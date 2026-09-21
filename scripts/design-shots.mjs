/**
 * Saves screenshots of the design preview (docs/DESIGN.md) into docs/design/shots/.
 *
 * Uses the Chrome already installed on the machine, driven over the DevTools
 * protocol with Node 22's built-in WebSocket — no new dependency for what is a
 * design-only artifact. Chrome's `--window-size` will not go below ~500px on
 * Windows, so the mobile width has to come from Emulation.setDeviceMetricsOverride.
 *
 *   pnpm --filter @steward/web dev        # in one terminal
 *   node scripts/design-shots.mjs         # in another
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
if (!CHROME) throw new Error('design-shots: no Chromium-based browser found');

const base = process.argv[2] ?? 'http://localhost:3000';
const outDir = resolve('docs/design/shots');
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'mobile-light', path: '/preview', width: 390, mobile: true },
  { name: 'mobile-dark', path: '/preview?theme=dark', width: 390, mobile: true },
  { name: 'desktop-light', path: '/preview', width: 1280, mobile: false },
  { name: 'desktop-dark', path: '/preview?theme=dark', width: 1280, mobile: false },
];

const port = 9333;
const profile = join(tmpdir(), `steward-shots-${process.pid}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('design-shots: Chrome did not expose a debugging target');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
    else events.get(msg.method)?.forEach((fn) => fn(msg.params));
  });
  return {
    ready: new Promise((r) => ws.addEventListener('open', r)),
    send: (method, params = {}) =>
      new Promise((r) => {
        const n = ++id;
        pending.set(n, r);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    once: (method) =>
      new Promise((r) => {
        const list = events.get(method) ?? [];
        list.push(r);
        events.set(method, list);
      }),
    close: () => ws.close(),
  };
}

try {
  const t = await target();
  const cdp = connect(t.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');

  for (const shot of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: shot.mobile,
    });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${base}${shot.path}` });
    await loaded;
    await sleep(900); // webfonts

    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(outDir, `${shot.name}.png`), Buffer.from(data, 'base64'));
    console.log('wrote', `${shot.name}.png`);
  }
  cdp.close();
} finally {
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Windows keeps a handle on the crashpad file; the temp dir is disposable */
  }
}

/**
 * Saves screenshots of the real app screens (fixture data, ?fixture=, needs DEMO_MODE=true pnpm dev) into docs/design/shots/app/.
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
const outDir = resolve('docs/design/shots/app');
mkdirSync(outDir, { recursive: true });

const widths = [
  { w: 390, mobile: true },
  { w: 1280, mobile: false },
];
const screens = [
  { name: 'landing', path: '/' },
  { name: 'connect', path: '/connect' },
  { name: 'onboarding', path: '/onboarding?fixture=onboarding' },
  { name: 'dashboard', path: '/app?fixture=1' },
  { name: 'dashboard-frozen', path: '/app?fixture=frozen' },
  { name: 'dashboard-safe', path: '/app?fixture=safe' },
  { name: 'activity', path: '/app/activity?fixture=1&open=fx-3' },
  // 7.6 signing surfaces
  { name: 'sign-limit', path: '/onboarding?fixture=sign-limit' },
  { name: 'sign-policy', path: '/onboarding?fixture=sign-policy' },
  { name: 'sign-sheets', path: '/preview/sign' },
  { name: 'sign-approval-sheet', path: '/preview/sign?sheet=1' },
  // 7.7 screens (their visual QA was deferred; done in 7.8)
  { name: 'approvals', path: '/app/approvals?fixture=1' },
  { name: 'policy', path: '/app/policy?fixture=1' },
  { name: 'recipients', path: '/app/recipients?fixture=1' },
  { name: 'settings', path: '/app/settings?fixture=1' },
  { name: 'settings-frozen', path: '/app/settings?fixture=frozen' },
  { name: 'close-account', path: '/app/close?fixture=1' },
  // 7.8 — the three steps of S9. `click` opens the modal; which step is live is decided by the
  // server's own owner-path status, so each fixture lands on a different step.
  { name: 'freeze-step1', path: '/app?fixture=1', click: '[aria-haspopup="dialog"]' },
  { name: 'freeze-step2', path: '/app?fixture=frozen', click: '[aria-haspopup="dialog"]' },
  { name: 'freeze-step3', path: '/app?fixture=freeze-sweep', click: '[aria-haspopup="dialog"]' },
];
const shots = [];
for (const s of screens)
  for (const { w, mobile } of widths)
    for (const theme of ['dark', 'light'])
      shots.push({
        name: `${s.name}-${w}-${theme}`,
        path: s.path,
        width: w,
        mobile,
        theme,
        ...(s.click ? { click: s.click } : {}),
      });
const port = 9334;
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
  await cdp.send('Runtime.enable');

  for (const shot of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: shot.mobile,
    });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: shot.theme }],
    });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${base}${shot.path}` });
    await loaded;
    await sleep(3500); // webfonts + first fetch
    if (shot.click) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(shot.click)})?.click()`,
      });
      await sleep(4000); // the modal fetches its own owner-path status before it can render
    }

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

/**
 * `SERV_LIVE_TESTS=1 pnpm test:record` — task 4.10.
 *
 * Runs the five reasoning tasks against the REAL SERV endpoint for the four worked examples in
 * SERV_REASONING §6 (A: idle cash, B: injected memo, C: conflicting constraints, D: vault risk),
 * and records each call as a fixture keyed by its request hash, including the SERV response `id`
 * (V-08: there is no x-request-id header).
 *
 * The recorded prompts contain no secrets and no addresses — that is enforced by the prompt
 * builder's field allowlist and proven by `packages/reasoning/test/prompts.test.ts` — so nothing is
 * scrubbed here: there is nothing to scrub.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContext, type Context } from '@steward/context';
import { Secret } from '@steward/shared';
import {
  LiveServClient,
  compileMandate,
  explain,
  propose,
  requestHash,
  screenUntrusted,
  verify,
  type ServClient,
  type ServFixture,
  type ServRequest,
  type ServTask,
} from '@steward/reasoning';
import {
  ALEX,
  DENY_VERDICT,
  EXAMPLES,
  PRIYA,
  TREASURY,
  USDC,
  VAULT,
} from '../../packages/reasoning/fixtures/examples';

function requireLiveTests(): void {
  if (process.env['SERV_LIVE_TESTS'] !== '1') {
    console.error(
      'test:record makes real SERV calls (they cost money and are shared with OpenServ). ' +
        'Re-run with SERV_LIVE_TESTS=1 to confirm.',
    );
    process.exit(1);
  }
}

function loadEnv(): void {
  try {
    process.loadEnvFile(new URL('../../.env.local', import.meta.url));
  } catch {
    // the shell may already carry the variables
  }
}

/** Wraps a client so every call is recorded. The key never passes through here. */
class Recording implements ServClient {
  readonly fixtures: ServFixture[] = [];
  constructor(private readonly inner: ServClient) {}
  async complete(req: ServRequest) {
    const res = await this.inner.complete(req);
    if (res.ok) {
      this.fixtures.push({
        requestHash: requestHash(req),
        task: req.task,
        model: req.model,
        response: {
          text: res.value.text,
          requestId: res.value.requestId,
          model: res.value.model,
          ...(res.value.usage ? { usage: res.value.usage } : {}),
        },
        recordedAt: new Date().toISOString(),
      });
      console.log(
        `  ${req.task.padEnd(8)} id=${res.value.requestId} model=${res.value.model} ` +
          `${res.value.latencyMs}ms tokens=${res.value.usage?.totalTokens ?? '?'}`,
      );
    } else {
      console.log(`  ${req.task.padEnd(8)} FAILED ${res.error.code}: ${res.error.message}`);
    }
    return res;
  }
}

async function main(): Promise<void> {
  requireLiveTests();
  loadEnv();
  const apiKey = process.env['SERV_API_KEY'];
  if (!apiKey) throw new Error('SERV_API_KEY is not set (put it in .env.local)');

  const baseURL = process.env['SERV_BASE_URL'] ?? 'https://inference-api.openserv.ai/v1';
  const proposerModel = process.env['SERV_MODEL_PROPOSER'] ?? 'gpt-5.4-mini';
  const verifierModel = process.env['SERV_MODEL_VERIFIER'] ?? proposerModel;

  const live = new LiveServClient({
    apiKey: new Secret(apiKey),
    baseURL,
    log: (f) => {
      if (f.outcome !== 'ok')
        console.log(`    retry/err ${f.task} ${f.outcome} attempt=${f.attempt}`);
    },
  });

  const models = await live.listModels();
  console.log(
    models.ok
      ? `models: ${models.value.length} available; proposer "${proposerModel}" present: ${models.value.includes(proposerModel)}, verifier "${verifierModel}" present: ${models.value.includes(verifierModel)}`
      : `models: could not list (${models.error.code}) — continuing`,
  );

  const client = new Recording(live);
  const all: ServFixture[] = [];
  const ids: string[] = [];

  for (const [name, input] of Object.entries(EXAMPLES)) {
    console.log(`\n── ${name} ───────────────────────────────`);
    const base = buildContext(input);
    const screen = await screenUntrusted({ client, model: proposerModel, items: base.untrusted });
    const ctx: Context = {
      ...base,
      screen: { injectionSuspected: screen.injectionSuspected, signals: screen.signals },
    };
    console.log(
      `  screen   injectionSuspected=${screen.injectionSuspected} signals=${screen.signals.length}`,
    );

    const proposed = await propose({
      client,
      model: proposerModel,
      ctx,
      usdcAddress: USDC,
      decimals: 6,
    });
    console.log(
      `  proposal ${proposed.proposal.kind} ${JSON.stringify(proposed.proposal.params, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}` +
        (proposed.issues.length > 0 ? ` REJECTED: ${proposed.issues.join('; ')}` : ''),
    );

    const verified = await verify({
      client,
      model: verifierModel,
      ctx,
      proposal: proposed.proposal,
      decimals: 6,
    });
    console.log(
      `  verifier ${verified.verifier.verdict} ${verified.verifier.reasons.join(' | ').slice(0, 120)}`,
    );
  }

  console.log('\n── explain ───────────────────────────────');
  const explained = await explain({ client, model: proposerModel, verdict: DENY_VERDICT });
  console.log(`  explain  fallback=${explained.fallback}: ${explained.text.slice(0, 160)}`);

  console.log('\n── compile (DEMO.md mandate) ─────────────');
  const compiled = await compileMandate({
    client,
    model: proposerModel,
    mandateText:
      'Keep 4 months of runway liquid, earn on the rest in approved vaults, pay my team on the 1st, ask me before anything over 15k.',
    binding: {
      chainId: 84532,
      treasuryAddress: TREASURY,
      usdcAddress: USDC,
      vaults: [
        { id: 'v1', name: 'Steward Demo USDC Vault', address: VAULT, maxAllocationBps: 5_000 },
      ],
      recipients: [
        { id: 'r_alex', label: 'Alex (contractor)', address: ALEX, maxPerTxMicroUsd: '3000000000' },
        {
          id: 'r_priya',
          label: 'Priya (designer)',
          address: PRIYA,
          maxPerTxMicroUsd: '2500000000',
        },
      ],
    },
  });
  console.log(
    `  compile  draft=${compiled.draft ? 'valid' : 'rejected'} issues=${compiled.issues.length}`,
  );
  for (const s of compiled.sentences) console.log(`    · ${s}`);
  for (const a of compiled.assumptions) console.log(`    assumption: ${a}`);
  for (const q of compiled.questions) console.log(`    question:   ${q}`);
  for (const i of compiled.issues) console.log(`    issue: ${i.path} ${i.code} ${i.message}`);

  all.push(...client.fixtures);
  for (const f of client.fixtures) ids.push(`${f.task}:${f.response.requestId}`);

  const dir = fileURLToPath(new URL('../../packages/reasoning/fixtures/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const byTask = new Map<ServTask, ServFixture[]>();
  for (const f of all) byTask.set(f.task, [...(byTask.get(f.task) ?? []), f]);
  for (const [task, fixtures] of byTask) {
    writeFileSync(`${dir}${task}.json`, `${JSON.stringify(fixtures, null, 2)}\n`);
    console.log(`\nwrote fixtures/${task}.json (${fixtures.length})`);
  }

  console.log('\nSERV request ids (record these in PROGRESS):');
  for (const id of ids) console.log(`  ${id}`);
}

await main();

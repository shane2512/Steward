// The worker process: pg-boss, the scheduled jobs, and the crash-window recovery that must run
// BEFORE the first tick (6.6 — `runIteration` refuses to propose for a wallet with an unresolved
// execution, but boot is where those get resolved in the first place).
import { PgBoss } from 'pg-boss';
import { createLogger, getEnv } from '@steward/shared';
import { createDb } from '@steward/db';
import { installUnhandledRejectionLogger } from '@steward/wallet';
import { registerJobs, resumeCrashWindow } from './jobs';
import {
  demoPriceRefresherFor,
  priceAdapterFor,
  publicClientFor,
  receiptKeyFor,
  senderFactory,
  servClientFor,
} from './runtime';

const log = createLogger('worker');
// D-1: AgentKit's un-awaited telemetry POST can reject and crash Node 22; log instead of dying.
installUnhandledRejectionLogger();

try {
  process.loadEnvFile(new URL('../../../.env.local', import.meta.url)); // shell env wins; file optional
} catch {
  /* env may come from the shell */
}
const env = getEnv();
const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (e) => log.error({ err: String(e) }, 'pg-boss error'));
await boss.start();

await boss.createQueue('health');
await boss.work('health', async (jobs) => {
  for (const job of jobs) log.info({ jobId: job.id }, 'health job ok');
});
await boss.send('health'); // one immediately, then every minute (cron minimum granularity)
await boss.schedule('health', '* * * * *');

const { db, pool } = createDb(env.DATABASE_URL);
const publicClient = publicClientFor(env);

// 6.6 — close the crash window first. An execution that reached the chain goes back to the
// confirmer; one that never did is marked failed; an ambiguous one becomes UNCERTAIN and is NEVER
// resent (PHASES "Do not").
const recovered = await resumeCrashWindow({ boss, db, publicClient });
if (recovered.resumed + recovered.uncertain + recovered.neverSent > 0)
  log.warn(recovered, 'crash window closed');

await registerJobs({
  boss,
  db,
  pool,
  env,
  publicClient,
  senderFor: senderFactory(env),
  receiptKey: receiptKeyFor(env),
  serv: servClientFor(env),
  priceAdapter: priceAdapterFor(env, publicClient),
  demoPrice: demoPriceRefresherFor(env),
});

log.info({ chainId: env.CHAIN_ID, demoMode: env.DEMO_MODE }, 'worker started');

const stop = async () => {
  await boss.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

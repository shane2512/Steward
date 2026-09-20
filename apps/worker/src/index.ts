// Worker skeleton (Phase 1): boots pg-boss and runs a recurring `health` job. Later phases add the decision loop.
import { PgBoss } from 'pg-boss';
import { createLogger, getEnv } from '@steward/shared';

const log = createLogger('worker');
// D-1: AgentKit's un-awaited telemetry POST can reject and crash Node 22; log instead of dying.
process.on('unhandledRejection', (reason) =>
  log.error({ reason: String(reason) }, 'unhandledRejection'),
);

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
log.info({ chainId: env.CHAIN_ID }, 'worker started');

const stop = async () => {
  await boss.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

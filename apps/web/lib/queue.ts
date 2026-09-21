// The web app's only link to the worker: a pg-boss queue insert.
//
// 6.8 — `/api/agent/run` and the approval handler ENQUEUE work; they never import the decision
// loop, the reasoning package or the executor. That keeps `check:arch`'s owner-path rules true by
// construction and means a compromised web process can ask for an iteration but cannot perform one:
// the worker still re-reads the policy, re-simulates, re-evaluates and re-verifies the signature.
import { PgBoss } from 'pg-boss';
import { getEnv } from '@steward/shared';

/** Queue names, duplicated here on purpose: importing apps/worker from apps/web is not allowed. */
export const LOOP_RUN_QUEUE = 'loop.run';
export const APPROVALS_EXECUTE_QUEUE = 'approvals.execute';

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

async function boss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const instance = new PgBoss(getEnv().DATABASE_URL);
    await instance.start();
    return instance;
  })();
  return g.__boss;
}

/** Enqueue one decision-loop iteration. Returns the job id, or null if pg-boss dropped it. */
export async function enqueueLoopRun(
  walletId: string,
  trigger: 'owner' | 'approval' = 'owner',
): Promise<string | null> {
  return (await boss()).send(LOOP_RUN_QUEUE, { walletId, trigger });
}

/** Enqueue the execution of an approval the owner has just signed. */
export async function enqueueApprovalExecution(approvalId: string): Promise<string | null> {
  return (await boss()).send(APPROVALS_EXECUTE_QUEUE, { approvalId });
}

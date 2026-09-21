// GET /api/dashboard: everything S4 needs in one owner-scoped read (API.md, PHASES 7.4). Read-only.
// It only aggregates what other services already decided; the browser computes nothing about funds.
import {
  countDeniedVerdicts,
  getActivePolicyBody,
  getVerdictForDecision,
  latestAgentAudit,
  listAgentDecisions,
  listApprovals,
  listObligationsUntil,
  listRecipients,
} from '@steward/db';
import { getEnv } from '@steward/shared';
import { getAddress } from 'viem';
import { z } from 'zod';
import type { Dashboard } from '@/lib/contracts';
import { toDecisionItem } from '@/lib/decisionView';
import { fixtureFor } from '@/lib/fixture';
import { fixtureDashboard } from '@/lib/fixtures';
import { loadLabels } from '@/lib/labels';
import { apiError } from '@/lib/server';
import { parkedFromAudit } from '@/lib/status';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';
import { loadWalletState } from '@/lib/walletState';

export const dynamic = 'force-dynamic';

/** The worker ticks every 5 min (30 s in demo); silence for 10 min on an active wallet means paused. */
const PAUSED_AFTER_MS = 10 * 60_000;

const zPolicyBody = z
  .object({
    runwayBufferMicroUsd: z.string(),
    limits: z.object({ perTxMicroUsd: z.string(), dailyMicroUsd: z.string() }),
  })
  .passthrough();

export async function GET(req: Request) {
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureDashboard(fx));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const env = getEnv();
  const state = await loadWalletState(owner, wallet);
  if (!state.ok) return apiError(502, 'rpc_error', state.message);
  const s = state.value;

  const now = new Date();
  const labels = await loadLabels(owner.db, wallet.id);
  const weekOut = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [rows, pending, blocked, lastAgent, policy, obligationRows, recipients] = await Promise.all(
    [
      listAgentDecisions(owner.db, wallet.id, { limit: 5 }),
      listApprovals(owner.db, wallet.id, 'pending'),
      countDeniedVerdicts(owner.db, wallet.id),
      latestAgentAudit(owner.db, wallet.id),
      getActivePolicyBody(owner.db, wallet.id),
      listObligationsUntil(owner.db, wallet.id, weekOut),
      listRecipients(owner.db, wallet.id),
    ],
  );

  const recent = [];
  for (const row of rows) {
    const v = await getVerdictForDecision(owner.db, row.id);
    recent.push(
      toDecisionItem(
        {
          id: row.id,
          trigger: row.trigger,
          status: row.status,
          proposal: row.proposal,
          createdAt: row.createdAt,
          verdict: v
            ? {
                decision: v.decision,
                policyVersion: v.policyVersion,
                evaluatedAt: v.evaluatedAt,
                results: v.results,
              }
            : null,
        },
        labels,
      ),
    );
  }

  const recipientById = new Map(recipients.map((r) => [r.id, r.label]));
  const parsedPolicy = policy ? zPolicyBody.safeParse(policy.body) : null;
  const paused =
    wallet.activePolicyVersion !== null &&
    !wallet.frozen &&
    lastAgent !== undefined &&
    now.getTime() - lastAgent.createdAt.getTime() > PAUSED_AFTER_MS;

  const body: Dashboard = {
    wallet: s.wallet,
    degraded: s.degraded,
    paused,
    lastLoopAt: lastAgent?.createdAt.toISOString() ?? null,
    demoMode: env.DEMO_MODE && env.CHAIN_ID === 84532,
    balances: s.balances,
    vault: s.vault
      ? {
          name: [...labels.vaults.values()][0] ?? 'Vault',
          address: getAddress(s.vault.address),
          shares: s.vault.shares,
          assets: s.vault.assets,
          apyPct: null, // no rate source is wired yet (D-72): the UI says "rate not reported"
        }
      : null,
    spendPermission: s.spendPermission,
    maxAtRiskMicroUsd: s.maxAtRiskMicroUsd,
    policy:
      policy && parsedPolicy?.success
        ? {
            version: policy.version,
            runwayBufferMicroUsd: parsedPolicy.data.runwayBufferMicroUsd,
            perTxMicroUsd: parsedPolicy.data.limits.perTxMicroUsd,
            dailyMicroUsd: parsedPolicy.data.limits.dailyMicroUsd,
          }
        : null,
    pendingApprovals: pending.length,
    obligations: obligationRows.map((o) => ({
      id: o.id,
      recipientLabel: recipientById.get(o.recipientId) ?? 'Recipient',
      amount: o.amount.toString(),
      dueDate: o.dueDate,
    })),
    recent,
    security: {
      blockedCount: blocked.count,
      lastCheckAt: lastAgent?.createdAt.toISOString() ?? null,
    },
    parked: parkedFromAudit(lastAgent),
    asOf: now.toISOString(),
  };
  return Response.json(body);
}

// GET /api/decisions/:id — one decision in full: the context snapshot, the proposal, the verifier,
// every rule result, the simulation and the audit trail for that decision.
//
// This is what makes a decision explainable and checkable by the owner (PRD NFR-4). The audit rows
// come from the append-only chain, so the timeline shows the same bytes `/api/audit/verify` hashes.
import { and, desc, eq } from 'drizzle-orm';
import {
  getAgentDecision,
  getSimulationForDecision,
  getVerdictForDecision,
  listAuditForEntity,
  schema,
} from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const { id } = await ctx.params;
  const decision = await getAgentDecision(owner.db, id);
  // Same 404 whether the row is missing or belongs to someone else: no enumeration oracle.
  if (!decision || decision.walletId !== wallet.id)
    return apiError(404, 'not_found', 'decision not found');

  const verdict = await getVerdictForDecision(owner.db, id);
  const simulation = await getSimulationForDecision(owner.db, id);
  const audit = await listAuditForEntity(owner.db, 'decision', id);
  const [execution] = await owner.db
    .select()
    .from(schema.executions)
    .where(and(eq(schema.executions.decisionId, id), eq(schema.executions.walletId, wallet.id)))
    .orderBy(desc(schema.executions.createdAt))
    .limit(1);
  const [approval] = await owner.db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.decisionId, id))
    .limit(1);

  return Response.json({
    decision: {
      id: decision.id,
      trigger: decision.trigger,
      status: decision.status,
      contextHash: decision.contextHash,
      contextSnapshot: decision.contextSnapshot,
      screen: decision.screen,
      proposal: decision.proposal,
      proposalHash: decision.proposalHash,
      proposalSource: decision.proposalSource,
      verifier: decision.verifier,
      // Model, prompt version and SERV request ids — never prompt bodies (SECURITY §6).
      servMeta: decision.servMeta,
      createdAt: decision.createdAt.toISOString(),
    },
    verdict: verdict
      ? {
          decision: verdict.decision,
          results: verdict.results,
          policyVersion: verdict.policyVersion,
          evaluatedAt: verdict.evaluatedAt.toISOString(),
        }
      : null,
    simulation: simulation
      ? {
          ok: simulation.ok,
          callsHash: simulation.callsHash,
          deltas: simulation.deltas,
          error: simulation.error,
          blockNumber: simulation.blockNumber?.toString() ?? null,
        }
      : null,
    execution: execution
      ? {
          id: execution.id,
          status: execution.status,
          kind: execution.kind,
          txHash: execution.txHash,
          userOpHash: execution.userOpHash,
          error: execution.error,
          createdAt: execution.createdAt.toISOString(),
          confirmedAt: execution.confirmedAt?.toISOString() ?? null,
        }
      : null,
    approval: approval
      ? {
          id: approval.id,
          status: approval.status,
          message: approval.message,
          expiresAt: approval.expiresAt.toISOString(),
        }
      : null,
    audit: audit.map((a) => ({
      id: a.id,
      event: a.event,
      actor: a.actor,
      payload: a.payload,
      rowHash: a.rowHash,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

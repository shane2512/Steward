// GET /api/decisions/:id: one decision in full, in plain language: the facts the agent saw, the
// proposal, the verifier, every rule check with its sentence, the simulation and the transaction.
//
// This is what makes a decision explainable and checkable by the owner (PRD NFR-4). It presents the
// stored rows; the rule sentences come from the same `ruleSentences` table the engine's explainer
// uses. Raw JSON blobs (context snapshot, audit payloads, prompt bodies) are never returned (I9).
import { and, desc, eq } from 'drizzle-orm';
import {
  getAgentDecision,
  getSimulationForDecision,
  getVerdictForDecision,
  schema,
} from '@steward/db';
import type { DecisionDetail } from '@/lib/contracts';
import {
  checksFrom,
  contextFacts,
  decisionTitle,
  oneLine,
  parseProposal,
  proposalAmount,
  screenView,
  simDeltas,
  verifierView,
  whyBlocked,
} from '@/lib/decisionView';
import { fixtureFor } from '@/lib/fixture';
import { fixtureDecisionDetail } from '@/lib/fixtures';
import { loadLabels } from '@/lib/labels';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fx = fixtureFor(req);
  if (fx) {
    const d = fixtureDecisionDetail(id);
    return d ? Response.json(d) : apiError(404, 'not_found', 'decision not found');
  }

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  // A non-uuid id would make Postgres throw; treat it as "not found" like any other miss.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, 'not_found', 'decision not found');
  const decision = await getAgentDecision(owner.db, id);
  // Same 404 whether the row is missing or belongs to someone else: no enumeration oracle.
  if (!decision || decision.walletId !== wallet.id)
    return apiError(404, 'not_found', 'decision not found');

  const verdict = await getVerdictForDecision(owner.db, id);
  const simulation = await getSimulationForDecision(owner.db, id);
  const [execution] = await owner.db
    .select()
    .from(schema.executions)
    .where(and(eq(schema.executions.decisionId, id), eq(schema.executions.walletId, wallet.id)))
    .orderBy(desc(schema.executions.createdAt))
    .limit(1);

  const labels = await loadLabels(owner.db, wallet.id);
  const checks = checksFrom(verdict?.results);
  const proposal = parseProposal(decision.proposal);
  const explanation = oneLine(verdict?.decision ?? null, checks, decision.status);

  const body: DecisionDetail = {
    decision: {
      id: decision.id,
      trigger: decision.trigger,
      status: decision.status,
      title: decisionTitle(decision.proposal, labels, decision.status),
      explanation,
      proposalSource: decision.proposalSource,
      proposalKind: proposal?.kind ?? null,
      rationale: proposal?.rationale ?? null,
      amount: proposalAmount(decision.proposal),
      contextHash: decision.contextHash,
      contextFacts: contextFacts(decision.contextSnapshot),
      screen: screenView(decision.screen),
      verifier: verifierView(decision.verifier),
      createdAt: decision.createdAt.toISOString(),
    },
    verdict: verdict
      ? {
          decision: verdict.decision,
          policyVersion: verdict.policyVersion,
          evaluatedAt: verdict.evaluatedAt.toISOString(),
          checks,
        }
      : null,
    simulation: simulation
      ? { ok: simulation.ok, error: simulation.error, deltas: simDeltas(simulation.deltas) }
      : null,
    execution: execution
      ? {
          status: execution.status,
          txHash: execution.txHash,
          error: execution.error,
          confirmedAt: execution.confirmedAt?.toISOString() ?? null,
        }
      : null,
    whyBlocked: whyBlocked(verdict?.decision ?? null, checks),
  };
  return Response.json(body);
}

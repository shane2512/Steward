// 5.4 / 5.6 / 5.7 — the executor, against a REAL Postgres, because every guarantee it makes
// (single-use nonce, one execution per proposal hash, atomicity under concurrency) is enforced by
// database constraints. A mocked db would test the mock.
//
// No network: the send capability is the injected `TxSender` port, and these tests inject a
// recording stub. The same port is filled by a local anvil account in test/fork and by the CDP
// smart account in scripts/live.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAddress } from 'viem';
import { hashProposal, signReceipt } from '@steward/policy';
import {
  schema,
  type Db,
  claimExecutionSlot,
  getExecutionById,
  listUnresolvedExecutions,
} from '@steward/db';
import type { AllowReceipt, Policy, Proposal, Verdict } from '@steward/shared';
import { freshTestDb } from '../../db/test/helpers';
import { buildCalls, callsHash, execute, type Call, type TxSender } from '../src';

const ADDR = {
  usdc: getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  vault: getAddress('0x3741f0da6dFFfFD8Be2353e326a49E41a3396485'),
  treasury: getAddress('0xE72B889052382487604b7A92E8F7fB1a5937F242'),
  agent: getAddress('0xE967db385aF313Cc6CA006a745fc929A201F58A2'),
  owner: getAddress('0xC388F1602dF570289825ac907a1C3D80A2916924'),
  alex: getAddress('0x1111111111111111111111111111111111111111'),
  manager: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
} as const;

const usdc = (n: number) => BigInt(n) * 1_000_000n;
const NOW = new Date('2026-09-21T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

let db: Db;
let pool: { end(): Promise<void> };
let walletId: string;
let decisionId: string;
let userId: string;

function policyFor(walletIdValue: string): Policy {
  return {
    version: 3,
    walletId: walletIdValue,
    chainId: 84532,
    treasuryAddress: ADDR.treasury,
    tokens: [{ symbol: 'USDC', address: ADDR.usdc, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Steward Demo Vault',
        address: ADDR.vault,
        asset: ADDR.usdc,
        kind: 'erc4626',
        maxAllocationBps: 5_000,
      },
    ],
    recipients: [{ id: 'alex', label: 'Alex', address: ADDR.alex, maxPerTxMicroUsd: usdc(5_000) }],
    limits: { perTxMicroUsd: usdc(50_000), dailyMicroUsd: usdc(60_000), maxActionsPerHour: 10 },
    runwayBufferMicroUsd: 0n,
    approvalThresholdMicroUsd: usdc(15_000),
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: ['pay_recipient', 'sweep_home', 'noop'],
    createdAt: '2026-09-20T09:00:00.000Z',
    signedBy: ADDR.owner,
    signature: '0xdeadbeef',
  } as Policy;
}

const payProposal = (amount = usdc(3_000)): Proposal => ({
  kind: 'pay_recipient',
  params: { recipientId: 'alex', amount },
  expectedDeltas: [
    { token: ADDR.usdc, holder: 'agent', delta: -amount },
    { token: ADDR.usdc, holder: 'recipient', delta: amount },
  ],
  rationale: 'Alex is due today.',
  citedFactIds: ['F_OBLIGATION_1'],
  confidence: 0.9,
  source: 'deterministic',
});

const buildContext = {
  agentWalletAddress: ADDR.agent,
  spendPermissionManagerAddress: ADDR.manager,
  agentUsdcBalance: usdc(10_000),
  vaultPositions: {},
  allowMainnet: false,
};

function verdictFor(proposal: Proposal, policy: Policy): Verdict {
  return {
    decision: 'ALLOW',
    results: [{ code: 'R00', result: 'PASS' }],
    proposalHash: hashProposal(proposal),
    policyVersion: policy.version,
    walletId: policy.walletId,
    evaluatedAt: NOW.toISOString(),
  };
}

function receiptFor(proposal: Proposal, policy: Policy, nonce: string, at = NOW): AllowReceipt {
  const calls = buildCalls(proposal, policy, buildContext);
  if (!calls.ok) throw new Error(`buildCalls failed: ${calls.error.message}`);
  const signed = signReceipt(verdictFor(proposal, policy), KEY, at, nonce, {
    callsHash: callsHash(calls.value),
  });
  if (!signed.ok) throw new Error(`signReceipt failed: ${signed.error.message}`);
  return signed.value;
}

/** Recording stub for the only send-capable port in the system. */
function recordingSender(
  behaviour: (attempt: number) => Promise<{ userOpHash?: `0x${string}`; txHash?: `0x${string}` }>,
): TxSender & { sent: Call[][]; attempts: number } {
  const sender = {
    sent: [] as Call[][],
    attempts: 0,
    getAddress: () => ADDR.agent,
    async send(calls: readonly Call[]) {
      sender.attempts += 1;
      sender.sent.push([...calls]);
      return behaviour(sender.attempts);
    },
  };
  return sender;
}

const okSender = () =>
  recordingSender(async () => ({
    userOpHash: `0x${'aa'.repeat(32)}`,
    txHash: `0x${'bb'.repeat(32)}`,
  }));

let seedCounter = 0;

async function seed() {
  const ownerAddress = getAddress(`0x${(++seedCounter).toString(16).padStart(40, '0')}`);
  const [user] = await db.insert(schema.users).values({ ownerAddress }).returning();
  userId = user!.id;
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId,
      chainId: 84532,
      treasuryAddress: ADDR.treasury,
      agentWalletAddress: getAddress(`0x${`a${seedCounter}`.padStart(40, '0')}`),
      activePolicyVersion: 3,
    })
    .returning();
  walletId = wallet!.id;
  await db.insert(schema.policies).values({
    walletId,
    version: 3,
    body: JSON.parse(
      JSON.stringify(policyFor(walletId), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ),
    bodyHash: `0x${'11'.repeat(32)}`,
    status: 'active',
  });
  const [decision] = await db
    .insert(schema.agentDecisions)
    .values({
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'22'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'allowed',
    })
    .returning();
  decisionId = decision!.id;
}

const nonces = (() => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
})();

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
}, 60_000);

afterAll(async () => {
  await pool.end();
});

// A fresh wallet per test, rather than truncating: `audit_log` is append-only (I6) and refuses
// DELETE, which is exactly the guarantee we do not want to work around in our own tests.
beforeEach(seed);

const deps = (sender: TxSender, sleeps?: number[]) => ({
  db,
  sender,
  receiptKey: KEY,
  now: () => NOW,
  sleep: async (ms: number) => {
    sleeps?.push(ms);
  },
});

function inputFor(proposal: Proposal, receipt: AllowReceipt, policy = policyFor(walletId)) {
  const calls = buildCalls(proposal, policy, buildContext);
  if (!calls.ok) throw new Error('buildCalls failed');
  return {
    walletId,
    decisionId,
    proposal,
    policy,
    receipt,
    buildContext,
    simulatedCallsHash: callsHash(calls.value),
  };
}

const auditEvents = async () =>
  (
    await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.walletId, walletId))
      .orderBy(schema.auditLog.id)
  ).map((r) => r.event);

const executionRows = () =>
  db.select().from(schema.executions).where(eq(schema.executions.walletId, walletId));

describe('executor — happy path', () => {
  it('sends exactly the calls the receipt authorises and records both hashes', async () => {
    const policy = policyFor(walletId);
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policy, nonces());
    const sender = okSender();

    const result = await execute(deps(sender), inputFor(proposal, receipt, policy));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('submitted');

    expect(sender.attempts).toBe(1);
    const built = buildCalls(proposal, policy, buildContext);
    expect(built.ok && sender.sent[0]).toEqual(built.ok ? built.value : undefined);

    const row = await getExecutionById(db, result.value.execution.id);
    expect(row?.status).toBe('submitted');
    expect(row?.userOpHash).toBe(`0x${'aa'.repeat(32)}`);
    expect(row?.txHash).toBe(`0x${'bb'.repeat(32)}`);
    expect(row?.callsHash).toBe(receipt.callsHash);

    // I6: the intent row is written BEFORE the send, the submission after it.
    expect(await auditEvents()).toEqual(['EXECUTION_PENDING', 'EXECUTION_SUBMITTED']);
  });

  it('burns the receipt nonce', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    await execute(deps(okSender()), inputFor(proposal, receipt));
    const [nonce] = await db
      .select()
      .from(schema.receiptNonces)
      .where(eq(schema.receiptNonces.nonce, receipt.nonce));
    expect(nonce?.usedAt).toEqual(NOW);
  });
});

describe('executor — idempotency (I10)', () => {
  it('a duplicate call with the SAME receipt returns the same execution and does not resend', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    const sender = okSender();

    const first = await execute(deps(sender), inputFor(proposal, receipt));
    const second = await execute(deps(sender), inputFor(proposal, receipt));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.status).toBe('duplicate');
    expect(second.value.execution.id).toBe(first.value.execution.id);
    expect(sender.attempts).toBe(1);
  });

  it('a FRESH receipt for the same proposal hash is still a duplicate — nothing is sent twice', async () => {
    const proposal = payProposal();
    const policy = policyFor(walletId);
    const sender = okSender();
    await execute(deps(sender), inputFor(proposal, receiptFor(proposal, policy, nonces()), policy));
    const again = await execute(
      deps(sender),
      inputFor(proposal, receiptFor(proposal, policy, nonces()), policy),
    );
    expect(again.ok && again.value.status).toBe('duplicate');
    expect(sender.attempts).toBe(1);
  });

  it('concurrent executes of the same proposal hash produce exactly one send and one row', async () => {
    const proposal = payProposal();
    const policy = policyFor(walletId);
    const sender = okSender();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        execute(deps(sender), inputFor(proposal, receiptFor(proposal, policy, nonces()), policy)),
      ),
    );
    const submitted = results.filter((r) => r.ok && r.value.status === 'submitted');
    expect(submitted).toHaveLength(1);
    expect(sender.attempts).toBe(1);
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
  });

  it('a replayed nonce on a DIFFERENT proposal is refused outright', async () => {
    const policy = policyFor(walletId);
    const first = payProposal(usdc(1_000));
    const nonce = nonces();
    await execute(deps(okSender()), inputFor(first, receiptFor(first, policy, nonce), policy));

    // Re-mint a receipt for a different action, reusing the burned nonce.
    const second = payProposal(usdc(2_000));
    const calls = buildCalls(second, policy, buildContext);
    if (!calls.ok) throw new Error('build failed');
    const forged = signReceipt(verdictFor(second, policy), KEY, NOW, nonce, {
      callsHash: callsHash(calls.value),
    });
    if (!forged.ok) throw new Error('sign failed');

    const sender = okSender();
    const result = await execute(deps(sender), inputFor(second, forged.value, policy));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NONCE_REPLAYED');
    expect(result.error.class).toBe('fatal');
    expect(sender.attempts).toBe(0);
  });
});

describe('executor — receipt gate', () => {
  const policy = () => policyFor(walletId);

  it('refuses an expired receipt', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policy(), nonces(), new Date(NOW.getTime() - 300_000));
    const sender = okSender();
    const result = await execute(deps(sender), inputFor(proposal, receipt));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RECEIPT_INVALID');
    expect(result.error.message).toContain('EXPIRED');
    expect(sender.attempts).toBe(0);
    expect(await executionRows()).toHaveLength(0);
  });

  it('refuses a receipt issued in the future', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policy(), nonces(), new Date(NOW.getTime() + 60_000));
    const result = await execute(deps(okSender()), inputFor(proposal, receipt));
    expect(result.ok === false && result.error.message).toContain('NOT_YET_VALID');
  });

  it.each([
    ['proposalHash', { proposalHash: `0x${'9'.repeat(64)}` }],
    ['policyVersion', { policyVersion: 99 }],
    ['walletId', { walletId: 'someone-else' }],
    ['nonce', { nonce: '11111111-1111-4111-8111-111111111111' }],
    ['issuedAt', { issuedAt: new Date(NOW.getTime() - 1000).toISOString() }],
    ['expiresAt', { expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }],
    ['callsHash', { callsHash: `0x${'c'.repeat(64)}` }],
    ['mac', { mac: `0x${'d'.repeat(64)}` }],
  ])('refuses a receipt with a tampered %s', async (_field, patch) => {
    const proposal = payProposal();
    const receipt = { ...receiptFor(proposal, policy(), nonces()), ...patch } as AllowReceipt;
    const sender = okSender();
    const result = await execute(deps(sender), inputFor(proposal, receipt));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RECEIPT_INVALID');
    expect(sender.attempts).toBe(0);
  });

  it('refuses a receipt signed with a different key', async () => {
    const proposal = payProposal();
    const calls = buildCalls(proposal, policy(), buildContext);
    if (!calls.ok) throw new Error('build failed');
    const other = signReceipt(
      verdictFor(proposal, policy()),
      new Uint8Array(32).fill(9),
      NOW,
      nonces(),
      {
        callsHash: callsHash(calls.value),
      },
    );
    if (!other.ok) throw new Error('sign failed');
    const result = await execute(deps(okSender()), inputFor(proposal, other.value));
    expect(result.ok === false && result.error.message).toContain('BAD_MAC');
  });
});

describe('executor — simulation parity', () => {
  it('refuses when the simulated calls hash differs from the built one', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    const sender = okSender();
    const input = {
      ...inputFor(proposal, receipt),
      simulatedCallsHash: `0x${'e'.repeat(64)}` as const,
    };
    const result = await execute(deps(sender), input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CALLS_MISMATCH');
    expect(result.error.class).toBe('fatal');
    expect(sender.attempts).toBe(0);
    expect(await executionRows()).toHaveLength(0);
  });

  it('refuses when the policy changed the recipient address after the receipt was signed', async () => {
    // The receipt binds the exact bytes: repointing the recipient changes the calls hash, so the
    // receipt no longer authorises them (D-27).
    const proposal = payProposal();
    const original = policyFor(walletId);
    const receipt = receiptFor(proposal, original, nonces());
    const repointed: Policy = {
      ...original,
      recipients: [
        {
          ...original.recipients[0]!,
          address: getAddress('0x3333333333333333333333333333333333333333'),
        },
      ],
    };
    const result = await execute(deps(okSender()), inputFor(proposal, receipt, repointed));
    expect(result.ok === false && result.error.code).toBe('RECEIPT_INVALID');
  });
});

describe('executor — frozen / breaker (I7)', () => {
  it('cancels when the wallet was frozen between verdict and send, without sending', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    await db.update(schema.wallets).set({ frozen: true }).where(eq(schema.wallets.id, walletId));

    const sender = okSender();
    const result = await execute(deps(sender), inputFor(proposal, receipt));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('cancelled');
    expect(sender.attempts).toBe(0);
    const row = await getExecutionById(db, result.value.execution.id);
    expect(row?.status).toBe('cancelled');
    expect(await auditEvents()).toContain('EXECUTION_CANCELLED');
  });

  it('cancels when the breaker is open', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    await db
      .update(schema.wallets)
      .set({ breakerOpen: true })
      .where(eq(schema.wallets.id, walletId));
    const sender = okSender();
    const result = await execute(deps(sender), inputFor(proposal, receipt));
    expect(result.ok && result.value.status).toBe('cancelled');
    expect(sender.attempts).toBe(0);
  });

  it('still sends an owner sweep_home while frozen', async () => {
    const policy = policyFor(walletId);
    const sweep: Proposal = {
      kind: 'sweep_home',
      params: {},
      expectedDeltas: [
        { token: ADDR.usdc, holder: 'agent', delta: -usdc(10_000) },
        { token: ADDR.usdc, holder: 'treasury', delta: usdc(10_000) },
      ],
      rationale: 'Owner sweep.',
      citedFactIds: [],
      confidence: 1,
      source: 'owner',
    };
    const receipt = receiptFor(sweep, policy, nonces());
    await db.update(schema.wallets).set({ frozen: true }).where(eq(schema.wallets.id, walletId));
    const sender = okSender();
    const result = await execute(deps(sender), inputFor(sweep, receipt, policy));
    expect(result.ok && result.value.status).toBe('submitted');
    expect(sender.attempts).toBe(1);
  });
});

describe('executor — error taxonomy (5.6)', () => {
  it('retries a retryable failure on the SAME row with the 1/2/4 minute backoff', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    const sleeps: number[] = [];
    const sender = recordingSender(async (attempt) => {
      if (attempt < 3) throw new Error('fetch failed: ECONNRESET');
      return { userOpHash: `0x${'aa'.repeat(32)}` };
    });

    const result = await execute(deps(sender, sleeps), inputFor(proposal, receipt));
    expect(result.ok && result.value.status).toBe('submitted');
    expect(sender.attempts).toBe(3);
    expect(sleeps).toEqual([60_000, 120_000]);
    expect(await executionRows()).toHaveLength(1);
  });

  it('gives up after 4 attempts and marks the row FAILED', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    const sleeps: number[] = [];
    const sender = recordingSender(async () => {
      throw new Error('paymaster rejected: sponsorship unavailable');
    });

    const result = await execute(deps(sender, sleeps), inputFor(proposal, receipt));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SPONSORSHIP');
    expect(sender.attempts).toBe(4);
    expect(sleeps).toEqual([60_000, 120_000, 240_000]);
    const [row] = await executionRows();
    expect(row?.status).toBe('failed');
  });

  it('never retries a fatal failure', async () => {
    const proposal = payProposal();
    const receipt = receiptFor(proposal, policyFor(walletId), nonces());
    const sleeps: number[] = [];
    const sender = recordingSender(async () => {
      throw new Error('execution reverted: ERC20: transfer amount exceeds balance');
    });

    const result = await execute(deps(sender, sleeps), inputFor(proposal, receipt));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.class).toBe('fatal');
    expect(sender.attempts).toBe(1);
    expect(sleeps).toEqual([]);
    const [row] = await executionRows();
    expect(row?.status).toBe('failed');
    expect(await auditEvents()).toContain('EXECUTION_FAILED');
  });
});

describe('claimExecutionSlot (the DB half of I10)', () => {
  it('leaves a pending intent row that shows up as the crash window', async () => {
    const claim = await claimExecutionSlot(db, {
      nonce: nonces(),
      issuedAt: NOW,
      usedAt: NOW,
      walletId,
      decisionId,
      proposalHash: `0x${'7'.repeat(64)}`,
      kind: 'pay_recipient',
      callsHash: `0x${'8'.repeat(64)}`,
    });
    expect(claim.ok && claim.value.created).toBe(true);
    expect(claim.ok && claim.value.execution.status).toBe('pending');
    expect(await listUnresolvedExecutions(db, walletId)).toHaveLength(1);
  });
});

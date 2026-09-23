// 9.1 — `pnpm db:seed:demo`. DB-only: no chain calls, no CDP. Populates what DEMO.md's beats need
// (owner, recipients, an obligation due today, the "Startup Operating" policy) so the checklist page
// and a rehearsal have something to show against. Idempotent (safe to re-run) and I11-fenced (refuses
// outside DEMO_MODE on chain 84532).
//
// Policy construction reuses `packages/policy`'s `policyDraftFromTemplate` — the same path onboarding
// uses — and activation reuses `activatePolicyVersion` + the exact body/hash/message shape
// `apps/web/lib/policyDraft.ts` computes for the real UI, signed by a real (test-only) private key
// rather than faked, so nothing here bypasses the signature check the real route enforces.
import { getAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { eq, and } from 'drizzle-orm';
import {
  createDb,
  schema,
  upsertUserByAddress,
  ensureWalletForUser,
  insertRecipient,
  listRecipients,
  appendAudit,
  activatePolicyVersion,
  getActivePolicy,
  type Db,
} from '@steward/db';
import { getEnv, canonicalJson, hashCanonical, policyActivationMessage, type Env } from '@steward/shared';
import { policyDraftFromTemplate, type TemplateBinding } from '@steward/policy';
import { recipientBindings } from '../../apps/web/lib/policyDraft';
import { loadEnv } from '../live/lib';

/** Foundry/Anvil's well-known default test account #0. Public, never holds real funds. */
export const DEMO_OWNER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
export const DEMO_OWNER_ADDRESS: Address = getAddress(
  privateKeyToAccount(DEMO_OWNER_PRIVATE_KEY).address,
);
export const DEMO_ALEX_ADDRESS: Address = getAddress('0x1111111111111111111111111111111111111111');
export const DEMO_PRIYA_ADDRESS: Address = getAddress('0x2222222222222222222222222222222222222222');

const usdc = (whole: number) => (BigInt(whole) * 1_000_000n).toString();

export type SeedResult = {
  userId: string;
  walletId: string;
  policyVersion: number;
  policyCreated: boolean;
  obligationIds: string[];
};

export function assertDemoModeAllowed(env: Pick<Env, 'DEMO_MODE' | 'CHAIN_ID'>): void {
  if (!env.DEMO_MODE || env.CHAIN_ID !== 84532) {
    throw new Error('db:seed:demo refuses: requires DEMO_MODE=true and CHAIN_ID=84532 (I11)');
  }
}

/** Everything 9.1 asks for. Callable directly (tests) or from `main()` below (CLI). */
export async function seedDemo(db: Db, env: Env, now: Date): Promise<SeedResult> {
  assertDemoModeAllowed(env);

  const user = await upsertUserByAddress(db, DEMO_OWNER_ADDRESS, now);
  const wallet = await ensureWalletForUser(db, user.id, env.CHAIN_ID, DEMO_OWNER_ADDRESS);

  // A human-provisioned live agent wallet can be attached for a full on-chain rehearsal; harmless to
  // leave unset for a DB-only seed (the /demo checklist still shows the rest).
  const liveAgent = process.env['DEMO_AGENT_WALLET_ADDRESS'];
  if (liveAgent && getAddress(liveAgent) !== wallet.agentWalletAddress) {
    await db
      .update(schema.wallets)
      .set({ agentWalletAddress: getAddress(liveAgent) })
      .where(eq(schema.wallets.id, wallet.id));
  }

  // ── vault row (DEMO.md: one allowlisted USDC vault) ───────────────────────────────────────────
  const vaultAddress = env.MOCK_VAULT_ADDRESS;
  const vaultsBinding: TemplateBinding['vaults'] = vaultAddress
    ? [
        {
          id: 'v1',
          name: 'Steward Demo USDC Vault',
          address: getAddress(vaultAddress),
          maxAllocationBps: 10_000,
        },
      ]
    : [];
  if (!vaultAddress) {
    console.warn(
      'MOCK_VAULT_ADDRESS is not set — seeding without a vault; deploy one first (scripts/live/deploy-contracts.ts) for a full rehearsal',
    );
  } else {
    await db
      .insert(schema.vaults)
      .values({
        id: 'v1',
        walletId: wallet.id,
        name: 'Steward Demo USDC Vault',
        address: getAddress(vaultAddress),
        assetAddress: getAddress(env.USDC_ADDRESS),
        kind: 'erc4626',
        maxAllocationBps: 10_000,
      })
      .onConflictDoUpdate({
        target: [schema.vaults.id, schema.vaults.walletId],
        set: { address: getAddress(vaultAddress), flagged: false, flaggedReason: null },
      });
  }

  // ── recipients (DEMO.md's cast: Alex the contractor, Priya the designer) ─────────────────────
  const recipientsBinding: TemplateBinding['recipients'] = [
    {
      id: 'alex',
      label: 'Alex (contractor)',
      address: DEMO_ALEX_ADDRESS,
      maxPerTxMicroUsd: usdc(50_000),
      schedule: { dayOfMonth: 1, amountMicroUsd: usdc(3_000) },
    },
    {
      id: 'priya',
      label: 'Priya (designer)',
      address: DEMO_PRIYA_ADDRESS,
      maxPerTxMicroUsd: usdc(50_000),
      schedule: { dayOfMonth: 1, amountMicroUsd: usdc(2_500) },
    },
  ];
  const recipientRowIds = new Map<string, string>();
  for (const r of recipientsBinding) {
    const inserted = await insertRecipient(db, {
      walletId: wallet.id,
      label: r.label,
      address: r.address,
      maxPerTx: BigInt(r.maxPerTxMicroUsd),
      schedule: r.schedule,
      addedSignature: '0xdemo', // demo seed, not an owner-signed add (F-1 residual — not I4/I5-relevant)
    });
    const row =
      inserted ??
      (await listRecipients(db, wallet.id)).find(
        (x) => getAddress(x.address) === r.address && x.status === 'active',
      );
    if (!row) throw new Error(`seedDemo: could not resolve recipient row for ${r.label}`);
    recipientRowIds.set(r.id, row.id);
  }

  // ── the policy: the exact "Startup Operating" template values from DEMO.md ───────────────────
  const draft = policyDraftFromTemplate('startup', {
    chainId: 84532,
    treasuryAddress: DEMO_OWNER_ADDRESS,
    usdcAddress: getAddress(env.USDC_ADDRESS),
    vaults: vaultsBinding,
    recipients: recipientsBinding,
  });
  if (!draft.ok) {
    throw new Error(`seedDemo: template produced an invalid draft: ${JSON.stringify(draft.error)}`);
  }

  const existingActive = await getActivePolicy(db, wallet.id);
  let policyVersion: number;
  let policyCreated = false;
  if (existingActive) {
    policyVersion = existingActive.version;
    console.log(`policy v${policyVersion} already active; leaving it as-is`);
  } else {
    const recipientRows = await listRecipients(db, wallet.id);
    policyVersion = 1;
    const unsigned = JSON.parse(
      canonicalJson({
        ...draft.value,
        version: policyVersion,
        walletId: wallet.id,
        chainId: env.CHAIN_ID,
        treasuryAddress: DEMO_OWNER_ADDRESS,
        recipients: recipientBindings(recipientRows),
        createdAt: now.toISOString(),
        signedBy: DEMO_OWNER_ADDRESS,
        signature: undefined,
      }),
    ) as Record<string, unknown>;
    const bodyHash = hashCanonical(unsigned);
    const message = policyActivationMessage({ version: policyVersion, bodyHash });
    const signature = await privateKeyToAccount(DEMO_OWNER_PRIVATE_KEY).signMessage({ message });

    await activatePolicyVersion(db, {
      walletId: wallet.id,
      version: policyVersion,
      mandateId: null,
      body: { ...unsigned, signature },
      bodyHash,
      signature,
      now,
    });
    policyCreated = true;
    console.log(`activated policy v${policyVersion} (${bodyHash})`);
  }

  // ── an obligation due TODAY for each recipient, so a fresh seed always has something due ────
  const today = now.toISOString().slice(0, 10);
  const obligationIds: string[] = [];
  for (const r of recipientsBinding) {
    const recipientId = recipientRowIds.get(r.id)!;
    await db
      .delete(schema.obligations)
      .where(
        and(eq(schema.obligations.walletId, wallet.id), eq(schema.obligations.recipientId, recipientId)),
      );
    const [row] = await db
      .insert(schema.obligations)
      .values({
        walletId: wallet.id,
        recipientId,
        amount: BigInt(r.schedule!.amountMicroUsd),
        dueDate: today,
        recurrence: 'monthly',
      })
      .returning();
    if (row) obligationIds.push(row.id);
  }

  await appendAudit(db, {
    walletId: wallet.id,
    actor: 'system',
    event: 'DEMO_SEEDED',
    entityType: 'wallet',
    entityId: wallet.id,
    payload: { policyVersion, policyCreated, obligations: obligationIds.length },
    createdAt: now,
  });

  return { userId: user.id, walletId: wallet.id, policyVersion, policyCreated, obligationIds };
}

async function main(): Promise<void> {
  loadEnv();
  const env = getEnv();
  assertDemoModeAllowed(env);
  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const result = await seedDemo(db, env, new Date());
    console.log(
      `seeded: user ${result.userId} · wallet ${result.walletId} · policy v${result.policyVersion}` +
        ` (${result.policyCreated ? 'created' : 'existing'}) · ${result.obligationIds.length} obligations due today`,
    );
    console.log(`demo owner address: ${DEMO_OWNER_ADDRESS}`);
  } finally {
    await pool.end();
  }
}

// Only run as a CLI entrypoint, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

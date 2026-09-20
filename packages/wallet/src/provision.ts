// 2.3 — provision one agent operating wallet per owner. Idempotent.
//
// D-3: `CdpSmartWalletProvider` cannot create a *named* wallet (V-03), so the named CDP accounts are
// created through the CDP client here and the resulting owner + smart-account name are what
// `buildAgentKit` reloads later. Names are derived from the userId, so a retry (or a concurrent
// request) re-uses the same accounts instead of minting a second wallet.
import { getAddress } from 'viem';
import { and, eq, isNull } from 'drizzle-orm';
import { appendAudit, schema, type Db } from '@steward/db';
import { err, ok, type Address, type Result } from '@steward/shared';
import type { CdpAccounts } from './agentkit';
import { assertChainAllowed } from './chain';

/** CDP account names: alphanumeric + hyphen, 2..36 chars, unique per CDP project (V-03). */
const NAME_RE = /^[A-Za-z0-9-]{2,36}$/;

/** `sto-<32 hex>` / `sta-<32 hex>` = 36 chars exactly, derived from the user's uuid. */
export function cdpAccountNames(userId: string): Result<{ owner: string; smartAccount: string }> {
  const compact = userId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return err(`userId is not a uuid: ${userId}`);
  const names = { owner: `sto-${compact}`, smartAccount: `sta-${compact}` };
  if (!NAME_RE.test(names.owner) || !NAME_RE.test(names.smartAccount))
    return err('derived CDP account name is not valid');
  return ok(names);
}

/** Stored in `wallets.agent_wallet_ref`. Identifiers only — never a key or a secret (I9). */
export type AgentWalletRef = {
  provider: 'cdp-smart-account';
  networkId: string;
  ownerName: string;
  ownerAddress: Address;
  smartAccountName: string;
};

export type ProvisionDeps = {
  db: Db;
  cdp: CdpAccounts;
  chainId: number;
  allowMainnet: boolean;
  networkId: string;
  now?: () => Date;
};

export type ProvisionError =
  | { code: 'NO_WALLET'; message: string }
  | { code: 'CHAIN_REFUSED'; message: string }
  | { code: 'BAD_USER_ID'; message: string }
  | { code: 'CDP_FAILED'; message: string }
  | { code: 'DB_FAILED'; message: string }
  | { code: 'CONFLICT'; message: string }
  | { code: 'AUDIT_FAILED'; message: string };

export type ProvisionResult = {
  walletId: string;
  agentWalletAddress: Address;
  ref: AgentWalletRef;
  created: boolean;
};

/**
 * Create (or re-attach) the agent wallet for a user's wallet row.
 *
 * Does NOT broadcast: `getOrCreateSmartAccount` registers a counterfactual smart account with CDP;
 * the account is deployed on-chain by its first user operation (Phase 5).
 */
export async function provisionAgentWallet(
  deps: ProvisionDeps,
  userId: string,
): Promise<Result<ProvisionResult, ProvisionError>> {
  const chain = assertChainAllowed({ chainId: deps.chainId, allowMainnet: deps.allowMainnet });
  if (!chain.ok) return err({ code: 'CHAIN_REFUSED', message: chain.error });

  const names = cdpAccountNames(userId);
  if (!names.ok) return err({ code: 'BAD_USER_ID', message: names.error });

  const [wallet] = await deps.db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.userId, userId))
    .limit(1);
  if (!wallet) return err({ code: 'NO_WALLET', message: `no wallet row for user ${userId}` });

  if (wallet.agentWalletAddress && wallet.agentWalletRef) {
    return ok({
      walletId: wallet.id,
      agentWalletAddress: getAddress(wallet.agentWalletAddress),
      ref: wallet.agentWalletRef as AgentWalletRef,
      created: false,
    });
  }

  let ref: AgentWalletRef;
  let agentWalletAddress: Address;
  try {
    const owner = await deps.cdp.getOrCreateAccount({ name: names.value.owner });
    const smartAccount = await deps.cdp.getOrCreateSmartAccount({
      name: names.value.smartAccount,
      owner,
    });
    agentWalletAddress = getAddress(smartAccount.address);
    ref = {
      provider: 'cdp-smart-account',
      networkId: deps.networkId,
      ownerName: names.value.owner,
      ownerAddress: getAddress(owner.address),
      smartAccountName: names.value.smartAccount,
    };
  } catch (e) {
    return err({ code: 'CDP_FAILED', message: `CDP account provisioning failed: ${String(e)}` });
  }

  // I6: audit first. If the chain cannot be appended we abort and persist nothing; the CDP calls above
  // are idempotent, so a retry re-attaches the same accounts.
  const audit = await appendAudit(deps.db, {
    walletId: wallet.id,
    actor: 'system',
    event: 'WALLET_PROVISIONED',
    entityType: 'wallet',
    entityId: wallet.id,
    payload: { userId, agentWalletAddress, ref, chainId: deps.chainId },
    ...(deps.now ? { createdAt: deps.now() } : {}),
  });
  if (!audit.ok)
    return err({ code: 'AUDIT_FAILED', message: `${audit.error.code}: ${audit.error.message}` });

  // Check-then-act is not atomic: two concurrent provision requests both see a null address. The
  // update is therefore conditional on the row still being unclaimed, and `agent_wallet_address` is
  // globally unique, so at most one writer wins. The loser re-reads and returns the winner's wallet
  // instead of throwing a 23505 at the caller.
  let claimed: { id: string }[];
  try {
    claimed = await deps.db
      .update(schema.wallets)
      .set({ agentWalletAddress, agentWalletRef: ref })
      .where(and(eq(schema.wallets.id, wallet.id), isNull(schema.wallets.agentWalletAddress)))
      .returning({ id: schema.wallets.id });
  } catch (e) {
    claimed = []; // unique violation: someone else stored this address first
    if (!String(e).includes('agent_wallet_address'))
      return err({ code: 'DB_FAILED', message: `wallet update failed: ${String(e)}` });
  }
  if (claimed.length > 0)
    return ok({ walletId: wallet.id, agentWalletAddress, ref, created: true });

  const [current] = await deps.db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.id, wallet.id))
    .limit(1);
  if (current?.agentWalletAddress && current.agentWalletRef) {
    return ok({
      walletId: wallet.id,
      agentWalletAddress: getAddress(current.agentWalletAddress),
      ref: current.agentWalletRef as AgentWalletRef,
      created: false,
    });
  }
  return err({
    code: 'CONFLICT',
    message: `agent wallet ${agentWalletAddress} is already attached to a different wallet row`,
  });
}

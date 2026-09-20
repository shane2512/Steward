// AGENTKIT_INTEGRATION §3 — the action registry: ProposalKind → the exact calls that implement it.
//
// This module is PURE. It builds calldata and never sends anything; only `executor.ts` (Phase 5) may
// broadcast, and it must broadcast exactly the `Call[]` that RiskGate simulated (same `callsHash`).
//
// The security property this file carries (Opus review gate Q1) is:
//   every call target is drawn from the active Policy (recipient / vault / USDC token), the Policy's
//   treasury address, or the SpendPermissionManager — never from a proposal, an LLM, or free text.
// Proposals reference IDs only (anti address-poisoning, I4/T3); the ID→address resolution happens here
// against the Policy, and `assertAllowedTargets` re-checks the finished calls before they are returned.
//
// D-2: vault deposit/withdraw are exact-bigint ERC-4626 calls encoded here, not the AgentKit Morpho
// actions (those take decimal strings — I12 — and are Morpho-specific).
import { encodeFunctionData, getAddress } from 'viem';
import {
  addressEquals,
  type Address,
  type Policy,
  type Proposal,
  type Result,
  err,
  ok,
} from '@steward/shared';
import { ERC20_ABI, ERC4626_ABI } from './abi';
import type { Call } from './calls';
import { assertChainAllowed } from './chain';
import { buildSpendCall, type SpendPermission } from './spendPermission';

export type VaultPosition = {
  /** Vault shares held by the agent wallet. */
  shares: bigint;
  /** Assets those shares redeem for right now (`maxWithdraw(agent)`), base units. */
  redeemableAssets: bigint;
};

export type BuildContext = {
  agentWalletAddress: Address;
  spendPermissionManagerAddress: Address;
  /** Required for `pull_allowance`; the owner-signed, on-chain-approved permission. */
  spendPermission?: SpendPermission | undefined;
  /** Agent wallet USDC balance, base units. Needed for `sweep_home`. */
  agentUsdcBalance: bigint;
  /** Agent positions keyed by Policy vault id. Needed for `sweep_home` and `risk_exit`. */
  vaultPositions: Record<string, VaultPosition>;
  /** I8: mirrors env.STEWARD_ALLOW_MAINNET. The Phase 9 gate still has to be signed off separately. */
  allowMainnet: boolean;
};

export type BuildErrorCode =
  | 'CHAIN_REFUSED'
  | 'UNKNOWN_KIND'
  | 'UNKNOWN_VAULT'
  | 'UNKNOWN_RECIPIENT'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_PERMISSION'
  | 'PERMISSION_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'NOTHING_TO_DO'
  | 'DISALLOWED_TARGET';

export type BuildError = { code: BuildErrorCode; message: string };
const fail = (code: BuildErrorCode, message: string): Result<never, BuildError> =>
  err({ code, message });

const usdcOf = (policy: Policy) => policy.tokens.find((t) => t.symbol === 'USDC');

/**
 * Every address a Steward call may ever target, derived from the Policy plus the two fixed
 * infrastructure addresses. Exported so tests and the review gate can assert against it directly.
 */
export function allowedTargets(policy: Policy, ctx: BuildContext): Set<Address> {
  const set = new Set<Address>();
  for (const t of policy.tokens) set.add(getAddress(t.address));
  for (const v of policy.vaults) set.add(getAddress(v.address));
  for (const r of policy.recipients) set.add(getAddress(r.address));
  set.add(getAddress(policy.treasuryAddress));
  set.add(getAddress(ctx.spendPermissionManagerAddress));
  return set;
}

function assertAllowedTargets(
  calls: Call[],
  policy: Policy,
  ctx: BuildContext,
): Result<Call[], BuildError> {
  const allowed = allowedTargets(policy, ctx);
  for (const c of calls) {
    if (!allowed.has(getAddress(c.to)))
      return fail('DISALLOWED_TARGET', `call target ${c.to} is not resolved from Policy`);
    if (c.value !== 0n) return fail('DISALLOWED_TARGET', 'Steward calls never carry native value');
  }
  return ok(calls);
}

const erc20 = (
  to: Address,
  functionName: 'approve' | 'transfer',
  args: [Address, bigint],
): Call => ({
  to,
  data: encodeFunctionData({ abi: ERC20_ABI, functionName, args }),
  value: 0n,
});

/**
 * Build the calls for a validated proposal.
 *
 * Returns `Err` for anything it cannot resolve deterministically — unknown kind, unknown vault or
 * recipient id, missing permission, non-positive amount (I5, fail closed). Never throws.
 */
export function buildCalls(
  proposal: Proposal,
  policy: Policy,
  ctx: BuildContext,
): Result<Call[], BuildError> {
  const chain = assertChainAllowed({ chainId: policy.chainId, allowMainnet: ctx.allowMainnet });
  if (!chain.ok) return fail('CHAIN_REFUSED', chain.error);

  const usdc = usdcOf(policy);
  if (!usdc) return fail('UNKNOWN_TOKEN', 'policy has no USDC token entry');
  const usdcAddress = getAddress(usdc.address);
  const agent = getAddress(ctx.agentWalletAddress);

  const built = buildForKind(proposal, policy, ctx, usdcAddress, agent);
  if (!built.ok) return built;
  return assertAllowedTargets(built.value, policy, ctx);
}

function buildForKind(
  proposal: Proposal,
  policy: Policy,
  ctx: BuildContext,
  usdcAddress: Address,
  agent: Address,
): Result<Call[], BuildError> {
  switch (proposal.kind) {
    case 'noop':
      return ok([]);

    case 'pull_allowance': {
      const permission = ctx.spendPermission;
      if (!permission) return fail('MISSING_PERMISSION', 'no spend permission for this wallet');
      if (!addressEquals(permission.spender, agent))
        return fail('PERMISSION_MISMATCH', 'permission spender is not this agent wallet');
      if (!addressEquals(permission.token, usdcAddress))
        return fail('PERMISSION_MISMATCH', 'permission token is not the policy USDC token');
      if (!addressEquals(permission.account, policy.treasuryAddress))
        return fail('PERMISSION_MISMATCH', 'permission account is not the policy treasury');
      const call = buildSpendCall(
        permission,
        proposal.params.amount,
        ctx.spendPermissionManagerAddress,
      );
      return call.ok ? ok([call.value]) : fail('INVALID_AMOUNT', call.error);
    }

    case 'vault_deposit': {
      const vault = resolveVault(policy, proposal.params.vaultId, usdcAddress);
      if (!vault.ok) return vault;
      const amount = proposal.params.amount;
      if (amount <= 0n) return fail('INVALID_AMOUNT', 'deposit amount must be > 0');
      // T5/R18: the approval is for EXACTLY the deposited amount, to an allowlisted vault, never
      // maxUint256. `deposit` pulls the whole approved amount inside the same batched user operation,
      // so no residual allowance survives the call and there is no window in between.
      return ok([
        erc20(usdcAddress, 'approve', [vault.value, amount]),
        {
          to: vault.value,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: 'deposit',
            args: [amount, agent],
          }),
          value: 0n,
        },
      ]);
    }

    case 'vault_withdraw': {
      const vault = resolveVault(policy, proposal.params.vaultId, usdcAddress);
      if (!vault.ok) return vault;
      const amount = proposal.params.amount;
      if (amount <= 0n) return fail('INVALID_AMOUNT', 'withdraw amount must be > 0');
      return ok([
        {
          to: vault.value,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: 'withdraw',
            args: [amount, agent, agent],
          }),
          value: 0n,
        },
      ]);
    }

    case 'pay_recipient': {
      const recipient = policy.recipients.find((r) => r.id === proposal.params.recipientId);
      if (!recipient)
        return fail(
          'UNKNOWN_RECIPIENT',
          `recipient ${proposal.params.recipientId} is not in Policy`,
        );
      const amount = proposal.params.amount;
      if (amount <= 0n) return fail('INVALID_AMOUNT', 'payment amount must be > 0');
      return ok([erc20(usdcAddress, 'transfer', [getAddress(recipient.address), amount])]);
    }

    case 'risk_exit': {
      const vault = resolveVault(policy, proposal.params.vaultId, usdcAddress);
      if (!vault.ok) return vault;
      const position = ctx.vaultPositions[proposal.params.vaultId];
      if (!position || position.shares <= 0n)
        return fail('NOTHING_TO_DO', `no position in vault ${proposal.params.vaultId}`);
      // Funds move vault → agent wallet only (R20). Nothing leaves the agent wallet here.
      return ok([redeemAll(vault.value, position.shares, agent)]);
    }

    case 'sweep_home': {
      const calls: Call[] = [];
      let total = ctx.agentUsdcBalance;
      for (const vault of policy.vaults) {
        const position = ctx.vaultPositions[vault.id];
        if (!position || position.shares <= 0n) continue;
        calls.push(redeemAll(getAddress(vault.address), position.shares, agent));
        total += position.redeemableAssets;
      }
      if (total <= 0n)
        return fail('NOTHING_TO_DO', 'nothing to sweep: no USDC and no vault shares');
      // The destination is `policy.treasuryAddress` — stored at onboarding, changeable only by an
      // owner-signed policy version, never by the agent or an LLM (SECURITY §3 L1).
      // `redeemableAssets` is a read of the current share price. If the price falls between the read
      // and execution the transfer reverts and the sweep fails loudly; it never sends someone else's
      // money. If it rises, a few base units of dust stay behind.
      calls.push(erc20(usdcAddress, 'transfer', [getAddress(policy.treasuryAddress), total]));
      return ok(calls);
    }
  }
}

function redeemAll(vault: Address, shares: bigint, agent: Address): Call {
  return {
    to: vault,
    data: encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'redeem',
      args: [shares, agent, agent],
    }),
    value: 0n,
  };
}

function resolveVault(
  policy: Policy,
  vaultId: string,
  usdcAddress: Address,
): Result<Address, BuildError> {
  const vault = policy.vaults.find((v) => v.id === vaultId);
  if (!vault) return fail('UNKNOWN_VAULT', `vault ${vaultId} is not in Policy`);
  if (!addressEquals(vault.asset, usdcAddress))
    return fail('UNKNOWN_TOKEN', `vault ${vaultId} asset is not the policy USDC token`);
  return ok(getAddress(vault.address));
}

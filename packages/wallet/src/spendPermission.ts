// SECURITY §3 Layer 2 — the on-chain authority cap.
//
// An owner (a Coinbase Smart Wallet holding the treasury) signs an EIP-712 SpendPermission naming the
// agent wallet as the only spender, USDC as the only token, and an allowance per period. Even a fully
// compromised Steward backend cannot pull more than that. The owner can revoke at any time.
//
// Layout of this file: PURE (encoders, hashes, validation) above the divider, I/O below it.
// Nothing here sends a transaction except `ensureApprovedOnchain`, which broadcasts exactly one call —
// `approveWithSignature(permission, ownerSignature)` — and only when the permission is not yet approved.
import {
  encodeFunctionData,
  getAddress,
  hashTypedData,
  isAddressEqual,
  type Hex,
  type PublicClient,
  type TypedDataDomain,
} from 'viem';
import { z } from 'zod';
import {
  addressEquals,
  err,
  ok,
  SYSTEM_CEILINGS,
  zAddress,
  zAmount,
  zHex,
  type Address,
  type Result,
} from '@steward/shared';
import { SPEND_PERMISSION_MANAGER_ABI } from './abi';
import type { Call } from './calls';

// ---------------------------------------------------------------------------------------------
// PURE
// ---------------------------------------------------------------------------------------------

export type SpendPermission = {
  /** The owner treasury account granting the allowance. Must be a smart-contract wallet (D-5). */
  account: Address;
  /** The only address allowed to pull: the user's agent wallet. */
  spender: Address;
  /** USDC only in the MVP. */
  token: Address;
  /** uint160 base units per period. */
  allowance: bigint;
  /** uint48 seconds. */
  period: number;
  /** uint48 unix seconds. */
  start: number;
  /** uint48 unix seconds. */
  end: number;
  salt: bigint;
  extraData: Hex;
};

/** EIP-712 struct, verbatim from the SpendPermissionManager (verified in V-05). */
export const SPEND_PERMISSION_TYPES = {
  SpendPermission: [
    { name: 'account', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'allowance', type: 'uint160' },
    { name: 'period', type: 'uint48' },
    { name: 'start', type: 'uint48' },
    { name: 'end', type: 'uint48' },
    { name: 'salt', type: 'uint256' },
    { name: 'extraData', type: 'bytes' },
  ],
} as const;

export function spendPermissionDomain(chainId: number, manager: Address): TypedDataDomain {
  return { name: 'Spend Permission Manager', version: '1', chainId, verifyingContract: manager };
}

export type SpendPermissionTypedData = {
  domain: TypedDataDomain;
  types: typeof SPEND_PERMISSION_TYPES;
  primaryType: 'SpendPermission';
  message: SpendPermission;
};

/** The exact typed-data payload the owner's wallet signs. */
export function prepareTypedData(
  permission: SpendPermission,
  chainId: number,
  manager: Address,
): SpendPermissionTypedData {
  return {
    domain: spendPermissionDomain(chainId, manager),
    types: SPEND_PERMISSION_TYPES,
    primaryType: 'SpendPermission',
    message: permission,
  };
}

/**
 * EIP-712 hash of the permission. Equals `SpendPermissionManager.getHash(permission)` on-chain, so it
 * can be computed without an RPC call and stored as `spend_permissions.permission_hash`.
 */
export function spendPermissionHash(
  permission: SpendPermission,
  chainId: number,
  manager: Address,
): Hex {
  return hashTypedData(prepareTypedData(permission, chainId, manager));
}

// -- JSON round trip (DATA_MODEL: `permission` jsonb). bigints as exact decimal strings, I12. ----

export const zSpendPermissionJson = z
  .object({
    account: zAddress,
    spender: zAddress,
    token: zAddress,
    allowance: zAmount,
    period: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    salt: zAmount,
    extraData: zHex,
  })
  .strict();

export type SpendPermissionJson = {
  account: Address;
  spender: Address;
  token: Address;
  allowance: string;
  period: number;
  start: number;
  end: number;
  salt: string;
  extraData: Hex;
};

export function serializeSpendPermission(p: SpendPermission): SpendPermissionJson {
  return {
    account: p.account,
    spender: p.spender,
    token: p.token,
    allowance: p.allowance.toString(),
    period: p.period,
    start: p.start,
    end: p.end,
    salt: p.salt.toString(),
    extraData: p.extraData,
  };
}

/** Parse a stored/posted permission. Fails closed on anything unexpected. */
export function parseSpendPermission(input: unknown): Result<SpendPermission> {
  const parsed = zSpendPermissionJson.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return ok(parsed.data as SpendPermission);
}

// -- encoders -----------------------------------------------------------------------------------

const UINT160_MAX = (1n << 160n) - 1n;
// NB: `1 << 48` is a 32-bit shift in JS and silently yields 65536 — use exponentiation.
const UINT48_MAX = 2 ** 48 - 1;

export function encodeApproveWithSignature(permission: SpendPermission, signature: Hex): Hex {
  return encodeFunctionData({
    abi: SPEND_PERMISSION_MANAGER_ABI,
    functionName: 'approveWithSignature',
    args: [permission, signature],
  });
}

export function encodeSpend(permission: SpendPermission, amount: bigint): Hex {
  return encodeFunctionData({
    abi: SPEND_PERMISSION_MANAGER_ABI,
    functionName: 'spend',
    args: [permission, amount],
  });
}

/** Owner-side revoke: the tx the owner's own wallet signs (Freeze flow, SECURITY §4). */
export function encodeRevoke(permission: SpendPermission): Hex {
  return encodeFunctionData({
    abi: SPEND_PERMISSION_MANAGER_ABI,
    functionName: 'revoke',
    args: [permission],
  });
}

/** Agent-side revoke: the agent gives up its own authority. Callable by the spender. */
export function encodeRevokeAsSpender(permission: SpendPermission): Hex {
  return encodeFunctionData({
    abi: SPEND_PERMISSION_MANAGER_ABI,
    functionName: 'revokeAsSpender',
    args: [permission],
  });
}

/**
 * The single `spend` call for a `pull_allowance` proposal. Pure: it builds calldata, it does not send.
 * Bounds are re-checked here so a bad amount can never be encoded even if a caller skipped the checks.
 */
export function buildSpendCall(
  permission: SpendPermission,
  amount: bigint,
  manager: Address,
): Result<Call> {
  if (amount <= 0n) return err('spend amount must be > 0');
  if (amount > permission.allowance)
    return err(`spend amount ${amount} exceeds permission allowance ${permission.allowance}`);
  return ok({ to: manager, data: encodeSpend(permission, amount), value: 0n });
}

// -- validation (API boundary, SECURITY §3 L2) --------------------------------------------------

export type SpendPermissionConstraints = {
  /** Session owner address: must equal `permission.account`. */
  ownerAddress: Address;
  /** The user's own agent wallet: must equal `permission.spender`. */
  agentWalletAddress: Address;
  /** The only allowed token. */
  usdcAddress: Address;
  /** Unix seconds. */
  now: number;
};

export type SpendPermissionIssue = { field: string; message: string };

/**
 * Reject anything a Steward owner must never be able to grant, whatever the UI posted:
 * a permission for someone else's account, a spender that is not their agent wallet, a non-USDC token,
 * an allowance/period/horizon over the system ceilings, or a window that already started in the past.
 */
export function validateSpendPermission(
  p: SpendPermission,
  c: SpendPermissionConstraints,
): Result<SpendPermission, SpendPermissionIssue[]> {
  const issues: SpendPermissionIssue[] = [];
  const bad = (field: string, message: string) => issues.push({ field, message });

  if (!addressEquals(p.account, c.ownerAddress))
    bad('account', 'permission account must be the signed-in owner treasury address');
  if (!addressEquals(p.spender, c.agentWalletAddress))
    bad('spender', 'spender must be this user’s agent wallet');
  if (!addressEquals(p.token, c.usdcAddress)) bad('token', 'only USDC may be granted (MVP)');

  if (p.allowance <= 0n) bad('allowance', 'allowance must be > 0');
  if (p.allowance > SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD)
    bad(
      'allowance',
      `allowance exceeds the system ceiling of ${SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD} base units`,
    );
  if (p.allowance > UINT160_MAX) bad('allowance', 'allowance does not fit in uint160');

  if (p.period < SYSTEM_CEILINGS.MIN_SPEND_PERMISSION_PERIOD_SEC)
    bad('period', `period must be at least ${SYSTEM_CEILINGS.MIN_SPEND_PERMISSION_PERIOD_SEC}s`);
  if (p.period > SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_PERIOD_SEC)
    bad('period', `period must be at most ${SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_PERIOD_SEC}s`);

  if (p.start < c.now - SYSTEM_CEILINGS.SPEND_PERMISSION_CLOCK_SKEW_SEC)
    bad('start', 'start is in the past');
  if (p.end <= c.now) bad('end', 'end is in the past');
  if (p.end <= p.start) bad('end', 'end must be after start');
  if (p.end > c.now + SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_HORIZON_SEC)
    bad('end', `end must be within ${SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_HORIZON_SEC}s from now`);
  if (p.end > UINT48_MAX || p.start > UINT48_MAX) bad('end', 'timestamps do not fit in uint48');

  if (p.extraData !== '0x') bad('extraData', 'extraData must be empty');

  return issues.length ? err(issues) : ok(p);
}

/** Convenience constructor used by `/api/spend-permission/prepare`. Salt is caller-supplied (testable). */
export function buildSpendPermission(input: {
  account: Address;
  spender: Address;
  token: Address;
  allowance: bigint;
  periodSeconds: number;
  start: number;
  end: number;
  salt: bigint;
}): SpendPermission {
  return {
    account: getAddress(input.account),
    spender: getAddress(input.spender),
    token: getAddress(input.token),
    allowance: input.allowance,
    period: input.periodSeconds,
    start: input.start,
    end: input.end,
    salt: input.salt,
    extraData: '0x',
  };
}

// ---------------------------------------------------------------------------------------------
// I/O — reads, plus the ONE write this module may make (ensureApprovedOnchain).
// ---------------------------------------------------------------------------------------------

/** ERC-6492 magic suffix; a wrapped signature ends with it (viem `erc6492MagicBytes`). */
const ERC6492_SUFFIX = '6492649264926492649264926492649264926492649264926492649264926492';

export type OwnerAccountKind = 'deployed-contract' | 'counterfactual-6492';

/**
 * D-5 — refuse plain EOAs as the granting account.
 *
 * A permission signed with a bare ECDSA signature by an EOA is accepted by nothing downstream: the
 * SpendPermissionManager needs the account to be a contract wallet that has the manager as an owner,
 * so an EOA grant would silently look fine in our DB and then fail forever at `spend`. We reject it
 * at the door instead.
 *
 * Heuristic (documented limits below):
 *  1. `publicClient.verifyTypedData` must return true. viem routes this through ERC-1271 for deployed
 *     contracts and ERC-6492 for counterfactual ones, so an EOA only passes with a real ECDSA sig.
 *  2. The account must have code (a contract wallet), OR the signature must be ERC-6492-wrapped,
 *     which only a smart-account signer produces for a not-yet-deployed wallet.
 *
 * Limits, accepted deliberately:
 *  - It proves "smart contract account", not "Coinbase Smart Wallet". Another 1271 wallet passes here
 *    and would fail later at `spend` if it cannot add the manager as an owner. That failure is loud
 *    and costs nothing (the agent pulls nothing), so a stricter on-chain shape check is not worth it.
 *  - An EIP-7702-delegated EOA has code and would pass step 2. It is also genuinely a smart account,
 *    so this is the correct answer rather than a hole.
 *  - Step 1 is the real gate; step 2 only catches the counterfactual case where there is no code to
 *    inspect yet. Both must hold.
 */
export async function assertSmartWalletAccount(
  publicClient: PublicClient,
  args: { typedData: SpendPermissionTypedData; signature: Hex },
): Promise<Result<OwnerAccountKind>> {
  const account = args.typedData.message.account;
  let valid: boolean;
  try {
    valid = await publicClient.verifyTypedData({
      address: account,
      domain: args.typedData.domain,
      types: args.typedData.types,
      primaryType: args.typedData.primaryType,
      message: args.typedData.message,
      signature: args.signature,
    });
  } catch {
    return err('signature verification failed'); // RPC error fails closed (I5)
  }
  if (!valid) return err('invalid signature for this permission');

  let code: Hex | undefined;
  try {
    code = await publicClient.getCode({ address: account });
  } catch {
    return err('could not read account code');
  }
  if (code && code !== '0x') return ok('deployed-contract');
  if (args.signature.toLowerCase().endsWith(ERC6492_SUFFIX)) return ok('counterfactual-6492');
  return err(
    'owner account is a plain EOA: Steward requires a Coinbase Smart Wallet to grant spend permissions (D-5)',
  );
}

export async function readCurrentPeriod(
  publicClient: PublicClient,
  manager: Address,
  permission: SpendPermission,
): Promise<Result<{ start: number; end: number; spend: bigint }>> {
  try {
    const p = await publicClient.readContract({
      address: manager,
      abi: SPEND_PERMISSION_MANAGER_ABI,
      functionName: 'getCurrentPeriod',
      args: [permission],
    });
    return ok({ start: p.start, end: p.end, spend: p.spend });
  } catch (e) {
    return err(`getCurrentPeriod failed: ${String(e)}`);
  }
}

/** `F_ALLOWANCE_REMAINING`: allowance minus what has already been pulled in the current period. */
export async function readAllowanceRemaining(
  publicClient: PublicClient,
  manager: Address,
  permission: SpendPermission,
): Promise<Result<bigint>> {
  const period = await readCurrentPeriod(publicClient, manager, permission);
  if (!period.ok) return period;
  const remaining = permission.allowance - period.value.spend;
  return ok(remaining > 0n ? remaining : 0n);
}

const readBool =
  (fn: 'isRevoked' | 'isApproved' | 'isValid') =>
  async (
    publicClient: PublicClient,
    manager: Address,
    permission: SpendPermission,
  ): Promise<Result<boolean>> => {
    try {
      return ok(
        await publicClient.readContract({
          address: manager,
          abi: SPEND_PERMISSION_MANAGER_ABI,
          functionName: fn,
          args: [permission],
        }),
      );
    } catch (e) {
      return err(`${fn} failed: ${String(e)}`);
    }
  };

export const isRevoked = readBool('isRevoked');
export const isApproved = readBool('isApproved');
export const isValid = readBool('isValid');

/** Minimal surface of the AgentKit wallet provider that may broadcast. Kept narrow on purpose. */
export type TxSender = {
  getAddress(): string;
  sendTransaction(tx: { to: Address; data: Hex; value: bigint }): Promise<Hex>;
  waitForTransactionReceipt(hash: Hex): Promise<unknown>;
};

export type EnsureApprovedResult =
  { status: 'already-approved' } | { status: 'approved'; userOpHash: Hex };

/**
 * ⚠️ BROADCASTS. First-use, idempotent on-chain approval of an owner-signed permission.
 *
 * Safe because: the only call it can ever emit is `approveWithSignature` to the SpendPermissionManager,
 * with a permission the owner signed and a signature we did not author. It moves no funds — it only
 * registers the owner's own grant. It is a no-op when `isApproved` is already true, and it refuses to
 * touch a revoked permission. The caller is responsible for persisting the resulting status.
 */
export async function ensureApprovedOnchain(args: {
  publicClient: PublicClient;
  sender: TxSender;
  manager: Address;
  permission: SpendPermission;
  signature: Hex;
}): Promise<Result<EnsureApprovedResult>> {
  const { publicClient, sender, manager, permission, signature } = args;

  if (!isAddressEqual(getAddress(sender.getAddress()), permission.spender))
    return err('refusing to approve a permission whose spender is not this agent wallet');

  const revoked = await isRevoked(publicClient, manager, permission);
  if (!revoked.ok) return revoked;
  if (revoked.value) return err('permission is revoked on-chain');

  const approved = await isApproved(publicClient, manager, permission);
  if (!approved.ok) return approved;
  if (approved.value) return ok({ status: 'already-approved' });

  try {
    const userOpHash = await sender.sendTransaction({
      to: manager,
      data: encodeApproveWithSignature(permission, signature),
      value: 0n,
    });
    await sender.waitForTransactionReceipt(userOpHash);
    return ok({ status: 'approved', userOpHash });
  } catch (e) {
    return err(`approveWithSignature failed: ${String(e)}`);
  }
}

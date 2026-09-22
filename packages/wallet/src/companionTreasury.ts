// Phase 7 addendum — the companion treasury.
//
// Spend Permissions only work with a genuine Coinbase Smart Wallet: `SpendPermissionManager` is
// added as an owner inside Smart Wallet V1's own owner-management system, so a Safe or a plain EOA
// can never grant one (D-5). Coinbase's hosted popup is the usual way to get such a wallet, and it
// is currently broken outside their app — but the popup is not the contract. viem builds the SAME
// contract account directly from any owner address, which is exactly what the Phase 0/2 spike and
// the Phase 5/7.6 live runs did.
//
// So when the owner signs in with a plain browser wallet, Steward derives the Coinbase Smart Wallet
// that EOA already owns (counterfactually) and uses THAT as the treasury. The EOA stays the sign-in
// identity; the derived account holds the funds and grants the permission.
//
// DETERMINISM IS THE WHOLE SAFETY ARGUMENT. The address is `CoinbaseSmartWalletFactory.getAddress(
// [pad(owner)], nonce)` — a CREATE2 address over the owner bytes and the nonce, nothing else. No
// salt, no randomness, no clock. Same owner in ⇒ same address out, forever, on every machine. If
// that were not true, a second sign-in would point the treasury at a different contract and any
// funds already sent to the first one would be stranded.
import { getAddress, type Address as ViemAddress, type PublicClient } from 'viem';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { err, ok, type Address, type Result } from '@steward/shared';

/**
 * Pinned. The version selects the factory (`0xba5ed1…` for 1.1), and the factory decides the
 * address — so changing this string would move every derived treasury. It is the version the live
 * spike proved end to end: deploy → `addOwnerAddress(manager)` → `approveWithSignature` → `spend`.
 */
export const COINBASE_SMART_WALLET_VERSION = '1.1' as const;

/** Pinned for the same reason as the version: the factory nonce is part of the CREATE2 input. */
export const COINBASE_SMART_WALLET_NONCE = 0n;

/**
 * The Coinbase Smart Wallet V1 address owned by `ownerEoa`. Counterfactual: it is a real, funded-
 * able address before any transaction deploys it, and the first user operation (or the factory call
 * in the spike) deploys the code at exactly this address.
 *
 * Needs a client only to read `getAddress` off the factory; it writes nothing and signs nothing.
 */
export async function deriveCompanionTreasury(
  client: PublicClient,
  ownerEoa: Address,
): Promise<Result<Address>> {
  try {
    const account = await toCoinbaseSmartAccount({
      client,
      owners: [getAddress(ownerEoa) as ViemAddress],
      version: COINBASE_SMART_WALLET_VERSION,
      nonce: COINBASE_SMART_WALLET_NONCE,
    });
    return ok(getAddress(await account.getAddress()));
  } catch {
    // An RPC we could not complete must not fall through to "use the EOA as the treasury" (I5).
    return err('could not derive the companion smart wallet address');
  }
}

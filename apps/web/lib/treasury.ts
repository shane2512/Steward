// Phase 7 addendum — choosing the owner's treasury address, once, at first sign-in.
//
// ARCHITECTURE §4: the treasury is the owner's own Coinbase Smart Wallet. It holds the funds, grants
// the spend permission, and is the only sweep-home destination. Until now it was simply the SIWE
// address, which is right for an owner who signed in with a Smart Wallet and wrong for everyone
// else: a plain EOA cannot grant a spend permission at all (D-5), so onboarding dead-ended there.
//
// The signature we just verified tells us which we have, and the server decides — the client is
// never asked, and never believed, about this.
import { err, ok, type Address, type Result } from '@steward/shared';
import { classifyOwnerAccount, deriveCompanionTreasury } from '@steward/wallet';
import { getAddress, type Hex, type PublicClient } from 'viem';

export type TreasuryChoice = {
  address: Address;
  /** True when the treasury is a companion wallet derived from an EOA rather than the signer itself. */
  derived: boolean;
};

/**
 * The treasury for an owner who has just proved control of `ownerAddress` with `siweSignature`.
 *
 * - contract wallet (code, or an ERC-6492-wrapped signature) ⇒ the signer IS the treasury. This is
 *   the spec'd path (PRD FR-1) and is untouched.
 * - plain EOA ⇒ the Coinbase Smart Wallet that EOA owns, derived deterministically.
 *
 * Deterministic, so calling this again for the same owner returns the same address — but callers
 * should not need to: the wallet row is written once and is the record of truth afterwards.
 */
export async function resolveTreasuryAddress(
  client: PublicClient,
  args: { ownerAddress: Address; siweSignature: Hex },
): Promise<Result<TreasuryChoice>> {
  const kind = await classifyOwnerAccount(client, {
    address: args.ownerAddress,
    signature: args.siweSignature,
  });
  if (!kind.ok) return err(kind.error);
  if (kind.value !== 'eoa') return ok({ address: getAddress(args.ownerAddress), derived: false });

  const companion = await deriveCompanionTreasury(client, args.ownerAddress);
  if (!companion.ok) return err(companion.error);
  return ok({ address: companion.value, derived: true });
}

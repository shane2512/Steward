'use client';
// Phase 7 addendum — signing typed data AS the treasury, even when the treasury is not the wallet
// the owner connected with.
//
// Two cases:
//  - the treasury IS the connected account (the owner signed in with a Coinbase Smart Wallet, PRD
//    FR-1). Sign with wagmi, exactly as before. Untouched path.
//  - the treasury is the companion Coinbase Smart Wallet derived from a connected EOA. viem builds
//    that same account object here and signs through it: it hashes the payload, wraps it in the
//    Smart Wallet's replay-safe envelope, asks the connected EOA to sign THAT through wagmi, wraps
//    the result in the contract's SignatureWrapper, and — while the wallet is still counterfactual —
//    in an ERC-6492 envelope so it verifies before deployment. That is the same construction the
//    live spike proved end to end (V-05/V-10).
//
// The server still decides everything that matters: the typed data is fetched verbatim, and the
// address we sign for is checked against the treasury the server stored before any signature is
// requested. If they disagree we refuse rather than sign for some other account.
import { useCallback } from 'react';
import { getAddress, type Hex } from 'viem';
import { toAccount } from 'viem/accounts';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { useAccount, usePublicClient, useSignTypedData } from 'wagmi';
import { TARGET_CHAIN_ID } from './connectMachine';

/**
 * Pinned to match `COINBASE_SMART_WALLET_VERSION` / `COINBASE_SMART_WALLET_NONCE` in
 * `packages/wallet/src/companionTreasury.ts`, which is what the SERVER derived and stored. They are
 * repeated rather than imported because that package reaches CDP credentials and must never enter
 * the browser bundle; `apps/web/test/companionConstants.test.ts` fails if the two ever drift.
 */
export const COMPANION_WALLET_VERSION = '1.1' as const;
export const COMPANION_WALLET_NONCE = 0n;

export type TypedDataPayload = {
  /** As the server serialized it (addresses and amounts arrive as strings; viem widens them). */
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

/**
 * Returns a signer for typed data that signs as `treasuryAddress`.
 *
 * `treasuryAddress` comes from the server (GET /api/wallet). Pass it undefined and this behaves
 * exactly like `useSignTypedData` did.
 */
export function useTypedDataSigner(treasuryAddress: string | undefined) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();

  return useCallback(
    async (typedData: TypedDataPayload): Promise<Hex> => {
      const connected = address ? getAddress(address) : undefined;
      const treasury = treasuryAddress ? getAddress(treasuryAddress) : undefined;
      if (!connected) throw new Error('wallet is not connected');
      if (!treasury || treasury === connected)
        return signTypedDataAsync(typedData as never) as Promise<Hex>;

      if (!publicClient) throw new Error('no chain connection for the companion wallet');
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [
          toAccount({
            address: connected,
            signTypedData: (td) => signTypedDataAsync(td as never) as Promise<Hex>,
            // viem only reaches for `signTypedData` on this path (the replay-safe envelope IS typed
            // data). The other two exist to satisfy the account shape and refuse loudly rather than
            // silently signing something this hook was not asked to sign.
            signMessage: () => {
              throw new Error('the companion wallet owner signs typed data only');
            },
            signTransaction: () => {
              throw new Error('the companion wallet owner does not sign transactions');
            },
          }),
        ],
        version: COMPANION_WALLET_VERSION,
        nonce: COMPANION_WALLET_NONCE,
      });

      // I4, exact checksummed equality: sign only for the account the server named as the treasury.
      const derived = getAddress(await smartAccount.getAddress());
      if (derived !== treasury)
        throw new Error('the companion wallet does not match the treasury on record');

      return smartAccount.signTypedData(typedData as never) as Promise<Hex>;
    },
    [address, treasuryAddress, publicClient, signTypedDataAsync],
  );
}

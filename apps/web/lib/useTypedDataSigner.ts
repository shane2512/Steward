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
import { getAddress, type Hex, type PublicClient } from 'viem';
import { toAccount } from 'viem/accounts';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { useAccount, usePublicClient, useSendTransaction, useSignTypedData } from 'wagmi';
import { TARGET_CHAIN_ID } from './connectMachine';

/**
 * Pinned to match `COINBASE_SMART_WALLET_VERSION` / `COINBASE_SMART_WALLET_NONCE` in
 * `packages/wallet/src/companionTreasury.ts`, which is what the SERVER derived and stored. They are
 * repeated rather than imported because that package reaches CDP credentials and must never enter
 * the browser bundle; `apps/web/test/companionTreasuryUi.test.tsx` fails if the two ever drift.
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

      const smartAccount = await companionAccount(
        publicClient,
        connected,
        treasury,
        (td) => signTypedDataAsync(td as never) as Promise<Hex>,
      );
      return smartAccount.signTypedData(typedData as never) as Promise<Hex>;
    },
    [address, treasuryAddress, publicClient, signTypedDataAsync],
  );
}

/**
 * The companion Coinbase Smart Wallet owned by `connected`, refused unless it IS `expected` (I4,
 * exact checksummed equality) — so nothing is ever signed or sent for some other account.
 */
async function companionAccount(
  publicClient: PublicClient | undefined,
  connected: `0x${string}`,
  expected: `0x${string}`,
  signTypedData: (td: unknown) => Promise<Hex>,
) {
  if (!publicClient) throw new Error('no chain connection for the companion wallet');
  const smartAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [
      toAccount({
        address: connected,
        signTypedData,
        // viem only reaches for `signTypedData` when signing (the replay-safe envelope IS typed
        // data). The other two exist to satisfy the account shape and refuse loudly rather than
        // silently signing something they were not asked to sign.
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
  if (getAddress(await smartAccount.getAddress()) !== expected)
    throw new Error('the companion wallet does not match the treasury on record');
  return smartAccount;
}

/**
 * Sends a call whose on-chain `msg.sender` must be `account` — today only the owner-side
 * `SpendPermissionManager.revoke`, which reverts `InvalidSender` for anyone but the permission's
 * account.
 *
 *  - `account` IS the connected wallet (Smart Wallet signer = treasury): a plain transaction,
 *    exactly as before.
 *  - `account` is the companion the connected EOA owns: the EOA calls the wallet's own
 *    `execute(to, 0, data)`, which a Coinbase Smart Wallet lets any owner call directly — no bundler
 *    or paymaster involved, the EOA pays gas as it did before. A companion that is still
 *    counterfactual is deployed first through its own factory call (permissionless and idempotent),
 *    and we wait for that to land, because an `execute` estimated against an empty address would be
 *    under-gassed.
 */
export function useTreasuryTransaction() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();

  return useCallback(
    async (account: string, call: { to: `0x${string}`; data: Hex }): Promise<Hex> => {
      const connected = address ? getAddress(address) : undefined;
      if (!connected) throw new Error('wallet is not connected');
      const sender = getAddress(account);
      if (sender === connected) return sendTransactionAsync(call);

      const smartAccount = await companionAccount(
        publicClient,
        connected,
        sender,
        (td) => signTypedDataAsync(td as never) as Promise<Hex>,
      );
      if (!(await smartAccount.isDeployed())) {
        const { factory, factoryData } = await smartAccount.getFactoryArgs();
        if (!factory || !factoryData || !publicClient)
          throw new Error('cannot deploy the companion wallet');
        const deployHash = await sendTransactionAsync({ to: factory, data: factoryData });
        const deployed = await publicClient.waitForTransactionReceipt({ hash: deployHash });
        if (deployed.status !== 'success')
          throw new Error('setting up the companion wallet failed on-chain');
      }
      return sendTransactionAsync({
        to: sender,
        data: await smartAccount.encodeCalls([{ to: call.to, data: call.data, value: 0n }]),
      });
    },
    [address, publicClient, signTypedDataAsync, sendTransactionAsync],
  );
}

'use client';
// What the connected wallet can and cannot do, checked BEFORE a signing flow asks for a signature.
//
// Two blockers, both explained up front rather than discovered as a confusing chain error:
//
//  - wrong network: Steward runs on Base Sepolia only (I8). Offer the switch.
//  - plain EOA (spend-permission grant ONLY — callers opt in): a regular externally-owned account
//    cannot grant a Coinbase Spend Permission (D-5). Message signatures are unaffected.
//    The server refuses one anyway (`assertSmartWalletAccount`); this is only so the owner reads an
//    explanation instead of watching their wallet reject a request they did not understand.
//
// Phase 7 addendum: an EOA is no longer a dead end. When the server has derived a companion Coinbase
// Smart Wallet for it (the treasury on the wallet row differs from the connected address), the
// signing flow proceeds AS that wallet — so this hook reports `companion` instead of the blocker.
// The blocker remains for every case where no companion exists.
//
// The EOA test is deliberately conservative. Deployed contract code proves a smart account, but a
// Coinbase Smart Wallet that has never sent a transaction is counterfactual and has no code yet — so
// missing bytecode alone is NOT enough. We only call it an EOA when the connector is also not the
// Smart Wallet connector. False negatives are fine (the server still refuses); false positives would
// block a legitimate owner.
import { getAddress } from 'viem';
import { useAccount, useBytecode, useSwitchChain } from 'wagmi';
import { TARGET_CHAIN_ID } from './connectMachine';

/** The wagmi connector id for Coinbase Wallet, configured `smartWalletOnly` in lib/wagmi.ts. */
export const SMART_WALLET_CONNECTOR_ID = 'coinbaseWalletSDK';

export type SignerBlocker =
  | { kind: 'disconnected' }
  | { kind: 'wrong-network'; chainId: number | undefined }
  | { kind: 'eoa' }
  | null;

/** The treasury is a smart wallet Steward derived from the connected EOA, not the EOA itself. */
export type CompanionTreasury = { address: `0x${string}`; deployed: boolean };

export function useSigner(
  /**
   * Pass ONLY on the spend-permission grant (D-5): that is the one act a plain EOA cannot perform.
   * Every other owner signature (policy, recipient, approval, freeze/unfreeze) is EIP-191 verified
   * against the SIWE owner, which any wallet — EOA included — can produce, so omitting this turns
   * the `eoa` blocker off. `treasuryAddress` is the treasury the SERVER stored (GET /api/wallet).
   */
  spendPermission?: { treasuryAddress: string | undefined },
): {
  address: `0x${string}` | undefined;
  blocker: SignerBlocker;
  companion: CompanionTreasury | null;
  switchNetwork: () => void;
  switching: boolean;
} {
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const onTarget = chainId === TARGET_CHAIN_ID;
  const grantsSpendPermission = spendPermission !== undefined;
  const treasuryAddress = spendPermission?.treasuryAddress;
  const code = useBytecode({
    address,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: grantsSpendPermission && isConnected && address !== undefined && onTarget },
  });

  // A treasury that is not the connected account is the derived companion wallet. Comparison is
  // checksum-exact (I4); both sides are normalized first so a lowercase API value still matches.
  const treasury = treasuryAddress ? getAddress(treasuryAddress) : undefined;
  const isCompanion = treasury !== undefined && address !== undefined && treasury !== address;
  const companionCode = useBytecode({
    address: treasury,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: isCompanion && onTarget },
  });

  const looksDeployedContract = typeof code.data === 'string' && code.data.length > 2;
  const isSmartWalletConnector = connector?.id === SMART_WALLET_CONNECTOR_ID;

  let blocker: SignerBlocker = null;
  if (!isConnected || !address) blocker = { kind: 'disconnected' };
  else if (!onTarget) blocker = { kind: 'wrong-network', chainId };
  else if (
    grantsSpendPermission &&
    code.isSuccess &&
    !looksDeployedContract &&
    !isSmartWalletConnector &&
    !isCompanion
  )
    blocker = { kind: 'eoa' };

  return {
    address,
    blocker,
    companion:
      isCompanion && treasury
        ? {
            address: treasury,
            deployed: typeof companionCode.data === 'string' && companionCode.data.length > 2,
          }
        : null,
    switchNetwork: () => switchChain({ chainId: TARGET_CHAIN_ID }),
    switching: isPending,
  };
}

export const BLOCKER_COPY: Record<
  'disconnected' | 'wrong-network' | 'eoa',
  { title: string; body: string }
> = {
  disconnected: {
    title: 'Your wallet is not connected',
    body: 'Steward needs your wallet to sign. Nothing moved. Connect it and come back to this step.',
  },
  'wrong-network': {
    title: 'Wrong network',
    body: 'Steward runs on Base Sepolia only. Nothing moved. Switch your wallet to Base Sepolia to carry on.',
  },
  eoa: {
    title: 'This wallet cannot give Steward a spending limit',
    body: 'A regular browser wallet cannot grant the capped spend permission that keeps Steward inside your limits, so there would be no cap on what it could ask for. Nothing moved. Sign in with a Coinbase Smart Wallet instead.',
  },
};

'use client';
// What the connected wallet can and cannot do, checked BEFORE a signing flow asks for a signature.
//
// Two blockers, both explained up front rather than discovered as a confusing chain error:
//
//  - wrong network: Steward runs on Base Sepolia only (I8). Offer the switch.
//  - plain EOA: a regular externally-owned account cannot grant a Coinbase Spend Permission (D-5).
//    The server refuses one anyway (`assertSmartWalletAccount`); this is only so the owner reads an
//    explanation instead of watching their wallet reject a request they did not understand.
//
// The EOA test is deliberately conservative. Deployed contract code proves a smart account, but a
// Coinbase Smart Wallet that has never sent a transaction is counterfactual and has no code yet — so
// missing bytecode alone is NOT enough. We only call it an EOA when the connector is also not the
// Smart Wallet connector. False negatives are fine (the server still refuses); false positives would
// block a legitimate owner.
import { useAccount, useBytecode, useSwitchChain } from 'wagmi';
import { TARGET_CHAIN_ID } from './connectMachine';

/** The wagmi connector id for Coinbase Wallet, configured `smartWalletOnly` in lib/wagmi.ts. */
export const SMART_WALLET_CONNECTOR_ID = 'coinbaseWalletSDK';

export type SignerBlocker =
  | { kind: 'disconnected' }
  | { kind: 'wrong-network'; chainId: number | undefined }
  | { kind: 'eoa' }
  | null;

export function useSigner(): {
  address: `0x${string}` | undefined;
  blocker: SignerBlocker;
  switchNetwork: () => void;
  switching: boolean;
} {
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const onTarget = chainId === TARGET_CHAIN_ID;
  const code = useBytecode({
    address,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: isConnected && address !== undefined && onTarget },
  });

  const looksDeployedContract = typeof code.data === 'string' && code.data.length > 2;
  const isSmartWalletConnector = connector?.id === SMART_WALLET_CONNECTOR_ID;

  let blocker: SignerBlocker = null;
  if (!isConnected || !address) blocker = { kind: 'disconnected' };
  else if (!onTarget) blocker = { kind: 'wrong-network', chainId };
  else if (code.isSuccess && !looksDeployedContract && !isSmartWalletConnector)
    blocker = { kind: 'eoa' };

  return {
    address,
    blocker,
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

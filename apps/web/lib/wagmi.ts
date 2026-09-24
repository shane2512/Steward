// wagmi config: Base Sepolia only. Two connectors:
//  - Coinbase Smart Wallet (V-14: `preference: 'smartWalletOnly'`) — the spec'd path (PRD FR-1),
//    the signer IS the treasury.
//  - injected (MetaMask or any EIP-1193 browser wallet) — a plain EOA. It cannot grant a Spend
//    Permission itself (D-5), so the server derives a companion Coinbase Smart Wallet the EOA owns
//    (`lib/treasury.ts` resolveTreasuryAddress, Phase 7 addendum) and that becomes the treasury.
//    This exists because Coinbase's own Smart Wallet popup has been unreliable (keys.coinbase.com
//    postMessage/auth issues) — an EOA connector gives a working path that doesn't depend on it.
//
// NOT tested against a real passkey Smart Wallet in this project (none was ever available): the
// wiring follows the wagmi/Coinbase docs and the installed types and is covered by unit tests with
// mocks. Recorded as untested-with-real-passkey in PROGRESS.md.
import { baseSepolia } from 'viem/chains';
import { createConfig, http } from 'wagmi';
import { coinbaseWallet, injected } from 'wagmi/connectors';

export const TARGET_CHAIN = baseSepolia; // 84532 (I8: testnet by default)

export function makeWagmiConfig() {
  return createConfig({
    chains: [baseSepolia],
    connectors: [coinbaseWallet({ appName: 'Steward', preference: 'smartWalletOnly' }), injected()],
    transports: { [baseSepolia.id]: http() },
    ssr: true,
  });
}

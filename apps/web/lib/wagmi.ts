// wagmi config: Base Sepolia only, Coinbase Smart Wallet only (V-14: `preference: 'smartWalletOnly'`).
// A plain EOA wallet cannot grant a Spend Permission (D-5), so we do not offer one.
//
// NOT tested against a real passkey Smart Wallet in this project (none was ever available): the
// wiring follows the wagmi/Coinbase docs and the installed types and is covered by unit tests with
// mocks. Recorded as untested-with-real-passkey in PROGRESS.md.
import { baseSepolia } from 'viem/chains';
import { createConfig, http } from 'wagmi';
import { coinbaseWallet } from 'wagmi/connectors';

export const TARGET_CHAIN = baseSepolia; // 84532 (I8: testnet by default)

export function makeWagmiConfig() {
  return createConfig({
    chains: [baseSepolia],
    connectors: [coinbaseWallet({ appName: 'Steward', preference: 'smartWalletOnly' })],
    transports: { [baseSepolia.id]: http() },
    ssr: true,
  });
}

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeWagmiConfig, TARGET_CHAIN } from '../lib/wagmi';

describe('wagmi config (V-14, D-5, I8)', () => {
  it('targets Base Sepolia only', () => {
    const cfg = makeWagmiConfig();
    expect(TARGET_CHAIN.id).toBe(84532);
    expect(cfg.chains.map((c) => c.id)).toEqual([84532]);
  });
  it('offers exactly one connector: Coinbase Smart Wallet', () => {
    const cfg = makeWagmiConfig();
    expect(cfg.connectors.length).toBe(1);
    expect(cfg.connectors[0]?.id).toBe('coinbaseWalletSDK');
  });
});

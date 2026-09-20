// I8 — mainnet guard. Must fail closed on 8453 today, because the Phase 9 gate is not signed off.
import { describe, expect, it } from 'vitest';
import {
  assertChainAllowed,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  CDP_NETWORK_ID,
  MAINNET_GATE_SIGNED_OFF,
  viemChain,
} from '../src/chain';

describe('assertChainAllowed', () => {
  it('allows Base Sepolia', () => {
    expect(assertChainAllowed({ chainId: BASE_SEPOLIA_CHAIN_ID, allowMainnet: false })).toEqual({
      ok: true,
      value: 84532,
    });
  });

  it('refuses mainnet without STEWARD_ALLOW_MAINNET', () => {
    const r = assertChainAllowed({ chainId: BASE_MAINNET_CHAIN_ID, allowMainnet: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/STEWARD_ALLOW_MAINNET/);
  });

  it('STILL refuses mainnet with STEWARD_ALLOW_MAINNET set, because the Phase 9 gate is unsigned', () => {
    expect(MAINNET_GATE_SIGNED_OFF).toBe(false);
    const r = assertChainAllowed({ chainId: BASE_MAINNET_CHAIN_ID, allowMainnet: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Phase 9 mainnet gate/);
  });

  it.each([1, 10, 137, 0, -1, 845320])('refuses unsupported chain %s', (chainId) => {
    expect(assertChainAllowed({ chainId, allowMainnet: true }).ok).toBe(false);
  });

  it('maps chain ids to CDP network ids', () => {
    expect(CDP_NETWORK_ID[84532]).toBe('base-sepolia');
    expect(CDP_NETWORK_ID[8453]).toBe('base');
    expect(viemChain(84532).id).toBe(84532);
  });
});

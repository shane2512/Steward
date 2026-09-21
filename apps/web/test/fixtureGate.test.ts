import { describe, expect, it } from 'vitest';
import { fixtureScenario } from '../lib/fixtureGate';

const req = (q: string) => new Request(`http://localhost:3000/api/dashboard${q}`);
const OK = { nodeEnv: 'development', demoMode: true, chainId: 84532 };

describe('the dev-only fixture switch (I11)', () => {
  it('serves a scenario only in dev + DEMO_MODE + Base Sepolia', () => {
    expect(fixtureScenario(req('?fixture=1'), OK)).toBe('1');
    expect(fixtureScenario(req('?fixture=frozen'), OK)).toBe('frozen');
  });
  it('is inert in production, whatever else is set', () =>
    expect(fixtureScenario(req('?fixture=1'), { ...OK, nodeEnv: 'production' })).toBeNull());
  it('is inert without DEMO_MODE', () =>
    expect(fixtureScenario(req('?fixture=1'), { ...OK, demoMode: false })).toBeNull());
  it('is inert on mainnet', () =>
    expect(fixtureScenario(req('?fixture=1'), { ...OK, chainId: 8453 })).toBeNull());
  it('ignores unknown scenarios and a missing param', () => {
    expect(fixtureScenario(req('?fixture=admin'), OK)).toBeNull();
    expect(fixtureScenario(req(''), OK)).toBeNull();
    expect(fixtureScenario(req('?fixture=0'), OK)).toBeNull();
  });
});

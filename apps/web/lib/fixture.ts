import { getEnv } from '@steward/shared';
import { fixtureScenario, type FixtureScenario } from './fixtureGate';

/** Server-only: the scenario when this request may be served fixtures, else null. */
export function fixtureFor(req: Request): FixtureScenario | null {
  const env = getEnv();
  return fixtureScenario(req, {
    nodeEnv: process.env['NODE_ENV'],
    demoMode: env.DEMO_MODE,
    chainId: env.CHAIN_ID,
  });
}

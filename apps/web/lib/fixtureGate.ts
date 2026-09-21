// The dev-only fixture switch (`?fixture=1`), so authenticated screens can be viewed without a real
// signed-in wallet. It is a DATA-LAYER switch: when on, a read route returns canned payloads INSTEAD
// of reading the database. It never grants a session, never touches a write route, and never runs
// unless ALL of: not production, DEMO_MODE, Base Sepolia (I11). Routes still call `requireOwner`
// first for anything that is not a fixture response, so real data stays behind the real session.
export const FIXTURE_SCENARIOS = ['1', 'frozen', 'safe', 'paused', 'quiet', 'onboarding'] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

export type FixtureEnv = { nodeEnv: string | undefined; demoMode: boolean; chainId: number };

export function fixtureScenario(req: Request, env: FixtureEnv): FixtureScenario | null {
  if (env.nodeEnv === 'production' || !env.demoMode || env.chainId !== 84532) return null;
  const v = new URL(req.url).searchParams.get('fixture');
  return (FIXTURE_SCENARIOS as readonly string[]).includes(v ?? '') ? (v as FixtureScenario) : null;
}

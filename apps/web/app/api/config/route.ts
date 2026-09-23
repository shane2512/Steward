// GET /api/config: public, non-secret runtime flags the shell needs before anyone signs in.
// `demoMode` drives the persistent DEMO DATA banner (I11): true only when DEMO_MODE is set AND the
// chain is Base Sepolia, the only combination the mock feeds are allowed to run under.
import { getEnv } from '@steward/shared';
import type { ConfigResponse } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = getEnv();
  const body: ConfigResponse = {
    demoMode: env.DEMO_MODE && env.CHAIN_ID === 84532,
    chainId: env.CHAIN_ID,
    explorerBase: env.CHAIN_ID === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org',
    // 8.5: whether TELEGRAM_BOT_TOKEN is configured on this deployment — never the token itself.
    telegramEnabled: env.TELEGRAM_BOT_TOKEN !== undefined,
  };
  return Response.json(body);
}

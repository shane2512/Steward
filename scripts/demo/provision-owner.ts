// Provisions the demo owner's agent wallet via a real CDP call — the missing setup step
// `scripts/demo/attack.ts` and `scripts/demo/drawdown.ts` refuse to run without ("the demo wallet
// has no agent wallet yet"). Calls the exact same `provisionAgentWallet` that `POST
// /api/wallet/provision` calls, so this is not a shortcut around the real path — it is that path,
// run once from a script instead of clicking through onboarding as the demo owner. Idempotent: safe
// to re-run, it just reports the existing agent wallet.
//
//   STEWARD_LIVE=1 pnpm demo:provision-owner
import { CDP_NETWORK_ID, provisionAgentWallet } from '@steward/wallet';
import { createDb, upsertUserByAddress } from '@steward/db';
import { getEnv } from '@steward/shared';
import { cdpClient, loadEnv, requireLive } from '../live/lib';
import { DEMO_OWNER_ADDRESS } from './seed';

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.DEMO_MODE || env.CHAIN_ID !== 84532) {
    throw new Error('provision-owner refuses: requires DEMO_MODE=true and CHAIN_ID=84532 (I11)');
  }
  const networkId = CDP_NETWORK_ID[env.CHAIN_ID];
  if (!networkId) throw new Error(`unsupported chain ${env.CHAIN_ID}`);

  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const user = await upsertUserByAddress(db, DEMO_OWNER_ADDRESS, new Date());
    const r = await provisionAgentWallet(
      {
        db,
        cdp: cdpClient().evm,
        chainId: env.CHAIN_ID,
        allowMainnet: env.STEWARD_ALLOW_MAINNET,
        networkId,
      },
      user.id,
    );
    if (!r.ok) {
      console.error(`provision failed (${r.error.code}): ${r.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`demo owner: ${DEMO_OWNER_ADDRESS}`);
    console.log(`agent wallet: ${r.value.agentWalletAddress} (created: ${r.value.created})`);
    console.log('\nRe-run `pnpm db:seed:demo` if you want this bound explicitly via');
    console.log(`DEMO_AGENT_WALLET_ADDRESS=${r.value.agentWalletAddress} pnpm db:seed:demo`);
  } finally {
    await pool.end();
  }
}

requireLive('demo-provision-owner');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

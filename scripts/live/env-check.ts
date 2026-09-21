// Print WHICH environment variable names are present. Never a value, never a prefix, never a length.
//
// Phase 6's live run needs credentials the human adds to `.env.local` in parallel; this is how the
// agent checks without ever reading a secret (I9).
import { loadEnv } from './lib';

loadEnv();

const REQUIRED = [
  'DATABASE_URL',
  'RECEIPT_HMAC_SECRET',
  'SESSION_SECRET',
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
  'RPC_URL_BASE_SEPOLIA',
] as const;

const OPTIONAL = [
  'MOCK_VAULT_ADDRESS',
  'MOCK_PRICE_FEED_ADDRESS',
  'DEMO_MODE',
  'CHAIN_ID',
  'SERV_API_KEY',
  'USDC_ADDRESS',
  'SPEND_PERMISSION_MANAGER_ADDRESS',
] as const;

const present = (name: string) => (process.env[name] ? 'present' : 'MISSING');

console.log('required:');
for (const name of REQUIRED) console.log(`  ${name.padEnd(32)} ${present(name)}`);
console.log('optional:');
for (const name of OPTIONAL) console.log(`  ${name.padEnd(32)} ${present(name)}`);

const missing = REQUIRED.filter((n) => !process.env[n]);
console.log(
  missing.length === 0 ? '\nall required names present' : `\nMISSING: ${missing.join(', ')}`,
);
process.exit(missing.length === 0 ? 0 : 1);

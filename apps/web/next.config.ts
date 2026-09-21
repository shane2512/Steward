import type { NextConfig } from 'next';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url)); // repo-root env; shell env wins
} catch {
  /* env may come from the shell */
}

const config: NextConfig = {
  // the dev overlay sits on top of the design preview's screenshots
  devIndicators: false,
  transpilePackages: [
    '@steward/shared',
    '@steward/db',
    '@steward/wallet',
    '@steward/policy',
    '@steward/reasoning',
    '@steward/context',
  ],
  serverExternalPackages: ['pg', 'pino'],
};
export default config;

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
  serverExternalPackages: ['pg', 'pino', '@coinbase/cdp-sdk'],
  // The CDP SDK drags in Solana/x402 packages whose versions do not line up when webpack bundles
  // them. It only ever runs on the server, so keep it (and them) out of the bundle.
  webpack: (cfg, { isServer }) => {
    if (isServer)
      cfg.externals = [...(cfg.externals ?? []), '@coinbase/cdp-sdk', /^@x402\//, /^@solana/];
    return cfg;
  },
};
export default config;

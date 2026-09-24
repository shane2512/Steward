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
  // 'jose' (ESM-only) is @coinbase/cdp-sdk's JWT auth dep. Next's build-time page-data collection
  // does a raw require() of externalized packages, and cdp-sdk's own require()/dynamic-import() of
  // jose race each other (ERR_REQUIRE_ESM_RACE_CONDITION) unless jose is externalized the same way.
  serverExternalPackages: ['pg', 'pino', '@coinbase/cdp-sdk', 'jose'],
  // The CDP SDK drags in Solana/x402 packages whose versions do not line up when webpack bundles
  // them. It only ever runs on the server, so keep it (and them) out of the bundle.
  webpack: (cfg, { isServer }) => {
    if (isServer)
      cfg.externals = [...(cfg.externals ?? []), '@coinbase/cdp-sdk', /^@x402\//, /^@solana/];
    // wagmi/connectors pulls in @metamask/sdk (for its metaMask() connector, which we don't use —
    // wagmi.ts only wires coinbaseWallet/injected). @metamask/sdk's web bundle still references this
    // React-Native-only optional dep without a bundler guard, breaking the client build.
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    };
    return cfg;
  },
};
export default config;

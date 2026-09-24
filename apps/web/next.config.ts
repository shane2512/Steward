import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url)); // repo-root env; shell env wins
} catch {
  /* env may come from the shell */
}

const config: NextConfig = {
  // the dev overlay sits on top of the design preview's screenshots
  devIndicators: false,
  // Without this, Next's output file tracer (which decides what a Vercel serverless function
  // actually ships with) only walks apps/web's own tree and misses packages that live in the
  // pnpm workspace root's node_modules/.pnpm store — exactly the externalized packages below.
  // Symptom without this: builds fine, then 500s at runtime with "Cannot find module
  // '@coinbase/agentkit'" because the function was deployed without it.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // outputFileTracingRoot alone still didn't pick these up: @coinbase/agentkit and @base-org/account
  // are dependencies of packages/wallet (a transpiled workspace package), not of apps/web itself, so
  // the tracer never resolves the require() calls that packages/wallet's inlined code makes to them.
  // Force them in explicitly, along with their own transitive deps that live in the shared pnpm store.
  outputFileTracingIncludes: {
    '/api/**': [
      '../../node_modules/.pnpm/@coinbase+agentkit@*/**',
      '../../node_modules/.pnpm/@base-org+account@*/**',
    ],
  },
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
  // @coinbase/agentkit's baseAccountActionProvider pulls in @base-org/account, which ships its own
  // pre-bundled, pinned-old copy of viem (and a matching-but-incompatible @noble/hashes). Webpack
  // merges that into the same chunk as our app's own (newer) viem, and the two @noble/hashes copies
  // collide at runtime (TypeError inside sha3.js, hit via keccak256/getAddress while Next collects
  // page data for any route touching the wallet). Externalizing keeps them in separate, independently
  // resolved node_modules trees instead of one merged bundle.
  serverExternalPackages: [
    'pg',
    'pino',
    '@coinbase/cdp-sdk',
    'jose',
    '@coinbase/agentkit',
    '@base-org/account',
  ],
  // The CDP SDK drags in Solana/x402 packages whose versions do not line up when webpack bundles
  // them. It only ever runs on the server, so keep it (and them) out of the bundle.
  webpack: (cfg, { isServer }) => {
    if (isServer)
      cfg.externals = [
        ...(cfg.externals ?? []),
        '@coinbase/cdp-sdk',
        '@coinbase/agentkit',
        '@base-org/account',
        /^@x402\//,
        /^@solana/,
      ];
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

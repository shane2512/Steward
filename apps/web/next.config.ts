import type { NextConfig } from 'next';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url)); // repo-root env; shell env wins
} catch {
  /* env may come from the shell */
}

const config: NextConfig = {
  transpilePackages: ['@steward/shared', '@steward/db'],
  serverExternalPackages: ['pg', 'pino'],
};
export default config;

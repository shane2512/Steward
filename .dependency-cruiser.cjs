// Import boundaries from docs/ARCHITECTURE.md §2 (I1/I2/I3). `pnpm check:arch` fails on any violation.
const pkg = (name) => `^packages/${name}/`;
const forbid = (name, from, to, comment) => ({
  name,
  comment,
  severity: 'error',
  from: { path: from },
  to: { path: to },
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // policy is pure (I2): only shared + zod/@noble/hashes, no node core modules (net/fs/http/crypto/env access).
    forbid(
      'policy-only-shared',
      pkg('policy'),
      '^(packages/(?!policy/|shared/)|apps/)',
      'policy may import only shared',
    ),
    {
      name: 'policy-no-core-or-network-deps',
      comment:
        'policy must not use node core modules or npm deps other than zod/@noble/hashes/shared',
      severity: 'error',
      from: { path: pkg('policy') },
      to: {
        dependencyTypes: [
          'core',
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: '^node_modules/(zod|@noble/hashes)/',
      },
    },
    forbid(
      'reasoning-no-wallet-db',
      pkg('reasoning'),
      '^packages/(wallet|db|policy|risk)/',
      'reasoning: shared + context only (I1/I3)',
    ),
    forbid(
      'context-no-wallet-db',
      pkg('context'),
      '^packages/(wallet|db|reasoning|policy|risk)/',
      'context is read-only glue',
    ),
    forbid(
      'wallet-no-reasoning',
      pkg('wallet'),
      '^packages/reasoning/',
      'wallet must not import reasoning (I1)',
    ),
    forbid(
      'risk-no-reasoning-wallet',
      pkg('risk'),
      '^packages/(reasoning|wallet)/',
      'risk: shared only',
    ),
    forbid('packages-no-apps', '^packages/', '^apps/', 'packages must not depend on apps'),
    forbid(
      'web-owner-routes-no-reasoning',
      '^apps/web/app/api/(freeze|sweep)/',
      '^packages/reasoning/',
      'owner-path routes never touch reasoning (I7)',
    ),
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|\.next|\.turbo|dist)/' },
    tsConfig: { fileName: require('node:path').join(__dirname, 'tsconfig.base.json') },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};

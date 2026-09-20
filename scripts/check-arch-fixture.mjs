// Proves dependency-cruiser actually fails on a boundary violation (Phase 1 task 1.3).
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const cwd = fileURLToPath(new URL('./fixtures/arch', import.meta.url));
const config = fileURLToPath(new URL('../.dependency-cruiser.cjs', import.meta.url));
const bin = fileURLToPath(
  new URL('../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', import.meta.url),
);
const r = spawnSync(process.execPath, [bin, 'packages', '--config', config, '--no-cache'], {
  cwd,
  encoding: 'utf8',
});
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
if (r.status === 0 || !r.stdout.includes('policy-only-shared')) {
  console.error(
    'FAIL: dependency-cruiser did NOT flag the deliberate violation (rule policy-only-shared)',
  );
  process.exit(1);
}
console.log(`OK: violation detected (depcruise exit ${r.status})`);

// Deliberate violation (8.1): the worker's out-of-band revoke scan must never reach reasoning (I7).
// `pnpm check:arch` fails if `owner-path-no-reasoning` does NOT flag this file.
import '../../../../packages/reasoning/src/index';

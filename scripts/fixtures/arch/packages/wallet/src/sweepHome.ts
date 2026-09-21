// DELIBERATE architecture violation (owner path -> reasoning, I7). `pnpm check:arch` must see
// rule `owner-path-no-reasoning` fail on this file.
import { propose } from '../../reasoning/src/index';
export const bad = propose;

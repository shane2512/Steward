// DELIBERATE architecture violation (owner-path API route -> reasoning, I7). `pnpm check:arch`
// must see rule `owner-path-no-reasoning` fail on this file: freeze/revoke/sweep have to work with
// SERV, the LLM and the worker all down, so no route under them may reach the reasoning package.
import { propose } from '../../../../../packages/reasoning/src/index';
export const bad = propose;

// DELIBERATE architecture violation (policy -> db). `pnpm check:arch:fixture` must see this fail.
import { db } from '../../db/src/index';
export const bad = db;

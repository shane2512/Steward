// DELIBERATE architecture violation (reasoning -> wallet, I1/I3). `pnpm check:arch:fixture` must
// see rule `reasoning-no-wallet-db` fail on this file.
import { executor } from '../../wallet/src/index';
export const bad = executor;

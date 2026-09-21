// DELIBERATE architecture violation (a non-bootstrap module holding a send-capable CDP client, I1).
// `pnpm check:arch` must see rule `cdp-only-in-wallet-bootstrap` fail on this file.
import { CdpClient } from '@coinbase/cdp-sdk';
export const bad = CdpClient;

// Request bodies for the Phase 2 wallet routes. Kept out of the route files so they can be unit
// tested directly (Next.js route modules may only export handlers and route config).
//
// Both are `.strict()`: `account` and `spender` are chosen by the server from the session and the
// user's own wallet, so a client that tries to supply them is rejected rather than silently ignored.
import { z } from 'zod';
import { zAmount, zHex } from '@steward/shared';

export const zPrepareBody = z
  .object({
    /** Base units of USDC per period (decimal string or bigint). */
    allowance: zAmount,
    periodSeconds: z.number().int().positive(),
    /** Unix seconds. Defaults to now. */
    start: z.number().int().positive().optional(),
    /** Unix seconds. */
    end: z.number().int().positive(),
  })
  .strict();

export const zStoreBody = z.object({ permission: z.unknown(), signature: zHex }).strict();

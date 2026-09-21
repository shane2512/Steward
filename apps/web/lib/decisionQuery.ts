import { z } from 'zod';

/** Query string of GET /api/decisions. Kept out of the route file so it can be unit tested. */
export const decisionsQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

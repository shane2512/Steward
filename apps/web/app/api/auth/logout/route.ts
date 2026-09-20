import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  (await getSession()).destroy();
  return Response.json({ ok: true });
}

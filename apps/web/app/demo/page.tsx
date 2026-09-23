// 9.3 — demo-only "Run demo" checklist. Gated the same way as every I11 demo override: DEMO_MODE
// and chain 84532, or the route does not exist. Deliberately NOT linked from AppShell/TabBar nav —
// reachable only by typing /demo, for whoever is running the rehearsal.
import { notFound } from 'next/navigation';
import { getEnv } from '@steward/shared';
import { DemoChecklist } from '@/components/demo/DemoChecklist';

export const metadata = { title: 'Demo checklist (internal) - Steward' };
export const dynamic = 'force-dynamic';

export default function DemoPage() {
  const env = getEnv();
  if (!env.DEMO_MODE || env.CHAIN_ID !== 84532) notFound();
  return <DemoChecklist />;
}

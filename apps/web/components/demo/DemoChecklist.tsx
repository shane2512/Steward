'use client';
// 9.3 — narrates DEMO.md's beats against whatever ALREADY happened through the real product. It
// polls the exact same `/api/dashboard` the real dashboard uses (no demo-specific endpoint) and
// derives each beat's status from real rows: a policy, a signed spend permission, real decisions.
//
// ponytail: a beat only ever reads as "pending" or "done" — there is no reliable "running"/"failed"
// signal in the aggregate dashboard read, and inventing one would mean guessing. Good enough for an
// internal rehearsal aid; a per-beat event feed would be the honest way to add "running" later.
import { EmptyState, ErrorPanel, Skeleton } from '@/components/ui/primitives';
import { zDashboard, type Dashboard, type DecisionItem } from '@/lib/contracts';
import { POLL_MS, useApi } from '@/lib/useApi';

type Beat = { id: string; label: string; detail: string; done: boolean };

const hasAllow = (recent: readonly DecisionItem[], kinds: readonly string[]) =>
  recent.some((d) => d.kind !== null && kinds.includes(d.kind) && d.verdict?.decision === 'ALLOW');

function beatsFor(d: Dashboard): Beat[] {
  return [
    {
      id: 'pain',
      label: '0:00 Pain',
      detail: 'Idle USDC earning 0%, payouts run by hand — the problem this replaces.',
      done: true, // scripted intro, not something the API can observe
    },
    {
      id: 'mandate',
      label: '0:20 Mandate compiled',
      detail: 'The plain-English mandate compiled into an active policy.',
      done: d.policy !== null,
    },
    {
      id: 'limits',
      label: '0:45 Spend permission signed',
      detail: 'On-chain cap: the maximum Steward can ever move without asking again.',
      done: d.spendPermission.status === 'approved_onchain',
    },
    {
      id: 'autonomy',
      label: '1:00 Autonomy: yield + payroll',
      detail: 'pull_allowance -> vault_deposit -> pay_recipient, allowed by the Policy Engine.',
      done: hasAllow(d.recent, ['pull_allowance', 'vault_deposit', 'pay_recipient']),
    },
    {
      id: 'attack',
      label: '1:30 Attack blocked',
      detail: 'scripts/demo/attack.ts: a malicious memo gets DENY, not obedience.',
      done: d.recent.some((r) => r.verdict?.decision === 'DENY'),
    },
    {
      id: 'escalation',
      label: '2:05 Escalation to the owner',
      detail: 'A proposal above the threshold waits for the owner to sign, not the model.',
      done: d.pendingApprovals > 0 || d.recent.some((r) => r.verdict?.decision === 'ESCALATE'),
    },
    {
      id: 'risk-exit',
      label: '2:25 Risk exit',
      detail: 'scripts/demo/drawdown.ts: a vault drawdown triggers an autonomous R20 exit.',
      done: hasAllow(d.recent, ['risk_exit']),
    },
    {
      id: 'owner-wins',
      label: '2:45 Owner always wins',
      detail: 'Freeze, revoke, sweep home — works even with SERV and the worker down.',
      done: d.wallet.frozen,
    },
  ];
}

export function DemoChecklist() {
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-2 font-mono text-label tracking-[0.12em] text-muted uppercase">
        Internal — not linked from the app, do not show to judges
      </div>
      <h1 className="text-h1 font-bold text-ink">Run demo</h1>
      <p className="mt-1 text-small text-muted">
        Live status for each beat of docs/DEMO.md, read from the real dashboard. Run{' '}
        <code>pnpm db:seed:demo</code>, then <code>scripts/demo/attack.ts</code> and{' '}
        <code>scripts/demo/drawdown.ts</code> at the right moments;{' '}
        <code>scripts/demo/reset.ts</code> resets between rehearsals.
      </p>

      <div className="mt-6" aria-live="polite">
        {dash.isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="mt-2 h-16 w-full" />
            <Skeleton className="mt-2 h-16 w-full" />
          </>
        ) : dash.error ? (
          <ErrorPanel
            title="Could not load the dashboard"
            body="Sign in as the demo owner and make sure the worker is running."
            onRetry={dash.refetch}
          />
        ) : !dash.data ? (
          <EmptyState title="No wallet yet" body="Run `pnpm db:seed:demo` first." />
        ) : (
          <ol className="flex flex-col gap-2">
            {beatsFor(dash.data).map((b) => (
              <li
                key={b.id}
                className="flex items-start justify-between gap-4 rounded-md bg-surface-2 p-4"
              >
                <div className="min-w-0">
                  <div className="text-h3 font-semibold text-ink">{b.label}</div>
                  <div className="mt-0.5 text-small text-muted">{b.detail}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-label tracking-[0.08em] uppercase ${
                    b.done ? 'bg-surface-3 text-allow' : 'bg-surface-3 text-muted'
                  }`}
                >
                  {b.done ? 'Done' : 'Pending'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

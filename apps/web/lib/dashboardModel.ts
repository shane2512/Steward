// Pure view-model helpers for the dashboard. bigint in, display numbers out; the only `number`s are
// 0..100 bar widths (I12). Nothing here decides anything: it arranges values the server computed.
import { formatToken, pctOf, toBig } from './format';
import type { Dashboard } from './contracts';
import { meterTone, type MeterTone } from '@/components/ui/primitives';

export type AllowanceView =
  | { kind: 'none'; caption: string }
  | {
      kind: 'active';
      usedPct: number;
      capPct: number;
      tone: MeterTone;
      caption: string;
      remaining: bigint;
      allowance: bigint;
      used: bigint;
    };

/** Everything in play: treasury + agent wallet + vault. The track of the limit-line meter. */
export function totalManaged(d: Pick<Dashboard, 'balances' | 'vault'>): bigint {
  return toBig(d.balances.treasuryUsdc) + toBig(d.balances.agentUsdc) + toBig(d.vault?.assets);
}

export const liquid = (d: Pick<Dashboard, 'balances'>): bigint =>
  toBig(d.balances.treasuryUsdc) + toBig(d.balances.agentUsdc);

const periodWord = (seconds: number | null): string =>
  seconds === 86_400 ? 'today' : 'this period';

/**
 * The limit line (DESIGN §1): left of the rule is what the spend permission lets Steward pull, right
 * of it is money it can never touch. The rule sits at allowance / managed funds.
 */
export function allowanceView(d: Dashboard): AllowanceView {
  const allowance = toBig(d.spendPermission.allowance);
  if (allowance <= 0n || d.spendPermission.status === null)
    return { kind: 'none', caption: 'No spend permission yet' };
  const remaining = toBig(d.spendPermission.allowanceRemaining);
  const used = allowance > remaining ? allowance - remaining : 0n;
  const total = totalManaged(d);
  const track = total > allowance ? total : allowance;
  const capPct = pctOf(allowance, track);
  const usedPct = pctOf(used, track);
  const tone = meterTone(used, allowance);
  const word = periodWord(d.spendPermission.periodSeconds);
  return {
    kind: 'active',
    usedPct,
    capPct,
    tone,
    used,
    remaining,
    allowance,
    caption:
      tone === 'deny'
        ? `Daily cap reached: ${formatToken(allowance)} USDC used ${word}`
        : `${formatToken(used)} USDC of ${formatToken(allowance)} used ${word}`,
  };
}

export type RunwayView = {
  liquid: bigint;
  buffer: bigint | null;
  fillPct: number;
  covered: boolean | null;
};

/** Liquid funds against the runway buffer the policy asks Steward to keep (R08). */
export function runwayView(d: Dashboard): RunwayView {
  const l = liquid(d);
  const buffer = d.policy ? toBig(d.policy.runwayBufferMicroUsd) : null;
  if (buffer === null || buffer <= 0n) return { liquid: l, buffer, fillPct: 0, covered: null };
  // full bar == twice the buffer, so "just covered" reads as half-way and a shortfall is visible
  return { liquid: l, buffer, fillPct: pctOf(l, buffer * 2n), covered: l >= buffer };
}

export function daysUntil(dueDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return null;
  const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86_400_000);
}

export function dueLabel(dueDate: string, now: Date): string {
  const n = daysUntil(dueDate, now);
  if (n === null) return dueDate;
  if (n <= 0) return 'Due today';
  if (n === 1) return 'Tomorrow';
  return `In ${n} days`;
}

/** `14:02` local, for "as of" indicators. */
export function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

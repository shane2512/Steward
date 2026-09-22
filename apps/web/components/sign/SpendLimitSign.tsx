'use client';
// (a) Spend-permission signing — S3 step 4 (UX_FLOWS), SECURITY §3 Layer 2.
//
// The owner picks two things: how much USDC Steward may pull per day, and the day the permission
// stops. Everything else about the permission — the account, the spender, the token, the salt — is
// chosen by the SERVER from the session (see app/api/spend-permission/prepare/route.ts), which is
// why this screen has no field for them.
//
// The typed data is fetched, shown verbatim, then signed. `packages/wallet` is never imported here:
// the browser must not own a second copy of the struct or the domain, or the two could drift and the
// owner would be reading one permission while signing another.
import { useState } from 'react';
import { useSignTypedData } from 'wagmi';
import { SYSTEM_CEILINGS } from '@steward/shared/client';
import { Button, Money, TextButton } from '@/components/ui/primitives';
import { apiPost } from '@/lib/api';
import {
  zSpendPermissionPrepare,
  zSpendPermissionStored,
  type SpendPermissionPrepare,
  type WalletState,
} from '@/lib/contracts';
import { formatToken, toBig } from '@/lib/format';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { BlockerPanel, FactRow, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

const USDC = 1_000_000n;
/** Daily caps offered on the slider, in base units. The top of the range is the system ceiling. */
export const ALLOWANCE_STEPS: readonly bigint[] = [
  1_000n * USDC,
  2_500n * USDC,
  5_000n * USDC,
  10_000n * USDC,
  25_000n * USDC,
  50_000n * USDC,
  100_000n * USDC,
  250_000n * USDC,
  500_000n * USDC,
  SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD,
];
const DEFAULT_STEP = 3; // 10,000 USDC/day — the SECURITY §3 L2 default
const DAY_SECONDS = 86_400;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (days: number): string => isoDay(new Date(Date.now() + days * 86_400_000));

/** Exposure if everything went wrong at once (SECURITY §3 Layer 1): what Steward holds + the cap. */
export function maxAtRisk(input: {
  agentUsdc: bigint;
  vaultAssets: bigint;
  allowance: bigint;
}): bigint {
  return input.agentUsdc + input.vaultAssets + input.allowance;
}

export function SpendLimitSign({
  wallet,
  onSigned,
}: {
  /** Live balances from GET /api/wallet, so "maximum at risk" uses the server's numbers. */
  wallet: WalletState | undefined;
  onSigned: () => void;
}) {
  const [step, setStep] = useState(DEFAULT_STEP);
  const [end, setEnd] = useState(() => addDays(30));
  const { blocker, switchNetwork, switching } = useSigner();
  const { signTypedDataAsync } = useSignTypedData();

  const flow = useSignFlow<SpendPermissionPrepare>({
    prepare: () =>
      apiPost('/api/spend-permission/prepare', zSpendPermissionPrepare, {
        allowance: (ALLOWANCE_STEPS[step] ?? ALLOWANCE_STEPS[DEFAULT_STEP] ?? 0n).toString(),
        periodSeconds: DAY_SECONDS,
        // End of the chosen day, so "until 30 June" means all of 30 June.
        end: Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000),
      }),
    // Signed exactly as the server built it. `message` carries decimal strings; viem widens them.
    sign: (p) => signTypedDataAsync(p.typedData as never),
    submit: (p, signature) =>
      apiPost('/api/spend-permission', zSpendPermissionStored, {
        permission: p.typedData.message,
        signature,
      }).then(() => undefined),
    onDone: onSigned,
  });

  const agentUsdc = toBig(wallet?.balances.agentUsdc);
  const vaultAssets = toBig(wallet?.vault?.assets);
  // Before review the figure follows the slider; once the server has prepared a payload it follows
  // THAT allowance, so what the owner confirms can never disagree with what they sign.
  const allowance =
    flow.prepared !== null
      ? toBig(flow.prepared.typedData.message.allowance)
      : (ALLOWANCE_STEPS[step] ?? 0n);
  const atRisk = maxAtRisk({ agentUsdc, vaultAssets, allowance });

  if (blocker !== null && blocker.kind !== 'disconnected')
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;

  const reviewing = flow.prepared !== null;

  return (
    <div data-testid="spend-limit-sign">
      {!reviewing ? (
        <>
          <label htmlFor="allowance" className="block text-small font-semibold text-ink">
            Most Steward may move per day
          </label>
          <p className="pt-1 pb-3 text-h1 font-bold text-ink">
            <Money base={allowance} usd />
          </p>
          <input
            id="allowance"
            type="range"
            min={0}
            max={ALLOWANCE_STEPS.length - 1}
            step={1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            aria-valuetext={`${formatToken(allowance)} USDC per day`}
            className="h-11 w-full accent-[var(--st-accent)]"
          />

          <label htmlFor="end" className="block pt-6 text-small font-semibold text-ink">
            Until
          </label>
          <input
            id="end"
            type="date"
            value={end}
            min={addDays(1)}
            max={addDays(
              Math.floor(SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_HORIZON_SEC / DAY_SECONDS),
            )}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-2 h-14 w-full rounded-md bg-surface-2 px-4 font-mono text-mono text-ink"
          />
          <p className="pt-2 text-small text-muted">
            After this date Steward can move nothing, even if everything else is still running.
          </p>
        </>
      ) : (
        <div className="rounded-md bg-surface-2 px-4 py-2">
          <FactRow label="Per day">
            <Money base={allowance} usd />
          </FactRow>
          <FactRow label="Until">{end}</FactRow>
        </div>
      )}

      <div className="mt-6 rounded-md bg-surface-2 p-4">
        <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
          Maximum at risk
        </p>
        <p className="pt-1 text-h2 font-bold text-ink">
          <Money base={atRisk} usd />
        </p>
        <p className="max-w-[46ch] pt-2 text-small text-muted">
          The most Steward could ever lose: what its own wallet holds, what is working in vaults,
          and one day of this limit. Your treasury keeps the rest, and Steward cannot reach it.
        </p>
      </div>

      {flow.prepared !== null ? (
        <LiteralPayload value={flow.prepared.typedData} label="Your wallet will sign this:" />
      ) : null}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <div className="pt-6">
        {!reviewing ? (
          <Button loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Review the limit
          </Button>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              Sign in wallet
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Change the limit</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

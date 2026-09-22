'use client';
// Unfreeze (S10, task 7.8). SECURITY §5: "Unfreeze requires owner signature and resets the circuit
// breaker" — both happen in `POST /api/unfreeze`, on one signature over a server-issued message.
//
// This is the same owner path as the freeze flow and reuses the same signing machinery (7.6); it is
// deliberately NOT in the freeze modal, because starting again is a different decision from
// stopping and should not sit one click away from it.
//
// Unfreezing does not restore a revoked spending permission: the copy says so, because an owner who
// completed the freeze flow has no on-chain allowance left and would otherwise expect Steward to
// resume paying.
import { useSignMessage } from 'wagmi';
import {
  BlockerPanel,
  LiteralPayload,
  SignErrorPanel,
  SignStatus,
} from '@/components/sign/SignSurface';
import { Button } from '@/components/ui/primitives';
import { apiPost } from '@/lib/api';
import { zFreezePrepare, zUnfreezeResult } from '@/lib/contracts';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';

export function UnfreezeSlot({ frozen, onUnfrozen }: { frozen: boolean; onUnfrozen: () => void }) {
  const { blocker, switchNetwork, switching } = useSigner();
  const { signMessageAsync } = useSignMessage();
  const flow = useSignFlow<string>({
    prepare: async () =>
      (await apiPost('/api/freeze/prepare', zFreezePrepare, { action: 'unfreeze' })).message,
    sign: (message) => signMessageAsync({ message }),
    submit: (_m, signature) =>
      apiPost('/api/unfreeze', zUnfreezeResult, { signature }).then(() => undefined),
    onDone: onUnfrozen,
  });

  if (!frozen) return null;
  return (
    <div data-slot="unfreeze" className="rounded-md bg-surface-2 p-4">
      <p className="text-h3 font-semibold text-ink">Steward is stopped</p>
      <p className="max-w-[46ch] pt-2 text-small text-muted">
        Unfreezing lets Steward propose and act again, and clears the safety breaker. It does not
        give back a spending limit you revoked — you would grant a new one.
      </p>

      {flow.prepared !== null ? <LiteralPayload value={flow.prepared} /> : null}
      {blocker !== null && blocker.kind !== 'disconnected' ? (
        <div className="pt-4">
          <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />
        </div>
      ) : null}
      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <div className="pt-4">
        <Button
          variant="ghost"
          data-testid="unfreeze"
          loading={
            flow.phase === 'preparing' ||
            flow.phase === 'awaiting-signature' ||
            flow.phase === 'submitting'
          }
          onClick={flow.prepared === null ? flow.prepare : flow.confirm}
        >
          {flow.prepared === null ? 'Unfreeze' : 'Sign in wallet'}
        </Button>
      </div>
    </div>
  );
}

'use client';
// The one signing state machine, shared by all four of Steward's signature flows (task 7.6):
// spend permission, policy activation, recipient add, approval.
//
// Two rules are structural here, not left to each screen:
//
//  1. THE CLIENT NEVER BUILDS WHAT IT SIGNS. `prepare()` fetches the literal string or typed-data
//     object from a server route; `confirm()` signs exactly that object and nothing else. Nothing in
//     between reformats it.
//  2. A FAILED ATTEMPT THROWS THE PAYLOAD AWAY. `confirm()` clears `prepared` on any error, so a
//     retry goes back through `prepare()` and gets a fresh payload. The browser can never hold a
//     signature and present it against a different message.
//
// `done` is set only after the SERVER accepted the submission.
import { useCallback, useState } from 'react';
import type { Hex } from 'viem';
import { signErrorCopy, type SignError } from './signCopy';

export type SignPhase =
  'idle' | 'preparing' | 'review' | 'awaiting-signature' | 'submitting' | 'done' | 'error';

/** What each phase announces through `aria-live` (DESIGN §12). */
export const PHASE_STATUS: Record<SignPhase, string> = {
  idle: '',
  preparing: 'Preparing what you will sign.',
  review: 'Ready for you to review before signing.',
  'awaiting-signature': 'Waiting for your wallet. Check it for a signature request.',
  submitting: 'Sending your signature to Steward.',
  done: 'Done. Steward accepted your signature.',
  error: '',
};

export type SignFlow<P> = {
  phase: SignPhase;
  prepared: P | null;
  error: SignError | null;
  /** Fetch the payload to sign from the server and show it. */
  prepare: () => void;
  /** Sign exactly what is on screen, then submit. */
  confirm: () => void;
  /** Back to idle, dropping any prepared payload. */
  reset: () => void;
};

export function useSignFlow<P>(opts: {
  /** Server route that returns the literal payload. Called fresh for every attempt. */
  prepare: () => Promise<P>;
  /** Hand `prepared` to the wallet verbatim. */
  sign: (prepared: P) => Promise<Hex>;
  /** POST the signature. Resolves only when the server accepted it. */
  submit: (prepared: P, signature: Hex) => Promise<void>;
  onDone?: () => void;
}): SignFlow<P> {
  const [phase, setPhase] = useState<SignPhase>('idle');
  const [prepared, setPrepared] = useState<P | null>(null);
  const [error, setError] = useState<SignError | null>(null);
  const { prepare: doPrepare, sign, submit, onDone } = opts;

  const prepare = useCallback(() => {
    setError(null);
    setPrepared(null);
    setPhase('preparing');
    void (async () => {
      try {
        const p = await doPrepare();
        setPrepared(p);
        setPhase('review');
      } catch (e) {
        setError(signErrorCopy(e));
        setPhase('error');
      }
    })();
  }, [doPrepare]);

  const confirm = useCallback(() => {
    if (prepared === null) return;
    setError(null);
    setPhase('awaiting-signature');
    void (async () => {
      try {
        const signature = await sign(prepared);
        setPhase('submitting');
        await submit(prepared, signature);
        setPhase('done');
        onDone?.();
      } catch (e) {
        // Drop the payload: the next attempt re-prepares rather than re-using a stale message.
        setPrepared(null);
        setError(signErrorCopy(e));
        setPhase('error');
      }
    })();
  }, [onDone, prepared, sign, submit]);

  const reset = useCallback(() => {
    setPrepared(null);
    setError(null);
    setPhase('idle');
  }, []);

  return { phase, prepared, error, prepare, confirm, reset };
}

'use client';
// The modal FRAME for S9 (DESIGN §5, §9): scrim, glass sheet, focus trap, Escape to close, focus
// restored to the opener. What happens inside it is `FreezeFlow` (task 7.8).
import { useEffect, useRef } from 'react';
import { FreezeFlow, type FreezeFlowProps } from './FreezeFlow';

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function FreezeModal({
  open,
  frozen,
  onClose,
  onDone,
}: { open: boolean } & FreezeFlowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const a = items[0];
      const z = items[items.length - 1];
      if (!a || !z) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="freeze-title"
        tabIndex={-1}
        className="glass-sheet relative w-full max-w-[440px] rounded-lg p-5"
      >
        <h2 id="freeze-title" className="text-h2 font-bold text-ink">
          Freeze Steward
        </h2>
        <p className="max-w-[46ch] pt-3 pb-4 text-small text-muted">
          Steward stops proposing and stops executing, right now. Your spend permission is revoked
          on-chain. Nothing in the treasury moves until you unfreeze.
        </p>
        <FreezeFlow frozen={frozen} onDone={onDone} onClose={onClose} />
      </div>
    </div>
  );
}

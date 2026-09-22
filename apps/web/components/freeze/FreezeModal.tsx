'use client';
// The modal FRAME for S9 (DESIGN §5, §9): scrim, glass sheet, focus trap, Escape to close, focus
// restored to the opener. What happens inside it is `FreezeFlow` (task 7.8).
import { useRef } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { FreezeFlow, type FreezeFlowProps } from './FreezeFlow';

export function FreezeModal({
  open,
  frozen,
  onClose,
  onDone,
}: { open: boolean } & FreezeFlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

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
        // 7.8 visual QA: with three real steps inside, the sheet is taller than a phone. Cap it and
        // let it scroll, or the title clips off the top and Cancel falls off the bottom.
        className="glass-sheet relative max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-lg p-5"
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

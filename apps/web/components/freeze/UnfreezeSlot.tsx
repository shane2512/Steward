'use client';
// ============================================================================================
// EXTENSION POINT for task 7.8 (Opus): unfreezing.
//
// SECURITY.md §5: "Unfreeze requires owner signature and resets the circuit breaker." There is no
// /api/unfreeze route yet — that belongs to 7.8 alongside FreezeFlow (freeze/revoke/sweep), since
// unfreeze is the other half of the same owner-only, no-reasoning-imports code path (I7). 7.7 only
// ships the slot in Settings (S10) so the page renders correctly today and 7.8 can drop the real
// flow in without touching this file's caller.
//
// Contract to keep stable: `frozen` is the server's current frozen flag (GET /api/dashboard); call
// `onUnfrozen` once the owner's signature has been accepted and the wallet is confirmed unfrozen.
// ============================================================================================
import { Button } from '@/components/ui/primitives';

export function UnfreezeSlot({ frozen }: { frozen: boolean; onUnfrozen: () => void }) {
  if (!frozen) return null;
  return (
    <div data-slot="unfreeze" className="rounded-md bg-surface-2 p-4">
      <p className="text-small text-muted" data-testid="unfreeze-placeholder">
        Steward is frozen. Unfreezing (with your signature) arrives in task 7.8.
      </p>
      <div className="pt-3">
        <Button variant="ghost" disabled>
          Unfreeze
        </Button>
      </div>
    </div>
  );
}

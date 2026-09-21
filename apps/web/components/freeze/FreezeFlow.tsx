'use client';
// ============================================================================================
// EXTENSION POINT for task 7.8 (Opus): the freeze flow.
//
// 7.1 ships only the shell: the global Freeze button, the modal frame and this placeholder. NOTHING
// here freezes, revokes or sweeps. Task 7.8 replaces the body of `FreezeFlow` with the three
// idempotent, resumable steps of UX_FLOWS S9 (freeze -> revoke spend permission -> sweep home) wired
// to /api/freeze, /api/spend-permission/revoked and /api/sweep (owner path, no reasoning imports: I7).
//
// The props below are the contract the shell already provides; keep them stable:
//   frozen   - the server's current frozen flag (from GET /api/dashboard), so the flow can resume
//   onDone   - call when every step has finished; the shell refetches state and closes the modal
//   onClose  - the Cancel path; always available and never blocked by a network call
// ============================================================================================
import { Button } from '@/components/ui/primitives';

export type FreezeFlowProps = {
  frozen: boolean;
  onDone: () => void;
  onClose: () => void;
};

export function FreezeFlow({ onClose }: FreezeFlowProps) {
  return (
    <div data-slot="freeze-flow">
      <p
        role="note"
        className="rounded-md bg-surface-2 p-3 text-small text-muted"
        data-testid="freeze-flow-placeholder"
      >
        Freeze flow arrives in task 7.8
      </p>
      <div className="space-y-2 pt-6">
        <Button variant="danger" disabled>
          Freeze now
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

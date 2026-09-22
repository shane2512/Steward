'use client';
import Link from 'next/link';
import { IconBack } from '@/components/icons';
import { StatusPill, Wordmark } from '@/components/ui/primitives';
import { pillLabel, type PillState } from '@/lib/status';

/**
 * The global Freeze control (DESIGN §5): calm outlined pill; a filled chip once frozen.
 *
 * 7.8: the frozen state is still a BUTTON. Freezing is step 1 of three (SECURITY §4), so an owner
 * who froze and closed the modal has to be able to reopen it and finish revoking and sweeping — a
 * dead status chip would strand them. The live region announces the state either way.
 */
export function FreezeButton({ frozen, onOpen }: { frozen: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      {...(frozen ? { 'aria-live': 'assertive' as const, role: 'status' } : {})}
      className={
        frozen
          ? 'inline-flex h-11 items-center rounded-full bg-deny-fill px-4 text-small font-bold text-on-deny-fill'
          : 'inline-flex h-11 items-center rounded-full border border-deny/40 px-4 text-small font-bold text-deny transition-colors hover:border-deny hover:bg-deny-tint focus-visible:border-deny'
      }
    >
      {frozen ? 'Frozen' : 'Freeze'}
    </button>
  );
}

export function AppHeader({
  title,
  pill,
  pending,
  frozen,
  onFreeze,
  wide,
}: {
  /** set on sub-screens: shows a back arrow and the title instead of the wordmark + pill */
  title: string | null;
  pill: PillState | null;
  pending: number;
  frozen: boolean;
  onFreeze: () => void;
  wide: boolean;
}) {
  return (
    <header className="glass sticky top-0 z-30 h-14">
      <div
        className={`mx-auto flex h-full items-center justify-between gap-3 px-4 ${
          wide ? 'max-w-[440px] lg:max-w-[1080px]' : 'max-w-[440px]'
        }`}
      >
        {title ? (
          <>
            <Link
              href="/app"
              aria-label="Back to home"
              className="-ml-2 flex size-11 items-center justify-center text-ink"
            >
              <IconBack className="size-6" />
            </Link>
            <span className="min-w-0 flex-1 truncate text-h3 font-semibold text-ink">{title}</span>
          </>
        ) : (
          <>
            <Link href="/app" className="flex min-h-11 items-center" aria-label="Steward home">
              <Wordmark />
            </Link>
            {pill ? <StatusPill state={pill} label={pillLabel(pill, pending)} /> : <span />}
          </>
        )}
        <FreezeButton frozen={frozen} onOpen={onFreeze} />
      </div>
    </header>
  );
}

'use client';
// 8.5 — the notification center: a bell in the header, a badge for unread count, and a glass sheet
// listing recent notifications (the sheet frame matches FreezeModal — DESIGN §5/§9 glass allowance
// for a small popover; the rows inside are solid per the Row primitive, same as Activity/S5).
import { useRef, useState } from 'react';
import { z } from 'zod';
import { IconBell, IconClose } from '@/components/icons';
import { EmptyState, Row, RowSkeleton } from '@/components/ui/primitives';
import { apiPost } from '@/lib/api';
import { zNotificationList, type NotificationItem } from '@/lib/contracts';
import { formatAgo } from '@/lib/format';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { POLL_MS, useApi } from '@/lib/useApi';

const zOk = z.object({}).passthrough();

const TITLES: Record<NotificationItem['type'], string> = {
  execution: 'Action',
  escalation: 'Needs approval',
  blocked: 'Blocked',
  risk: 'Risk',
  freeze: 'Freeze',
  report: 'Weekly report',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const list = useApi('/api/notifications', zNotificationList, {
    refetchInterval: open ? false : POLL_MS,
  });
  const unread = list.data?.unreadCount ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useFocusTrap(ref, open, close);

  const markRead = async (id: string) => {
    try {
      await apiPost(`/api/notifications/${id}/read`, zOk);
    } catch {
      /* best-effort; the badge is a convenience, not a source of truth */
    }
    list.refetch();
  };
  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/read-all', zOk);
    } catch {
      /* same as above */
    }
    list.refetch();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-11 items-center justify-center text-ink"
      >
        <IconBell className="size-6" />
        <span aria-live="polite" className="sr-only">
          {unread > 0 ? `${unread} unread notifications` : 'No unread notifications'}
        </span>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-deny-fill text-[10px] font-bold text-on-deny-fill"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50" onClick={close} aria-hidden="true">
          <div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="glass-sheet absolute top-14 right-4 max-h-[70dvh] w-[min(92vw,380px)] overflow-y-auto rounded-lg"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-h3 font-bold text-ink">Notifications</h2>
              <div className="flex items-center gap-2">
                {unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="text-small font-semibold text-accent"
                  >
                    Mark all read
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close notifications"
                  className="flex size-8 items-center justify-center text-muted"
                >
                  <IconClose className="size-5" />
                </button>
              </div>
            </div>
            <div className="border-t border-line bg-surface">
              {list.isLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (list.data?.rows.length ?? 0) === 0 ? (
                <EmptyState
                  title="Nothing yet"
                  body="Steward will notify you here as things happen."
                />
              ) : (
                list.data?.rows.map((n) => (
                  <Row
                    key={n.id}
                    title={
                      <span className={n.read ? 'font-normal' : ''}>
                        {n.read ? null : (
                          <span
                            aria-hidden="true"
                            className="mr-2 inline-block size-2 rounded-full bg-accent align-middle"
                          />
                        )}
                        {TITLES[n.type]}: {n.title}
                      </span>
                    }
                    sub={
                      <>
                        <span className="line-clamp-2 block">{n.body}</span>
                        <span className="block font-mono text-label text-faint">
                          {formatAgo(n.createdAt)}
                        </span>
                      </>
                    }
                    onClick={n.read ? undefined : () => void markRead(n.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

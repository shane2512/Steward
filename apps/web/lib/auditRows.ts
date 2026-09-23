// 8.4 — the one place an `audit_log` row is turned into JSON for an owner, shared by
// `GET /api/audit` (the listing) and `GET /api/audit/export` (the download).
//
// Every row here was already checked for secret-looking keys when it was WRITTEN (`appendAudit`
// refuses those, SECURITY §6), so there is nothing to redact on the way out — but the shape is
// still pinned in one function so the two routes cannot drift apart and start disagreeing about
// what an audit row is.
import type { AuditRow } from '@steward/db';
import { canonicalJson } from '@steward/shared';

export type AuditRowJson = {
  id: number;
  createdAt: string;
  actor: string;
  event: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  prevHash: string;
  rowHash: string;
};

export const auditRowJson = (r: AuditRow): AuditRowJson => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  actor: r.actor,
  event: r.event,
  entityType: r.entityType,
  entityId: r.entityId,
  payload: JSON.parse(canonicalJson(r.payload)) as unknown,
  prevHash: r.prevHash,
  rowHash: r.rowHash,
});

/** CSV field with the usual quoting. Shared by both exports. */
export const csvField = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvRows = (header: readonly string[], rows: readonly unknown[][]): string =>
  [header.join(','), ...rows.map((r) => r.map(csvField).join(','))].join('\n') + '\n';

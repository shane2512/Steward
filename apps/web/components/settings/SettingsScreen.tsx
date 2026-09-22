'use client';
// S10 Settings (UX_FLOWS S10, task 7.7): notifications, export audit, verify audit chain, unfreeze,
// close account. Nothing here makes a security decision in the browser — export and verify are both
// plain server reads, and Unfreeze (7.8) is an owner signature over a server-issued message that
// `POST /api/unfreeze` verifies before it clears the frozen flag and the circuit breaker.
import { useState } from 'react';
import Link from 'next/link';
import { UnfreezeSlot } from '@/components/freeze/UnfreezeSlot';
import { Banner, Button, Eyebrow, TextButton } from '@/components/ui/primitives';
import { apiGet } from '@/lib/api';
import { zAuditVerify, zDashboard, type AuditVerify } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

export function SettingsScreen() {
  const dash = useApi('/api/dashboard', zDashboard);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerify | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await apiGet('/api/audit/verify', zAuditVerify));
    } catch {
      setVerifyResult({
        ok: false,
        break: { rowId: -1, reason: 'network', expected: '', actual: '' },
      });
    } finally {
      setVerifying(false);
    }
  };

  // The route already validates its own query and shapes its own output; this is a same-origin,
  // owner-authenticated download, so the raw text is saved as-is rather than re-parsed with zod.
  const runExport = async (format: 'csv' | 'json') => {
    setExporting(format);
    try {
      const res = await fetch(`/api/audit/export?format=${format}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const text = await res.text();
      downloadText(
        text,
        `steward-audit.${format}`,
        format === 'json' ? 'application/json' : 'text/csv',
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="pb-10">
      <Eyebrow>Notifications</Eyebrow>
      <div className="px-4">
        <label htmlFor="telegram" className="block text-small font-semibold text-ink">
          Telegram chat ID
        </label>
        <input
          id="telegram"
          disabled
          placeholder="Coming soon"
          className="mt-2 h-14 w-full rounded-md bg-surface-2 px-4 text-h3 text-faint placeholder:text-faint"
        />
        {/* TODO(Phase 8.5): wire this to a real notifications route once one exists. Shipping a
            disabled field beats a route that silently accepts an ID and never sends anything. */}
        <p className="pt-2 text-small text-muted">
          Steward will be able to message you on Telegram when it needs a decision. This arrives in
          a later phase.
        </p>
      </div>

      <Eyebrow>Audit log</Eyebrow>
      <div className="space-y-3 px-4">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            className="w-auto"
            loading={exporting === 'csv'}
            onClick={() => void runExport('csv')}
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            className="w-auto"
            loading={exporting === 'json'}
            onClick={() => void runExport('json')}
          >
            Export JSON
          </Button>
        </div>
        <div>
          <Button
            variant="ghost"
            className="w-auto"
            loading={verifying}
            onClick={() => void runVerify()}
          >
            Verify audit chain
          </Button>
        </div>
        <div aria-live="polite">
          {verifyResult ? (
            verifyResult.ok ? (
              <Banner tone="info" title="Verified">
                {verifyResult.rows} rows, unbroken from the first to row {verifyResult.rows}.
              </Banner>
            ) : (
              <Banner tone="bad" title="Chain broken" live="assertive">
                Row {verifyResult.break.rowId}: {verifyResult.break.reason}. Expected{' '}
                {verifyResult.break.expected || '(none)'}, found{' '}
                {verifyResult.break.actual || '(none)'}.
              </Banner>
            )
          ) : null}
        </div>
      </div>

      <Eyebrow>Security</Eyebrow>
      <div className="px-4">
        <UnfreezeSlot
          frozen={dash.data?.wallet.frozen ?? false}
          onUnfrozen={() => dash.refetch()}
        />
      </div>

      <Eyebrow>Account</Eyebrow>
      <div className="px-4">
        <Link href="/app/settings/close" className="inline-block">
          <TextButton>Close account</TextButton>
        </Link>
      </div>
    </div>
  );
}

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

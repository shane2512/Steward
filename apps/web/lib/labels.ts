import { listRecipients, listVaultRows, type Db } from '@steward/db';
import type { Labels } from './decisionView';

/** id -> owner-authored label, for turning proposal ids into names on screen. */
export async function loadLabels(db: Db, walletId: string): Promise<Labels> {
  const [recipients, vaults] = await Promise.all([
    listRecipients(db, walletId),
    listVaultRows(db, walletId),
  ]);
  return {
    recipients: new Map(recipients.map((r) => [r.id, r.label])),
    vaults: new Map(vaults.map((v) => [v.id, v.name])),
  };
}

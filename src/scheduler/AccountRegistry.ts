import { SqlDb } from '../storage/SqlDb';

// Persists the multi-account pool (migration v8 `account` table). SecretStorage
// holds the keys but can't be enumerated, so this is the authoritative list of
// which accounts exist per provider, plus each account's health + observed
// latency (PROV-15) so deprioritisation survives reloads. The key value never
// lives here — only the account_id that addresses it in the KeyStore.

export interface AccountRecord {
  providerId: string;
  accountId: string;
  label: string;
  healthy: boolean;
  latencyMs: number;
  addedAt: number;
}

interface AccountRow {
  provider_id: string;
  account_id: string;
  label: string;
  healthy: number;
  ewma_latency_ms: number;
  added_at: number;
}

function toRecord(r: AccountRow): AccountRecord | undefined {
  if (!r.provider_id || !r.account_id) {
    return undefined; // unaddressable row -> skip (STATE-4)
  }
  return {
    providerId: r.provider_id,
    accountId: r.account_id,
    label: r.label,
    healthy: r.healthy !== 0,
    latencyMs: r.ewma_latency_ms,
    addedAt: r.added_at,
  };
}

export class AccountRegistry {
  constructor(private readonly db: SqlDb) {}

  /** All registered accounts for a provider (oldest first). */
  list(providerId: string): AccountRecord[] {
    return this.db
      .all<AccountRow>(
        'SELECT * FROM account WHERE provider_id = ? ORDER BY added_at ASC',
        [providerId],
      )
      .map(toRecord)
      .filter((r): r is AccountRecord => r !== undefined);
  }

  /** Every registered account across all providers. */
  all(): AccountRecord[] {
    return this.db
      .all<AccountRow>('SELECT * FROM account ORDER BY provider_id ASC, added_at ASC')
      .map(toRecord)
      .filter((r): r is AccountRecord => r !== undefined);
  }

  /** Register (or relabel) an account. The key is stored separately in KeyStore. */
  add(providerId: string, accountId: string, label: string, now = Date.now()): void {
    this.db.run(
      `INSERT INTO account (provider_id, account_id, label, healthy, ewma_latency_ms, added_at)
       VALUES (?,?,?,1,0,?)
       ON CONFLICT(provider_id, account_id) DO UPDATE SET label = excluded.label`,
      [providerId, accountId, label, now],
    );
  }

  /** Persist observed latency + health (PROV-15 deprioritisation across reloads). */
  update(providerId: string, accountId: string, fields: { healthy?: boolean; latencyMs?: number }): void {
    this.db.run(
      `UPDATE account
         SET healthy = COALESCE(?, healthy),
             ewma_latency_ms = COALESCE(?, ewma_latency_ms)
       WHERE provider_id = ? AND account_id = ?`,
      [
        fields.healthy === undefined ? null : fields.healthy ? 1 : 0,
        fields.latencyMs ?? null,
        providerId,
        accountId,
      ],
    );
  }

  remove(providerId: string, accountId: string): void {
    this.db.run('DELETE FROM account WHERE provider_id = ? AND account_id = ?', [providerId, accountId]);
  }
}

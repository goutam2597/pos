/**
 * Post-sync record migrations.
 *
 * Kept in its own module so the dependency graph stays acyclic: `capture.ts`
 * nudges the sync engine, so anything the engine imports must not import
 * capture back.
 */

import { db } from '../db';

interface MigrationCandidate {
  type: string;
  payload: unknown;
}

/**
 * Adopt the server's id for an offline-created record.
 *
 * A customer created at the counter with no network is keyed locally as
 * `pos-<clientTxnId>`, because the server's id does not exist yet. The moment
 * the push lands, the server tells us the real id. Without rewriting the key
 * here, the next pull would deliver the same person a second time under the
 * server id and the cashier would be left with two customer records to merge.
 *
 * The local row's data wins for fields the operator typed and the id/updatedAt
 * come from the server, so the migration never loses what was typed at the
 * counter.
 */
export async function applyLocalIdMigration(entry: MigrationCandidate, serverId: string | null | undefined): Promise<void> {
  if (!serverId) return;
  if (entry.type !== 'CUSTOMER_CREATE') return;

  const payload = entry.payload as { localId?: unknown } | null;
  const localId = typeof payload?.localId === 'string' ? payload.localId : null;
  if (!localId || localId === serverId) return;

  const customer = await db.customers.get(localId);
  if (!customer) return;

  await db.transaction('rw', db.customers, async () => {
    await db.customers.delete(localId);
    await db.customers.put({ ...customer, id: serverId });
  });
}

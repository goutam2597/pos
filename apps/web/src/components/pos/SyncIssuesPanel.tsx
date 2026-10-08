/**
 * The "needs attention" panel.
 *
 * Anything the sync engine could not settle is listed here with the server's
 * own words. Two rules:
 *
 *   * FAILURES ARE SHOWN, NEVER HIDDEN AND NEVER AUTO-RETRIED FOREVER. A `rejected`
 *     operation is permanent by definition; re-queueing it would spin a till at
 *     the back office for a document that will never validate. The operator
 *     fixes the cause (wrong price, retired customer, closed register) and
 *     presses Retry.
 *   * THE SALE ITSELF IS NEVER AT RISK. A failed entry is a sale the customer
 *     already paid for; it stays in `db.sales` and can be reprinted from the
 *     sales list at any time. This panel is about the RECORD, not the money.
 */

import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, RefreshCw, TriangleAlert } from 'lucide-react';
import { listAttentionEntries } from '../../lib/offline/outbox';
import { retrySync } from '../../lib/offline/syncEngine';
import { listConflictNotes, type ConflictNote } from '../../lib/offline/conflicts';
import { dateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { OutboxEntry } from '../../lib/db';
import { Badge, Button, EmptyState, Modal, Spinner } from './ui';

export interface SyncIssuesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Bumped by the page when the sync engine reports progress. */
  refreshToken: number;
}

export function SyncIssuesPanel({ open, onClose, refreshToken }: SyncIssuesPanelProps) {
  const t = useT();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [notes, setNotes] = useState<ConflictNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, noteList] = await Promise.all([listAttentionEntries(), listConflictNotes()]);
      setEntries(list);
      setNotes(noteList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshToken]);

  const retry = useCallback(
    async (ids?: string[]) => {
      setBusy(true);
      try {
        await retrySync(ids);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const nothing = entries.length === 0 && notes.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('sync.failedItems')}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={14} strokeWidth={1.75} />
            {t('action.refresh')}
          </Button>
          <Button variant="primary" onClick={() => void retry()} disabled={busy || entries.length === 0}>
            {busy ? <Spinner /> : <RefreshCw size={14} strokeWidth={1.75} />}
            {t('sync.retryAll')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : nothing ? (
        <EmptyState
          icon={<CircleAlert size={22} strokeWidth={1.75} />}
          title={t('sync.noFailures')}
          description="Every sale taken on this till has been acknowledged by the server."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {entries.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                {t('sync.failedItems')} ({entries.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <li
                    key={entry.clientTxnId}
                    className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={entry.state === 'failed' ? 'danger' : 'warning'}>
                        {entry.state === 'failed' ? (
                          <TriangleAlert size={11} strokeWidth={1.75} />
                        ) : (
                          <CircleAlert size={11} strokeWidth={1.75} />
                        )}
                        {entry.type.replace('_', ' ')}
                      </Badge>
                      <span className="tabular text-[12px] text-[var(--text-primary)]">{entry.serverRef ?? entry.clientTxnId.slice(0, 8)}</span>
                      <span className="ms-auto text-[11px] text-[var(--text-tertiary)]">{dateTime(entry.capturedAt)}</span>
                    </div>

                    <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                      {entry.lastError ?? 'No reason was supplied by the server.'}
                    </p>

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void retry([entry.clientTxnId])} disabled={busy}>
                        <RefreshCw size={12} strokeWidth={1.75} />
                        {t('action.retry')}
                      </Button>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {notes.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                Reconciliations ({notes.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {notes.map((note) => (
                  <li
                    key={note.id}
                    className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">{note.entityName}</Badge>
                      <span className="ms-auto text-[11px] text-[var(--text-tertiary)]">{dateTime(note.at)}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{note.message}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/**
 * Held sales.
 *
 * Parking a cart writes it to IndexedDB and queues a `HOLD_CREATE`, so a parked
 * sale survives a reload, a crash and a closed browser — the same durability
 * guarantee a completed sale gets. Resuming restores the cart exactly, including
 * the customer and the cart-level discount, because a held sale that comes back
 * subtly different is a held sale the cashier cannot trust.
 */

import { Pause, Trash2 } from 'lucide-react';
import { dateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { LocalHold } from '../../lib/db';
import { Badge, Button, EmptyState, Modal, Spinner, cx } from './ui';

export interface HoldPanelProps {
  open: boolean;
  holds: LocalHold[];
  loading: boolean;
  /** Line/item count per hold, precomputed by the page from the stored cart. */
  describe: (hold: LocalHold) => { items: number; total: string };
  onResume: (hold: LocalHold) => void;
  onRelease: (hold: LocalHold) => void;
  onClose: () => void;
}

export function HoldPanel({ open, holds, loading, describe, onResume, onRelease, onClose }: HoldPanelProps) {
  const t = useT();

  return (
    <Modal open={open} title={t('pos.held')} onClose={onClose} width="md">
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : holds.length === 0 ? (
        <EmptyState
          icon={<Pause size={22} strokeWidth={1.75} />}
          title="Nothing is on hold"
          description="Park a sale with F8 when a customer needs to step away. It is stored on this till and stays there through a restart."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {holds.map((hold, index) => {
            const info = describe(hold);
            return (
              <li
                key={hold.clientTxnId}
                className={cx(
                  'flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3',
                  index === 0 && 'border-[var(--accent)]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{hold.label}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {info.items} item{info.items === 1 ? '' : 's'} · {info.total} · {dateTime(hold.createdAt)}
                  </p>
                </div>

                {hold.state !== 'synced' && hold.state !== 'duplicate' ? (
                  <Badge tone={hold.state === 'failed' ? 'danger' : 'info'}>
                    {hold.state === 'failed' ? 'Not sent' : 'Not yet synced'}
                  </Badge>
                ) : null}

                <Button size="sm" variant="primary" onClick={() => onResume(hold)}>
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRelease(hold)}
                  title="Discard this held sale"
                  aria-label={`Discard ${hold.label}`}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

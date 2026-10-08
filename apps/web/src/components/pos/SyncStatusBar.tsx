/**
 * The sync status bar.
 *
 * This is the most safety-critical piece of chrome on the whole till, so it is
 * permanent and never collapses to a spinner. A cashier who cannot tell
 * "saved to this device" from "saved on the server" will eventually hand a
 * customer a receipt for a sale that was never recorded.
 *
 * The rule it enforces in plain words: when the link is down it SAYS the sales
 * are being kept locally and will sync when it returns. It never implies the
 * sale is already safe on the server, and it never hides a failure behind a
 * healthy-looking dot.
 */

import { RefreshCw, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import { relativeTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { triggerSync } from '../../lib/offline/syncEngine';
import { useSyncStatus } from '../../lib/offline/useSyncStatus';
import { Badge, Button, Spinner, cx } from './ui';

export interface SyncStatusBarProps {
  onOpenIssues: () => void;
}

export function SyncStatusBar({ onOpenIssues }: SyncStatusBarProps) {
  const t = useT();
  const status = useSyncStatus();
  const attention = status.failed + status.conflict;

  const offline = status.state === 'offline';
  const degraded = status.state === 'degraded';

  const dotTone = offline
    ? 'bg-[var(--warning)]'
    : degraded
      ? 'bg-[var(--warning)]'
      : attention > 0
        ? 'bg-[var(--danger)]'
        : 'bg-[var(--success)]';

  const stateLabel = offline
    ? t('state.offline')
    : degraded
      ? 'Connection problems'
      : attention > 0
        ? t('state.failed')
        : t('state.online');

  return (
    <div
      className={cx(
        'no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5',
        offline || degraded ? 'border-[var(--warning)] bg-[var(--warning-subtle)]' : 'border-[var(--border-default)] bg-[var(--bg-surface)]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', dotTone)} aria-hidden="true" />
        {offline ? (
          <WifiOff size={14} strokeWidth={1.75} className="text-[var(--warning-text)]" />
        ) : (
          <Wifi size={14} strokeWidth={1.75} className="text-[var(--text-tertiary)]" />
        )}
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{stateLabel}</span>
      </div>

      {offline ? (
        <p className="text-[12px] text-[var(--warning-text)]">{t('pos.offlineBanner')}</p>
      ) : degraded && status.lastError ? (
        <p className="truncate text-[12px] text-[var(--warning-text)]">{status.lastError}</p>
      ) : null}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {status.syncing > 0 ? (
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
            <Spinner />
            {t('state.syncing')} ({status.syncing})
          </span>
        ) : null}

        {status.pending > 0 ? (
          <Badge tone={offline ? 'warning' : 'info'}>
            {t('sync.pending')}: {status.pending}
          </Badge>
        ) : null}

        {attention > 0 ? (
          <Button size="sm" variant="danger" onClick={onOpenIssues}>
            <TriangleAlert size={13} strokeWidth={1.75} />
            {attention} {attention === 1 ? 'item needs' : 'items need'} attention
          </Button>
        ) : null}

        <span className="text-[11px] text-[var(--text-tertiary)]">
          {status.lastSyncedAt ? `${t('sync.lastSynced')}: ${relativeTime(status.lastSyncedAt)}` : 'Never synced'}
        </span>

        <Button
          size="sm"
          variant="ghost"
          onClick={triggerSync}
          disabled={offline}
          title={offline ? 'Cannot sync while offline' : t('sync.syncNow')}
        >
          <RefreshCw size={13} strokeWidth={1.75} className={cx(status.syncing > 0 && 'motion-safe:animate-spin')} />
          {t('sync.syncNow')}
        </Button>
      </div>
    </div>
  );
}

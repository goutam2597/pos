/**
 * React binding for the sync engine.
 *
 * Components read sync state through this hook and nothing else. That is a
 * deliberate rule: a component that polls IndexedDB on an interval to draw a
 * "3 pending" badge is a component that will show the wrong number, briefly,
 * exactly when the operator is looking at it. The engine owns the state; this
 * hook subscribes to it.
 */

import { useSyncExternalStore } from 'react';
import { emptySyncStatus, type SyncStatus } from '@monopos/shared';
import { syncEngine } from './syncEngine';

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => syncEngine.subscribe(() => listener()),
    () => syncEngine.getStatus(),
    // Server rendering / pre-hydration: no IndexedDB, so no real status.
    () => emptySyncStatus(),
  );
}

/** Just the online flag, for the few places that must not re-render on counts. */
export function useIsOnline(): boolean {
  return useSyncStatus().state !== 'offline';
}

/** True when anything needs a human. Used to badge the sync button. */
export function useSyncAttention(): boolean {
  const status = useSyncStatus();
  return status.failed > 0 || status.conflict > 0;
}

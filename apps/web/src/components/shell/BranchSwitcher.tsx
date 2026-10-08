import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, RefreshCw, Wifi, WifiOff } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { queryKeys, useApiQuery, type Branch, type SyncOverview } from '../../lib/queries';
import { Button } from '../ui/Button';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Tooltip } from '../ui/Popover';

/**
 * Branch switcher.
 *
 * Only rendered when the user actually has more than one branch. The selection
 * rides on every request as `X-Branch-Id`, so switching is instant for the
 * user and there is nothing to "apply".
 */
export function BranchSwitcher() {
  const { api, branchId, setBranchId } = useAuth();

  const { data: branches } = useApiQuery<Branch[]>(
    queryKeys.branches,
    (signal) => api.data<Branch[]>('/branches', { signal }),
    { staleTime: 5 * 60_000 },
  );

  const list = branches ?? [];
  if (list.length <= 1) return null;

  const active = list.find((branch) => branch.id === branchId) ?? list[0];

  const items: MenuItem[] = list.map((branch) => ({
    key: branch.id,
    label: branch.name,
    icon: <Building2 size={16} strokeWidth={1.75} />,
    hint: branch.id === active?.id ? <Check size={14} strokeWidth={2} /> : undefined,
    onSelect: () => setBranchId(branch.id),
  }));

  return (
    <DropdownMenu
      label="Switch branch"
      align="start"
      items={items}
      trigger={({ open, ref }) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex h-[var(--height-control)] max-w-[13rem] items-center gap-1.5 rounded-[var(--radius-md)] px-2',
            'text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
            open && 'bg-[var(--bg-sunken)] text-[var(--text-primary)]',
          )}
        >
          <Building2 size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 truncate">{active?.name ?? 'All branches'}</span>
        </button>
      )}
    />
  );
}

/**
 * Sync status.
 *
 * Deliberately quiet: it only draws attention when a human is needed. A
 * permanently spinning icon trains people to ignore the one moment it matters.
 */
export function SyncStatusIndicator() {
  const { api, can } = useAuth();
  const navigate = useNavigate();

  const { data } = useApiQuery<SyncOverview>(
    queryKeys.sync,
    (signal) => api.data<SyncOverview>('/sync/overview', { signal }),
    { enabled: can('sync:view'), staleTime: 30_000, refetchInterval: 60_000 },
  );

  const pending = data?.pendingTotal ?? 0;
  const failures = data?.recentFailures?.length ?? 0;

  if (pending === 0 && failures === 0) {
    return (
      <Tooltip content="All devices are in sync">
        <span className="flex size-[var(--height-control)] items-center justify-center text-[var(--success-text)]">
          <Wifi size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Synchronised</span>
        </span>
      </Tooltip>
    );
  }

  const items: MenuItem[] = [
    {
      key: 'pending',
      label: `${pending} waiting to sync`,
      icon: <RefreshCw size={16} strokeWidth={1.75} />,
      disabled: true,
    },
    ...(failures > 0
      ? [
          {
            key: 'failed',
            label: `${failures} need attention`,
            icon: <WifiOff size={16} strokeWidth={1.75} />,
            disabled: true,
          },
        ]
      : []),
    { key: 'go', label: 'Open sync overview', separated: true, onSelect: () => navigate('/sync') },
  ];

  return (
    <DropdownMenu
      label="Synchronisation status"
      items={items}
      trigger={({ open, ref }) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex size-[var(--height-control)] items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--bg-sunken)]',
            failures > 0 ? 'text-[var(--danger-text)]' : 'text-[var(--warning-text)]',
          )}
        >
          {failures > 0 ? (
            <WifiOff size={16} strokeWidth={1.75} />
          ) : (
            <RefreshCw size={16} strokeWidth={1.75} className="animate-spin" />
          )}
          <span className="sr-only">{failures > 0 ? `${failures} sync failures` : `${pending} items pending`}</span>
        </button>
      )}
    />
  );
}

/** Human label for the branch currently in scope. */
export function useBranchLabel(branches: Branch[] | undefined, branchId: string | null): string {
  return useMemo(() => {
    if (!branchId) return 'All branches';
    return branches?.find((branch) => branch.id === branchId)?.name ?? 'All branches';
  }, [branches, branchId]);
}

/** Compact "clear the scope" control for reports. */
export function BranchScopeReset({ onReset }: { onReset: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onReset}>
      All branches
    </Button>
  );
}

import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Skeleton } from './Skeleton';

/**
 * KPI tile.
 *
 * A number, what the number is, and — only when the server actually told us —
 * how it moved. A trend arrow with no server-provided delta is worse than no
 * arrow, so `trend` is never derived client-side.
 */

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Signed change already expressed as a display string, e.g. `+12.4%`. */
  trend?: string | null;
  /** Direction of the trend. Neutral means "no direction", e.g. flat. */
  trendDirection?: 'up' | 'down' | 'flat';
  /** Context under the value, e.g. "vs. same day last week". */
  caption?: ReactNode;
  /** Marks a number that should get the owner's attention. */
  tone?: 'default' | 'danger' | 'warning' | 'success';
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONE_TEXT = {
  default: 'text-[var(--text-primary)]',
  danger: 'text-[var(--danger-text)]',
  warning: 'text-[var(--warning-text)]',
  success: 'text-[var(--success-text)]',
} as const;

export function KpiTile({
  label,
  value,
  icon: Icon,
  trend,
  trendDirection = 'flat',
  caption,
  tone = 'default',
  loading,
  onClick,
  className,
}: KpiTileProps) {
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-start',
        onClick && 'transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-[var(--text-secondary)]">{label}</span>
        {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--text-tertiary)]" />}
      </div>

      {loading ? (
        <Skeleton className="mt-1 h-7 w-28" />
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn('text-2xl font-semibold leading-7 tracking-tight tabular-nums', TONE_TEXT[tone])}>
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums',
                trendDirection === 'up' && 'text-[var(--success-text)]',
                trendDirection === 'down' && 'text-[var(--danger-text)]',
                trendDirection === 'flat' && 'text-[var(--text-tertiary)]',
              )}
            >
              {trendDirection === 'up' && <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />}
              {trendDirection === 'down' && <ArrowDownRight size={13} strokeWidth={1.75} aria-hidden="true" />}
              {trend}
            </span>
          )}
        </div>
      )}

      {caption && <div className="text-[12px] text-[var(--text-tertiary)]">{caption}</div>}
    </Wrapper>
  );
}

/** Row of tiles; wraps rather than scrolls so nothing is hidden off-screen. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>;
}

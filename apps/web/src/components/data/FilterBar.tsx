import { useState, type ReactNode } from 'react';
import { Filter, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

/**
 * Filter bar.
 *
 * Collapsible, and collapsed by default on a list that is already dense — a
 * permanently expanded row of four selects pushes the actual data below the
 * fold. Active filters are also summarised as removable chips so the user can
 * see at a glance why a list is short.
 */

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  /** Search field and primary actions. Always visible. */
  children: ReactNode;
  /** The collapsible part: selects, date ranges, toggles. */
  filters?: ReactNode;
  active?: ActiveFilter[];
  onClearAll?: () => void;
  className?: string;
}

export function FilterBar({ children, filters, active = [], onClearAll, className }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const hasFilters = Boolean(filters);

  return (
    /*
     * `contents` dissolves this wrapper so the search field becomes a direct
     * item of the DataTable's control row. Left as a flex container, the search
     * always wrapped onto a line of its own, which is what put it above the
     * filters instead of beside them.
     */
    <div className="contents">
      {/*
        This row participates in the DataTable's control row via `contents` on
        the parent, so it must NOT wrap internally: an internal `flex-wrap`
        would send the search onto a line of its own. The search also has a fixed
        width rather than `flex-1`, because a growing search consumes exactly the
        slack the filter selects need to stay on the same line.
      */}
      <div className="flex items-center gap-2 empty:hidden">
        <div className="w-[15rem] shrink-0">{children}</div>
        {hasFilters && (
          <Button
            variant={open ? 'secondary' : 'ghost'}
            size="md"
            icon={<Filter size={15} strokeWidth={1.75} />}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            Filters
            {active.length > 0 && (
              <span className="ms-1 inline-flex size-[18px] items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[var(--accent-contrast)]">
                {active.length}
              </span>
            )}
          </Button>
        )}
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={filter.onRemove}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-1.5 py-0.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              {filter.label}
              <X size={12} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          {onClearAll && (
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              Clear all
            </Button>
          )}
        </div>
      )}

      {hasFilters && open && <div className="flex flex-wrap items-end gap-2.5">{filters}</div>}
    </div>
  );
}

/** Fixed-width column wrapper so filter controls line up with each other. */
export function FilterField({ children, width = 'w-[10rem]' }: { children: ReactNode; width?: string }) {
  return <div className={cn('min-w-0', width)}>{children}</div>;
}

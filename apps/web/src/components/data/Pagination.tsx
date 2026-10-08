import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

/**
 * Pagination.
 *
 * Shows the real range ("Showing 26–50 of 312") rather than just arrows, because
 * the most common support question about a list is "is my item past the end?".
 * The page numbers collapse to first / current window / last so a 2,000-page
 * ledger does not render 2,000 buttons.
 */

export const PAGE_SIZES = [10, 25, 50, 100, 200];

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
  label?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  pageCount,
  onPageChange,
  onPageSizeChange,

  className,
  label = 'Pagination',
}: PaginationProps) {
  const safeCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safeCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(current * pageSize, total);

  return (
    <nav
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-3 py-2.5',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-[12px] text-[var(--text-tertiary)]">Rows</span>
            <Select
              size="sm"
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
              aria-label="Rows per page"
              className="w-[4.5rem]"
            />
          </div>
        )}
        <p className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
          {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
        </p>
      </div>

      {safeCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} strokeWidth={1.75} className="rtl:rotate-180" />
          </Button>

          {pageWindow(current, safeCount).map((entry, index) =>
            entry === '…' ? (
              <span key={`gap-${index}`} className="px-1 text-[12px] text-[var(--text-disabled)]">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPageChange(entry)}
                aria-current={entry === current ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                className={cn(
                  'h-[var(--height-control-sm)] min-w-[var(--height-control-sm)] rounded-[var(--radius-sm)] px-1.5 text-[13px] tabular-nums transition-colors',
                  entry === current
                    ? 'bg-[var(--accent)] font-medium text-[var(--accent-contrast)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
                )}
              >
                {entry}
              </button>
            ),
          )}

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            disabled={current >= safeCount}
            onClick={() => onPageChange(current + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} strokeWidth={1.75} className="rtl:rotate-180" />
          </Button>
        </div>
      )}
    </nav>
  );
}

/** First, a window around the current page, last. `null` marks an ellipsis. */
function pageWindow(current: number, count: number): Array<number | '…'> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const pages = new Set<number>([1, count, current]);
  for (const offset of [-1, 1]) {
    const candidate = current + offset;
    if (candidate > 1 && candidate < count) pages.add(candidate);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push('…');
    out.push(value);
    previous = value;
  }
  return out;
}

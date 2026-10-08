import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

/**
 * Table primitives.
 *
 * A styled `<table>` and nothing more — no virtualisation, no column model, no
 * opinion about what a row is. `DataTable` builds on these; a report that needs
 * an arbitrary grid uses them directly.
 *
 * STICKY HEADER is the one behaviour worth owning here: a 200-row product list
 * scrolled past row 40 is unreadable without it.
 */

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Freeze the header against page scroll. */
  stickyHeader?: boolean;
  /** Remove the default border for a nested table inside a card. */
  borderless?: boolean;
  /** `fixed` pins the numeric columns so a wide row stays scannable. */
  layout?: 'auto' | 'fixed';
}

export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, stickyHeader, borderless, layout = 'auto', ...props },
  ref,
) {
  return (
    <div className={cn('w-full overflow-x-auto scrollbar-thin', stickyHeader && 'max-h-[70vh] overflow-y-auto')}>
      <table
        ref={ref}
        className={cn(
          'w-full caption-bottom border-collapse text-[13px]',
          layout === 'fixed' && 'table-fixed',
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableHeader({ className, ...props }, ref) {
    return (
      <thead
        ref={ref}
        className={cn(
          'border-b border-[var(--border-default)] bg-[var(--bg-surface)]',
          className,
        )}
        {...props}
      />
    );
  },
);

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className, ...props }, ref) {
    return <tbody ref={ref} className={cn('divide-y divide-[var(--border-subtle)]', className)} {...props} />;
  },
);

export const TableFooter = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableFooter({ className, ...props }, ref) {
    return (
      <tfoot
        ref={ref}
        className={cn('border-t border-[var(--border-default)] bg-[var(--bg-sunken)]', className)}
        {...props}
      />
    );
  },
);

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={cn('transition-colors hover:bg-[var(--bg-sunken)]', className)}
        {...props}
      />
    );
  },
);

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className, ...props }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={cn(
          'px-3 py-2 text-start text-[12px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase',
          'whitespace-nowrap',
          className,
        )}
        {...props}
      />
    );
  },
);

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className, ...props }, ref) {
    return (
      <td
        ref={ref}
        className={cn('px-3 py-2.5 align-middle text-[var(--text-primary)]', className)}
        {...props}
      />
    );
  },
);

/** Caption for a table whose meaning is not obvious from its headers. */
export function TableCaption({ children }: { children: React.ReactNode }) {
  return <caption className="pb-2 text-start text-[13px] text-[var(--text-tertiary)]">{children}</caption>;
}

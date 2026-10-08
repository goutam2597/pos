import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Link } from 'react-router-dom';

import { cn } from '../../lib/cn';
import { readTableView, resetTableView, writeTableView } from '../../lib/stores';
import type { ListMeta } from '../../lib/queries';
import { Badge, Button, EmptyState, ErrorState, SkeletonTableRows, Tooltip, type EmptyStateProps } from '../ui';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Checkbox } from '../ui/Toggle';
import { Pagination } from './Pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

/**
 * DataTable.
 *
 * One component for every list in the product: catalogue, sales, invoices,
 * ledger lines, audit entries. Pages describe *columns*; this owns sorting,
 * paging, column visibility, row selection, bulk actions and CSV export.
 *
 * DESIGN RULE: the table never invents data. Sorting is client-side over the
 * current page and labelled as such; server-side sorting is opt-in via
 * `manualSort`, which sends the sort through the query instead. An empty result
 * set says so; it never renders a placeholder row of fake numbers.
 */

export interface Column<T> {
  /** Stable key; also the CSV header and the column-visibility id. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the whole row so a cell can reach its siblings. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting and CSV export. Omit for a non-comparable column. */
  value?: (row: T) => string | number | null | undefined;
  align?: 'start' | 'end' | 'center';
  /** Hidden until the user opts in via the column picker. */
  optional?: boolean;
  width?: string;
  /** Sticky to the start edge; use for the identifying column only. */
  sticky?: boolean;
  sortable?: boolean;
  className?: string;
}

export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  onRun: (selectedIds: string[]) => void;
  /** Hide when the current selection does not satisfy it. */
  enabled?: (selectedIds: string[]) => boolean;
}

export interface DataTableProps<T> {
  /** Stable id; column visibility and sort are remembered per table. */
  tableId: string;
  columns: Column<T>[];
  rows: T[];
  meta: ListMeta;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  /** True on a background refetch — keeps the rows visible instead of flashing. */
  isRefetching?: boolean;
  error?: Error | null;
  onRetry?: () => void;

  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;

  /** Toolbar above the table. */
  toolbar?: ReactNode;
  /** Filters, rendered in their own row below the toolbar. */
  filters?: ReactNode;

  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyIcon?: EmptyStateProps['icon'];
  emptyAction?: { label: string; onClick: () => void; icon?: ReactNode };
  errorTitle?: ReactNode;

  selectable?: boolean;
  bulkActions?: BulkAction[];

  /** Send sort state to the server instead of sorting the current page. */
  manualSort?: boolean;
  onSortChange?: (sort: { sortBy: string; sortDir: 'asc' | 'desc' }) => void;
  defaultSort?: { sortBy?: string; sortDir?: 'asc' | 'desc' };
  defaultPageSize?: number;

  /** Row click handler; a real link in the first column is usually better. */
  onRowClick?: (row: T) => void;

  /** Disable CSV export (e.g. on a report with no rows). */
  exportable?: boolean;
  exportName?: string;
  className?: string;
}

export function DataTable<T>({
  tableId,
  columns,
  rows,
  meta,
  getRowId,
  isLoading,
  isRefetching,
  error,
  onRetry,
  onPageChange,
  onPageSizeChange,
  toolbar,
  filters,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyIcon,
  emptyAction,
  errorTitle = 'Could not load this list',
  selectable,
  bulkActions = [],
  manualSort,
  onSortChange,
  defaultSort,
  defaultPageSize,
  onRowClick,
  exportable = true,
  exportName,
  className,
}: DataTableProps<T>) {
  const view = readTableView(tableId);

  const [hidden, setHidden] = useState<string[]>(view.hiddenColumns ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(
    view.sortBy ? { key: view.sortBy, dir: view.sortDir ?? 'asc' } : null,
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // A new result set means the old selection no longer refers to anything.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const valid = new Set(rows.map(getRowId));
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows, getRowId]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.includes(column.key)),
    [columns, hidden],
  );

  const sortedRows = useMemo(() => {
    if (!sort || manualSort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.value) return rows;
    const direction = sort.dir === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const left = column.value?.(a);
      const right = column.value?.(b);
      if (left === right) return 0;
      // Empties always sort last regardless of direction — an empty price is
      // not "the smallest price".
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [rows, sort, manualSort, columns]);

  const applySort = useCallback(
    (key: string) => {
      setSort((current) => {
        const dir = current?.key === key && current.dir === 'asc' ? 'desc' : 'asc';
        writeTableView(tableId, { sortBy: key, sortDir: dir });
        if (manualSort) onSortChange?.({ sortBy: key, sortDir: dir });
        return { key, dir };
      });
    },
    [manualSort, onSortChange, tableId],
  );

  const toggleColumn = useCallback(
    (key: string) => {
      setHidden((current) => {
        const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
        writeTableView(tableId, { hiddenColumns: next });
        return next;
      });
    },
    [tableId],
  );

  const allIds = sortedRows.map(getRowId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const exportableColumns = visibleColumns.filter((column) => column.value);
    if (exportableColumns.length === 0) {
      toast.error('This table has no exportable columns.');
      return;
    }

    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [
      exportableColumns.map((column) => escape(column.header)).join(','),
      ...sortedRows.map((row) => exportableColumns.map((column) => escape(column.value?.(row))).join(',')),
    ];

    // The BOM keeps Excel from mangling non-Latin characters on open, which
    // matters for exactly the shop owners this product is for.
    const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${exportName ?? tableId}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columnItems: MenuItem[] = [
    ...columns
      .filter((column) => column.optional)
      .map((column) => {
        const shown = !hidden.includes(column.key);
        return {
          key: column.key,
          // A tick glyph, not a real <input>: this row is already a <button>,
          // and nesting a form control inside one is invalid and unreachable by
          // keyboard. The menu item itself is the control.
          label: (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-[16px] shrink-0 items-center justify-center rounded-[var(--radius-xs)] border',
                  shown
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'border-[var(--border-strong)] bg-[var(--bg-surface)]',
                )}
              >
                {shown && (
                  <svg viewBox="0 0 12 12" className="size-3">
                    <path
                      d="M2.5 6.2 4.8 8.5 9.5 3.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.9}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {column.header}
              <span className="sr-only">{shown ? ' (shown)' : ' (hidden)'}</span>
            </span>
          ),
          onSelect: () => toggleColumn(column.key),
        };
      }),
    { key: '__reset', label: 'Show all columns', separated: true, onSelect: () => { resetTableView(tableId); setHidden([]); } },
  ];

  const activeBulkActions = bulkActions.filter((action) => !action.enabled || action.enabled([...selected]));

  /**
   * Row-level actions: column chooser and CSV export. Rendered on the trailing
   * edge of the single control row rather than in a band of their own.
   */
  const renderRowActions = () => (
    <>
      {columnItems.length > 0 && (
        <DropdownMenu
          label="Columns"
          align="end"
          items={columnItems}
          trigger={({ open, ref }) => (
            <Button
              ref={ref as React.Ref<HTMLButtonElement>}
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Choose columns"
              aria-expanded={open}
            >
              <Columns3 size={16} strokeWidth={1.75} />
            </Button>
          )}
        />
      )}
      {exportable && (
        <Button variant="ghost" size="sm" onClick={exportCsv} icon={<Download size={15} strokeWidth={1.75} />}>
          <span className="hidden sm:inline">Export</span>
        </Button>
      )}
    </>
  );

  return (
    <div className={cn('flex min-w-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)]', className)}>
      {activeBulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--accent-subtle)] px-3 py-2">
          <span className="text-[13px] font-medium text-[var(--accent-text)]">{selected.size} selected</span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            {activeBulkActions.map((action) => (
              <Button
                key={action.key}
                size="sm"
                variant="outline"
                icon={action.icon}
                onClick={() => action.onRun([...selected])}
              >
                {action.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/*
        ONE control row for every list screen: the toolbar (search, date range)
        and the filter selects share a single wrapping row, with the row-level
        actions — refresh, column chooser, export — pushed to the trailing edge.

        Previously these were three stacked bands, which pushed the actual table
        below the fold on any screen with a date range and two filters.
        `display: contents` dissolves each page's own toolbar wrapper so its
        children join this row, and the width override stops their `w-full`
        from forcing a wrap.
      */}
      {(toolbar || filters || exportable || columnItems.length > 0) && (
        <div className="flex flex-wrap items-end gap-x-2.5 gap-y-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
          {/*
            The toolbar's own wrapper is dissolved with `display: contents` so
            the search field and any date range join this row directly instead
            of forming a band of their own.

            The wrapper is NOT `flex-1`: that would claim the leftover width and
            shove the filters to the trailing edge, which is the same gap in a
            different place. Instead the search itself grows (see `FilterBar`)
            and the filters follow it at their natural width.
          */}
          {/*
            `contents` dissolves the page's toolbar wrapper so the search field
            and date range become items of THIS row. The wrapper carries no
            width of its own — giving it `flex-1` claimed the leftover space
            and pushed the filters to the far right, which is the same gap in a
            different place. The search's own `flex-1` (set in `FilterBar`)
            absorbs the slack instead.
          */}
          {toolbar && <div className="contents [&>div]:flex [&>div]:min-w-0 [&>div]:items-end [&>div]:gap-2.5 [&>div]:flex-none">{toolbar}</div>}
          {filters}
          {/*
            The row actions sit inline, immediately after the filters. Pushing
            them to the trailing edge with `ms-auto` split the strip into two
            unrelated groups and left a large void on the right; a single
            left-packed control row reads as one toolbar.
          */}
          {(exportable || columnItems.length > 0 || isRefetching) && (
            /* `h-[var(--height-control)]` matches the labelled inputs so the
               icon buttons sit on the same baseline instead of reading as a
               second row. */
            <div className="flex h-[var(--height-control)] items-center gap-1.5">
              {isRefetching && (
                <span className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
                  Refreshing…
                </span>
              )}
              {renderRowActions()}
            </div>
          )}
        </div>
      )}

      <div ref={bodyRef} className="min-w-0 flex-1 overflow-x-auto scrollbar-thin">
        {error ? (
          <ErrorState
            title={errorTitle}
            description={error instanceof Error ? error.message : undefined}
            onRetry={onRetry}
            compact
          />
        ) : (
          <Table stickyHeader>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {selectable && (
                  <TableHead className="w-9 ps-3">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows on this page"
                    />
                  </TableHead>
                )}
                {visibleColumns.map((column) => {
                  const sortable = column.sortable !== false && column.value !== undefined;
                  const active = sort?.key === column.key;
                  return (
                    <TableHead
                      key={column.key}
                      style={column.width ? { width: column.width } : undefined}
                      className={cn(column.sticky && 'sticky start-0 z-10 bg-[var(--bg-surface)]', column.className)}
                      aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => applySort(column.key)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-[var(--radius-xs)] transition-colors hover:text-[var(--text-primary)]',
                            active && 'text-[var(--text-primary)]',
                            column.align === 'end' && 'flex-row-reverse',
                          )}
                        >
                          {column.header}
                          {active ? (
                            sort?.dir === 'asc' ? (
                              <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown size={12} strokeWidth={1.75} aria-hidden="true" className="opacity-40" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <SkeletonTableRows rows={8} columns={visibleColumns.length + (selectable ? 1 : 0)} />
              ) : sortedRows.length === 0 ? (
                <tr>
                  <TableCell colSpan={visibleColumns.length + (selectable ? 1 : 0)} className="p-0">
                    <EmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      compact
                      action={emptyAction}
                      {...(emptyIcon ? { icon: emptyIcon } : {})}
                    />
                  </TableCell>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const id = getRowId(row);
                  const isSelected = selected.has(id);
                  return (
                    <TableRow
                      key={id}
                      data-selected={isSelected || undefined}
                      className={cn(
                        onRowClick && 'cursor-pointer',
                        isSelected && 'bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle-hover)]',
                      )}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {selectable && (
                        <TableCell className="w-9 ps-3" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onChange={() => toggleRow(id)}
                            aria-label={`Select row ${id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.map((column) => (
                        <TableCell
                          key={column.key}
                          style={column.width ? { width: column.width } : undefined}
                          className={cn(
                            column.align === 'end' && 'text-end tabular-nums',
                            column.align === 'center' && 'text-center',
                            column.sticky && 'sticky start-0 bg-[var(--bg-surface)]',
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {!error && onPageChange && (
        <Pagination
          page={meta.page}
          pageSize={meta.pageSize}
          total={meta.total}
          pageCount={meta.pageCount}
          onPageChange={onPageChange}
          {...(onPageSizeChange ? { onPageSizeChange } : {})}
        />
      )}
    </div>
  );
}

/**
 * A link that reads as the row identity.
 *
 * Uses the router's `Link`, not a bare `<a>`: a full page load for a detail view
 * would throw away the query cache and refetch the list the user came from.
 */
export function TableLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Tooltip content={typeof children === 'string' ? children : undefined}>
      <Link
        to={to}
        className="font-medium text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent-text)] hover:underline"
      >
        {children}
      </Link>
    </Tooltip>
  );
}

/** Consistent empty/loading wrapper for a non-table list (chips, cards). */
export function ListState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  children,
  emptyTitle,
  emptyDescription,
  emptyAction,
  skeleton,
}: {
  isLoading: boolean;
  error?: Error | null;
  isEmpty: boolean;
  onRetry?: () => void;
  children: ReactNode;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyAction?: { label: string; onClick: () => void; icon?: ReactNode };
  skeleton?: ReactNode;
}) {
  if (error) {
    return <ErrorState title="Could not load this list" description={error.message} onRetry={onRetry} />;
  }
  if (isLoading) return <>{skeleton ?? <div className="h-40" />}</>;
  if (isEmpty) {
    return <EmptyState title={emptyTitle ?? 'Nothing here yet'} description={emptyDescription} action={emptyAction} />;
  }
  return <>{children}</>;
}

/** Row-count pill used in page headers. */
export function CountBadge({ total }: { total: number }) {
  return <Badge tone="neutral">{total.toLocaleString()}</Badge>;
}

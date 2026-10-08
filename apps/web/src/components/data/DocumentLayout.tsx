import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';

import { cn } from '../../lib/cn';
import { money } from '../../lib/format';
import { Button } from '../ui/Button';

/**
 * Printable document layout.
 *
 * Invoices and receipts have to survive both a browser print dialog and a
 * thermal till. The rules that make that work live here rather than in each
 * page: the chrome is `no-print`, the sheet is the only thing that prints, and
 * every amount is right-aligned with tabular figures so columns line up on
 * paper the way they do on screen.
 */
export function DocumentSheet({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'mx-auto w-full max-w-[52rem] rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 print:max-w-none print:rounded-none print:border-0 print:p-0',
        className,
      )}
    >
      {children}
    </article>
  );
}

/** Toolbar above a document: printing, the record number, and a back link. */
export function DocumentToolbar({
  title,
  reference,
  onBack,
  backLabel = 'Back',
  actions,
}: {
  title: ReactNode;
  reference?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            {backLabel}
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
          {reference && <p className="truncate text-[13px] text-[var(--text-tertiary)]">{reference}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button variant="secondary" icon={<Printer size={15} strokeWidth={1.75} />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}

export function DocumentHeader({
  businessName,
  meta,
  title,
  number,
}: {
  businessName?: string | null;
  meta: Array<{ label: string; value: ReactNode }>;
  title: string;
  number?: string | null;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--border-subtle)] pb-5">
      <div className="min-w-0">
        <p className="text-base font-semibold text-[var(--text-primary)]">{businessName ?? 'MonoPOS'}</p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
        {number && <p className="mt-0.5 font-mono text-[13px] text-[var(--text-secondary)]">{number}</p>}
      </div>
      <dl className="grid min-w-[12rem] gap-1.5 text-[13px]">
        {meta.map((entry) => (
          <div key={entry.label} className="flex justify-between gap-6">
            <dt className="text-[var(--text-tertiary)]">{entry.label}</dt>
            <dd className="text-end font-medium text-[var(--text-primary)]">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export interface DocumentLine {
  description: string;
  meta?: string;
  qtyMilli?: number;
  unitName?: string | null;
  unitPrice?: number;
  discount?: number;
  taxAmount?: number;
  total: number;
}

/**
 * Line table.
 *
 * The header row repeats on every printed page (`thead` + `display: table-header`
 * is the browser's job — we just have to not break the table into separate
 * elements).
 */
export function DocumentLines({ lines, showTax }: { lines: DocumentLine[]; showTax?: boolean }) {
  return (
    <table className="mt-6 w-full text-[13px]">
      <thead>
        <tr className="border-b border-[var(--border-default)]">
          <th scope="col" className="py-2 text-start text-[12px] font-semibold text-[var(--text-secondary)] uppercase">
            Description
          </th>
          <th scope="col" className="w-20 py-2 text-end text-[12px] font-semibold text-[var(--text-secondary)] uppercase">
            Qty
          </th>
          <th scope="col" className="w-28 py-2 text-end text-[12px] font-semibold text-[var(--text-secondary)] uppercase">
            Price
          </th>
          {showTax && (
            <th scope="col" className="w-24 py-2 text-end text-[12px] font-semibold text-[var(--text-secondary)] uppercase">
              Tax
            </th>
          )}
          <th scope="col" className="w-28 py-2 text-end text-[12px] font-semibold text-[var(--text-secondary)] uppercase">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-[var(--border-subtle)]">
            <td className="py-2.5 pe-3">
              <p className="font-medium text-[var(--text-primary)]">{line.description}</p>
              {line.meta && <p className="text-[12px] text-[var(--text-tertiary)]">{line.meta}</p>}
            </td>
            <td className="py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
              {line.qtyMilli === undefined ? '—' : qtyText(line.qtyMilli, line.unitName)}
            </td>
            <td className="py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
              {line.unitPrice === undefined ? '—' : money(line.unitPrice)}
            </td>
            {showTax && (
              <td className="py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
                {line.taxAmount === undefined ? '—' : money(line.taxAmount)}
              </td>
            )}
            <td className="py-2.5 text-end font-medium tabular-nums text-[var(--text-primary)]">{money(line.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DocumentTotals({
  rows,
  grandTotal,
  grandTotalLabel = 'Total',
}: {
  rows: Array<{ label: string; value: ReactNode; emphasis?: boolean }>;
  grandTotal?: ReactNode;
  grandTotalLabel?: string;
}) {
  return (
    <div className="mt-5 flex justify-end">
      <dl className="w-full max-w-xs space-y-1.5 text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-6">
            <dt className={row.emphasis ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>{row.label}</dt>
            <dd className={cn('text-end tabular-nums', row.emphasis ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              {row.value}
            </dd>
          </div>
        ))}
        {grandTotal !== undefined && (
          <div className="flex justify-between gap-6 border-t border-[var(--border-default)] pt-2 text-sm">
            <dt className="font-semibold text-[var(--text-primary)]">{grandTotalLabel}</dt>
            <dd className="text-end font-semibold tabular-nums text-[var(--text-primary)]">{grandTotal}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function DocumentFooter({ notes, terms }: { notes?: ReactNode; terms?: string }) {
  if (!notes && !terms) return null;
  return (
    <footer className="mt-8 border-t border-[var(--border-subtle)] pt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
      {notes && <div className="mb-2">{notes}</div>}
      {terms && <p>{terms}</p>}
    </footer>
  );
}

/** Milli-unit quantity as a printable string. */
export function qtyText(qtyMilli: number, unitName?: string | null): string {
  const negative = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  const text = `${negative ? '−' : ''}${whole}${frac ? `.${frac}` : ''}`;
  return unitName ? `${text} ${unitName}` : text;
}

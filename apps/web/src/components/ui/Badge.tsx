import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Badge and StatusBadge.
 *
 * Status colours come from the token layer's four status pairs (success,
 * danger, warning, info) rather than an ad-hoc palette per module, so a `PAID`
 * invoice and a `COMPLETED` sale are visibly the same "good" green.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border-default)]',
  brand: 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-[var(--brand-200)]',
  success: 'bg-[var(--success-subtle)] text-[var(--success-text)] border-transparent',
  danger: 'bg-[var(--danger-subtle)] text-[var(--danger-text)] border-transparent',
  warning: 'bg-[var(--warning-subtle)] text-[var(--warning-text)] border-transparent',
  info: 'bg-[var(--info-subtle)] text-[var(--info-text)] border-transparent',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  className?: string;
  /** Small dot before the label; useful in dense lists. */
  dot?: boolean;
  title?: string;
}

export function Badge({ children, tone = 'neutral', variant = 'soft', className, dot, title }: BadgeProps) {
  const solid = variant === 'solid';
  const outline = variant === 'outline';

  const solidTone: Record<BadgeTone, string> = {
    neutral: 'bg-[var(--bg-inset)] text-[var(--text-primary)] border-transparent',
    brand: 'bg-[var(--accent)] text-[var(--accent-contrast)] border-transparent',
    success: 'bg-[var(--success)] text-[var(--text-inverse)] border-transparent',
    danger: 'bg-[var(--danger)] text-[var(--text-inverse)] border-transparent',
    warning: 'bg-[var(--warning)] text-[var(--text-primary)] border-transparent',
    info: 'bg-[var(--info)] text-[var(--text-inverse)] border-transparent',
  };

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap',
        solid ? solidTone[tone] : outline ? `bg-transparent ${TONES[tone]}` : TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            solid ? 'bg-current' : 'bg-[var(--text-tertiary)]',
          )}
        />
      )}
      {children}
    </span>
  );
}

/**
 * Domain status -> tone + label.
 *
 * Every enum in `@monopos/shared` is mapped here, so adding a status means
 * extending one record rather than hunting through pages for the right colour.
 */
const STATUS_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  // Sales
  DRAFT: { tone: 'neutral', label: 'Draft' },
  COMPLETED: { tone: 'success', label: 'Completed' },
  PARTIAL: { tone: 'warning', label: 'Partial' },
  REFUNDED: { tone: 'info', label: 'Refunded' },
  VOIDED: { tone: 'danger', label: 'Voided' },
  RETURNED: { tone: 'warning', label: 'Returned' },
  // Invoices
  ISSUED: { tone: 'info', label: 'Issued' },
  PART_PAID: { tone: 'warning', label: 'Part paid' },
  PAID: { tone: 'success', label: 'Paid' },
  OVERDUE: { tone: 'danger', label: 'Overdue' },
  VOID: { tone: 'danger', label: 'Void' },
  CANCELLED: { tone: 'danger', label: 'Cancelled' },
  // Expenses
  SUBMITTED: { tone: 'info', label: 'Submitted' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  // Parties
  ACTIVE: { tone: 'success', label: 'Active' },
  INACTIVE: { tone: 'neutral', label: 'Inactive' },
  BLOCKED: { tone: 'danger', label: 'Blocked' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
  // Journal
  POSTED: { tone: 'success', label: 'Posted' },
  REVERSED: { tone: 'neutral', label: 'Reversed' },
  // Stock
  IN_TRANSIT: { tone: 'info', label: 'In transit' },
  RECEIVED: { tone: 'success', label: 'Received' },
  REQUESTED: { tone: 'info', label: 'Requested' },
  // Registers
  OPEN: { tone: 'success', label: 'Open' },
  CLOSED: { tone: 'neutral', label: 'Closed' },
  SUSPENDED: { tone: 'danger', label: 'Suspended' },
  // Sync
  PENDING: { tone: 'neutral', label: 'Pending' },
  SYNCING: { tone: 'info', label: 'Syncing' },
  SYNCED: { tone: 'success', label: 'Synced' },
  FAILED: { tone: 'danger', label: 'Failed' },
  CONFLICT: { tone: 'warning', label: 'Needs attention' },
  DUPLICATE: { tone: 'neutral', label: 'Duplicate' },
};

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string | null | undefined;
  className?: string;
  label?: string;
}) {
  if (!status) return <span className="text-[var(--text-disabled)]">—</span>;
  const entry = STATUS_TONES[status];
  const text = label ?? entry?.label ?? status.replace(/_/g, ' ').toLowerCase();
  return (
    <Badge tone={entry?.tone ?? 'neutral'} className={cn('capitalize', className)}>
      {text}
    </Badge>
  );
}

/** Active/inactive switch for settings lists. */
export function ActiveBadge({ isActive }: { isActive?: boolean | null }) {
  return <Badge tone={isActive === false ? 'neutral' : 'success'}>{isActive === false ? 'Inactive' : 'Active'}</Badge>;
}

/** Low-stock emphasis: used wherever a reorder threshold is breached. */
export function StockBadge({ isLow, onHand }: { isLow?: boolean; onHand?: number }) {
  if (isLow) {
    return (
      <Badge tone="warning" dot>
        Low
      </Badge>
    );
  }
  if (onHand !== undefined) return <span className="tabular-nums text-[var(--text-secondary)]">{onHand}</span>;
  return <Badge tone="neutral">In stock</Badge>;
}

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './Button';

/**
 * Empty, error and loading states.
 *
 * An empty state has to answer two questions or it is decoration: *why* is this
 * empty, and *what do I do about it*. So every one here names the cause and, when
 * the user can do something, offers the button that does it.
 */

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** The action that resolves the emptiness, e.g. "New product". */
  action?: { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean };
  /** Secondary action, e.g. "Clear filters" when a search hid everything. */
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  secondaryAction,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <span className="mb-3 flex size-10 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button variant="primary" size="sm" onClick={action.onClick} disabled={action.disabled} icon={action.icon}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Error state.
 *
 * Shows the message the server actually sent rather than a generic apology —
 * "Insufficient stock in Warehouse A" is actionable; "Something went wrong" is
 * not.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
  className,
  compact,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <span className="mb-3 flex size-10 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--danger-subtle)] bg-[var(--danger-subtle)] text-[var(--danger-text)]">
        <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          {description}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

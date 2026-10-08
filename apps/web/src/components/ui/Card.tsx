import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Card.
 *
 * Depth comes from a 1px border and a one-step background tint, never a drop
 * shadow. Stacking a dozen shadowed panels on a dashboard produces mush; a grid
 * of outlined panels stays readable.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the body padding for tables that manage their own. */
  flush?: boolean;
  /** Slightly stronger border for a card that is the page's focus. */
  emphasis?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, flush, emphasis, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-lg)] bg-[var(--bg-surface)]',
        emphasis
          ? 'border border-[var(--border-strong)]'
          : 'border border-[var(--border-default)]',
        !flush && 'p-4',
        className,
      )}
      {...props}
    />
  );
});

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or a link on the trailing edge. */
  actions?: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, title, description, actions, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>
        )}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
});

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardBody(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('p-4', className)} {...props} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3',
          className,
        )}
        {...props}
      />
    );
  },
);

/** Section heading used above a group of cards. */
export function SectionTitle({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{children}</h2>
      {actions}
    </div>
  );
}

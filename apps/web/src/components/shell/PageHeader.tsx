import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useLocation } from 'react-router-dom';
import { breadcrumbsFor, navLabel } from '../../lib/routes';
import { useI18n } from '../../lib/i18n';
import { Breadcrumbs } from '../ui/Breadcrumbs';

/**
 * Page header.
 *
 * One consistent place for the title, the primary action and the toolbar row,
 * so every screen in the product opens the same way. The breadcrumb trail is
 * derived from the route rather than passed in — a page that forgets to label
 * itself is still findable.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary actions, top-right. Usually one primary button and maybe one ghost. */
  actions?: ReactNode;
  /** Search + filters + view toggles, on their own row. */
  toolbar?: ReactNode;
  /** Suppress the breadcrumb for pages that are a root themselves (dashboard). */
  hideBreadcrumbs?: boolean;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  toolbar,
  hideBreadcrumbs,
  className,
  children,
}: PageHeaderProps) {
  const location = useLocation();
  const { t } = useI18n();

  const crumbs = breadcrumbsFor(location.pathname)
    .filter((item) => item.to !== '/')
    .map((item) => ({ label: navLabel(item.labelKey ?? item.key, t), to: item.to }));

  return (
    <div className={cn('mb-4 space-y-3', className)}>
      {!hideBreadcrumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {toolbar && <div className="flex flex-wrap items-end justify-between gap-2">{toolbar}</div>}
      {children}
    </div>
  );
}

/** Vertical rhythm for a page's main regions. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

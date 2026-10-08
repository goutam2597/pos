import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * Breadcrumbs.
 *
 * The separator is rotated by CSS rather than swapped for a mirrored glyph, so
 * an RTL trail points the way the reader is actually going.
 */

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-[13px]">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={index}>
              <li className="min-w-0">
                {item.to && !last ? (
                  <Link
                    to={item.to}
                    className="truncate text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className="truncate text-[var(--text-primary)]">
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-[var(--text-disabled)]">
                  <ChevronRight size={14} strokeWidth={1.75} className="rtl:rotate-180" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

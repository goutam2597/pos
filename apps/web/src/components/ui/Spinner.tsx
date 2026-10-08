import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Skeleton } from './Skeleton';

/** Indeterminate spinner. Sized in px so it matches a 16px lucide icon. */
export const Spinner = forwardRef<HTMLSpanElement, { size?: number; className?: string; label?: string }>(
  function Spinner({ size = 16, className, label }, ref) {
    return (
      <span ref={ref} role="status" className={cn('inline-flex', className)}>
        <Loader2
          size={size}
          strokeWidth={1.75}
          className="animate-spin text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
        {label ? <span className="sr-only">{label}</span> : null}
      </span>
    );
  },
);

/** Full-region busy state, used while a panel's first load is in flight. */
export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-[13px] text-[var(--text-tertiary)]">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

/** Page-level busy state while a route chunk loads. */
export function PageFallback() {
  return (
    <div className="space-y-4 p-6" role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-[var(--height-control)] w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-lg)]" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-[var(--radius-lg)]" />
      <span className="sr-only">Loading page</span>
    </div>
  );
}

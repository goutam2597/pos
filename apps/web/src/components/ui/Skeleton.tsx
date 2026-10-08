import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

/**
 * Loading placeholder.
 *
 * Skeletons mirror the real layout rather than showing a spinner in the middle
 * of an empty page, so the screen does not jump when data lands. It is hidden
 * from assistive tech — the surrounding region announces the busy state.
 */
export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Skeleton(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-inset)]', className)}
      {...props}
    />
  );
});

/** Placeholder rows shaped like a DataTable body. */
export function SkeletonTableRows({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-3 py-2.5">
              <Skeleton className={cn('h-4', c === 0 ? 'w-3/5' : 'w-full')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Placeholder block shaped like a card. */
export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton className={cn('h-32 rounded-[var(--radius-lg)]', className)} />;
}

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * The page container: one max width and one padding for every screen.
 *
 * Lives here rather than in `pages/` so a list component can render a full page
 * without the component layer having to reach up into the route layer.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[100rem] p-4 sm:p-6', className)}>{children}</div>;
}

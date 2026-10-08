import { useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Portal, useDismissable, useScrollLock } from './overlay';

/**
 * Drawer / slide-over.
 *
 * Used for record details that are too wide for a modal but should not take the
 * whole screen — a stock adjustment sheet, a customer profile. On a small
 * screen it becomes a bottom sheet, which is where a thumb expects it.
 */

export type DrawerSide = 'end' | 'bottom';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `end` is a side panel; `bottom` is a mobile sheet. */
  side?: DrawerSide;
  width?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'end',
  width = 'w-full max-w-lg',
  className,
}: DrawerProps) {
  const surfaceRef = useDismissable<HTMLDivElement>({ open, onClose, closeOnOutside: false });
  useScrollLock(open);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      surfaceRef.current = node;
    },
    [surfaceRef],
  );

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex">
        <div
          className="fixed inset-0 bg-[var(--bg-inset)] opacity-70"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={setRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            'relative z-10 flex flex-col border-[var(--border-default)] bg-[var(--bg-surface)] outline-none',
            side === 'end'
              ? 'ms-auto h-full border-s shadow-[var(--shadow-lg)]'
              : 'mt-auto max-h-[85dvh] w-full rounded-t-[var(--radius-xl)] border-t shadow-[var(--shadow-lg)]',
            side === 'end' ? width : '',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
              {description && (
                <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={onClose}
              aria-label="Close panel"
              className="-me-1.5 -mt-0.5"
            >
              <X size={16} strokeWidth={1.75} />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-4">{children}</div>

          {footer && (
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      </div>
    </Portal>
  );
}

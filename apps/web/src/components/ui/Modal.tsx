import { useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Portal, overlaySurface, useDismissable, useScrollLock } from './overlay';

/**
 * Modal dialog.
 *
 * The dialog owns its own focus, so it never hands focus management to the
 * caller. `initialFocus="first"` is the right default for forms; for a
 * destructive confirmation we want the Cancel button, which is why that passes
 * `initialFocus` through to a ref instead.
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[min(96vw,80rem)]',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Hide the × and require an explicit footer action to dismiss. */
  dismissible?: boolean;
  /** Focus the first control on open; use false for destructive dialogs. */
  autoFocus?: boolean;
  /** Widens the header strip for page-like dialogs (settings, editors). */
  bare?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  autoFocus = true,
  bare,
  className,
}: ModalProps) {
  const surfaceRef = useDismissable<HTMLDivElement>({
    open,
    onClose: dismissible ? onClose : () => undefined,
    closeOnEscape: dismissible,
    closeOnOutside: false,
    initialFocus: autoFocus ? 'first' : 'none',
  });
  useScrollLock(open);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    surfaceRef.current = node;
  }, [surfaceRef]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
        <div
          className="fixed inset-0 bg-[var(--bg-inset)] opacity-70"
          onClick={dismissible ? onClose : undefined}
          aria-hidden="true"
        />
        <div
          ref={setRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            'relative z-10 w-full outline-none',
            SIZES[size],
            overlaySurface,
            'flex max-h-[calc(100dvh-3rem)] flex-col',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
              {description && (
                <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>
              )}
            </div>
            {dismissible && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={onClose}
                aria-label="Close dialog"
                className="-me-2 -mt-1"
              >
                <X size={16} strokeWidth={1.75} />
              </Button>
            )}
          </div>

          <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin', !bare && 'p-6')}>
            {children}
          </div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** Convenience wrapper for a form dialog: body + footer + a submit button. */
export function FormDialog({
  open,
  onClose,
  title,
  description,
  children,
  submitLabel = 'Save',
  onSubmit,
  submitting,
  disabled,
  size,
  secondary,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  submitLabel?: string;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  size?: ModalSize;
  /** Extra footer control on the trailing edge (e.g. "Save and add another"). */
  secondary?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          {secondary}
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={submitting} disabled={disabled}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Modal>
  );
}

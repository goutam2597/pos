import { Toaster as SonnerToaster, toast } from 'sonner';

import { useTheme } from '../../lib/theme';
import { ApiError } from '../../lib/api';

/**
 * Toast host.
 *
 * Styled entirely from the token layer so notifications look like part of the
 * product rather than a library default, and given a very short default
 * duration: on a till, a toast that lingers blocks the next action.
 */
export function Toaster() {
  const { resolved } = useTheme();

  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      duration={3200}
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-[var(--shadow-lg)]',
          description: 'text-[var(--text-secondary)]',
          actionButton: 'bg-[var(--accent)] text-[var(--accent-contrast)] rounded-[var(--radius-sm)]',
          cancelButton: 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] rounded-[var(--radius-sm)]',
          error: 'border-[var(--danger)]',
          success: 'border-[var(--success)]',
        },
      }}
    />
  );
}

/**
 * Toast helper for a failed mutation whose error has already been rendered
 * inline. Used where a field-level message is shown and a toast would only
 * repeat it.
 */
export function toastError(error: unknown, message?: string): void {
  const text = message ?? (error instanceof ApiError ? error.message : 'Something went wrong.');
  toast.error(text);
}

import { useEffect, useState } from 'react';

import { ApiError } from '../lib/api';
import { fieldErrors } from '../lib/queries';
import { ErrorState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/shell/PageHeader';
import { Page } from '../components/data/Page';

/**
 * Shared page plumbing.
 *
 * Every list page needs the same four things: a page header with a title and an
 * action, a query-state hook for search/filters/paging, a dialog slot, and
 * honest loading/error/empty states. These helpers are where that lives so no
 * page re-implements it slightly differently.
 */

/** `useState` with a URL-addressable value: page 2 is a shareable link. */
export function useQueryState<T extends Record<string, unknown>>(initial: T) {
  const [params, setParams] = useState(initial);

  const patch = (next: Partial<T>) => {
    setParams((current) => {
      const merged: T = { ...current, ...next };
      // Any filter change invalidates the current page number; staying on page 7
      // of a result set that just changed is almost never what the user wants.
      if (!('page' in next)) (merged as Record<string, unknown>).page = 1;
      return merged;
    });
  };

  const reset = () => setParams(initial);

  return [params, patch, reset] as const;
}

/** Map a `VALIDATION_FAILED` body onto form state. */
export function useServerFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const capture = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_FAILED') {
        setErrors(fieldErrors(error));
        setFormError(null);
        return true;
      }
      if (error.code === 'FORBIDDEN') {
        setFormError('You do not have permission to do that.');
        return true;
      }
      if (error.code === 'CONFLICT') {
        setFormError('Someone else changed this record. Close this and reload it.');
        return true;
      }
      setFormError(error.message);
      return true;
    }
    setFormError('Something went wrong.');
    return true;
  };

  const clear = () => {
    setErrors({});
    setFormError(null);
  };

  return { errors, setErrors, formError, setFormError, capture, clear };
}

/** Reset a form whenever the dialog it belongs to is reopened. */
export function useResetOnOpen(open: boolean, reset: () => void) {
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
}

export { Page, PageHeader, ErrorState };

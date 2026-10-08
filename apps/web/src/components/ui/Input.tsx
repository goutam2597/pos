import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { controlBase, controlHeight } from './tokens';

/**
 * Text input.
 *
 * `aria-invalid` drives the error styling from the token layer, so a field
 * never needs a parallel `error` prop purely to turn red — screen readers get
 * the state from the same attribute.
 */

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  /** Decorative leading icon; the input stays responsible for its own padding. */
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  /** Rendered under the field, e.g. a currency hint or a validation message. */
  hint?: ReactNode;
  error?: ReactNode;
  /** Wraps the control in a `<label>` so clicking the label focuses it. */
  label?: ReactNode;
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', iconStart, iconEnd, hint, error, label, required, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy: string | undefined =
    error && typeof error === 'string' ? `${inputId}-error` : undefined;

  const control = (
    <div className="relative">
      {iconStart && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-0 flex w-[var(--height-control)] items-center justify-center text-[var(--text-tertiary)]"
        >
          {iconStart}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          controlBase,
          controlHeight[size],
          'px-3',
          iconStart && 'ps-9',
          iconEnd && 'pe-9',
          error && 'border-[var(--danger)]',
          className,
        )}
        {...props}
      />
      {iconEnd && (
        <span className="absolute inset-y-0 end-0 flex w-[var(--height-control)] items-center justify-center text-[var(--text-tertiary)]">
          {iconEnd}
        </span>
      )}
    </div>
  );

  return (
    <div className="w-full">
      {label !== undefined && (
        <FieldLabel htmlFor={inputId} required={required}>
          {label}
        </FieldLabel>
      )}
      {control}
      <FieldFoot hint={hint} error={error} id={inputId} />
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, label, hint, error, required, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="w-full">
      {label !== undefined && (
        <FieldLabel htmlFor={fieldId} required={required}>
          {label}
        </FieldLabel>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(controlBase, 'w-full resize-y px-3 py-2', error && 'border-[var(--danger)]', className)}
        {...props}
      />
      <FieldFoot hint={hint} error={error} id={fieldId} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Field chrome, shared by Input/Textarea/Select/NumberInput
// ---------------------------------------------------------------------------

export function FieldLabel({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'mb-1.5 block text-[13px] font-medium text-[var(--text-secondary)]',
        className,
      )}
    >
      {children}
      {required && (
        <span className="ms-1 text-[var(--danger)]" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

export function FieldFoot({
  hint,
  error,
  id,
}: {
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
}) {
  if (error) {
    return (
      <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1.5 text-[13px] text-[var(--danger-text)]">
        {error}
      </p>
    );
  }
  if (hint) {
    return <p className="mt-1.5 text-[13px] text-[var(--text-tertiary)]">{hint}</p>;
  }
  return null;
}

/** Two-column layout for settings-style forms. */
export function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

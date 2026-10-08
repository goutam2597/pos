import { forwardRef, useCallback, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { FieldFoot, FieldLabel } from './Input';

/**
 * Checkbox, Switch and Radio.
 *
 * All three wrap real `<input type>` elements, so keyboard behaviour, form
 * participation and the `checked` contract come from the platform. The visual
 * is a sibling of the input driven by `peer-checked:`, which keeps the markup
 * to exactly one focusable control.
 */

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  /** Description under the label; use for settings rows. */
  description?: ReactNode;
  error?: ReactNode;
  /** Renders the box before the label. Set false for a trailing "edit" box. */
  boxFirst?: boolean;
  /**
   * The third checkbox state — "some rows selected".
   *
   * `indeterminate` is a DOM property rather than an HTML attribute, so React
   * cannot set it declaratively and it has to be assigned on the element.
   */
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, error, boxFirst = true, disabled, id, indeterminate, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const localRef = useRef<HTMLInputElement | null>(null);

  const attachRef = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
    },
    [ref],
  );

  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={fieldId}
        className={cn(
          'flex cursor-pointer items-start gap-2 text-[13px] text-[var(--text-primary)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {boxFirst && (
          <span className="relative mt-[1px] inline-flex size-[16px] shrink-0 items-center justify-center">
            <input
              ref={attachRef}
              id={fieldId}
              type="checkbox"
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              className={cn(
                'peer size-[16px] cursor-pointer appearance-none rounded-[var(--radius-xs)]',
                'border border-[var(--border-strong)] bg-[var(--bg-surface)]',
                'checked:border-[var(--accent)] checked:bg-[var(--accent)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
              )}
              {...props}
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="pointer-events-none absolute inset-0 m-auto size-3 scale-0 text-[var(--accent-contrast)] transition-transform peer-checked:scale-100"
            >
              <path
                d="M2.5 6.2 4.8 8.5 9.5 3.8"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        <span className="min-w-0">
          <span className="block">{label}</span>
          {description && (
            <span className="mt-0.5 block text-[13px] text-[var(--text-tertiary)]">{description}</span>
          )}
        </span>
        {!boxFirst && (
          <span className="relative mt-[1px] ms-auto inline-flex size-[16px] shrink-0 items-center justify-center">
            <input
              ref={attachRef}
              id={fieldId}
              type="checkbox"
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              className={cn(
                'peer size-[16px] cursor-pointer appearance-none rounded-[var(--radius-xs)]',
                'border border-[var(--border-strong)] bg-[var(--bg-surface)]',
                'checked:border-[var(--accent)] checked:bg-[var(--accent)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
              )}
              {...props}
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="pointer-events-none absolute inset-0 m-auto size-3 scale-0 text-[var(--accent-contrast)] transition-transform peer-checked:scale-100"
            >
              <path
                d="M2.5 6.2 4.8 8.5 9.5 3.8"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </label>
      <FieldFoot error={error} id={fieldId} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, label, description, error, disabled, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const localRef = useRef<HTMLInputElement | null>(null);

  const attachRef = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
    },
    [ref],
  );

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={fieldId} className="min-w-0 cursor-pointer">
          <span className="block text-[13px] font-medium text-[var(--text-primary)]">{label}</span>
          {description && (
            <span className="mt-0.5 block text-[13px] text-[var(--text-tertiary)]">{description}</span>
          )}
        </label>
        <span className="relative inline-flex h-[18px] w-[32px] shrink-0 items-center">
          <input
            ref={attachRef}
            id={fieldId}
            type="checkbox"
            role="switch"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            className={cn(
              'peer absolute inset-0 cursor-pointer appearance-none rounded-full',
              'border border-[var(--border-default)] bg-[var(--bg-inset)]',
              'checked:border-[var(--accent)] checked:bg-[var(--accent)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            )}
            {...props}
          />
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute start-[2px] size-[12px] rounded-full bg-[var(--bg-surface)]',
              'shadow-[var(--shadow-xs)] transition-transform',
              'peer-checked:translate-x-[14px] rtl:peer-checked:-translate-x-[14px]',
            )}
          />
        </span>
      </div>
      <FieldFoot error={error} id={fieldId} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Radio group
// ---------------------------------------------------------------------------

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  name: string;
  label?: ReactNode;
  error?: ReactNode;
  /** `cards` renders each option as a selectable card; `inline` as a row. */
  layout?: 'cards' | 'inline';
  className?: string;
  disabled?: boolean;
}

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  label,
  error,
  layout = 'cards',
  className,
  disabled,
}: RadioGroupProps) {
  const groupName = useId();

  return (
    <fieldset className={cn('min-w-0', className)} disabled={disabled}>
      {label !== undefined && (
        <legend className="mb-1.5 text-[13px] font-medium text-[var(--text-secondary)]">{label}</legend>
      )}
      <div className={cn(layout === 'cards' ? 'grid gap-2' : 'flex flex-wrap gap-4')}>
        {options.map((option) => {
          const id = `${groupName}-${option.value}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] text-[13px]',
                layout === 'cards' && 'border p-3 transition-colors',
                layout === 'cards' &&
                  (selected
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                    : 'border-[var(--border-default)] hover:border-[var(--border-strong)]'),
                layout === 'inline' && 'items-center py-1',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="mt-[2px] size-[16px] shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] checked:border-[5px] checked:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              />
              <span className="min-w-0">
                <span className="block text-[var(--text-primary)]">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[var(--text-tertiary)]">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <FieldFoot error={error} />
    </fieldset>
  );
}


import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '../../lib/cn';
import { controlBase } from './tokens';
import { FieldFoot, FieldLabel, type InputSize } from './Input';

/**
 * Select.
 *
 * A native `<select>` on purpose: it inherits the OS picker, is keyboard and
 * screen-reader correct for free, and on a phone gives the platform control
 * that no custom listbox can match. Only the chrome is ours.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Rendered in a separate group with its own `<optgroup>` label. */
  group?: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> {
  options?: SelectOption[];
  placeholder?: string;
  size?: InputSize;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

const SIZES: Record<InputSize, string> = {
  sm: 'h-[var(--height-control-sm)]',
  md: 'h-[var(--height-control)]',
  lg: 'h-[var(--height-control-lg)]',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, size = 'md', label, hint, error, required, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const grouped = groupOptions(options ?? []);

  return (
    <div className="w-full">
      {label !== undefined && (
        <FieldLabel htmlFor={fieldId} required={required}>
          {label}
        </FieldLabel>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlBase,
            SIZES[size],
            'appearance-none pe-8',
            error && 'border-[var(--danger)]',
            className,
          )}
          {...props}
        >
          {placeholder !== undefined && (
            <option value="">{placeholder}</option>
          )}
          {grouped.map((entry) =>
            entry.group ? (
              <optgroup key={entry.group} label={entry.group}>
                {entry.options.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              entry.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
            ),
          )}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 end-2.5 my-auto text-[var(--text-tertiary)]"
        />
      </div>
      <FieldFoot hint={hint} error={error} id={fieldId} />
    </div>
  );
});

/** Stable optgroup boundaries so React does not remount options on every render. */
function groupOptions(options: SelectOption[]): Array<{ group?: string; options: SelectOption[] }> {
  const out: Array<{ group?: string; options: SelectOption[] }> = [];
  for (const option of options) {
    const last = out[out.length - 1];
    const key = option.group ?? '';
    if (!last || (last.group ?? '') !== key) out.push({ group: option.group, options: [option] });
    else last.options.push(option);
  }
  return out;
}

import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';

import { SearchableSelect } from './SearchableSelect';

/**
 * Select — the standard dropdown control.
 *
 * This renders the CUSTOM searchable dropdown, not a native `<select>`. An
 * earlier version used the native element "because it inherits the OS picker",
 * which is defensible in isolation but wrong for this product: the rendered
 * control then looks different on every machine, cannot be styled to match the
 * rest of the design system, and cannot search a long option list. Every dropdown
 * in MonoPOS now goes through one implementation.
 *
 * The component keeps the native `<select>` API — notably `onChange` receiving
 * a DOM-ish event with `target.value` — so all thirty-odd call sites across the
 * admin pages keep working unchanged. That compatibility shim is deliberate:
 * swapping the control should never require touching twenty files.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Rendered in a separate group with its own heading. */
  group?: string;
  /** Extra text shown right-aligned; used for rates and units. */
  description?: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size' | 'value' | 'defaultValue' | 'onChange'> {
  options?: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (event: { target: { value: string } }) => void;
  /** Hide the search box for very short lists where it is only noise. */
  searchable?: boolean;
}

/**
 * Shape a plain-string value the way callers historically passed it.
 *
 * `''` is kept as `''` rather than collapsed to `null`, because a filter
 * dropdown uses the empty string to mean "no filter" and the clear affordance
 * keys off exactly that. Only `undefined`/`null` become "no value at all".
 */
function coerce(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    className,
    options = [],
    placeholder = 'Select…',
    searchPlaceholder,
    size = 'md',
    label,
    hint,
    error,
    required,
    disabled,
    value,
    defaultValue,
    onChange,
    id,
    searchable,
    ...rest
  },
  ref,
) {
  return (
    <SearchableSelect
      ref={ref}
      id={id}
      className={className}
      size={size}
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder ?? 'Search…'}
      value={coerce(value)}
      defaultValue={coerce(defaultValue)}
      // Short fixed lists (a status filter, a page size) do not benefit from a
      // search box; long entity lists do. This is decided by the list, not by
      // the caller, so every dropdown behaves the same way.
      searchable={searchable ?? options.length > 8}
      options={options}
      onChange={(next) => onChange?.({ target: { value: next } })}
      {...rest}
    />
  );
});

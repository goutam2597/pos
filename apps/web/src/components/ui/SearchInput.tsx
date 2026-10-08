import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Input, type InputSize } from './Input';

/**
 * Debounced search field.
 *
 * The parent gets a settled value, not a keystroke: typing filters a 5,000-row
 * list, and firing a request per character would make the field feel like it is
 * fighting the user. The visible value updates instantly so typing never lags.
 */

export interface SearchInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Settle delay in ms. 300 is the point where it stops feeling laggy. */
  delay?: number;
  size?: InputSize;
  className?: string;
  autoFocus?: boolean;
  label?: ReactNode;
  'aria-label'?: string;
}

export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Search',
  delay = 300,
  size = 'md',
  className,
  autoFocus,
  label,
  'aria-label': ariaLabel,
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // An external reset (a "clear filters" button) must win over the local draft.
  useEffect(() => {
    setDraft((current) => (current === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    timer.current = setTimeout(() => onValueChange(draft), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, value, delay, onValueChange]);

  return (
    <div className={cn('relative min-w-0', className)}>
      <Input
        ref={inputRef}
        type="search"
        role="searchbox"
        size={size}
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft !== '') {
            event.preventDefault();
            setDraft('');
            onValueChange('');
          }
        }}
        label={label}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : placeholder)}
        placeholder={placeholder}
        iconStart={<Search size={16} strokeWidth={1.75} />}
        className="pe-8 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft !== '' && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onValueChange('');
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute inset-y-0 end-1 flex w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)]"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

export interface DateInputProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  size?: InputSize;
  className?: string;
  /** Range this field accepts, for the browser's picker affordances. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * Date field backed by the native picker.
 *
 * The value is always `YYYY-MM-DD` — the one date format with no timezone
 * ambiguity — so a value read straight out of this field can go into an API
 * body without a parse step.
 */
export function DateInput({
  value,
  onValueChange,
  label,
  hint,
  error,
  size = 'md',
  className,
  min,
  max,
  required,
  disabled,
  id,
}: DateInputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className={cn('w-full', className)}>
      {label !== undefined && (
        <label htmlFor={fieldId} className="mb-1.5 block text-[13px] font-medium text-[var(--text-secondary)]">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        type="date"
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-3 text-[13px] text-[var(--text-primary)]',
          'transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:bg-[var(--bg-sunken)] disabled:text-[var(--text-disabled)]',
          size === 'sm' && 'h-[var(--height-control-sm)]',
          size === 'md' && 'h-[var(--height-control)]',
          size === 'lg' && 'h-[var(--height-control-lg)]',
          error ? 'border-[var(--danger)]' : 'border-[var(--border-default)]',
        )}
      />
      {(hint || error) && (
        <p className={cn('mt-1.5 text-[13px]', error ? 'text-[var(--danger-text)]' : 'text-[var(--text-tertiary)]')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Today as `YYYY-MM-DD` in the browser's own timezone. */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` for a date offset from today by whole days. */
export function isoDaysAgo(days: number): string {
  const now = new Date();
  return new Date(now.getTime() - days * 86_400_000 + now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export interface DateRangeProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}

/** The `from`/`to` pair every report and list endpoint takes. */
export function DateRangePicker({ from, to, onChange, className }: DateRangeProps) {
  return (
    <div className={cn('flex items-end gap-2', className)}>
      <DateInput
        value={from}
        max={to || undefined}
        onValueChange={(next) => onChange({ from: next, to })}
        label="From"
        aria-label="From date"
      />
      <DateInput
        value={to}
        min={from || undefined}
        onValueChange={(next) => onChange({ from, to: next })}
        label="To"
        aria-label="To date"
      />
    </div>
  );
}

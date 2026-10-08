import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { controlBase, controlHeight } from './tokens';
import { FieldFoot, FieldLabel, type InputSize } from './Input';
import type { SelectOption } from './Select';

/**
 * Searchable dropdown (combobox).
 *
 * A fully custom listbox — button trigger, popover panel, embedded search —
 * for the case the native `<select>` cannot serve: long option lists
 * (hundreds of products, customers, accounts) where scrolling is not finding.
 *
 * Accessibility follows the combobox pattern: the trigger owns the listbox via
 * `aria-controls`, the active option is exposed through
 * `aria-activedescendant`, and every interaction (ArrowUp/Down, Home/End,
 * Enter, Escape, Tab-away) behaves the way a native select does. The search
 * field is a real input inside the panel, so screen-reader and keyboard users
 * reach it with one Tab from the trigger.
 *
 * The panel is positioned with logical properties and flips above the trigger
 * when there is no room below, so it stays usable at the bottom of a modal and
 * in RTL layouts without a line of direction-specific code.
 */

export interface SearchableSelectProps {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string) => void;
  options: SelectOption[];
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the search field. */
  searchPlaceholder?: string;
  size?: InputSize;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Show an × to clear the selection. Defaults to true when not required. */
  clearable?: boolean;
  /** Text shown when the filter matches nothing. */
  emptyText?: string;
  /** Maximum panel height before it scrolls. */
  maxVisibleOptions?: number;
  id?: string;
  className?: string;
  /** Called with the raw query for server-side filtering; skips local filtering. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  /** Hide the search box for short fixed lists where it is only noise. */
  searchable?: boolean;
  /** The trigger button, forwarded from the parent. */
  ref?: Ref<HTMLButtonElement>;
}

const OPTION_HEIGHT = 34;

export const SearchableSelect = forwardRef<HTMLButtonElement, SearchableSelectProps>(
function SearchableSelect({
  value,
  defaultValue = null,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Type to search…',
  size = 'md',
  label,
  hint,
  error,
  required,
  disabled,
  clearable,
  emptyText = 'No matches found',
  maxVisibleOptions = 8,
  id,
  className,
  onSearch,
  loading,
  searchable = true,
  ref,
}: SearchableSelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-listbox`;
  const searchId = `${fieldId}-search`;

  const [internal, setInternal] = useState<string | null>(defaultValue);
  const selected = value !== undefined ? value : internal;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Server-side filtering bypasses the local match; the parent owns the list.
  const filtered = useMemo(() => {
    if (onSearch) return options;
    if (!searchable && !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle) ||
        (option.group ?? '').toLowerCase().includes(needle),
    );
  }, [options, query, onSearch]);

  const selectedOption = options.find((option) => option.value === selected) ?? null;

  const commit = useCallback(
    (next: string | null) => {
      if (value === undefined) setInternal(next);
      if (next !== null) onChange?.(next);
      setOpen(false);
      setQuery('');
      setActiveIndex(0);
      // Return focus to the trigger so keyboard users stay oriented.
      triggerRef.current?.focus();
    },
    [value, onChange],
  );

  // Close on outside pointer-down and on Escape; Tab closes implicitly by blur.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        setQuery('');
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open ]);

  // Opening focuses the search field; the till operator can type immediately.
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      // Decide the direction once, from the trigger's viewport position.
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const spaceBelow = window.innerHeight - rect.bottom;
        setDropUp(spaceBelow < Math.min(320, maxVisibleOptions * OPTION_HEIGHT + 60));
      }
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, maxVisibleOptions]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault();
        setOpen(true);
        break;
      default:
        break;
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Enter': {
        event.preventDefault();
        const option = filtered[activeIndex];
        if (option && !option.disabled) commit(option.value);
        break;
      }
      default:
        break;
    }
  };

  const showClear = (clearable ?? !required) && selected !== null && !disabled;
  const panelHeight = Math.min(filtered.length, maxVisibleOptions) * OPTION_HEIGHT;
  const activeId = filtered[activeIndex] ? `${fieldId}-option-${activeIndex}` : undefined;

  // Group consecutive options under their label, preserving order.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label?: string; items: Array<{ option: SelectOption; index: number }> }> = [];
    filtered.forEach((option, index) => {
      const last = out[out.length - 1];
      if (last && (last.label ?? '') === (option.group ?? '')) last.items.push({ option, index });
      else out.push({ key: `${option.group ?? ''}-${index}`, label: option.group, items: [{ option, index }] });
    });
    return out;
  }, [filtered]);

  return (
    <div ref={rootRef} className={cn('w-full', className)}>
      {label !== undefined && (
        <FieldLabel htmlFor={fieldId} required={required}>
          {label}
        </FieldLabel>
      )}
      <div className="relative">
        <button
          ref={mergeRefs(triggerRef, ref)}
          type="button"
          id={fieldId}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={error ? true : undefined}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            controlBase,
            controlHeight[size],
            'flex w-full cursor-pointer items-center gap-2 px-3 text-start',
            !selectedOption && 'text-[var(--text-disabled)]',
            showClear && 'pe-14',
            error && 'border-[var(--danger)]',
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {loading && (
            <span
              aria-hidden="true"
              className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-transparent"
            />
          )}
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-[var(--text-tertiary)] transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {/*
          The clear affordance is a SIBLING of the trigger, not a child: a button
          inside a button is invalid HTML, double-exposes the control to screen
          readers, and breaks strict-mode automation. It sits over the trigger's
          reserved end padding.
        */}
        {showClear && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={() => {
              if (value === undefined) setInternal(null);
              onChange?.('');
            }}
            className="absolute inset-y-0 end-8 my-auto flex size-6 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-tertiary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        )}

        {open && (
          <div
            className={cn(
              'absolute start-0 z-50 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-raised)] shadow-[var(--shadow-lg)]',
              dropUp ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]',
            )}
          >
            <div className="border-b border-[var(--border-subtle)] p-1.5">
              <div className="relative">
                <Search
                  size={15}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-[var(--text-tertiary)]"
                />
                <input
                  ref={searchRef}
                  id={searchId}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  aria-label="Search options"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                    onSearch?.(event.target.value);
                  }}
                  onKeyDown={onSearchKeyDown}
                  className="h-[var(--height-control-sm)] w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--bg-sunken)] ps-8 pe-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)] focus:outline-none"
                />
              </div>
            </div>
            <div
              ref={listRef}
              role="listbox"
              id={listId}
              aria-labelledby={fieldId}
              tabIndex={-1}
              className="scrollbar-thin overflow-y-auto p-1"
              style={{ maxHeight: maxVisibleOptions * OPTION_HEIGHT + 8 }}
            >
              {groups.length === 0 && (
                <p className="px-2.5 py-4 text-center text-[13px] text-[var(--text-tertiary)]">
                  {emptyText}
                </p>
              )}
              {groups.map((group) => (
                <div key={group.key} role={group.label ? 'group' : undefined} aria-label={group.label}>
                  {group.label && (
                    <p aria-hidden="true" className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                      {group.label}
                    </p>
                  )}
                  {group.items.map(({ option, index }) => {
                    const isActive = index === activeIndex;
                    const isSelected = option.value === selected;
                    return (
                      <div
                        key={option.value}
                        id={`${fieldId}-option-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        onClick={() => !option.disabled && commit(option.value)}
                        onMouseMove={() => setActiveIndex(index)}
                        className={cn(
                          'flex h-[34px] cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-[13px]',
                          isActive
                            ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)]'
                            : 'text-[var(--text-primary)]',
                          option.disabled && 'cursor-not-allowed opacity-50',
                          isSelected && 'font-medium',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {isSelected && (
                          <Check size={15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--accent-text)]" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {panelHeight === 0 && null}
          </div>
        )}
      </div>
      <FieldFoot hint={hint} error={error} id={fieldId} />
    </div>
  );
});

/** Combine a local ref with one forwarded from the parent. */
function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

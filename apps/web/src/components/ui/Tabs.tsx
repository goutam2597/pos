import { useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Tabs.
 *
 * Supports the two behaviours users expect without a dependency: arrow keys move
 * between tabs (WAI-ARIA tabs pattern), and the active tab is driven by a value
 * the page owns so a URL hash or a deep link can select it.
 */

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Small count or status on the trailing edge. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  variant?: 'underline' | 'segmented';
  label: string;
}

export function Tabs({ items, value, onValueChange, className, variant = 'underline', label }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const move = (direction: number) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((item) => item.value === value);
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    if (next) {
      onValueChange(next.value);
      // Keep focus with the selection so the keyboard user does not lose place.
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
      });
    }
  };

  if (variant === 'segmented') {
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            move(getDirection() * 1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            move(getDirection() * -1);
          }
        }}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] p-0.5',
          className,
        )}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              data-value={item.value}
              onClick={() => onValueChange(item.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-[13px] font-medium transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              {item.icon}
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(getDirection() * 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(getDirection() * -1);
        }
      }}
      className={cn('flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)] scrollbar-thin', className)}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${baseId}-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${baseId}-${item.value}-panel`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            data-value={item.value}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
            )}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Arrow direction follows the writing direction: Right moves "next" in LTR. */
function getDirection(): number {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1;
}

export function TabPanel({
  value,
  active,
  children,
  className,
}: {
  value: string;
  active: string;
  children: ReactNode;
  className?: string;
}) {
  if (value !== active) return null;
  return (
    <div role="tabpanel" tabIndex={0} className={cn('outline-none', className)}>
      {children}
    </div>
  );
}

/** Uncontrolled tabs for pages that do not need to own the selection. */
export function useTabs(defaultValue: string) {
  const [value, setValue] = useState(defaultValue);
  return [value, setValue] as const;
}

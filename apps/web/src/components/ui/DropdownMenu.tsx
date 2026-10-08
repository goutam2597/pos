import { useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Portal, overlaySurface, useAnchoredPosition, useDismissable, type AnchorRef } from './overlay';

/**
 * Dropdown menu.
 *
 * Implemented with `role="menu"` and roving arrow-key focus rather than a plain
 * list, so it behaves the way a keyboard user expects from a menu. Items are
 * real buttons, so Tab still reaches them and screen readers announce them.
 */

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  /** Renders a divider above this item. */
  separated?: boolean;
  /** Hide the item entirely (e.g. a permission-gated action). */
  hidden?: boolean;
  /** Right-aligned hint, e.g. a shortcut chord. */
  hint?: ReactNode;
}

export interface DropdownMenuProps {
  /** The trigger. Rendered as-is; the menu anchors to its bounding box. */
  trigger: (props: { open: boolean; ref: AnchorRef }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
  label?: string;
}

export function DropdownMenu({ trigger, items, align = 'end', className, label = 'Menu' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLElement | null>(null);

  const position = useAnchoredPosition(anchor, panel, { align, side: 'bottom' });

  const close = () => setOpen(false);

  const surfaceRef = useDismissable<HTMLDivElement>({
    open,
    onClose: close,
    closeOnOutside: true,
    closeOnEscape: true,
    initialFocus: 'none',
  });

  const visible = items.filter((item) => !item.hidden);

  const panelRef = (node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    setPanel(node);
  };

  return (
    <>
      {trigger({
        open,
        ref: (node: HTMLElement | null) => {
          anchorRef.current = node;
          setAnchor(node);
        },
      })}

      {open && (
        <Portal>
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((i) => (i + 1) % Math.max(visible.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((i) => (i - 1 + Math.max(visible.length, 1)) % Math.max(visible.length, 1));
              } else if (event.key === 'Enter' || event.key === ' ') {
                const item = visible[activeIndex];
                if (item && !item.disabled) {
                  event.preventDefault();
                  item.onSelect?.();
                  close();
                }
              }
            }}
            style={{ top: position.top, insetInlineStart: position.start }}
            className={cn(
              'fixed z-50 min-w-[11rem] overflow-hidden py-1 outline-none',
              overlaySurface,
              className,
            )}
          >
            {visible.map((item, index) => (
              <div key={item.key}>
                {item.separated && <div role="separator" className="my-1 h-px bg-[var(--border-subtle)]" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    item.onSelect?.();
                    close();
                    anchorRef.current?.focus();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-[13px] transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    item.tone === 'danger'
                      ? 'text-[var(--danger-text)] hover:bg-[var(--danger-subtle)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-sunken)]',
                  )}
                >
                  {item.icon && (
                    <span aria-hidden="true" className="text-[var(--text-tertiary)]">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-[12px] text-[var(--text-disabled)]">{item.hint}</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}

/** Icon-only kebab trigger, the most common menu entry point. */
export function MenuButton({
  icon,
  label,
  items,
  align = 'end',
}: {
  icon: ReactNode;
  label: string;
  items: MenuItem[];
  align?: 'start' | 'end';
}) {
  return (
    <DropdownMenu
      label={label}
      align={align}
      items={items}
      trigger={({ open, ref }) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          className={cn(
            'flex h-[var(--height-control)] w-[var(--height-control)] items-center justify-center rounded-[var(--radius-md)]',
            'text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
            open && 'bg-[var(--bg-sunken)] text-[var(--text-primary)]',
          )}
        >
          {icon}
        </button>
      )}
    />
  );
}

/**
 * Menu for a plain button trigger.
 *
 * Scroll lock is deliberately omitted here: a menu is not a modal, and locking
 * the page under it makes long lists feel broken.
 */
export function ButtonMenu({
  children,
  items,
  align = 'start',
  label,
  className,
}: {
  children: (state: { open: boolean }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  label?: string;
  className?: string;
}) {
  return (
    <DropdownMenu
      items={items}
      align={align}
      label={label}
      className={className}
      trigger={({ open, ref }) => (
        <span ref={ref as React.Ref<HTMLSpanElement>} className="inline-flex">
          <span aria-expanded={open} aria-haspopup="menu" className="inline-flex">
            {children({ open })}
          </span>
        </span>
      )}
    />
  );
}


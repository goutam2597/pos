import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';

import { cn } from '../../lib/cn';
import { canSeeNavItem, filterNav, flattenNav, NAV_GROUPS, navLabel } from '../../lib/routes';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Portal, useDismissable, useScrollLock } from './overlay';

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Hand-rolled rather than pulled from a library: the whole thing is a filtered
 * list, a roving focus index and a portal, and shipping 4 kB of dependency for
 * that is not a trade this product should make.
 *
 * Results are grouped, keyboard-driven, and every result is an action the user
 * can actually take — the palette never renders an item it cannot perform.
 */

export interface CommandItem {
  id: string;
  label: string;
  /** Extra words that should match, e.g. "delete product". */
  keywords?: string;
  group?: string;
  icon?: ReactNode;
  shortcut?: string;
  onRun: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Extra items merged with the built-in navigation entries. */
  extraItems?: CommandItem[];
  placeholder?: string;
  /** Empty-state line shown when nothing matches. */
  emptyMessage?: string;
}

export function CommandPalette({
  open,
  onClose,
  extraItems = [],
  placeholder = 'Search modules and actions',
  emptyMessage = 'No matching commands',
}: CommandPaletteProps) {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const surfaceRef = useDismissable<HTMLDivElement>({
    open,
    onClose,
    closeOnOutside: true,
    closeOnEscape: true,
    initialFocus: 'none',
  });
  useScrollLock(open);

  // Navigation entries are injected here rather than imported, so the palette
  // shows exactly the modules this user can reach.
  const { navItems } = useNavCommands();

  const items = useMemo<CommandItem[]>(
    () => [
      ...navItems.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        group: 'Go to',
        keywords: item.label,
        onRun: () => navigate(item.to),
      })),
      ...extraItems,
    ],
    [extraItems, navItems, navigate],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    const words = q.split(/\s+/);
    return items
      .filter((item) => {
        const haystack = `${item.label} ${item.keywords ?? ''} ${item.group ?? ''}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .slice(0, 40);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const run = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    // Defer navigation past the close so the palette does not unmount the route
    // it is trying to push.
    requestAnimationFrame(() => item.onRun());
  };

  let lastGroup: string | undefined;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
        <div className="fixed inset-0 bg-[var(--bg-inset)] opacity-70" aria-hidden="true" />
        <div
          ref={surfaceRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-raised)] shadow-[var(--shadow-lg)]"
        >
          <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--text-tertiary)]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  run(results[active]);
                }
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-controls="command-results"
              role="combobox"
              aria-expanded="true"
              aria-activedescendant={results[active] ? `command-${results[active]?.id}` : undefined}
              className="h-12 w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            />
          </div>

          <div
            id="command-results"
            ref={listRef}
            role="listbox"
            aria-label="Commands"
            className="max-h-[60vh] overflow-y-auto scrollbar-thin p-1.5"
          >
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-[var(--text-tertiary)]">{emptyMessage}</p>
            ) : (
              results.map((item, index) => {
                const showGroup = item.group !== lastGroup;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {showGroup && item.group && (
                      <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text-disabled)] uppercase">
                        {item.group}
                      </div>
                    )}
                    <button
                      id={`command-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run(item)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-start text-[13px] transition-colors',
                        index === active
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-sunken)]',
                      )}
                    >
                      {item.icon && (
                        <span aria-hidden="true" className="shrink-0 text-[var(--text-tertiary)]">
                          {item.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-[var(--text-tertiary)] sm:flex">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft size={11} strokeWidth={1.75} aria-hidden="true" /> to open
            </span>
            <span>↑↓ to navigate</span>
            <span>esc to close</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Navigation commands, filtered by what the signed-in user may open. */
function useNavCommands() {
  const { can } = useAuth();
  const { t } = useI18n();

  const navItems = useMemo(
    () =>
      flattenNav(filterNav(NAV_GROUPS, can))
        .filter((item) => canSeeNavItem(item, can))
        .map((item) => ({ to: item.to, label: navLabel(item.labelKey ?? item.key, t) })),
    [can, t],
  );

  return { navItems };
}


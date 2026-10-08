/**
 * Keyboard hint bar.
 *
 * Always visible on purpose. Shortcuts nobody can discover are not shortcuts,
 * they are trivia — a till that is faster with the keyboard but shows a mouse
 * user nothing is a till that gets abandoned. This bar doubles as the
 * affordance that teaches them.
 */

import { Kbd, cx } from './ui';

export interface Shortcut {
  keys: string;
  label: string;
}

export const POS_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'F1', label: 'Search' },
  { keys: 'F2', label: 'Search / scan' },
  { keys: 'F3', label: 'Cart' },
  { keys: 'F4', label: 'Customer' },
  { keys: 'F8', label: 'Hold' },
  { keys: 'F9', label: 'Charge' },
  { keys: 'F10', label: 'Total' },
  { keys: 'F11', label: 'Sync now' },
  { keys: 'F12', label: 'Shift' },
  { keys: '↑↓', label: 'Move' },
  { keys: '+/−', label: 'Quantity' },
  { keys: 'Del', label: 'Void line' },
  { keys: 'Esc', label: 'Cancel' },
] as const;

export function ShortcutBar({ visibleKeys = POS_SHORTCUTS }: { visibleKeys?: readonly Shortcut[] }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-1.5">
      {visibleKeys.map((shortcut) => (
        <span key={shortcut.keys} className={cx('flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]')}>
          <Kbd>{shortcut.keys}</Kbd>
          {shortcut.label}
        </span>
      ))}
    </div>
  );
}

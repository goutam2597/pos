import { Link } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';

import { useUiStore } from '../../lib/stores';
import { Button } from '../ui/Button';
import { CommandPalette } from '../ui/CommandPalette';
import { LanguageSwitcher, ThemeToggle } from '../ui/ThemeToggle';
import { UserMenu } from '../ui/UserMenu';
import { BranchSwitcher, SyncStatusIndicator } from './BranchSwitcher';

/**
 * Topbar.
 *
 * Deliberately short: hamburger (mobile), branch scope, a search affordance
 * that opens the command palette, sync status, language, theme, account. Every
 * control here is either global state or something used several times a day —
 * nothing that belongs on the page it would otherwise live in.
 */
export function Topbar() {
  const toggleMobileNav = useUiStore((state) => state.toggleMobileNav);
  const commandPaletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  return (
    <header className="app-header no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-3">
      <Button
        variant="ghost"
        size="md"
        iconOnly
        className="lg:hidden"
        onClick={toggleMobileNav}
        aria-label="Open navigation"
      >
        <Menu size={18} strokeWidth={1.75} />
      </Button>

      <div className="hidden items-center gap-1 sm:flex">
        <BranchSwitcher />
      </div>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="mx-auto flex h-[var(--height-control)] w-full max-w-md items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-2.5 text-start text-[13px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] sm:mx-0"
      >
        <Search size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-1 font-mono text-[10px] text-[var(--text-disabled)] sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ms-auto flex items-center gap-0.5">
        <SyncStatusIndicator />
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>
        <ThemeToggle />
        <UserMenu />
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </header>
  );
}

/** Offline banner: the till keeps working, but the user must know why. */
export function OfflineBanner({ pendingCount }: { pendingCount: number }) {
  if (pendingCount <= 0) return null;
  return (
    <div
      role="status"
      className="no-print flex flex-wrap items-center gap-2 border-b border-[var(--warning)] bg-[var(--warning-subtle)] px-3 py-1.5 text-[13px] text-[var(--warning-text)]"
    >
      <span>Working offline. Sales are saved on this device.</span>
      {pendingCount > 0 && (
        <span className="tabular-nums">
          {pendingCount} {pendingCount === 1 ? 'sale is' : 'sales are'} waiting to sync.
        </span>
      )}
      <Link to="/sync" className="ms-auto underline underline-offset-2">
        Review
      </Link>
    </div>
  );
}

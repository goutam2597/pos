import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useT } from '../../lib/i18n';
import { filterNav, NAV_GROUPS, navLabel, type NavItem } from '../../lib/routes';
import { useUiStore } from '../../lib/stores';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

/**
 * Sidebar.
 *
 * Grouped, permission-filtered, and collapsible to an icon rail. Groups keep
 * their open state across navigation, because a user who always works in
 * "Stock" should not have to re-open it on every page.
 *
 * Below `lg` the same markup becomes an overlay drawer; above it, the collapse
 * control switches between the full rail and a 64px icon-only rail.
 */

const EXPANDED_WIDTH = 'w-60';
const COLLAPSED_WIDTH = 'w-[68px]';

export function Sidebar() {
  const { can } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  const groups = useMemo(() => filterNav(NAV_GROUPS, can), [can]);

  return (
    <>
      {/* Mobile overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-[var(--bg-inset)] opacity-70"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={cn(
              'absolute inset-y-0 start-0 flex w-64 flex-col border-e border-[var(--border-default)] bg-[var(--bg-surface)]',
            )}
            aria-label="Main navigation"
          >
            <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-3">
              <BrandMark />
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X size={16} strokeWidth={1.75} />
              </Button>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2">
              <NavList groups={groups} collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
            </nav>
          </aside>
        </div>
      )}

      {/* Desktop rail */}
      <aside
        className={cn(
          'no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-[var(--border-default)] bg-[var(--bg-surface)] transition-[width] duration-150 lg:flex',
          collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        )}
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-[var(--border-subtle)]',
            collapsed ? 'justify-center px-2' : 'justify-between px-3',
          )}
        >
          <BrandMark compact={collapsed} />
          {!collapsed && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={toggleSidebar}
              aria-label="Collapse navigation"
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </Button>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2" aria-label="Main navigation">
          <NavList groups={groups} collapsed={collapsed} />
        </nav>

        {collapsed && (
          <div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={toggleSidebar}
              aria-label="Expand navigation"
              className="w-full"
            >
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            </Button>
          </div>
        )}
      </aside>
    </>
  );
}

function BrandMark({ compact }: { compact?: boolean }) {
  const { business } = useAuth();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[13px] font-semibold text-[var(--accent-contrast)]"
      >
        M
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {business?.name ?? 'MonoPOS'}
          </span>
        </span>
      )}
    </div>
  );
}

function NavList({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: ReturnType<typeof filterNav>;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const t = useT();

  return (
    <ul className="space-y-4">
      {groups.map((group) => (
        <li key={group.key}>
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-disabled)] uppercase">
              {navLabel(group.labelKey ?? group.key, t)}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.key}>
                <NavEntry item={item} collapsed={collapsed} onNavigate={onNavigate} pathname={location.pathname} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function NavEntry({
  item,
  collapsed,
  onNavigate,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const { t } = useI18n();
  const label = navLabel(item.labelKey ?? item.key, t);
  const Icon = item.icon;

  // A group is "current" when it or any child matches, so its submenu can be
  // open while the user is on a child route.
  const isCurrent = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
  const hasActiveChild = item.children?.some((child) => pathname.startsWith(child.to)) ?? false;

  return (
    <div>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] transition-colors',
            collapsed && 'justify-center px-0',
            isActive || hasActiveChild
              ? 'bg-[var(--accent-subtle)] font-medium text-[var(--accent-text)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
          )
        }
      >
        <Icon size={17} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!collapsed && item.shortcut && (
          <kbd className="hidden shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] px-1 font-mono text-[10px] text-[var(--text-disabled)] group-hover:inline lg:inline">
            g {item.shortcut}
          </kbd>
        )}
      </NavLink>

      {!collapsed && item.children && (hasActiveChild || isCurrent) && (
        <ul className="mt-0.5 space-y-0.5 ps-[1.4rem]">
          {item.children.map((child) => (
            <li key={child.key}>
              <NavLink
                to={child.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'block truncate rounded-[var(--radius-sm)] px-2 py-1 text-[13px] transition-colors',
                    isActive
                      ? 'font-medium text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
                  )
                }
              >
                {navLabel(child.labelKey ?? child.key, t)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small status strip shown under the brand in the collapsed rail. */
export function SidebarBadge({ label }: { label: string }) {
  return <Badge tone="neutral">{label}</Badge>;
}

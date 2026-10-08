import { create } from 'zustand';

/**
 * Ephemeral UI state that is NOT server state.
 *
 * Anything the server owns lives in TanStack Query; anything the browser owns
 * (which panes are open, which sidebar rail state was last used) lives here.
 * Keeping the two apart is what stops a "collapse the sidebar" click from
 * invalidating a data fetch, and what makes the layout survive a reload.
 */

const SIDEBAR_KEY = 'monopos.sidebarCollapsed';

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === '1';
}

function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode: layout preference simply does not persist */
  }
}

export interface UiState {
  /** Desktop rail is collapsed to icons only. */
  sidebarCollapsed: boolean;
  /** Below `lg`, the sidebar is an overlay drawer. */
  mobileNavOpen: boolean;
  /** Cmd/Ctrl+K command palette. */
  commandPaletteOpen: boolean;
  /** Mobile/desktop quick-jump command palette. */
  quickFindOpen: boolean;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setQuickFindOpen: (open: boolean) => void;
  closeOverlays: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: readBool(SIDEBAR_KEY, false),
  mobileNavOpen: false,
  commandPaletteOpen: false,
  quickFindOpen: false,

  setSidebarCollapsed: (collapsed) => {
    writeBool(SIDEBAR_KEY, collapsed);
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    writeBool(SIDEBAR_KEY, next);
    set({ sidebarCollapsed: next });
  },

  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  toggleMobileNav: () => set({ mobileNavOpen: !get().mobileNavOpen }),

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () => set({ commandPaletteOpen: !get().commandPaletteOpen }),

  setQuickFindOpen: (quickFindOpen) => set({ quickFindOpen }),

  closeOverlays: () => set({ mobileNavOpen: false, commandPaletteOpen: false, quickFindOpen: false }),
}));

/**
 * Per-table view state (sort, visible columns, density).
 *
 * Deliberately a plain module-level map rather than a store: it is keyed by an
 * opaque string the page owns, it never drives re-renders of unrelated
 * components, and persisting it is a localStorage concern rather than app
 * state. The DataTable reads it on demand.
 */
export interface TableViewState {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  hiddenColumns?: string[];
  density?: 'comfortable' | 'compact';
}

const tableViews = new Map<string, TableViewState>();

export function readTableView(tableId: string): TableViewState {
  if (!tableViews.has(tableId)) {
    try {
      const raw = window.localStorage.getItem(`monopos.table.${tableId}`);
      if (raw) tableViews.set(tableId, JSON.parse(raw) as TableViewState);
    } catch {
      /* corrupt or unavailable storage: fall back to component defaults */
    }
  }
  return tableViews.get(tableId) ?? {};
}

export function writeTableView(tableId: string, patch: Partial<TableViewState>): void {
  const next = { ...readTableView(tableId), ...patch };
  tableViews.set(tableId, next);
  try {
    window.localStorage.setItem(`monopos.table.${tableId}`, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Columns a user has dismissed, so the ColumnPicker can offer "reset". */
export function resetTableView(tableId: string): void {
  tableViews.delete(tableId);
  try {
    window.localStorage.removeItem(`monopos.table.${tableId}`);
  } catch {
    /* ignore */
  }
}

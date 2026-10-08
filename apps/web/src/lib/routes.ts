import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  ClipboardList,
  Truck,
  Package,
  Boxes,
  Warehouse,
  Layers,
  Tags,
  Users,
  UserRound,
  UsersRound,
  Building2,
  Store,
  CreditCard,
  Wallet,
  ReceiptText,
  BookOpen,
  ScrollText,
  ChartColumn,
  Percent,
  ReceiptIndianRupee,
  Landmark,
  BarChart3,
  Globe,
  ScrollTextIcon,
  RefreshCw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@monopos/shared';

/**
 * Navigation model.
 *
 * One table drives the sidebar, the command palette, the breadcrumbs and the
 * keyboard shortcuts, so a new module is one entry here rather than four
 * separate lists that drift apart.
 *
 * Each entry declares the permission that unlocks it. The server is the real
 * authority — this is purely so a cashier does not see forty modules they can
 * never open.
 */

export interface NavItem {
  /** Path segment relative to the shell root, e.g. `products`. */
  key: string;
  /** Absolute route. */
  to: string;
  labelKey?: string;
  icon: LucideIcon;
  /** `any` unlocks when the user holds at least one of these. */
  permissions?: Permission[];
  /** Grouped one level deeper (report pages, accounting pages). */
  children?: NavItem[];
  /** `g x` keyboard chord; `x` is the second key after `g`. */
  shortcut?: string;
}

export interface NavGroup {
  key: string;
  labelKey?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'sell',
    labelKey: 'nav.group.sell',
    items: [
      { key: 'dashboard', to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, permissions: ['dashboard:view'], shortcut: 'd' },
      { key: 'pos', to: '/pos', labelKey: 'nav.pos', icon: ShoppingCart, permissions: ['pos:view'], shortcut: 'p' },
      { key: 'sales', to: '/sales', labelKey: 'nav.sales', icon: Receipt, permissions: ['sale:view'], shortcut: 's' },
      { key: 'invoices', to: '/invoices', labelKey: 'nav.invoices', icon: ReceiptText, permissions: ['invoice:view'], shortcut: 'i' },
      { key: 'payments', to: '/payments', labelKey: 'nav.payments', icon: CreditCard, permissions: ['payment:view'] },
      { key: 'returns', to: '/returns', labelKey: 'nav.returns', icon: RefreshCw, permissions: ['return:view'] },
    ],
  },
  {
    key: 'buy',
    labelKey: 'nav.group.buy',
    items: [
      { key: 'purchases', to: '/purchases', labelKey: 'nav.purchases', icon: ClipboardList, permissions: ['purchase:view'] },
      { key: 'suppliers', to: '/suppliers', labelKey: 'nav.suppliers', icon: Truck, permissions: ['supplier:view'] },
      { key: 'expenses', to: '/expenses', labelKey: 'nav.expenses', icon: Wallet, permissions: ['expense:view'] },
    ],
  },
  {
    key: 'stock',
    labelKey: 'nav.group.stock',
    items: [
      { key: 'inventory', to: '/inventory', labelKey: 'nav.inventory', icon: Boxes, permissions: ['inventory:view'], shortcut: 'k' },
      { key: 'products', to: '/products', labelKey: 'nav.products', icon: Package, permissions: ['product:view'], shortcut: 'o' },
      { key: 'categories', to: '/categories', labelKey: 'nav.categories', icon: Layers, permissions: ['category:view'] },
      { key: 'brands', to: '/brands', labelKey: 'nav.brands', icon: Tags, permissions: ['brand:view'] },
      { key: 'units', to: '/units', labelKey: 'nav.units', icon: Boxes, permissions: ['product:view'] },
      { key: 'warehouses', to: '/warehouses', labelKey: 'nav.warehouses', icon: Warehouse, permissions: ['warehouse:view'] },
    ],
  },
  {
    key: 'money',
    labelKey: 'nav.group.money',
    items: [
      {
        key: 'accounting',
        to: '/accounting',
        labelKey: 'nav.accounting',
        icon: BookOpen,
        permissions: ['account:view', 'journal:view', 'ledger:view'],
        children: [
          { key: 'accounts', to: '/accounting/accounts', labelKey: 'nav.accounts', icon: Landmark },
          { key: 'journal', to: '/accounting/journal', labelKey: 'nav.journal', icon: ScrollText },
          { key: 'trial-balance', to: '/accounting/trial-balance', labelKey: 'nav.trialBalance', icon: ChartColumn },
          { key: 'profit-loss', to: '/accounting/profit-loss', labelKey: 'nav.profitLoss', icon: ChartColumn },
          { key: 'ledger', to: '/accounting/ledger', labelKey: 'nav.ledger', icon: BookOpen },
        ],
      },
      { key: 'taxes', to: '/taxes', labelKey: 'nav.tax', icon: Percent, permissions: ['tax:view'] },
      {
        key: 'reports',
        to: '/reports',
        labelKey: 'nav.reports',
        icon: BarChart3,
        permissions: ['report:view'],
        children: [
          { key: 'sales-summary', to: '/reports/sales', labelKey: 'report.salesSummary', icon: ChartColumn },
          { key: 'product-profitability', to: '/reports/profitability', labelKey: 'report.profitability', icon: Package },
          { key: 'inventory-valuation', to: '/reports/inventory-valuation', labelKey: 'report.inventoryValuation', icon: Warehouse },
          { key: 'tax-summary', to: '/reports/tax-summary', labelKey: 'report.taxSummary', icon: ReceiptIndianRupee },
          { key: 'cash-position', to: '/reports/cash-position', labelKey: 'report.cashPosition', icon: Wallet },
          { key: 'customer-balances', to: '/reports/customer-balances', labelKey: 'report.customerBalances', icon: UsersRound },
          { key: 'supplier-balances', to: '/reports/supplier-balances', labelKey: 'report.supplierBalances', icon: Truck },
          { key: 'expense-breakdown', to: '/reports/expense-breakdown', icon: Wallet },
          { key: 'shift-history', to: '/reports/shift-history', labelKey: 'report.shiftHistory', icon: Store },
        ],
      },
    ],
  },
  {
    key: 'people',
    labelKey: 'nav.group.people',
    items: [
      { key: 'customers', to: '/customers', labelKey: 'nav.customers', icon: Users, permissions: ['customer:view'], shortcut: 'c' },
      { key: 'employees', to: '/employees', labelKey: 'nav.employees', icon: UserRound, permissions: ['employee:view'] },
    ],
  },
  {
    key: 'manage',
    labelKey: 'nav.group.manage',
    items: [
      { key: 'branches', to: '/branches', labelKey: 'nav.branches', icon: Building2, permissions: ['branch:view'] },
      { key: 'registers', to: '/registers', labelKey: 'nav.registers', icon: Store, permissions: ['register:view'] },
      { key: 'users', to: '/users', labelKey: 'nav.users', icon: Users, permissions: ['user:view'], shortcut: 'u' },
      { key: 'roles', to: '/roles', labelKey: 'nav.roles', icon: UserRound, permissions: ['role:view'] },
      { key: 'languages', to: '/languages', labelKey: 'nav.languages', icon: Globe, permissions: ['i18n:view'] },
      { key: 'audit', to: '/audit', labelKey: 'nav.audit', icon: ScrollTextIcon, permissions: ['audit:view'] },
      { key: 'sync', to: '/sync', labelKey: 'nav.sync', icon: RefreshCw, permissions: ['sync:view'] },
      { key: 'settings', to: '/settings', labelKey: 'nav.settings', icon: Settings, permissions: ['setting:view', 'setting:manage'], shortcut: 'g' },
    ],
  },
];

/** Flat list of every routable nav entry, used by the command palette. */
export function flattenNav(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  const out: NavItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      out.push(item);
      if (item.children) out.push(...item.children);
    }
  }
  return out;
}

/** Does the user's permission set unlock this nav item? */
export function canSeeNavItem(item: NavItem, can: (permission: Permission) => boolean): boolean {
  if (!item.permissions || item.permissions.length === 0) return true;
  return item.permissions.some((permission) => can(permission));
}

export function filterNav(
  groups: NavGroup[],
  can: (permission: Permission) => boolean,
): NavGroup[] {
  return groups
    .map((group) => {
      const items = group.items.filter((item) => canSeeNavItem(item, can));
      return {
        ...group,
        items: items.map((item) =>
          item.children
            ? { ...item, children: item.children.filter((child) => canSeeNavItem(child, can)) }
            : item,
        ),
      };
    })
    .filter((group) => group.items.length > 0);
}

/** Resolve a pathname to its breadcrumb trail. */
export function breadcrumbsFor(pathname: string): NavItem[] {
  const all = flattenNav();
  const exact = all.find((item) => item.to === pathname);
  const trail: NavItem[] = [];

  if (exact) {
    const parent = all.find((item) => item.children?.some((child) => child.to === exact.to));
    if (parent) trail.push(parent);
    trail.push(exact);
    return trail;
  }

  // Fall back to a prefix match so an unlisted sub-route still shows context.
  const parent = all.find((item) => item.to !== '/' && pathname.startsWith(`${item.to}/`));
  if (parent) trail.push(parent);
  return trail;
}

/** `g` then `x` opens the matching module. */
export const SHORTCUTS: Record<string, string> = Object.fromEntries(
  flattenNav()
    .filter((item) => item.shortcut)
    .map((item) => [item.shortcut as string, item.to]),
);

/**
 * English text for nav keys that are not in the shipped `EN` table yet.
 *
 * Rendering a raw key like `nav.trialBalance` would be worse than showing
 * English, so those fall back here. Once they are added to `EN` the i18n table
 * takes over automatically and this map becomes dead weight to delete.
 */
const NAV_FALLBACKS: Record<string, string> = {
  'nav.returns': 'Returns',
  'nav.units': 'Units',
  'nav.registers': 'Registers',
  'nav.trialBalance': 'Trial balance',
  'nav.profitLoss': 'Profit & loss',
  'nav.group.people': 'People',
  'report.salesSummary': 'Sales summary',
  'report.profitability': 'Product profitability',
  'report.inventoryValuation': 'Inventory valuation',
  'report.taxSummary': 'Tax summary',
  'report.cashPosition': 'Cash position',
  'report.customerBalances': 'Customer balances',
  'report.supplierBalances': 'Supplier balances',
  'report.expenseBreakdown': 'Expense breakdown',
  'report.shiftHistory': 'Shift history',
};

/** True when the key has a real translation table (so `t()` should be used). */
export function hasNavKey(key: string): boolean {
  return !(key in NAV_FALLBACKS);
}

/** Resolve a nav label: translated when available, English otherwise. */
export function navLabel(key: string, t: (key: string) => string): string {
  const fallback = NAV_FALLBACKS[key];
  if (fallback !== undefined) return fallback;
  return t(key);
}

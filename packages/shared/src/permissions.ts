/**
 * Permission catalogue.
 *
 * Permissions are flat strings of the form `resource:action`. The server is the
 * only authority; the web client uses the same catalogue purely to decide what
 * to render. A client-side check is a UX affordance, never a security control.
 */

export const RESOURCES = [
  'dashboard',
  'pos',
  'sale',
  'purchase',
  'return',
  'product',
  'category',
  'brand',
  'inventory',
  'stock',
  'customer',
  'supplier',
  'employee',
  'branch',
  'warehouse',
  'register',
  'invoice',
  'payment',
  'expense',
  'account',
  'journal',
  'ledger',
  'report',
  'tax',
  'user',
  'role',
  'setting',
  'i18n',
  'audit',
  'sync',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'export', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

export type Permission = `${Resource}:${Action}`;

const RESOURCE_SET = new Set<string>(RESOURCES);
const ACTION_SET = new Set<string>(ACTIONS);

/** Build the full permission matrix, sorted, for seeding and for the UI. */
export function allPermissions(): Permission[] {
  const out: Permission[] = [];
  for (const r of RESOURCES) {
    for (const a of ACTIONS) out.push(`${r}:${a}` as Permission);
  }
  return out;
}

export function isPermission(value: string): value is Permission {
  const [res, act] = value.split(':');
  return res !== undefined && act !== undefined && RESOURCE_SET.has(res) && ACTION_SET.has(act);
}

export function parsePermissions(values: readonly string[]): Permission[] {
  return values.filter(isPermission);
}

// ---------------------------------------------------------------------------
// System roles
// ---------------------------------------------------------------------------

export const SYSTEM_ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'WAREHOUSE',
  'STOCK_CLERK',
  'VIEWER',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Permissions that always exist and cannot be granted away or deleted. */
export const SYSTEM_PERMISSIONS: Permission[] = ['setting:manage', 'role:manage'];

/**
 * Default grants per system role.
 *
 * `OWNER` is the intersection of every permission; it is computed rather than
 * listed so a new resource can never be forgotten here.
 */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = (() => {
  const all = allPermissions();
  const pick = (resources: readonly Resource[], actions: readonly Action[]): Permission[] =>
    all.filter((p) => {
      const [r, a] = p.split(':');
      return r !== undefined && a !== undefined
        && (resources as readonly string[]).includes(r)
        && (actions as readonly string[]).includes(a);
    });

  const businessWide: Resource[] = RESOURCES.filter((r) => !['pos', 'sync'].includes(r));

  return {
    OWNER: all,
    ADMIN: all.filter((p) => p !== 'setting:manage'),
    MANAGER: pick(businessWide, ['view', 'create', 'update', 'approve', 'export']),
    ACCOUNTANT: pick(
      ['dashboard', 'sale', 'purchase', 'return', 'invoice', 'payment', 'expense', 'account', 'journal', 'ledger', 'report', 'tax', 'customer', 'supplier', 'product', 'branch'],
      ['view', 'create', 'update', 'approve', 'export', 'manage'],
    ),
    CASHIER: pick(
      ['dashboard', 'pos', 'sale', 'invoice', 'payment', 'customer', 'product', 'category', 'brand', 'stock', 'sync', 'return', 'tax'],
      ['view', 'create'],
    ),
    WAREHOUSE: pick(
      ['dashboard', 'product', 'category', 'brand', 'inventory', 'stock', 'purchase', 'supplier', 'warehouse', 'branch', 'report'],
      ['view', 'create', 'update', 'export'],
    ),
    STOCK_CLERK: pick(['product', 'category', 'brand', 'inventory', 'stock', 'warehouse'], ['view', 'create', 'update']),
    VIEWER: pick(RESOURCES as readonly Resource[], ['view']),
  };
})();

/**
 * Capabilities that are deliberately NOT permission-gated because breaking them
 * corrupts the books. These are hard-blocked in the service layer regardless of
 * role, and are surfaced to the UI as locked actions.
 */
export const PROTECTED_OPERATIONS = [
  'accounting.post_journal_to_closed_period',
  'accounting.delete_account_with_balance',
  'inventory.override_negative_stock',
  'invoice.reissue_number',
] as const;

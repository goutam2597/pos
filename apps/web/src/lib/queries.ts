import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from './api';
import { useAuth } from './auth';
import { normalizeRow, normalizeRows } from './normalize';

/**
 * Server data access.
 *
 * A thin, typed layer over `ApiClient` + TanStack Query. Pages never touch
 * `fetch`, the envelope, or the query-key array shape directly, so changing
 * how a list is fetched or invalidated is a change here and nowhere else.
 */

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface ListMeta {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ListResult<T> {
  rows: T[];
  meta: ListMeta;
}

const EMPTY_META: ListMeta = { total: 0, page: 1, pageSize: 25, pageCount: 1 };

function normalizeMeta(meta: Record<string, unknown> | undefined, rowCount: number): ListMeta {
  if (!meta) return { ...EMPTY_META, total: rowCount, page: 1 };
  const num = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed > 0 ? parsed : fallback;
  };
  const total = num(meta.total, rowCount);
  const pageSize = num(meta.pageSize, EMPTY_META.pageSize);
  return {
    total,
    page: num(meta.page, 1),
    pageSize,
    pageCount: num(meta.pageCount, Math.max(1, Math.ceil(total / pageSize))),
  };
}

/** Drop empty params so the URL (and the cache key) stays stable. */
export function cleanParams(params: QueryParams | undefined): QueryParams {
  if (!params) return {};
  const out: QueryParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Query keys are hierarchical arrays: `['products', 'list', {…}]` is
 * invalidated wholesale by `invalidate(['products'])`, which is why every key
 * starts with the resource name.
 */
export const queryKeys = {
  dashboard: (params?: QueryParams) => ['dashboard', cleanParams(params)] as const,
  products: (params?: QueryParams) => ['products', 'list', cleanParams(params)] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  categories: ['categories'] as const,
  brands: ['brands'] as const,
  units: ['units'] as const,
  taxes: ['taxes'] as const,
  customers: (params?: QueryParams) => ['customers', 'list', cleanParams(params)] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
  suppliers: (params?: QueryParams) => ['suppliers', cleanParams(params)] as const,
  employees: (params?: QueryParams) => ['employees', cleanParams(params)] as const,
  sales: (params?: QueryParams) => ['sales', 'list', cleanParams(params)] as const,
  sale: (id: string) => ['sales', 'detail', id] as const,
  invoices: (params?: QueryParams) => ['invoices', 'list', cleanParams(params)] as const,
  invoice: (id: string) => ['invoices', 'detail', id] as const,
  purchases: (params?: QueryParams) => ['purchases', cleanParams(params)] as const,
  returns: (params?: QueryParams) => ['returns', cleanParams(params)] as const,
  stock: (params?: QueryParams) => ['inventory', 'stock', cleanParams(params)] as const,
  stockMoves: (params?: QueryParams) => ['inventory', 'moves', cleanParams(params)] as const,
  stockValue: (params?: QueryParams) => ['inventory', 'value', cleanParams(params)] as const,
  expenses: (params?: QueryParams) => ['expenses', cleanParams(params)] as const,
  accounts: ['accounting', 'accounts'] as const,
  journal: (params?: QueryParams) => ['accounting', 'journal', cleanParams(params)] as const,
  trialBalance: (params?: QueryParams) => ['accounting', 'trial-balance', cleanParams(params)] as const,
  profitLoss: (params?: QueryParams) => ['accounting', 'profit-loss', cleanParams(params)] as const,
  ledger: (accountId: string, params?: QueryParams) =>
    ['accounting', 'ledger', accountId, cleanParams(params)] as const,
  reports: (name: string, params?: QueryParams) => ['reports', name, cleanParams(params)] as const,
  branches: ['branches'] as const,
  warehouses: ['warehouses'] as const,
  registers: (params?: QueryParams) => ['registers', cleanParams(params)] as const,
  users: (params?: QueryParams) => ['users', cleanParams(params)] as const,
  roles: ['roles'] as const,
  languages: ['i18n', 'languages'] as const,
  translations: (code: string) => ['i18n', 'translations', code] as const,
  settings: ['settings'] as const,
  audit: (params?: QueryParams) => ['audit', cleanParams(params)] as const,
  sync: ['sync', 'overview'] as const,
} as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface QueryOptions<T> {
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
  select?: (data: T) => T;
  onError?: (error: ApiError) => void;
}

/**
 * Fetch a single resource. `fn` receives the API client so a page can compose
 * more than one call if it must, while still getting caching and retries.
 */
export function useApiQuery<T>(
  key: QueryKey,
  fn: (signal: AbortSignal) => Promise<T>,
  options: QueryOptions<T> = {},
): UseQueryResult<T, ApiError> {
  const { enabled = true, staleTime = 30_000, refetchInterval = false, select, onError } = options;
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => fn(signal),
    enabled,
    staleTime,
    refetchInterval,
    select,
    retry: (failureCount, error) => (error.isTransient ? failureCount < 2 : false),
    refetchOnWindowFocus: false,
  }) as UseQueryResult<T, ApiError>;
}

/** GET a list endpoint, keeping the `{ rows, meta }` shape the DataTable wants. */
export function useApiList<T>(
  key: QueryKey,
  path: string,
  params?: QueryParams,
  options: QueryOptions<ListResult<T>> = {},
): UseQueryResult<ListResult<T>, ApiError> {
  const { api } = useAuth();
  const clean = cleanParams(params);
  return useApiQuery<ListResult<T>>(
    key,
    async (signal) => {
      const envelope = await api.request<T[]>(path, { query: clean, signal });
      const rows = normalizeRows(path, envelope.data ?? []);
      return { rows, meta: normalizeMeta(envelope.meta, rows.length) };
    },
    { staleTime: 15_000, ...options },
  );
}

/** Convenience: GET one resource by path. */
export function useApiGet<T>(key: QueryKey, path: string, options: QueryOptions<T> = {}) {
  const { api } = useAuth();
  return useApiQuery<T>(
    key,
    async (signal) => normalizeRow(path, (await api.data<T>(path, { signal })) as Record<string, any>) as T,
    options,
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MutationConfig<TVariables, TData> {
  /** Query keys to invalidate once the write succeeds. */
  invalidate?: readonly (readonly unknown[])[];
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: string | ((data: TData, variables: TVariables) => string);
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiError, variables: TVariables) => void;
}

/**
 * Shared write path.
 *
 * A `VALIDATION_FAILED` body carries `details` keyed by field name; the caller
 * maps those onto its form. A transient failure is surfaced with a "retry"
 * affordance rather than a silent console error, because on a till an
 * unexplained failure looks like data loss.
 */
export function useApiMutation<TVariables, TData = unknown>(
  config: MutationConfig<TVariables, TData>,
) {
  const queryClient = useQueryClient();
  const { invalidate = [], successMessage, onSuccess, onError } = config;

  return useMutation<TData, ApiError, TVariables>({
    mutationFn: config.mutationFn,
    retry: (failureCount, error) => (error.isTransient ? failureCount < 1 : false),
    onSuccess: (data, variables) => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key as QueryKey });
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(data, variables) : successMessage);
      }
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      if (onError) {
        onError(error, variables);
        return;
      }
      toast.error(describeError(error));
    },
  });
}

/**
 * Create / update / remove helpers.
 *
 * The caller passes the path as part of the variables rather than as a second
 * argument, so a page's `mutate({ path: `/products/${id}`, name })` reads as one
 * value and the cache invalidation stays attached to the same call.
 */
type WithPath<T> = T & { path: string };

export function useCreate<TVariables, TData = unknown>(
  invalidate: readonly (readonly unknown[])[],
  successMessage?: string,
) {
  const { api } = useAuth();
  return useApiMutation<WithPath<TVariables>, TData>({
    invalidate,
    successMessage,
    mutationFn: (variables) => {
      const { path, ...body } = variables;
      return api.post<TData>(path, body);
    },
  });
}

export function useUpdate<TVariables, TData = unknown>(
  invalidate: readonly (readonly unknown[])[],
  successMessage?: string,
) {
  const { api } = useAuth();
  return useApiMutation<WithPath<TVariables>, TData>({
    invalidate,
    successMessage,
    mutationFn: (variables) => {
      const { path, ...body } = variables;
      return api.patch<TData>(path, body);
    },
  });
}

export function useRemove(
  invalidate: readonly (readonly unknown[])[],
  successMessage = 'Deleted',
) {
  const { api } = useAuth();
  return useApiMutation<{ path: string }>({
    invalidate,
    successMessage,
    mutationFn: ({ path }) => api.del(path),
  });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** One honest sentence for a toast. Never a stack trace, never a bare code. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isOffline) return 'No connection to the server. Your change was not saved.';
    if (error.status === 0) return error.message;
    if (error.code === 'VALIDATION_FAILED') return 'Some fields need attention.';
    if (error.code === 'FORBIDDEN') return 'You do not have permission to do that.';
    if (error.code === 'NOT_FOUND') return 'That record no longer exists.';
    if (error.code === 'CONFLICT') return 'Someone else changed this record. Reload and try again.';
    if (error.code === 'INSUFFICIENT_STOCK') return 'There is not enough stock for that.';
    if (error.code === 'LOCKED' || error.code === 'ACCOUNT_LOCKED') {
      return 'Too many failed attempts. This account is temporarily locked.';
    }
    return error.message || 'Request failed.';
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Field-level errors from a `VALIDATION_FAILED` body, for form mapping. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(error.details)) {
    out[key] = Array.isArray(value) ? (value[0] ?? 'Invalid value') : value;
  }
  return out;
}

/** A short, actionable error block for a page-level error state. */
export function errorTitle(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isOffline) return 'You are offline';
    if (error.status === 403) return 'Access denied';
    if (error.status === 404) return 'Not found';
    if (error.status >= 500) return 'The server had a problem';
  }
  return 'Something went wrong';
}

// ---------------------------------------------------------------------------
// Entity types (as returned by the API)
// ---------------------------------------------------------------------------

export interface Branch {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
  createdAt?: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  address?: string | null;
  isActive?: boolean;
}

export interface Register {
  id: string;
  name: string;
  code?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  status?: string | null;
  isActive?: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  description?: string | null;
  isActive?: boolean;
  productCount?: number;
}

export interface Brand {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  isActive?: boolean;
  productCount?: number;
}

export interface Unit {
  id: string;
  name: string;
  /** Short code printed beside quantities (max 20 chars). Required by the API. */
  code: string;
  plural?: string | null;
  /** False = the unit only sells in whole numbers. */
  allowFraction?: boolean;
  /** Milli-units of the base unit equal to one of this unit (a box of 12 → 12000). */
  conversionFactor?: number;
}

export interface Tax {
  id: string;
  name: string;
  code?: string | null;
  rate?: number;
  type?: string | null;
  scope?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface ProductVariant {
  id: string;
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  costPrice?: number;
  qtyOnHand?: number;
}

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  type?: string | null;
  status?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  brandId?: string | null;
  brandName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  price: number;
  costPrice?: number;
  taxId?: string | null;
  taxName?: string | null;
  taxRate?: number;
  imageUrl?: string | null;
  trackInventory?: boolean;
  allowNegativeStock?: boolean;
  isActive?: boolean;
  qtyOnHand?: number;
  reorderLevel?: number;
  variantCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  variants?: ProductVariant[];
}

export interface Customer {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxNumber?: string | null;
  tier?: string | null;
  status?: string | null;
  creditLimit?: number;
  balance?: number;
  notes?: string | null;
  createdAt?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  isPreferred?: boolean;
  isActive?: boolean;
  balance?: number;
  notes?: string | null;
  createdAt?: string | null;
}

export interface Employee {
  id: string;
  userId?: string | null;
  firstName: string;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  isActive?: boolean;
  hiredAt?: string | null;
}

export interface SaleItem {
  id: string;
  productId?: string | null;
  productName: string;
  sku?: string | null;
  variantName?: string | null;
  unitName?: string | null;
  qtyMilli: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
}

export interface SalePayment {
  id: string;
  method: string;
  amount: number;
  reference?: string | null;
  tendered?: number;
  change?: number;
}

export interface Sale {
  id: string;
  number: string;
  status?: string | null;
  channel?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  registerId?: string | null;
  registerName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  userId?: string | null;
  userName?: string | null;
  subtotal: number;
  discount?: number;
  tax: number;
  total: number;
  paid?: number;
  change?: number;
  notes?: string | null;
  voidReason?: string | null;
  createdAt: string;
  voidedAt?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
  journalEntryId?: string | null;
}

export interface InvoiceLine {
  id: string;
  description?: string | null;
  productName?: string | null;
  sku?: string | null;
  qtyMilli?: number;
  unitName?: string | null;
  unitPrice?: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  total?: number;
  accountId?: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  type?: string | null;
  status?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  partyType?: string | null;
  partyEmail?: string | null;
  partyPhone?: string | null;
  partyAddress?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  issueDate: string;
  dueDate?: string | null;
  subtotal: number;
  discount?: number;
  tax: number;
  total: number;
  amountPaid?: number;
  balance?: number;
  currency?: string | null;
  notes?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  createdAt?: string | null;
  lines?: InvoiceLine[];
  payments?: SalePayment[];
}

export interface PurchaseItem {
  id?: string;
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  unitName?: string | null;
  qtyMilli?: number;
  receivedQtyMilli?: number;
  unitCost?: number;
  taxRate?: number;
  total?: number;
}

export interface Purchase {
  id: string;
  number: string;
  supplierId?: string | null;
  supplierName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  status?: string | null;
  orderDate?: string | null;
  expectedDate?: string | null;
  receivedAt?: string | null;
  subtotal?: number;
  tax?: number;
  total?: number;
  notes?: string | null;
  createdAt?: string | null;
  items?: PurchaseItem[];
}

export interface ReturnOrder {
  id: string;
  number: string;
  type?: string | null;
  status?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  branchName?: string | null;
  returnDate?: string | null;
  total?: number;
  reason?: string | null;
  createdAt?: string | null;
}

export interface StockLevel {
  id?: string;
  productId: string;
  productName?: string | null;
  sku?: string | null;
  barcode?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  unitName?: string | null;
  qtyOnHand: number;
  reservedQty?: number;
  reorderLevel?: number;
  costPrice?: number;
  value?: number;
  isLow?: boolean;
}

export interface StockMove {
  id: string;
  type: string;
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  qtyMilli: number;
  unitName?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
  note?: string | null;
  userName?: string | null;
  branchName?: string | null;
  createdAt: string;
}

export interface StockValueRow {
  productId?: string;
  productName?: string;
  sku?: string | null;
  warehouseName?: string | null;
  qtyMilli?: number;
  costPrice?: number;
  value?: number;
}

export interface Expense {
  id: string;
  number?: string | null;
  category?: string | null;
  description?: string | null;
  vendor?: string | null;
  amount: number;
  tax?: number;
  total?: number;
  status?: string | null;
  expenseDate?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  userName?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  description?: string | null;
  isActive?: boolean;
  isSystem?: boolean;
  balance?: number;
}

export interface JournalLine {
  id: string;
  accountId: string;
  accountCode?: string | null;
  accountName?: string | null;
  memo?: string | null;
  debit: number;
  credit: number;
  branchId?: string | null;
  branchName?: string | null;
}

export interface JournalEntry {
  id: string;
  number?: string | null;
  entryDate?: string | null;
  postedAt?: string | null;
  source?: string | null;
  status?: string | null;
  memo?: string | null;
  reference?: string | null;
  createdByName?: string | null;
  reversedById?: string | null;
  totalDebit?: number;
  totalCredit?: number;
  lines?: JournalLine[];
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  isActive?: boolean;
  locale?: string | null;
  roleNames?: string[] | null;
  branchIds?: string[] | null;
  branchNames?: string[] | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  permissions?: string[];
  userCount?: number;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  branchName?: string | null;
  ip?: string | null;
  changes?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Language {
  code: string;
  name: string;
  nativeName?: string | null;
  direction: 'ltr' | 'rtl';
  isDefault?: boolean;
  isActive?: boolean;
  translatedCount?: number;
  totalKeys?: number;
}

export interface DeviceSummary {
  id: string;
  name?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  lastSeenAt?: string | null;
  lastSyncedAt?: string | null;
  status?: string | null;
}

export interface SyncFailure {
  id: string;
  clientTxnId?: string | null;
  type?: string | null;
  deviceName?: string | null;
  code?: string | null;
  note?: string | null;
  attempts?: number;
  createdAt?: string | null;
}

export interface SyncOverview {
  devices?: DeviceSummary[];
  recentFailures?: SyncFailure[];
  pendingTotal?: number;
}

export interface DashboardKpis {
  salesToday?: number;
  salesMonth?: number;
  profitMonth?: number;
  ordersToday?: number;
  ordersMonth?: number;
  avgTicket?: number;
  lowStockCount?: number;
  outstandingReceivables?: number;
  salesTrendPct?: number;
  [key: string]: unknown;
}

export interface TrendPoint {
  label: string;
  date?: string;
  value: number;
  secondaryValue?: number;
}

export interface NamedValue {
  label: string;
  value: number;
  key?: string;
  color?: number;
}

export interface DashboardData {
  kpis?: DashboardKpis;
  salesTrend?: TrendPoint[];
  topProducts?: NamedValue[];
  lowStock?: StockLevel[];
  recentSales?: Sale[];
  paymentMix?: NamedValue[];
  branchPerformance?: NamedValue[];
}

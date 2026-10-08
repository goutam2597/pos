/**
 * Domain vocabulary shared by server and client.
 *
 * These mirror the Prisma enums exactly. They are duplicated as string literal
 * unions rather than imported from the generated client so that `@monopos/web`
 * can depend on them without pulling in the Prisma runtime.
 */

// --- Parties ---------------------------------------------------------------

export const PARTY_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const CUSTOMER_TIERS = ['RETAIL', 'WHOLESALE', 'VIP', 'DISTRIBUTOR'] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

// --- Catalog ---------------------------------------------------------------

export const PRODUCT_TYPES = ['SIMPLE', 'VARIANT', 'BUNDLE', 'SERVICE'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Costing methods that drive COGS and stock valuation. */
export const COSTING_METHODS = ['AVERAGE', 'FIFO', 'LIFETIME', 'STANDARD'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

// --- Inventory -------------------------------------------------------------

export const WAREHOUSE_TYPES = ['STORE', 'WAREHOUSE', 'SUPPLY', 'QUARANTINE', 'DAMAGED'] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const STOCK_MOVE_TYPES = [
  'PURCHASE',       // stock in from a purchase invoice
  'SALE',           // stock out from a sale
  'RETURN_IN',      // customer returns goods to us
  'RETURN_OUT',     // we return goods to a supplier
  'ADJUSTMENT_IN',  // manual positive correction (stocktake surplus)
  'ADJUSTMENT_OUT', // manual negative correction (damage, loss, stocktake)
  'TRANSFER_IN',    // arrived from another warehouse
  'TRANSFER_OUT',   // sent to another warehouse
  'OPENING',        // opening balance
  'SHRINKAGE',      // expired / written off
] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];

export const STOCK_REFERENCE_TYPES = [
  'SALE', 'PURCHASE', 'RETURN', 'ADJUSTMENT', 'TRANSFER', 'STOCKTAKE', 'OPENING',
] as const;
export type StockReferenceType = (typeof STOCK_REFERENCE_TYPES)[number];

export const TRANSFER_STATUSES = ['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// --- Sales -----------------------------------------------------------------

export const SALE_STATUSES = [
  'DRAFT',      // held in the cart, not yet committed
  'COMPLETED',  // paid and posted
  'PARTIAL',    // part-paid against a credit sale
  'REFUNDED',   // fully refunded
  'VOIDED',     // cancelled before posting
  'RETURNED',   // partially returned
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/**
 * Where the sale originated. This is what makes online and offline first-class
 * rather than an afterthought: offline sales carry `OFFLINE` plus the device id
 * and captured timestamp, and reports can be split by channel.
 */
export const SALE_CHANNELS = ['POS', 'ONLINE', 'PHONE', 'MANUAL', 'OFFLINE', 'API'] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

export const PAYMENT_METHODS = [
  'CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'FAILED', 'REFUNDED', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = ['SALE', 'PURCHASE', 'EXPENSE', 'REFUND', 'CASH_IN', 'CASH_OUT', 'CUSTOMER_ADVANCE', 'SUPPLIER_ADVANCE'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

// --- Documents -------------------------------------------------------------

export const INVOICE_TYPES = ['SALE', 'PURCHASE', 'RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PROFORMA'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'OVERDUE', 'VOID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_TYPES = ['SALE_RETURN', 'PURCHASE_RETURN'] as const;
export type ReturnType = (typeof RETURN_TYPES)[number];

// --- Accounting ------------------------------------------------------------

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Sub-ledgers that drive the receivables/payables side of the business. */
export const ACCOUNT_SUBTYPES = [
  'CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'FIXED_ASSET',
  'ACCOUNTS_PAYABLE', 'TAX_PAYABLE', 'CREDIT_CARD',
  'OWNERS_EQUITY', 'RETAINED_EARNINGS',
  'SALES_REVENUE', 'SERVICE_REVENUE', 'OTHER_INCOME', 'SALES_DISCOUNT', 'TAX_COLLECTED',
  'COGS', 'EXPENSE', 'RENT', 'UTILITIES', 'SALARIES', 'SUPPLIES', 'TRANSPORT', 'OTHER_EXPENSE',
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const JOURNAL_STATUSES = ['DRAFT', 'POSTED', 'REVERSED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_SOURCES = [
  'MANUAL', 'SALE', 'PURCHASE', 'PAYMENT', 'EXPENSE', 'RETURN', 'REFUND', 'OPENING', 'CLOSING', 'STOCKTAKE',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

// --- Tax -------------------------------------------------------------------

export const TAX_TYPES = ['PERCENTAGE', 'FIXED', 'INCLUSIVE', 'EXCLUSIVE'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const TAX_SCOPES = ['SALE', 'PURCHASE', 'BOTH'] as const;
export type TaxScope = (typeof TAX_SCOPES)[number];

// --- Expense ---------------------------------------------------------------

export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

// --- Registers -------------------------------------------------------------

export const REGISTER_STATUSES = ['OPEN', 'CLOSED', 'SUSPENDED'] as const;
export type RegisterStatus = (typeof REGISTER_STATUSES)[number];

// --- Audit -----------------------------------------------------------------

export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'VOID', 'SYNC', 'EXPORT', 'STOCKTAKE'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'Product', 'Category', 'Brand', 'Customer', 'Supplier', 'Employee', 'Branch', 'Warehouse',
  'Register', 'Sale', 'SaleItem', 'Invoice', 'Payment', 'Purchase', 'PurchaseItem', 'Return',
  'Expense', 'Account', 'JournalEntry', 'JournalLine', 'Tax', 'User', 'Role', 'Setting',
  'Translation', 'StockMove', 'StockLevel', 'Session',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

// --- Helpers ---------------------------------------------------------------

export const isValid = <T extends readonly string[]>(
  list: T,
  value: unknown,
): value is T[number] => typeof value === 'string' && (list as readonly string[]).includes(value);

/** Shape of a paginated list response used by every list endpoint. */
export interface Paginated<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export function normalizeListQuery(q: ListQuery): Required<Pick<ListQuery, 'page' | 'pageSize'>> & ListQuery {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const requested = Math.floor(Number(q.pageSize) || DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { ...q, page, pageSize };
}

export function paginate<T>(rows: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    data: rows,
    meta: { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

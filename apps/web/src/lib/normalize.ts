/**
 * API-to-UI shape normalization.
 *
 * The server speaks in relations (`customer: { name }`, `code`, `occurredAt`);
 * the screens speak in flat display fields (`customerName`, `number`,
 * `createdAt`). Rather than teaching every page the server's nesting — which
 * is how tables end up rendering "—" in every cell — the translation lives
 * here, once, and runs automatically inside `useApiList`/`useApiGet`.
 *
 * Every mapper spreads the input first and only overrides what it knows, so an
 * unmapped field passes through untouched and a mapper can never delete data.
 * Mappers are also defensive about `null`: a missing relation yields `null`,
 * never a crash, because list endpoints deliberately select slim payloads.
 */

type Row = Record<string, any>;

const personName = (person: any): string | null => {
  if (!person) return null;
  if (typeof person === 'string') return person;
  const full = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return full || person.name || person.email || null;
};

function mapSaleItem(item: Row): Row {
  return {
    ...item,
    discount: item.discount ?? (item.discountAmount ?? 0) + (item.allocatedDiscount ?? 0),
    taxAmount: item.taxAmount ?? item.lineTax ?? 0,
    total: item.total ?? item.lineTotal ?? 0,
  };
}

function mapPayment(payment: Row): Row {
  return { ...payment };
}

export function mapSale(row: Row): Row {
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    createdAt: row.createdAt ?? row.occurredAt ?? null,
    customerName: row.customerName ?? row.customer?.name ?? null,
    userName: row.userName ?? personName(row.user),
    branchName: row.branchName ?? row.branch?.name ?? null,
    registerName: row.registerName ?? row.register?.name ?? null,
    discount: row.discount ?? row.discountTotal ?? 0,
    tax: row.tax ?? row.taxTotal ?? 0,
    paid: row.paid ?? row.paidTotal ?? 0,
    change:
      row.change ??
      (typeof row.paidTotal === 'number' && typeof row.total === 'number'
        ? Math.max(0, row.paidTotal - row.total)
        : 0),
    notes: row.notes ?? row.note ?? row.customerNote ?? null,
    invoiceId: row.invoiceId ?? row.invoice?.id ?? null,
    invoiceNumber: row.invoiceNumber ?? row.invoice?.code ?? null,
    items: Array.isArray(row.items) ? row.items.map(mapSaleItem) : row.items,
    payments: Array.isArray(row.payments) ? row.payments.map(mapPayment) : row.payments,
  };
}

export function mapInvoice(row: Row): Row {
  const sourceId = row.sourceId ?? row.saleId ?? row.purchaseId ?? row.returnId ?? null;
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    createdAt: row.createdAt ?? row.issueDate ?? null,
    partyName: row.partyName ?? row.party?.name ?? null,
    partyEmail: row.partyEmail ?? row.party?.email ?? null,
    partyPhone: row.partyPhone ?? row.party?.phone ?? null,
    partyAddress:
      row.partyAddress ??
      (row.party
        ? [row.party.address, row.party.city, row.party.country].filter(Boolean).join(', ') || null
        : null),
    branchName: row.branchName ?? row.branch?.name ?? null,
    discount: row.discount ?? row.discountTotal ?? 0,
    tax: row.tax ?? row.taxTotal ?? 0,
    amountPaid: row.amountPaid ?? row.paidTotal ?? 0,
    balance: row.balance ?? row.balanceDue ?? 0,
    notes: row.notes ?? null,
    sourceId,
    lines: Array.isArray(row.lines)
      ? row.lines.map((line: Row) => ({
          ...line,
          total: line.total ?? line.lineTotal ?? 0,
        }))
      : row.lines,
    payments: Array.isArray(row.payments) ? row.payments.map(mapPayment) : row.payments,
  };
}

export function mapJournalEntry(row: Row): Row {
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    entryDate: row.entryDate ?? row.date ?? null,
    createdByName: row.createdByName ?? personName(row.createdBy),
    reference: row.reference ?? row.referenceId ?? null,
    lines: Array.isArray(row.lines)
      ? row.lines.map((line: Row) => ({
          ...line,
          accountCode: line.accountCode ?? line.account?.code ?? null,
          accountName: line.accountName ?? line.account?.name ?? null,
        }))
      : row.lines,
  };
}

export function mapPurchase(row: Row): Row {
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    createdAt: row.createdAt ?? row.invoiceDate ?? null,
    orderDate: row.orderDate ?? row.invoiceDate ?? null,
    supplierName: row.supplierName ?? row.supplier?.name ?? null,
    branchName: row.branchName ?? row.branch?.name ?? null,
    tax: row.tax ?? row.taxTotal ?? 0,
    notes: row.notes ?? row.note ?? null,
  };
}

export function mapExpense(row: Row): Row {
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    createdAt: row.createdAt ?? row.expenseDate ?? null,
    vendor: row.vendor ?? row.payeeName ?? row.payee?.name ?? null,
    amount: row.amount ?? row.total ?? 0,
    tax: row.tax ?? row.taxTotal ?? 0,
    receiptNumber: row.receiptNumber ?? row.reference ?? null,
    notes: row.notes ?? row.note ?? null,
    branchName: row.branchName ?? row.branch?.name ?? null,
    userName: row.userName ?? personName(row.user),
  };
}

export function mapReturn(row: Row): Row {
  return {
    ...row,
    number: row.number ?? row.code ?? null,
    createdAt: row.createdAt ?? row.returnDate ?? null,
    partyName:
      row.partyName ?? row.customer?.name ?? row.supplier?.name ?? null,
    partyId: row.partyId ?? row.customerId ?? row.supplierId ?? null,
    branchName: row.branchName ?? row.branch?.name ?? null,
    reason: row.reason ?? row.note ?? null,
  };
}

export function mapProduct(row: Row): Row {
  return {
    ...row,
    categoryName: row.categoryName ?? row.category?.name ?? null,
    brandName: row.brandName ?? row.brand?.name ?? null,
    unitName: row.unitName ?? row.unit?.name ?? null,
    taxName: row.taxName ?? row.tax?.name ?? null,
    taxRate: row.taxRate ?? row.tax?.rate ?? 0,
  };
}

export function mapParty(row: Row): Row {
  return {
    ...row,
    balance: row.balance ?? row.outstandingBalance ?? 0,
  };
}

export function mapWarehouse(row: Row): Row {
  return {
    ...row,
    branchName: row.branchName ?? row.branch?.name ?? null,
  };
}

const identity = (row: Row): Row => row;

/**
 * Path-prefix registry. First match wins; more specific prefixes must come
 * first (`/accounting/journal` before any bare `/accounting` entry, of which
 * there is deliberately none — statements keep their own shapes).
 *
 * Mutation paths (`/sales/:id/void`) never reach this table: it is consulted
 * only by the GET helpers.
 */
const REGISTRY: Array<[string, (row: Row) => Row]> = [
  ['/accounting/journal', mapJournalEntry],
  ['/sales', mapSale],
  ['/invoices', mapInvoice],
  ['/purchases', mapPurchase],
  ['/expenses', mapExpense],
  ['/returns', mapReturn],
  ['/products', mapProduct],
  ['/customers', mapParty],
  ['/suppliers', mapParty],
  ['/warehouses', mapWarehouse],
];

/** Normalize one row according to the endpoint it came from. */
export function normalizeRow(path: string, row: Row): Row {
  if (!row || typeof row !== 'object') return row;
  for (const [prefix, fn] of REGISTRY) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) {
      try {
        return fn(row);
      } catch {
        return row;
      }
    }
  }
  return identity(row);
}

/** Normalize every row of a list response. */
export function normalizeRows<T>(path: string, rows: T[]): T[] {
  return rows.map((row) => normalizeRow(path, row as Row) as T);
}

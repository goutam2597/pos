import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ACCOUNT_CODES } from '../src/modules/accounting/ledger.js';
import { hashPassword } from '../src/modules/auth/service.js';
import {
  allPermissions,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  EN,
  type SystemRole,
} from '@monopos/shared';

/**
 * Seed data.
 *
 * Creates a working business: chart of accounts, roles, a branch with a till,
 * a catalog, some customers and suppliers, and an admin you can sign in with.
 *
 * Written to be IDEMPOTENT — safe to run repeatedly, because a seed that
 * duplicates your chart of accounts the second time you run it is a trap. Every
 * step either finds its row or creates it.
 *
 * This runs OUTSIDE a request context, so it writes through Prisma directly
 * rather than through services (which resolve the acting user from the request).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BUSINESS_CODE = 'DEMO';
const ADMIN_EMAIL = 'admin@monopos.test';
const ADMIN_PASSWORD = 'ChangeMe!2026';

async function main() {
  console.log('[seed] starting…');

  // -------------------------------------------------------------------------
  // Business
  // -------------------------------------------------------------------------
  const business = await prisma.business.upsert({
    where: { code: BUSINESS_CODE },
    create: {
      name: 'MonoPOS Demo Store',
      legalName: 'MonoPOS Demo Store Ltd',
      code: BUSINESS_CODE,
      email: 'hello@monopos.test',
      phone: '+1 555 0100',
      address: '1 Market Street',
      city: 'Springfield',
      country: 'US',
      timezone: 'UTC',
      currency: 'USD',
      defaultLanguage: 'en',
    },
    update: {},
  });
  console.log(`[seed] business: ${business.name}`);

  // -------------------------------------------------------------------------
  // Permissions + system roles
  // -------------------------------------------------------------------------
  const permissionRows = allPermissions().map((permission) => {
    const [resource, action] = permission.split(':') as [string, string];
    return { resource, action, description: `${action} ${resource}` };
  });

  await prisma.permission.createMany({ data: permissionRows, skipDuplicates: true });
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));
  console.log(`[seed] permissions: ${permissions.length}`);

  const ROLE_LABELS: Record<SystemRole, { name: string; description: string }> = {
    OWNER: { name: 'Owner', description: 'Full access to everything, including settings and roles' },
    ADMIN: { name: 'Administrator', description: 'Everything except system settings' },
    MANAGER: { name: 'Manager', description: 'Runs day-to-day operations across the business' },
    ACCOUNTANT: { name: 'Accountant', description: 'Accounting, invoices, payments and reports' },
    CASHIER: { name: 'Cashier', description: 'Operates the till and serves customers' },
    WAREHOUSE: { name: 'Warehouse', description: 'Receives stock and manages suppliers' },
    STOCK_CLERK: { name: 'Stock Clerk', description: 'Stock counts and adjustments' },
    VIEWER: { name: 'Viewer', description: 'Read-only access to reports' },
  };

  for (const role of SYSTEM_ROLES) {
    const slug = role.toLowerCase();
    const record = await prisma.role.upsert({
      where: { businessId_slug: { businessId: business.id, slug } },
      create: {
        businessId: business.id,
        name: ROLE_LABELS[role].name,
        slug,
        description: ROLE_LABELS[role].description,
        isSystem: true,
      },
      update: { name: ROLE_LABELS[role].name, description: ROLE_LABELS[role].description },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSIONS[role]
        .map((permission) => permissionByKey.get(permission))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: record.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`[seed] roles: ${SYSTEM_ROLES.length}`);

  // -------------------------------------------------------------------------
  // Chart of accounts
  // -------------------------------------------------------------------------
  const CHART: Array<{
    code: string;
    name: string;
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    subtype: string;
    isCash?: boolean;
  }> = [
    { code: ACCOUNT_CODES.CASH, name: 'Cash on Hand', type: 'ASSET', subtype: 'CASH', isCash: true },
    { code: ACCOUNT_CODES.BANK, name: 'Bank Account', type: 'ASSET', subtype: 'BANK' },
    { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE' },
    { code: ACCOUNT_CODES.INVENTORY, name: 'Inventory', type: 'ASSET', subtype: 'INVENTORY' },
    { code: '1300', name: 'Prepaid Expenses', type: 'ASSET', subtype: 'EXPENSE' },
    { code: ACCOUNT_CODES.FIXED_ASSET, name: 'Equipment & Fixtures', type: 'ASSET', subtype: 'FIXED_ASSET' },
    { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: 'Accounts Payable', type: 'LIABILITY', subtype: 'ACCOUNTS_PAYABLE' },
    { code: '2050', name: 'Credit Card Clearing', type: 'LIABILITY', subtype: 'CREDIT_CARD' },
    { code: ACCOUNT_CODES.TAX_PAYABLE, name: 'Sales Tax Payable', type: 'LIABILITY', subtype: 'TAX_PAYABLE' },
    { code: '2200', name: 'Payroll Liabilities', type: 'LIABILITY', subtype: 'SALARIES' },
    { code: ACCOUNT_CODES.OWNERS_EQUITY, name: "Owner's Equity", type: 'EQUITY', subtype: 'OWNERS_EQUITY' },
    { code: ACCOUNT_CODES.RETAINED_EARNINGS, name: 'Retained Earnings', type: 'EQUITY', subtype: 'RETAINED_EARNINGS' },
    { code: ACCOUNT_CODES.SALES_REVENUE, name: 'Sales Revenue', type: 'REVENUE', subtype: 'SALES_REVENUE' },
    { code: ACCOUNT_CODES.SERVICE_REVENUE, name: 'Service Revenue', type: 'REVENUE', subtype: 'SERVICE_REVENUE' },
    { code: ACCOUNT_CODES.OTHER_INCOME, name: 'Other Income', type: 'REVENUE', subtype: 'OTHER_INCOME' },
    { code: ACCOUNT_CODES.SALES_DISCOUNT, name: 'Sales Discounts', type: 'REVENUE', subtype: 'SALES_DISCOUNT' },
    { code: ACCOUNT_CODES.COGS, name: 'Cost of Goods Sold', type: 'EXPENSE', subtype: 'COGS' },
    { code: ACCOUNT_CODES.EXPENSE, name: 'General Expenses', type: 'EXPENSE', subtype: 'EXPENSE' },
    { code: ACCOUNT_CODES.RENT, name: 'Rent', type: 'EXPENSE', subtype: 'RENT' },
    { code: ACCOUNT_CODES.UTILITIES, name: 'Utilities', type: 'EXPENSE', subtype: 'UTILITIES' },
    { code: ACCOUNT_CODES.SALARIES, name: 'Salaries & Wages', type: 'EXPENSE', subtype: 'SALARIES' },
    { code: ACCOUNT_CODES.SUPPLIES, name: 'Supplies', type: 'EXPENSE', subtype: 'SUPPLIES' },
    { code: ACCOUNT_CODES.TRANSPORT, name: 'Transport & Delivery', type: 'EXPENSE', subtype: 'TRANSPORT' },
    { code: ACCOUNT_CODES.OTHER_EXPENSE, name: 'Other Expenses', type: 'EXPENSE', subtype: 'OTHER_EXPENSE' },
  ];

  for (const account of CHART) {
    await prisma.account.upsert({
      where: { businessId_code: { businessId: business.id, code: account.code } },
      create: {
        businessId: business.id,
        code: account.code,
        name: account.name,
        type: account.type,
        subtype: account.subtype as never,
        isSystem: true,
        isCash: account.isCash ?? false,
      },
      update: { name: account.name, type: account.type, subtype: account.subtype as never },
    });
  }
  console.log(`[seed] chart of accounts: ${CHART.length}`);

  // -------------------------------------------------------------------------
  // Branch, warehouses, registers
  // -------------------------------------------------------------------------
  const branch = await prisma.branch.upsert({
    where: { businessId_code: { businessId: business.id, code: 'MAIN' } },
    create: {
      businessId: business.id,
      code: 'MAIN',
      name: 'Main Street Store',
      isMain: true,
      address: '1 Market Street',
      city: 'Springfield',
      country: 'US',
      phone: '+1 555 0100',
      taxNumber: 'US-REG-001',
      trackBranchAccounting: true,
    },
    update: {},
  });

  const store = await prisma.warehouse.upsert({
    where: { businessId_code: { businessId: business.id, code: 'STORE' } },
    create: {
      businessId: business.id,
      branchId: branch.id,
      code: 'STORE',
      name: 'Main Store Floor',
      type: 'STORE',
      isRetail: true,
      address: '1 Market Street',
      city: 'Springfield',
    },
    update: {},
  });

  await prisma.warehouse.upsert({
    where: { businessId_code: { businessId: business.id, code: 'BACK' } },
    create: {
      businessId: business.id,
      branchId: branch.id,
      code: 'BACK',
      name: 'Back Stockroom',
      type: 'SUPPLY',
    },
    update: {},
  });

  const register = await prisma.register.upsert({
    where: { businessId_code: { businessId: business.id, code: 'TILL-1' } },
    create: {
      businessId: business.id,
      branchId: branch.id,
      code: 'TILL-1',
      name: 'Front Counter',
      openingFloat: 20_000,
    },
    update: {},
  });
  console.log('[seed] branch, warehouses, register');

  // -------------------------------------------------------------------------
  // Admin user
  // -------------------------------------------------------------------------
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { businessId_slug: { businessId: business.id, slug: 'owner' } },
  });

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      businessId: business.id,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      firstName: 'Store',
      lastName: 'Owner',
      locale: 'en',
      isSuperAdmin: true,
      branchIds: [branch.id],
      roles: { create: [{ roleId: ownerRole.id }] },
    },
    update: { businessId: business.id },
  });

  const cashierRole = await prisma.role.findUniqueOrThrow({
    where: { businessId_slug: { businessId: business.id, slug: 'cashier' } },
  });

  await prisma.user.upsert({
    where: { email: 'cashier@monopos.test' },
    create: {
      businessId: business.id,
      email: 'cashier@monopos.test',
      passwordHash: await hashPassword('Cashier!2026'),
      firstName: 'Casey',
      lastName: 'Cashier',
      locale: 'en',
      branchIds: [branch.id],
      roles: { create: [{ roleId: cashierRole.id }] },
    },
    update: {},
  });
  console.log(`[seed] users: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);

  // -------------------------------------------------------------------------
  // Languages (admin-managed)
  // -------------------------------------------------------------------------
  const LANGUAGES = [
    { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' as const, locale: 'en-US', isDefault: true, sortOrder: 0 },
    { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr' as const, locale: 'es-ES', isDefault: false, sortOrder: 1 },
    { code: 'fr', name: 'French', nativeName: 'Français', direction: 'ltr' as const, locale: 'fr-FR', isDefault: false, sortOrder: 2 },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' as const, locale: 'ar', isDefault: false, sortOrder: 3 },
  ];

  for (const language of LANGUAGES) {
    const record = await prisma.language.upsert({
      where: { businessId_code: { businessId: business.id, code: language.code } },
      create: { businessId: business.id, ...language },
      update: { name: language.name, nativeName: language.nativeName, direction: language.direction },
    });

    // Seed every language with the English baseline so the translation editor
    // opens complete, and isCustom stays false until a human edits a value.
    const existing = await prisma.translation.count({ where: { languageId: record.id } });
    if (existing === 0) {
      await prisma.translation.createMany({
        data: Object.entries(EN).map(([key, value]) => ({
          languageId: record.id,
          key,
          value,
          isCustom: false,
        })),
      });
    }
  }

  // A couple of real translations so RTL and language switching are visible
  // without an admin having to type anything first.
  const arabic = await prisma.language.findFirst({ where: { businessId: business.id, code: 'ar' } });
  if (arabic) {
    const AR: Record<string, string> = {
      'nav.dashboard': 'لوحة التحكم',
      'nav.pos': 'نقطة البيع',
      'nav.sales': 'المبيعات',
      'nav.products': 'المنتجات',
      'nav.customers': 'العملاء',
      'nav.inventory': 'المخزون',
      'nav.invoices': 'الفواتير',
      'nav.accounting': 'المحاسبة',
      'nav.reports': 'التقارير',
      'nav.settings': 'الإعدادات',
      'action.save': 'حفظ',
      'action.cancel': 'إلغاء',
      'action.print': 'طباعة',
      'auth.signIn': 'تسجيل الدخول',
      'auth.email': 'البريد الإلكتروني',
      'auth.password': 'كلمة المرور',
      'pos.cart': 'السلة',
      'pos.checkout': 'تحصيل',
      'pos.total': 'الإجمالي',
      'sync.title': 'المزامنة',
      'sync.pending': 'في الانتظار',
    };
    for (const [key, value] of Object.entries(AR)) {
      await prisma.translation.upsert({
        where: { languageId_key: { languageId: arabic.id, key } },
        create: { languageId: arabic.id, key, value, isCustom: true },
        update: { value, isCustom: true },
      });
    }
  }
  console.log(`[seed] languages: ${LANGUAGES.length}`);

  // -------------------------------------------------------------------------
  // Units, taxes, catalog
  // -------------------------------------------------------------------------
  const UNITS = [
    { code: 'EA', name: 'Each', plural: 'Each', conversionFactor: 1000, allowFraction: false },
    { code: 'KG', name: 'Kilogram', plural: 'Kilograms', conversionFactor: 1_000_000, allowFraction: true },
    { code: 'L', name: 'Litre', plural: 'Litres', conversionFactor: 1_000_000, allowFraction: true },
    { code: 'BOX', name: 'Box', plural: 'Boxes', conversionFactor: 12_000, allowFraction: false },
  ];
  const unitIds = new Map<string, string>();
  for (const unit of UNITS) {
    const record = await prisma.unit.upsert({
      where: { businessId_code: { businessId: business.id, code: unit.code } },
      create: { businessId: business.id, ...unit },
      update: { name: unit.name },
    });
    unitIds.set(unit.code, record.id);
  }

  const salesTax = await prisma.tax.upsert({
    where: { businessId_code: { businessId: business.id, code: 'VAT10' } },
    create: {
      businessId: business.id, name: 'Standard Rate', code: 'VAT10',
      rate: 1000, type: 'PERCENTAGE', scope: 'BOTH', isDefault: true,
    },
    update: { rate: 1000 },
  });
  const zeroTax = await prisma.tax.upsert({
    where: { businessId_code: { businessId: business.id, code: 'ZERO' } },
    create: { businessId: business.id, name: 'Zero Rated', code: 'ZERO', rate: 0, type: 'PERCENTAGE', scope: 'BOTH' },
    update: {},
  });

  const CATEGORIES = [
    { name: 'Groceries', slug: 'groceries' },
    { name: 'Beverages', slug: 'beverages' },
    { name: 'Household', slug: 'household' },
    { name: 'Personal Care', slug: 'personal-care' },
    { name: 'Bakery', slug: 'bakery' },
  ];
  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { businessId_slug: { businessId: business.id, slug: category.slug } },
      create: { businessId: business.id, name: category.name, slug: category.slug, sortOrder: 0 },
      update: { name: category.name },
    });
    categoryIds.set(category.slug, record.id);
  }

  const BRANDS = ['Natura', 'Kilo', 'Bright', 'Harvest'];
  const brandIds = new Map<string, string>();
  for (const name of BRANDS) {
    const slug = name.toLowerCase();
    const record = await prisma.brand.upsert({
      where: { businessId_slug: { businessId: business.id, slug } },
      create: { businessId: business.id, name, slug },
      update: {},
    });
    brandIds.set(slug, record.id);
  }

  // name, sku, category, brand, cost, price, unit, taxable, openingStock
  const PRODUCTS: Array<[string, string, string, string | null, number, number, string, boolean, number]> = [
    ['Organic Whole Milk 1L', 'GRO-1001', 'groceries', 'natura', 180, 299, 'EA', true, 40],
    ['Free Range Eggs (12)', 'GRO-1002', 'groceries', 'natura', 320, 549, 'EA', true, 25],
    ['Sourdough Loaf', 'BAK-1003', 'bakery', 'harvest', 150, 320, 'EA', true, 18],
    ['Ground Coffee 500g', 'BEV-1004', 'beverages', 'kilo', 620, 1150, 'EA', true, 22],
    ['Green Tea (25 bags)', 'BEV-1005', 'beverages', 'harvest', 210, 420, 'EA', true, 30],
    ['Orange Juice 1L', 'BEV-1006', 'beverages', 'bright', 190, 349, 'EA', true, 28],
    ['Sparkling Water 6-pack', 'BEV-1007', 'beverages', 'bright', 240, 450, 'EA', true, 24],
    ['Dish Soap 500ml', 'HOU-1008', 'household', 'bright', 140, 289, 'EA', true, 35],
    ['Kitchen Roll (4)', 'HOU-1009', 'household', 'bright', 260, 499, 'EA', true, 20],
    ['Laundry Powder 2kg', 'HOU-1010', 'household', 'natura', 480, 899, 'EA', true, 16],
    ['Shampoo 400ml', 'PER-1011', 'personal-care', 'natura', 210, 429, 'EA', true, 26],
    ['Toothpaste 150ml', 'PER-1012', 'personal-care', 'bright', 95, 199, 'EA', true, 44],
    ['Hand Soap 250ml', 'PER-1013', 'personal-care', 'bright', 110, 229, 'EA', true, 38],
    ['Apples (per kg)', 'PRO-1014', 'groceries', 'harvest', 120, 249, 'KG', true, 15],
    ['Bananas (per kg)', 'PRO-1015', 'groceries', 'harvest', 80, 179, 'KG', true, 12],
    ['Rice 5kg', 'PRO-1016', 'groceries', 'kilo', 420, 780, 'EA', true, 14],
  ];

  let createdProducts = 0;
  for (const [name, sku, category, brand, cost, price, unitCode, taxable, stock] of PRODUCTS) {
    const existing = await prisma.product.findUnique({
      where: { businessId_sku: { businessId: business.id, sku } },
      select: { id: true },
    });
    if (existing) continue;

    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        name,
        sku,
        type: 'SIMPLE',
        status: 'ACTIVE',
        categoryId: categoryIds.get(category)!,
        brandId: brand ? (brandIds.get(brand) ?? null) : null,
        unitId: unitIds.get(unitCode)!,
        taxId: taxable ? salesTax.id : zeroTax.id,
        price,
        costPrice: cost,
        trackInventory: true,
      },
    });

    // Opening stock, written through the same StockLevel + StockMove pair the
    // runtime uses, so the ledger and the balance agree from day one.
    await prisma.stockLevel.create({
      data: {
        businessId: business.id,
        warehouseId: store.id,
        branchId: branch.id,
        productId: product.id,
        variantId: null,
        itemKey: product.id,
        qtyOnHand: stock * 1000,
        averageCost: cost,
        lastCost: cost,
      },
    });
    await prisma.stockMove.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        warehouseId: store.id,
        productId: product.id,
        variantId: null,
        type: 'OPENING',
        referenceType: 'OPENING',
        referenceNo: 'OPENING-BALANCE',
        qtyMilli: stock * 1000,
        unitCost: cost,
        value: cost * stock,
        balanceAfterMilli: stock * 1000,
        note: 'Opening balance',
        createdById: admin.id,
      },
    });

    createdProducts += 1;
  }
  console.log(`[seed] products: ${createdProducts} created`);

  // -------------------------------------------------------------------------
  // Customers & suppliers
  // -------------------------------------------------------------------------
  const CUSTOMERS = [
    ['Regular Customer', 'RETAIL'],
    ['Wholesale Buyer Ltd', 'WHOLESALE'],
    ['VIP Member', 'VIP'],
    ['Neighbourhood Cafe', 'DISTRIBUTOR'],
  ] as const;

  for (const [index, [name, tier]] of CUSTOMERS.entries()) {
    const code = `CUS${String(index + 1).padStart(5, '0')}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await prisma.party.upsert({
      where: { businessId_code: { businessId: business.id, code } },
      create: {
        businessId: business.id,
        type: 'CUSTOMER',
        code,
        name,
        phone: `+1 555 0${100 + index}`,
        email: `${slug}@example.test`,
        customerProfile: { create: { tier } },
      },
      update: {},
    });
  }

  const SUPPLIERS = [
    ['Fresh Fields Distributors', 3],
    ['Brew & Co Wholesale', 2],
    ['Bright Home Supply', 5],
  ] as const;

  for (const [index, [name, leadTime]] of SUPPLIERS.entries()) {
    const code = `SUP${String(index + 1).padStart(5, '0')}`;

    await prisma.party.upsert({
      where: { businessId_code: { businessId: business.id, code } },
      create: {
        businessId: business.id,
        type: 'SUPPLIER',
        code,
        name,
        email: `orders@${name.toLowerCase().replace(/[^a-z]+/g, '')}.test`,
        supplierProfile: { create: { leadTimeDays: leadTime, isPreferred: leadTime === 3 } },
      },
      update: {},
    });
  }
  console.log(`[seed] customers: ${CUSTOMERS.length}, suppliers: ${SUPPLIERS.length}`);

  // -------------------------------------------------------------------------
  // Settings & numbering
  // -------------------------------------------------------------------------
  const SETTINGS: Record<string, unknown> = {
    'receipt.footer': 'Thank you for shopping with us!',
    'receipt.showTaxSummary': true,
    'receipt.header': '',
    'pos.allowCreditSale': true,
    'pos.maxLineDiscountPercent': 3000,
    'pos.requireCustomerAbove': 50_000,
    'pos.roundingMethod': 'CASH',
    'inventory.allowNegativeStock': false,
    'inventory.lowStockAlerts': true,
    'accounting.fiscalYearStartMonth': 1,
    'accounting.defaultRounding': 'HALF_UP',
  };

  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({
      where: { businessId_scopeKey_key: { businessId: business.id, scopeKey: 'GLOBAL', key } },
      create: { businessId: business.id, scopeKey: 'GLOBAL', key, value: value as never, group: 'GENERAL' },
      update: { value: value as never },
    });
  }

  const SEQUENCES = [
    { type: 'SALE', prefix: 'SALE', padding: 6 },
    { type: 'INVOICE', prefix: 'INV', padding: 6 },
    { type: 'PURCHASE', prefix: 'PUR', padding: 6 },
    { type: 'RETURN', prefix: 'RET', padding: 6 },
    { type: 'EXPENSE', prefix: 'EXP', padding: 5 },
  ];
  for (const sequence of SEQUENCES) {
    await prisma.documentSequence.upsert({
      where: { businessId_type_scopeKey: { businessId: business.id, type: sequence.type, scopeKey: 'GLOBAL' } },
      create: {
        businessId: business.id,
        scopeKey: 'GLOBAL',
        type: sequence.type,
        prefix: sequence.prefix,
        padding: sequence.padding,
        nextValue: 1,
      },
      update: {},
    });
  }
  console.log('[seed] settings and numbering');

  console.log('\n[seed] done.');
  console.log(`[seed] sign in at http://localhost:5173/login`);
  console.log(`[seed]   email:    ${ADMIN_EMAIL}`);
  console.log(`[seed]   password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('[seed] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

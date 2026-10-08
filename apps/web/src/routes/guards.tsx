import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@monopos/shared';
import { Lock } from 'lucide-react';

import { useAuth } from '../lib/auth';
import { PageFallback, Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

/**
 * Route guards and the lazy page catalogue.
 *
 * Every module page is `React.lazy` so the first paint after sign-in is the
 * login screen plus the shell, not thirty pages of JavaScript. The chunk for a
 * module is fetched when the user actually opens it.
 */

/**
 * The POS terminal is owned by a different module of this codebase and may not
 * exist in every build. The dynamic import is wrapped so a missing file
 * degrades to an honest message instead of breaking the whole bundle.
 */
const POSPage = lazy(async () => {
  try {
    return await import('../pos/POSPage');
  } catch {
    return {
      default: function POSUnavailable() {
        return (
          <div className="mx-auto w-full max-w-3xl p-6">
            <EmptyState
              icon={Lock}
              title="The till is not available in this build"
              description="The point-of-sale terminal is a separate bundle. If you are running a till build, check that it was included."
            />
          </div>
        );
      },
    };
  }
});

// --- Module pages ------------------------------------------------------------

const LoginPage = lazy(() => import('../pages/LoginPage').then((m) => ({ default: m.LoginPage })));

const DashboardPage = lazy(() => import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));

const ProductsPage = lazy(() => import('../pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));

const CategoriesPage = lazy(() => import('../pages/CatalogPages').then((m) => ({ default: m.CategoriesPage })));
const BrandsPage = lazy(() => import('../pages/CatalogPages').then((m) => ({ default: m.BrandsPage })));
const UnitsPage = lazy(() => import('../pages/CatalogPages').then((m) => ({ default: m.UnitsPage })));
const TaxesPage = lazy(() => import('../pages/CatalogPages').then((m) => ({ default: m.TaxesPage })));

const CustomersPage = lazy(() => import('../pages/PartyPages').then((m) => ({ default: m.CustomersPage })));
const SuppliersPage = lazy(() => import('../pages/PartyPages').then((m) => ({ default: m.SuppliersPage })));
const EmployeesPage = lazy(() => import('../pages/PartyPages').then((m) => ({ default: m.EmployeesPage })));

const SalesPage = lazy(() => import('../pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const SaleDetailPage = lazy(() => import('../pages/InvoicePages').then((m) => ({ default: m.SaleDetailPage })));
const InvoicesPage = lazy(() => import('../pages/InvoicePages').then((m) => ({ default: m.InvoicesPage })));
const InvoicePage = lazy(() => import('../pages/InvoicePages').then((m) => ({ default: m.InvoicePage })));

const PurchasesPage = lazy(() => import('../pages/PurchasingPages').then((m) => ({ default: m.PurchasesPage })));
const ReturnsPage = lazy(() => import('../pages/PurchasingPages').then((m) => ({ default: m.ReturnsPage })));
const ExpensesPage = lazy(() => import('../pages/PurchasingPages').then((m) => ({ default: m.ExpensesPage })));

const InventoryPage = lazy(() => import('../pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));

const AccountsPage = lazy(() => import('../pages/AccountingPages').then((m) => ({ default: m.AccountsPage })));
const JournalPage = lazy(() => import('../pages/AccountingPages').then((m) => ({ default: m.JournalPage })));
const TrialBalancePage = lazy(() => import('../pages/AccountingPages').then((m) => ({ default: m.TrialBalancePage })));
const ProfitLossPage = lazy(() => import('../pages/AccountingPages').then((m) => ({ default: m.ProfitLossPage })));
const LedgerPage = lazy(() => import('../pages/AccountingPages').then((m) => ({ default: m.LedgerPage })));

const ReportsIndexPage = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ReportsIndexPage })));
const SalesSummaryReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.SalesSummaryReport })));
const ProfitabilityReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ProfitabilityReport })));
const InventoryValuationReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.InventoryValuationReport })));
const TaxSummaryReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.TaxSummaryReport })));
const CashPositionReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.CashPositionReport })));
const CustomerBalancesReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.CustomerBalancesReport })));
const SupplierBalancesReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.SupplierBalancesReport })));
const ExpenseBreakdownReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ExpenseBreakdownReport })));
const ShiftHistoryReport = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ShiftHistoryReport })));

const BranchesPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.BranchesPage })));
const WarehousesPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.WarehousesPage })));
const RegistersPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.RegistersPage })));
const UsersPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.RolesPage })));
const AuditPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.AuditPage })));
const SyncPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SyncPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const LanguagesPage = lazy(() => import('../pages/LanguagesPage').then((m) => ({ default: m.LanguagesPage })));

const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

// --- Guards ------------------------------------------------------------------

/**
 * Require a signed-in user.
 *
 * The intended destination travels in location state so signing in continues
 * where the user was trying to go, rather than always dumping them on the
 * dashboard.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner label="Restoring your session" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

/**
 * Require a permission.
 *
 * The server is the real authority; this guard exists so a user who cannot open
 * a module is told so plainly instead of watching an empty table load forever.
 */
export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: Permission;
  anyOf?: Permission[];
  children: ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = anyOf ? canAny(...anyOf) : permission ? can(permission) : true;

  if (allowed) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <EmptyState
        icon={Lock}
        title="You do not have access to this page"
        description="Ask the business owner to grant you the permission this screen needs. It is listed under Roles."
      />
    </div>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-2 bg-[var(--bg-canvas)] text-[13px] text-[var(--text-tertiary)]">
      <Spinner size={18} />
      <span>{label ?? 'Loading'}</span>
    </div>
  );
}

/** Wrap a lazy page so a chunk download never blanks the shell. */
export function PageBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

/** 404. Also the destination for any route the shell does not own. */
export { NotFoundPage };

export const lazyPages = {
  POSPage,
  LoginPage,
  DashboardPage,
  ProductsPage,
  CategoriesPage,
  BrandsPage,
  UnitsPage,
  TaxesPage,
  CustomersPage,
  SuppliersPage,
  EmployeesPage,
  SalesPage,
  SaleDetailPage,
  InvoicesPage,
  InvoicePage,
  PurchasesPage,
  ReturnsPage,
  ExpensesPage,
  InventoryPage,
  AccountsPage,
  JournalPage,
  TrialBalancePage,
  ProfitLossPage,
  LedgerPage,
  ReportsIndexPage,
  SalesSummaryReport,
  ProfitabilityReport,
  InventoryValuationReport,
  TaxSummaryReport,
  CashPositionReport,
  CustomerBalancesReport,
  SupplierBalancesReport,
  ExpenseBreakdownReport,
  ShiftHistoryReport,
  BranchesPage,
  WarehousesPage,
  RegistersPage,
  UsersPage,
  RolesPage,
  AuditPage,
  SyncPage,
  SettingsPage,
  LanguagesPage,
  NotFoundPage,
} satisfies Record<string, ComponentType>;


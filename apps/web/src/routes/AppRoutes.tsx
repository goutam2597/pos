import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/shell/AppShell';
import { PageBoundary, RequireAuth, RequirePermission, lazyPages } from './guards';

/**
 * Route table.
 *
 * The route tree mirrors the navigation in `lib/routes.ts` exactly, and each
 * leaf declares the permission that unlocks it. A route with no permission is
 * reachable by anyone signed in — used only for the dashboard and detail pages
 * whose access is implied by their parent list.
 */
export function AppRoutes() {
  const {
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
  } = lazyPages;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/*
        The till is its own surface: no shell, no sidebar — a cashier's screen
        is not an admin page. Mounted outside the AppShell layout so it owns
        the whole viewport, and opened in its own browser tab from the sidebar.
      */}
      <Route
        path="/pos"
        element={
          <RequireAuth>
            <PageBoundary>
              <RequirePermission permission="pos:view">
                <POSPage />
              </RequirePermission>
            </PageBoundary>
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* --- Selling --- */}
        <Route
          path="/"
          element={
            <PageBoundary>
              <RequirePermission permission="dashboard:view">
                <DashboardPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/sales"
          element={
            <PageBoundary>
              <RequirePermission permission="sale:view">
                <SalesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/sales/:id"
          element={
            <PageBoundary>
              <RequirePermission permission="sale:view">
                <SaleDetailPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/invoices"
          element={
            <PageBoundary>
              <RequirePermission permission="invoice:view">
                <InvoicesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/invoices/:id"
          element={
            <PageBoundary>
              <RequirePermission permission="invoice:view">
                <InvoicePage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/payments"
          element={
            <PageBoundary>
              <RequirePermission permission="payment:view">
                <SalesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/returns"
          element={
            <PageBoundary>
              <RequirePermission permission="return:view">
                <ReturnsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />

        {/* --- Buying --- */}
        <Route
          path="/purchases"
          element={
            <PageBoundary>
              <RequirePermission permission="purchase:view">
                <PurchasesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/suppliers"
          element={
            <PageBoundary>
              <RequirePermission permission="supplier:view">
                <SuppliersPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/expenses"
          element={
            <PageBoundary>
              <RequirePermission permission="expense:view">
                <ExpensesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />

        {/* --- Stock --- */}
        <Route
          path="/inventory"
          element={
            <PageBoundary>
              <RequirePermission permission="inventory:view">
                <InventoryPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/products"
          element={
            <PageBoundary>
              <RequirePermission permission="product:view">
                <ProductsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/products/:id"
          element={
            <PageBoundary>
              <RequirePermission permission="product:view">
                <ProductsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/categories"
          element={
            <PageBoundary>
              <RequirePermission permission="category:view">
                <CategoriesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/brands"
          element={
            <PageBoundary>
              <RequirePermission permission="brand:view">
                <BrandsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/units"
          element={
            <PageBoundary>
              <RequirePermission permission="product:view">
                <UnitsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/warehouses"
          element={
            <PageBoundary>
              <RequirePermission permission="warehouse:view">
                <WarehousesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />

        {/* --- Money --- */}
        <Route
          path="/taxes"
          element={
            <PageBoundary>
              <RequirePermission permission="tax:view">
                <TaxesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting"
          element={<Navigate to="/accounting/accounts" replace />}
        />
        <Route
          path="/accounting/accounts"
          element={
            <PageBoundary>
              <RequirePermission anyOf={['account:view', 'account:manage']}>
                <AccountsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting/journal"
          element={
            <PageBoundary>
              <RequirePermission permission="journal:view">
                <JournalPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting/trial-balance"
          element={
            <PageBoundary>
              <RequirePermission permission="ledger:view">
                <TrialBalancePage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting/profit-loss"
          element={
            <PageBoundary>
              <RequirePermission permission="ledger:view">
                <ProfitLossPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting/ledger"
          element={
            <PageBoundary>
              <RequirePermission permission="ledger:view">
                <LedgerPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/accounting/ledger/:accountId"
          element={
            <PageBoundary>
              <RequirePermission permission="ledger:view">
                <LedgerPage />
              </RequirePermission>
            </PageBoundary>
          }
        />

        <Route
          path="/reports"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <ReportsIndexPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/sales"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <SalesSummaryReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/profitability"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <ProfitabilityReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/inventory-valuation"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <InventoryValuationReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/tax-summary"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <TaxSummaryReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/cash-position"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <CashPositionReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/customer-balances"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <CustomerBalancesReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/supplier-balances"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <SupplierBalancesReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/expense-breakdown"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <ExpenseBreakdownReport />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/reports/shift-history"
          element={
            <PageBoundary>
              <RequirePermission permission="report:view">
                <ShiftHistoryReport />
              </RequirePermission>
            </PageBoundary>
          }
        />

        {/* --- People --- */}
        <Route
          path="/customers"
          element={
            <PageBoundary>
              <RequirePermission permission="customer:view">
                <CustomersPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/employees"
          element={
            <PageBoundary>
              <RequirePermission permission="employee:view">
                <EmployeesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />

        {/* --- Manage --- */}
        <Route
          path="/branches"
          element={
            <PageBoundary>
              <RequirePermission permission="branch:view">
                <BranchesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/registers"
          element={
            <PageBoundary>
              <RequirePermission permission="register:view">
                <RegistersPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/users"
          element={
            <PageBoundary>
              <RequirePermission permission="user:view">
                <UsersPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/roles"
          element={
            <PageBoundary>
              <RequirePermission permission="role:view">
                <RolesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/languages"
          element={
            <PageBoundary>
              <RequirePermission permission="i18n:view">
                <LanguagesPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        <Route
          path="/audit"
          element={
            <PageBoundary>
              <AuditPage />
            </PageBoundary>
          }
        />
        <Route
          path="/sync"
          element={
            <PageBoundary>
              <SyncPage />
            </PageBoundary>
          }
        />
        <Route
          path="/settings"
          element={
            <PageBoundary>
              <RequirePermission anyOf={['setting:view', 'setting:manage']}>
                <SettingsPage />
              </RequirePermission>
            </PageBoundary>
          }
        />
        {/* Anything the shell does not own, including a stale deep link. Inside
            the shell route so an anonymous visitor is still sent to sign-in. */}
        <Route
          path="*"
          element={
            <PageBoundary>
              <NotFoundPage />
            </PageBoundary>
          }
        />
      </Route>
    </Routes>
  );
}

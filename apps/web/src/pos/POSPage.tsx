/**
 * The POS terminal.
 *
 * Structure: a permanent sync bar on top, a shortcut bar on the bottom, and
 * exactly two working columns in between — products on the start side, the cart
 * on the end side. Everything else is a modal that the cashier opens when they
 * mean to, because a screen full of panels is a screen where the total is
 * harder to find than the product list.
 *
 * THE ONE INVARIANT THIS PAGE ENFORCES: the "Charge" button never talks to the
 * network. It calls `captureSale`, which writes to IndexedDB and returns. The
 * sync engine is a background concern that this page merely nudges. That is why
 * the page is identical whether the connection is up, down, or flapping.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard, Store } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth';
import { db, getMeta, setMeta, type LocalHold } from '../lib/db';
import { money } from '../lib/format';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';
import { scanBeepError, scanBeepOk } from '../lib/posAudio';
import {
  captureSale,
  closeShift,
  createQuickCustomer,
  expectedCash as computeExpectedCash,
  listHolds,
  loadShift,
  openShift,
  parkCart,
  parsePayments,
  readHold,
  recordCashDrop,
  releaseHold,
  type QuickCustomerInput,
  type ShiftState,
} from '../lib/offline/capture';
import { configureSyncEngine, startSyncEngine, stopSyncEngine, triggerSync } from '../lib/offline/syncEngine';
import { useSyncStatus } from '../lib/offline/useSyncStatus';
import { CartPanel } from '../components/pos/CartPanel';
import { CameraScanner } from '../components/pos/CameraScanner';
import { CustomerPicker, type CustomerOption, type QuickCustomerDraft } from '../components/pos/CustomerPicker';
import { HoldPanel } from '../components/pos/HoldPanel';
import { PaymentModal } from '../components/pos/PaymentModal';
import { ProductGrid } from '../components/pos/ProductGrid';
import { ReceiptModal } from '../components/pos/ReceiptView';
import { ShiftButton, ShiftPanel } from '../components/pos/ShiftPanel';
import { ShortcutBar } from '../components/pos/ShortcutBar';
import { SyncIssuesPanel } from '../components/pos/SyncIssuesPanel';
import { SyncStatusBar } from '../components/pos/SyncStatusBar';
import { Badge, Button, CONTROL_H, Select } from '../components/pos/ui';
import { priceCart } from '../lib/offline/pricing';
import type { CartLine, PaymentDraft, ProductView, ReceiptView, ScanOutcome, ShiftSummaryView } from './types';
import { useCart } from './useCart';
import { findProductByCode, useCustomers, usePosCatalog } from './usePosCatalog';
import { useScanner } from './useScanner';

export default function POSPage() {
  const t = useT();
  const { api, branchId, setBranchId, user, business } = useAuth();
  const status = useSyncStatus();

  const cart = useCart();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [catalogToken, setCatalogToken] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);

  const [registerId, setRegisterId] = useState<string | null>(null);
  const [allowCredit, setAllowCredit] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [holds, setHolds] = useState<LocalHold[]>([]);
  const [holdsLoading, setHoldsLoading] = useState(false);
  const [shift, setShift] = useState<ShiftState | null>(null);
  const [shiftExpected, setShiftExpected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const totalRef = useRef<HTMLDivElement | null>(null);

  const catalog = usePosCatalog(query, categoryId, catalogToken);
  const customers = useCustomers(catalogToken);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? null;

  // ---------------------------------------------------------------------------
  // Engine wiring. Configure before start so the first drain has credentials.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void getMeta<string | null>('pos.registerId', null).then(setRegisterId);
  }, []);

  // The till cannot take a sale without a branch, so the picker must always
  // have options — and a stale stored branch (a branch since deleted) must
  // heal to a real one rather than leaving the till permanently unable to
  // charge. Auto-selects the main branch when none is chosen.
  useEffect(() => {
    let cancelled = false;
    void api
      .get<Array<{ id: string; name: string; isMain: boolean; isActive: boolean }>>('/branches', { pageSize: 100 })
      .then((rows) => {
        if (cancelled) return;
        setBranches(rows.filter((b) => b.isActive !== false).map((b) => ({ id: b.id, name: b.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (branches.length === 0) return;
    if (!branchId || !branches.some((b) => b.id === branchId)) {
      setBranchId(branches[0]!.id);
    }
  }, [branches, branchId, setBranchId]);

  // Shifts and cash events are keyed to a register server-side, and nothing
  // else ever chooses one for this terminal — so pick the branch's first
  // register automatically and remember it. A stored register that no longer
  // exists heals to a live one the same way the branch does.
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    void api
      .get<Array<{ id: string; isActive: boolean }>>('/registers', { branchId })
      .then((rows) => {
        if (cancelled) return;
        const live = rows.filter((r) => r.isActive !== false);
        if (live.length === 0) return;
        void getMeta<string | null>('pos.registerId', null).then((stored) => {
          if (cancelled) return;
          if (stored && live.some((r) => r.id === stored)) return;
          void setMeta('pos.registerId', live[0]!.id);
          setRegisterId(live[0]!.id);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, branchId]);

  useEffect(() => {
    configureSyncEngine({
      api,
      getBranchId: () => branchId,
      getRegisterId: () => registerId,
    });
    void startSyncEngine();
    return () => stopSyncEngine();
  }, [api, branchId, registerId]);

  const refreshCatalog = useCallback(() => setCatalogToken((token) => token + 1), []);

  const refreshHolds = useCallback(async () => {
    if (!branchId) return;
    setHoldsLoading(true);
    try {
      setHolds(await listHolds(branchId));
    } finally {
      setHoldsLoading(false);
    }
  }, [branchId]);

  const refreshShift = useCallback(async () => {
    const current = await loadShift();
    setShift(current);
    setShiftExpected(current ? await computeExpectedCash(current) : 0);
  }, []);

  useEffect(() => {
    void refreshHolds();
    void refreshShift();
  }, [refreshHolds, refreshShift, catalogToken]);

  // A completed drain means the server's catalog just changed under us.
  useEffect(() => {
    if (status.lastSyncedAt) refreshCatalog();
  }, [status.lastSyncedAt, refreshCatalog]);

  // The receipt stays open while the sale it describes is still syncing, so the
  // real invoice number replaces the local ref the moment it arrives. This is
  // event-driven off the engine, never a poll.
  useEffect(() => {
    if (!receipt || receipt.code !== null) return;
    if (status.synced === 0 && status.lastSyncedAt === null) return;
    let cancelled = false;
    void db.sales.get(receipt.saleId).then((sale) => {
      if (cancelled || !sale) return;
      setReceipt((current) =>
        current && current.saleId === sale.clientTxnId && sale.serverCode
          ? { ...current, code: sale.serverCode, syncState: sale.state }
          : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [status.synced, status.lastSyncedAt, receipt]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const addProduct = useCallback(
    (product: ProductView) => {
      const isNew = !cart.lines.some((line) => line.productId === product.id && line.variantId === null);
      cart.addProduct(product, 1000);
      // Select what was just added, so the +/- and Delete keys act on it.
      if (isNew) setSelectedIndex(cart.lines.length);
      setFlashId(product.id);
      window.setTimeout(() => setFlashId(null), 900);
    },
    [cart],
  );

  const addFromQuery = useCallback(() => {
    const first = catalog.products[0];
    if (!first) return;
    addProduct(first);
    setQuery('');
    searchRef.current?.focus();
  }, [catalog.products, addProduct]);

  // ---------------------------------------------------------------------------
  // Scanning. One lookup serves both the keyboard wedge (a USB scanner "types"
  // into whatever has focus — useScanner recognises it by timing) and the
  // camera scanner, so a code means the same product and the same beep either
  // way. Exact match only: a till that guesses sells the wrong item silently.
  // ---------------------------------------------------------------------------

  const handleScan = useCallback(
    async (code: string): Promise<ScanOutcome> => {
      let product: ProductView | null = null;
      try {
        product = await findProductByCode(code);
      } catch {
        product = null;
      }
      if (!product) {
        scanBeepError();
        toast.error(`No product for code ${code}`, {
          description: 'The barcode is not in the catalogue. Set it in Products, or add the item by hand.',
        });
        return { status: 'unknown', code };
      }
      // A scan on the receipt means the cashier has already started the next
      // basket — clear the old one out of the way first.
      if (receiptOpen) {
        setReceiptOpen(false);
        setReceipt(null);
      }
      addProduct(product);
      setQuery('');
      if (!scannerOpen) searchRef.current?.focus();
      scanBeepOk();
      return { status: 'added', product };
    },
    [addProduct, receiptOpen, scannerOpen],
  );

  // Scanning is a floor activity: off whenever a modal owns the flow (a scan
  // must never change the total under an open tender). The receipt is not a
  // gate — scanning past it is the normal next-customer motion.
  const scanEnabled = !paymentOpen && !customerOpen && !holdOpen && !shiftOpen && !issuesOpen;
  useScanner({ enabled: scanEnabled, onScan: handleScan });

  const openPayment = useCallback(() => {
    if (cart.lines.length === 0) return;
    setPayError(null);
    setPaymentOpen(true);
  }, [cart.lines.length]);

  const focusTotal = useCallback(() => {
    totalRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const handleCharge = useCallback(
    async (payments: PaymentDraft[], creditAllowed: boolean) => {
      if (!branchId) {
        setPayError('No branch is selected. Choose a branch before taking a sale.');
        return;
      }
      setBusy(true);
      setPayError(null);
      try {
        const { sale, priced } = await captureSale(
          {
            lines: cart.lines,
            payments,
            cartDiscount: cart.cartDiscount,
            allowCredit: creditAllowed,
          },
          {
            branchId,
            registerId,
            customerId: cart.customerId,
            shiftId: shift ? shift.clientId : null,
            cashierName: user ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
          },
        );

        const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
        setReceipt({
          saleId: sale.clientTxnId,
          code: sale.serverCode,
          occurredAt: sale.occurredAt,
          cashierName: sale.cashierName,
          syncState: sale.state,
          lines: priced.lines.map((line) => ({
            name: line.name,
            qtyMilli: line.qtyMilli,
            unitPrice: line.unitPrice,
            discountType: line.discountType,
            discountValue: line.discountValue,
            total: line.total,
          })),
          payments: parsePayments(sale.paymentsJson).map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference ?? null,
          })),
          subtotal: priced.grossSubtotal,
          discountTotal: priced.discountTotal,
          taxTotal: priced.taxTotal,
          total: priced.total,
          change: Math.max(0, paid - priced.total),
          note: sale.note,
        });

        setPaymentOpen(false);
        setReceiptOpen(true);
        cart.clear();
        setSelectedIndex(0);
        refreshCatalog();
        void refreshShift();
      } catch (error) {
        setPayError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [branchId, cart, registerId, shift, user, refreshCatalog, refreshShift],
  );

  const handleHold = useCallback(async () => {
    if (!branchId || cart.lines.length === 0) return;
    setBusy(true);
    try {
      await parkCart(
        { lines: cart.lines, cartDiscount: cart.cartDiscount, customerId: cart.customerId },
        cart.customerName ? `Hold — ${cart.customerName}` : `Hold — ${new Date().toLocaleTimeString()}`,
        { branchId, registerId },
      );
      cart.clear();
      setSelectedIndex(0);
      await refreshHolds();
    } finally {
      setBusy(false);
    }
  }, [branchId, cart, registerId, refreshHolds]);

  const handleResumeHold = useCallback(
    (hold: LocalHold) => {
      const parsed = readHold(hold);
      if (!parsed) return;
      const customer = customers.find((entry) => entry.id === parsed.customerId);
      cart.resume(parsed.lines as CartLine[], parsed.cartDiscount, parsed.customerId, customer?.name ?? null);
      setSelectedIndex(0);
      setHoldOpen(false);
      searchRef.current?.focus();
    },
    [cart, customers],
  );

  const handleReleaseHold = useCallback(
    async (hold: LocalHold) => {
      if (!branchId) return;
      await releaseHold(hold, { branchId, registerId });
      await refreshHolds();
    },
    [branchId, registerId, refreshHolds],
  );

  const handleSelectCustomer = useCallback(
    (customer: CustomerOption) => {
      cart.setCustomer(customer.id, customer.name, customer.pendingSync === true);
      setCustomerOpen(false);
      searchRef.current?.focus();
    },
    [cart],
  );

  const handleCreateCustomer = useCallback(
    async (draft: QuickCustomerDraft) => {
      if (!branchId) throw new Error('No branch is selected');
      const input: QuickCustomerInput = { name: draft.name, phone: draft.phone, email: draft.email };
      const { customer } = await createQuickCustomer(input, { branchId, registerId });
      cart.setCustomer(customer.id, customer.name, true);
      refreshCatalog();
    },
    [branchId, registerId, cart, refreshCatalog],
  );

  const shiftSummary: ShiftSummaryView | null = useMemo(() => {
    if (!shift || shift.closedAt !== null) return null;
    return {
      openingFloat: shift.openingFloat,
      expectedCash: shiftExpected,
      countedCash: 0,
      dropped: shift.dropped,
      openedAt: shift.openedAt,
      variance: 0,
    };
  }, [shift, shiftExpected]);

  const handleOpenShift = useCallback(
    async (openingFloat: number) => {
      if (!branchId) throw new Error('No branch is selected');
      await openShift(openingFloat, {
        branchId,
        registerId,
        cashierName: user ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
      });
      await refreshShift();
    },
    [branchId, registerId, user, refreshShift],
  );

  const handleCloseShift = useCallback(
    async (counted: number) => {
      if (!branchId) throw new Error('No branch is selected');
      await closeShift(counted, {
        branchId,
        registerId,
        cashierName: user ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
      });
      await refreshShift();
      setShiftOpen(false);
    },
    [branchId, registerId, user, refreshShift],
  );

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTypingTarget(event.target);

      // Esc always works — a cashier must never be trapped in a modal.
      if (event.key === 'Escape') {
        if (paymentOpen) setPaymentOpen(false);
        else if (customerOpen) setCustomerOpen(false);
        else if (holdOpen) setHoldOpen(false);
        else if (shiftOpen) setShiftOpen(false);
        else if (issuesOpen) setIssuesOpen(false);
        else if (query !== '') setQuery('');
        else if (cart.lines.length > 0) {
          cart.clear();
          setSelectedIndex(0);
        }
        return;
      }

      // Function keys are global: they must work with the mouse anywhere,
      // including while focus sits in a text field.
      switch (event.key) {
        case 'F1':
        case 'F2':
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        case 'F3':
          event.preventDefault();
          focusTotal();
          return;
        case 'F4':
          event.preventDefault();
          setCustomerOpen(true);
          return;
        case 'F8':
          event.preventDefault();
          void handleHold();
          return;
        case 'F9':
          event.preventDefault();
          openPayment();
          return;
        case 'F10':
          event.preventDefault();
          focusTotal();
          return;
      // F11 is deliberately NOT handled here: the browser's native fullscreen
      // is exactly what a till wants, and it only works if the page does not
      // intercept the key. (The old binding used F11 for "sync now" — sync has
      // its own button and F12-adjacent shortcut instead.)
        case 'F12':
          event.preventDefault();
          setShiftOpen(true);
          return;
        default:
          break;
      }

      if (typing) return;
      if (paymentOpen || customerOpen || holdOpen || shiftOpen || issuesOpen) return;

      const line = cart.lines[Math.min(selectedIndex, cart.lines.length - 1)];

      switch (event.key) {
        case 'ArrowDown':
          if (cart.lines.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => Math.min(index + 1, cart.lines.length - 1));
          }
          return;
        case 'ArrowUp':
          if (cart.lines.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => Math.max(index - 1, 0));
          }
          return;
        case 'Enter':
          event.preventDefault();
          openPayment();
          return;
        case '+':
        case '=':
          if (line) {
            event.preventDefault();
            cart.stepQty(line.lineId, 1000);
          }
          return;
        case '-':
        case '_':
          if (line) {
            event.preventDefault();
            cart.stepQty(line.lineId, -1000);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (line) {
            event.preventDefault();
            cart.removeLine(line.lineId);
            setSelectedIndex((index) => Math.max(0, Math.min(index, cart.lines.length - 2)));
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    cart,
    focusTotal,
    handleHold,
    issuesOpen,
    customerOpen,
    holdOpen,
    openPayment,
    paymentOpen,
    query,
    selectedIndex,
    shiftOpen,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const describeHold = useCallback(
    (hold: LocalHold) => {
      const parsed = readHold(hold);
      if (!parsed) return { items: 0, total: money(0) };
      const priced = priceCart(parsed.lines, parsed.cartDiscount);
      return { items: priced.lineCount, total: money(priced.total) };
    },
    [],
  );

  const customerOptions: CustomerOption[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    pendingSync: customer.id.startsWith('pos-'),
  }));

  return (
    <div className="no-print flex h-dvh min-h-0 flex-col bg-[var(--bg-canvas)]">
      <header className="no-print flex items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2">
        <Store size={18} strokeWidth={1.75} className="text-[var(--accent-text)]" />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{business?.name ?? t('app.name')}</h1>
          <p className="truncate text-[11px] text-[var(--text-tertiary)]">
            {branchName ? `${branchName} · ` : 'No branch selected · '}
            {user?.email ?? ''}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {status.backlogged ? <Badge tone="warning">Queue is backing up</Badge> : null}

          {/* The till runs in its own tab; the admin lives in another one. */}
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Open the admin dashboard in a new tab"
            className="flex size-[var(--height-control)] items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]"
          >
            <LayoutDashboard size={16} strokeWidth={1.75} aria-hidden="true" />
          </a>

          {branches.length > 0 ? (
            <Select
              value={branchId ?? ''}
              onChange={(event) => setBranchId(event.target.value || null)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select branch"
              className="w-44"
            />
          ) : null}

          <label
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-2 text-[12px] text-[var(--text-secondary)]',
              CONTROL_H,
            )}
          >
            <input
              type="checkbox"
              checked={allowCredit}
              onChange={(event) => setAllowCredit(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Credit allowed
          </label>

          <Button size="sm" variant="secondary" onClick={() => setHoldOpen(true)}>
            {t('pos.held')} ({holds.length})
          </Button>

          <ShiftButton summary={shiftSummary} onOpen={() => setShiftOpen(true)} label="Shift" />
        </div>
      </header>

      <SyncStatusBar onOpenIssues={() => setIssuesOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <ProductGrid
            products={catalog.products}
            categories={catalog.categories}
            catalogEmpty={catalog.catalogEmpty}
            loading={catalog.loading}
            query={query}
            onQueryChange={setQuery}
            onQuerySubmit={addFromQuery}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            onSelect={addProduct}
            searchRef={searchRef}
            flashId={flashId}
            onSyncNow={triggerSync}
            onOpenScanner={() => setScannerOpen(true)}
          />
        </div>

        <div ref={totalRef} className="flex min-h-0">
          <CartPanel
            lines={cart.lines}
            priced={cart.priced}
            cartDiscount={cart.cartDiscount}
            selectedIndex={selectedIndex}
            onSelectLine={setSelectedIndex}
            onStepQty={cart.stepQty}
            onSetQty={cart.setQty}
            onRemoveLine={cart.removeLine}
            onSetLineDiscount={cart.setLineDiscount}
            onSetCartDiscount={cart.setCartDiscount}
            customerName={cart.customerName}
            customerPendingSync={cart.customerPendingSync}
            onPickCustomer={() => setCustomerOpen(true)}
            onHold={() => void handleHold()}
            onCharge={openPayment}
          />
        </div>
      </div>

      <ShortcutBar />

      <PaymentModal
        open={paymentOpen}
        total={cart.priced.total}
        allowCredit={allowCredit}
        busy={busy}
        error={payError}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(payments, credit) => void handleCharge(payments, credit)}
      />

      <CustomerPicker
        open={customerOpen}
        customers={customerOptions}
        loading={catalog.loading}
        onSelect={handleSelectCustomer}
        onClear={() => {
          cart.setCustomer(null, null, false);
          setCustomerOpen(false);
        }}
        onCreate={handleCreateCustomer}
        onClose={() => setCustomerOpen(false)}
      />

      <HoldPanel
        open={holdOpen}
        holds={holds}
        loading={holdsLoading}
        describe={describeHold}
        onResume={handleResumeHold}
        onRelease={(hold) => void handleReleaseHold(hold)}
        onClose={() => setHoldOpen(false)}
      />

      <ShiftPanel
        open={shiftOpen}
        summary={shiftSummary}
        busy={busy}
        onOpen={handleOpenShift}
        onDrop={async (amount, reason) => {
          if (!branchId) throw new Error('No branch is selected');
          await recordCashDrop(amount, reason, { branchId, registerId });
          await refreshShift();
        }}
        onClose={handleCloseShift}
        onDismiss={() => setShiftOpen(false)}
      />

      <ReceiptModal
        open={receiptOpen}
        receipt={receipt}
        businessName={business?.name ?? null}
        onNewSale={() => {
          setReceiptOpen(false);
          setReceipt(null);
          setQuery('');
          searchRef.current?.focus();
        }}
        onClose={() => setReceiptOpen(false)}
      />

      <CameraScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      <SyncIssuesPanel open={issuesOpen} onClose={() => setIssuesOpen(false)} refreshToken={catalogToken} />
    </div>
  );
}

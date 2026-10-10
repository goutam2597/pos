/**
 * Cart panel — the right half of the till, and the only thing on screen that
 * the cashier must never have to reason about.
 *
 * Design rules that come from real counters:
 *   * The TOTAL is the largest number in the entire layout. Everything else is
 *     smaller. A cashier reads the total, not the tax line.
 *   * Quantities are stepped with buttons, not a keypad, because the common
 *     case is "one more" and typing a quantity is a slower path to the same
 *     result.
 *   * Removing a line asks once, then never again. A confirmation dialog on
 *     every void would cost more time than it saves.
 *   * The panel is a fixed width. Lines wrap; the column does not.
 */

import { useState } from 'react';
import { Minus, Percent, Plus, Trash2, User } from 'lucide-react';
import { amountInputValue, money, parseAmountInput, qty } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { CartDiscount, PricedCart } from '../../lib/offline/pricing';
import type { CartLine, DiscountType } from '../../pos/types';
import { Badge, Button, Divider, EmptyState, Field, IconButton, Input, Modal, MoneyRow, Select, cx } from './ui';

export interface CartPanelProps {
  lines: CartLine[];
  priced: PricedCart;
  cartDiscount: CartDiscount;
  selectedIndex: number;
  onSelectLine: (index: number) => void;
  onStepQty: (lineId: string, deltaMilli: number) => void;
  onSetQty: (lineId: string, qtyMilli: number) => void;
  onRemoveLine: (lineId: string) => void;
  onSetLineDiscount: (lineId: string, type: DiscountType, value: number) => void;
  onSetCartDiscount: (discount: CartDiscount) => void;
  customerName: string | null;
  customerPendingSync: boolean;
  onPickCustomer: () => void;
  onHold: () => void;
  onCharge: () => void;
}

export function CartPanel(props: CartPanelProps) {
  const t = useT();
  const {
    lines,
    priced,
    cartDiscount,
    selectedIndex,
    onSelectLine,
    onStepQty,
    onSetQty,
    onRemoveLine,
    onSetLineDiscount,
    onSetCartDiscount,
    customerName,
    customerPendingSync,
    onPickCustomer,
    onHold,
    onCharge,
  } = props;

  const [discountLineId, setDiscountLineId] = useState<string | null>(null);
  const [cartDiscountOpen, setCartDiscountOpen] = useState(false);

  const total = priced.total;
  const canCharge = lines.length > 0 && total >= 0;

  return (
    <aside className="no-print flex h-full w-[26rem] shrink-0 flex-col border-s border-[var(--border-default)] bg-[var(--bg-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <button
          type="button"
          onClick={onPickCustomer}
          className={cx(
            'flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border px-2',
            'h-[var(--height-control)] text-[12px] transition-colors',
            customerName
              ? 'border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-primary)]'
              : 'border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)] hover:bg-[var(--bg-sunken)]',
          )}
        >
          <User size={14} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{customerName ?? 'Walk-in customer  (F4)'}</span>
          {customerPendingSync ? <Badge tone="warning">Not yet synced</Badge> : null}
        </button>
        <Button size="sm" variant="secondary" onClick={onHold} disabled={lines.length === 0} title="Park this sale (F8)">
          {t('pos.hold')}
        </Button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <EmptyState
            title={t('pos.emptyCart')}
            description="Scan a barcode or pick a product to begin. Everything you enter is kept on this terminal, so the till works with no connection."
          />
        ) : (
          <ul className="flex flex-col">
            {lines.map((line, index) => {
              const pricedLine = priced.lines[index];
              const selected = index === selectedIndex;
              const low = line.trackInventory && line.qtyMilli > line.qtyOnHand && !line.allowNegativeStock;

              return (
                <li
                  key={line.lineId}
                  className={cx(
                    'flex flex-col gap-1 border-b border-[var(--border-subtle)] px-3 py-2',
                    selected && 'bg-[var(--accent-subtle)]',
                  )}
                  onClick={() => onSelectLine(index)}
                >
                  <div className="flex items-start gap-2">
                    <span className="tabular mt-0.5 w-4 shrink-0 text-[11px] text-[var(--text-tertiary)]">{index + 1}</span>
                    {line.imageUrl ? (
                      <img
                        src={line.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-8 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] leading-tight font-medium text-[var(--text-primary)]">{line.name}</p>
                      <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                        {line.sku ?? '—'} · {money(line.unitPrice)} each
                        {line.discountType !== 'NONE' ? ' · discounted' : ''}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[13px] font-semibold text-[var(--text-primary)]">
                      {money(pricedLine?.total ?? 0)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 ps-6">
                    <div className="flex items-center rounded-[var(--radius-sm)] border border-[var(--border-default)]">
                      <IconButton
                        label="Decrease quantity"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onStepQty(line.lineId, -1000);
                        }}
                      >
                        <Minus size={13} strokeWidth={1.75} />
                      </IconButton>
                      <input
                        value={qty(line.qtyMilli)}
                        onChange={(event) => {
                          const parsed = Math.round(Number.parseFloat(event.target.value.replace(/[^0-9.]/g, '')) * 1000);
                          onSetQty(line.lineId, Number.isFinite(parsed) ? parsed : 0);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Quantity for ${line.name}`}
                        className="tabular h-6 w-12 border-x border-[var(--border-default)] bg-transparent text-center text-[12px] text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                      />
                      <IconButton
                        label="Increase quantity"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onStepQty(line.lineId, 1000);
                        }}
                      >
                        <Plus size={13} strokeWidth={1.75} />
                      </IconButton>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDiscountLineId(line.lineId);
                      }}
                      title="Line discount"
                    >
                      <Percent size={12} strokeWidth={1.75} />
                      {line.discountType === 'NONE' ? 'Discount' : `${line.discountValue / 100}%`}
                    </Button>

                    {low ? <Badge tone="warning">Above stock on hand</Badge> : null}

                    <IconButton
                      label={`Remove ${line.name}`}
                      size="sm"
                      className="ms-auto hover:text-[var(--danger-text)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveLine(line.lineId);
                      }}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <MoneyRow label={t('pos.subtotal')} value={money(priced.grossSubtotal)} />
          {priced.discountTotal > 0 ? (
            <>
              {priced.lineDiscountTotal > 0 ? (
                <MoneyRow label="Line discounts" value={`−${money(priced.lineDiscountTotal)}`} tone="muted" />
              ) : null}
              {priced.cartDiscountTotal > 0 ? (
                <MoneyRow
                  label={`Cart discount${cartDiscount.type === 'PERCENT' ? ` (${cartDiscount.value / 100}%)` : ''}`}
                  value={`−${money(priced.cartDiscountTotal)}`}
                  tone="muted"
                />
              ) : null}
              <MoneyRow label={t('pos.discount')} value={`−${money(priced.discountTotal)}`} tone="muted" />
            </>
          ) : null}
          <MoneyRow label={t('pos.tax')} value={money(priced.taxTotal)} />
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-[var(--border-default)] pt-2">
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t('pos.total')}</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {priced.lineCount} item{priced.lineCount === 1 ? '' : 's'}
            </span>
          </div>
          <span className="tabular text-[24px] leading-none font-semibold text-[var(--text-primary)]">{money(total)}</span>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCartDiscountOpen(true)} disabled={lines.length === 0}>
            <Percent size={14} strokeWidth={1.75} />
            {t('pos.discount')}
          </Button>
          <Button variant="primary" size="lg" className="flex-1" onClick={onCharge} disabled={!canCharge} title="Take payment (F9)">
            {t('pos.checkout')} (F9)
          </Button>
        </div>
      </footer>

      <LineDiscountDialog
        open={discountLineId !== null}
        line={lines.find((l) => l.lineId === discountLineId) ?? null}
        onClose={() => setDiscountLineId(null)}
        onApply={(type, value) => {
          if (discountLineId) onSetLineDiscount(discountLineId, type, value);
          setDiscountLineId(null);
        }}
      />

      <CartDiscountDialog
        open={cartDiscountOpen}
        value={priced.cartDiscountTotal}
        onClose={() => setCartDiscountOpen(false)}
        onApply={(type, value) => {
          onSetCartDiscount({ type, value });
          setCartDiscountOpen(false);
        }}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------

const DISCOUNT_OPTIONS = [
  { value: 'NONE', label: 'No discount' },
  { value: 'PERCENT', label: 'Percentage' },
  { value: 'FIXED', label: 'Fixed amount' },
];

function LineDiscountDialog({
  open,
  line,
  onClose,
  onApply,
}: {
  open: boolean;
  line: CartLine | null;
  onClose: () => void;
  onApply: (type: DiscountType, value: number) => void;
}) {
  const t = useT();
  const [type, setType] = useState<DiscountType>('NONE');
  const [amount, setAmount] = useState('');
  const [seed, setSeed] = useState<string | null>(null);

  // Re-seed the fields when a different line is opened, without an effect that
  // would also fire while the cashier is typing.
  if (open && seed !== line?.lineId) {
    setSeed(line?.lineId ?? null);
    setType(line?.discountType ?? 'NONE');
    setAmount(line?.discountType === 'FIXED' ? amountInputValue(line.discountValue) : line?.discountType === 'PERCENT' ? String(line.discountValue / 100) : '');
  }
  if (!open && seed !== null) setSeed(null);

  const apply = (): void => {
    if (type === 'NONE') return onApply('NONE', 0);
    if (type === 'PERCENT') return onApply('PERCENT', Math.round(Number.parseFloat(amount || '0') * 100) || 0);
    onApply('FIXED', parseAmountInput(amount));
  };

  return (
    <Modal
      open={open}
      title={`Discount — ${line?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Discount type">
          {(id) => (
            <Select
              id={id}
              value={type}
              onChange={(event) => setType(event.target.value as DiscountType)}
              options={DISCOUNT_OPTIONS}
            />
          )}
        </Field>

        {type !== 'NONE' ? (
          <Field label={type === 'PERCENT' ? 'Percent off' : 'Amount off'} hint={type === 'PERCENT' ? 'Stored as basis points so 10% is exact.' : undefined}>
            {(id) => (
              <Input
                id={id}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                autoFocus
              />
            )}
          </Field>
        ) : null}

        <Divider />
        <p className="text-[12px] text-[var(--text-secondary)]">
          A discount reduces what the goods are worth, so tax is charged on the discounted amount. It can never make a line payable.
        </p>
      </div>
    </Modal>
  );
}

function CartDiscountDialog({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean;
  value: number;
  onClose: () => void;
  onApply: (type: DiscountType, value: number) => void;
}) {
  const t = useT();
  const [type, setType] = useState<DiscountType>('NONE');
  const [amount, setAmount] = useState('');

  const apply = (): void => {
    if (type === 'NONE') return onApply('NONE', 0);
    if (type === 'PERCENT') return onApply('PERCENT', Math.round(Number.parseFloat(amount || '0') * 100) || 0);
    onApply('FIXED', parseAmountInput(amount));
  };

  return (
    <Modal
      open={open}
      title="Discount the whole sale"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Discount type">
          {(id) => (
            <Select id={id} value={type} onChange={(event) => setType(event.target.value as DiscountType)} options={DISCOUNT_OPTIONS} />
          )}
        </Field>
        {type !== 'NONE' ? (
          <Field label={type === 'PERCENT' ? 'Percent off' : 'Amount off'}>
            {(id) => (
              <Input id={id} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoFocus />
            )}
          </Field>
        ) : null}
        <Divider />
        <MoneyRow label="Currently discounted" value={money(value)} tone="muted" />
      </div>
    </Modal>
  );
}

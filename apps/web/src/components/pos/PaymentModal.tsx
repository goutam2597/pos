/**
 * Payment modal — where the money actually changes hands.
 *
 * Design constraints that came from the counter:
 *   * CASH IS THE DEFAULT TAB. It is the most common tender in most shops and it
 *     must be zero keystrokes to take the exact amount.
 *   * CHANGE IS CALCULATED, NEVER TYPED. A cashier typing change is a cashier
 *     making an arithmetic error on a live till.
 *   * SPLIT TENDER IS EXPLICIT, NOT A MODE. Tendering 500 by card and the rest
 *     in cash is normal retail; making it a separate mode would push people to
 *     fake a single tender instead.
 *   * CREDIT IS OFF UNLESS THE SALE IS ALLOWED TO BE ON ACCOUNT. A missing
 *     toggle should never become an accidental debt for a walk-in.
 *
 * All arithmetic here is integer minor units. `parseAmountInput` is the only
 * path from typed text to money.
 */

import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Plus, Trash2 } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, QUICK_TENDER, type PaymentDraft } from '../../pos/types';
import { amountInputValue, money, parseAmountInput } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { PaymentMethod } from '@monopos/shared';
import { Button, Divider, Field, IconButton, Input, Modal, MoneyRow, Select, cx } from './ui';

export interface PaymentModalProps {
  open: boolean;
  total: number;
  /** Whether this sale may be put on account. Credit tabs hide otherwise. */
  allowCredit: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (payments: PaymentDraft[], allowCredit: boolean) => void;
  error: string | null;
}

type Tab = 'cash' | 'card' | 'credit' | 'split';

const SPLIT_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'GIFT_CARD'];

export function PaymentModal({ open, total, allowCredit, busy, onClose, onConfirm, error }: PaymentModalProps) {
  const t = useT();

  const [tab, setTab] = useState<Tab>('cash');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([]);
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>('CASH');
  const [splitAmount, setSplitAmount] = useState('');

  // Reset whenever the modal opens: a previous sale's half-typed reference must
  // never leak onto the next customer.
  useEffect(() => {
    if (!open) return;
    setTab('cash');
    setTendered('');
    setReference('');
    setSplitPayments([]);
    setSplitMethod('CASH');
    setSplitAmount('');
  }, [open, total]);

  const tenderedAmount = parseAmountInput(tendered);
  const change = Math.max(0, tenderedAmount - total);
  const splitPaid = useMemo(() => splitPayments.reduce((sum, p) => sum + p.amount, 0), [splitPayments]);
  const splitRemaining = total - splitPaid;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Banknote }> = [
    { id: 'cash', label: t('pos.cash'), icon: Banknote },
    { id: 'card', label: t('pos.card'), icon: CreditCard },
    ...(allowCredit ? [{ id: 'credit' as Tab, label: 'On account', icon: CreditCard }] : []),
    { id: 'split', label: 'Split', icon: Plus },
  ];

  const confirmCash = (): void => {
    if (tenderedAmount < total) return;
    onConfirm([{ method: 'CASH', amount: tenderedAmount, reference }], allowCredit);
  };

  const confirmCard = (): void => {
    onConfirm([{ method: 'CARD', amount: total, reference }], allowCredit);
  };

  const confirmCredit = (): void => {
    onConfirm([{ method: 'CREDIT', amount: total, reference }], true);
  };

  const addSplit = (): void => {
    const amount = parseAmountInput(splitAmount);
    if (amount <= 0) return;
    setSplitPayments((current) => [...current, { method: splitMethod, amount, reference }]);
    setSplitAmount('');
    setReference('');
  };

  const confirmSplit = (): void => {
    if (splitPayments.length === 0 || splitRemaining > 0) return;
    onConfirm(splitPayments, allowCredit);
  };

  const canConfirm =
    tab === 'cash'
      ? tenderedAmount >= total
      : tab === 'split'
        ? splitPayments.length > 0 && splitRemaining <= 0
        : true;

  return (
    <Modal
      open={open}
      title="Take payment"
      width="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="success"
            size="lg"
            disabled={!canConfirm || busy}
            onClick={tab === 'cash' ? confirmCash : tab === 'card' ? confirmCard : tab === 'credit' ? confirmCredit : confirmSplit}
          >
            {busy ? 'Saving…' : `Complete sale — ${money(total)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-3 py-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[var(--text-tertiary)]">{t('pos.total')} due</span>
          <span className="tabular text-[26px] leading-none font-semibold text-[var(--text-primary)]">{money(total)}</span>
        </div>

        {error ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        <div className="flex gap-1.5" role="tablist">
          {tabs.map((entry) => {
            const active = entry.id === tab;
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(entry.id)}
                className={cx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-2 text-[12px] transition-colors',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)]',
                )}
              >
                <Icon size={14} strokeWidth={1.75} />
                {entry.label}
              </button>
            );
          })}
        </div>

        {tab === 'cash' ? (
          <div className="flex flex-col gap-3">
            <Field label="Cash tendered" hint="Quick keys below fill the amount. Type anything larger for change.">
              {(id) => (
                <Input
                  id={id}
                  value={tendered}
                  onChange={(event) => setTendered(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="text-[18px]"
                />
              )}
            </Field>

            <div className="grid grid-cols-6 gap-1.5">
              {QUICK_TENDER.map((option) => (
                <Button
                  key={String(option)}
                  size="sm"
                  variant={option === 'exact' ? 'primary' : 'secondary'}
                  onClick={() => setTendered(amountInputValue(option === 'exact' ? total : option))}
                >
                  {option === 'exact' ? 'Exact' : money(option, { showCents: false })}
                </Button>
              ))}
            </div>

            <Divider />
            <MoneyRow label="Tendered" value={money(tenderedAmount)} />
            <MoneyRow
              label={t('pos.change')}
              value={money(change)}
              tone={change > 0 ? 'success' : 'muted'}
              emphasis={change > 0}
            />
          </div>
        ) : null}

        {tab === 'card' ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
              Take {money(total)} on the terminal, then record the approval code below so the sale can be reconciled against the
              processor's batch later.
            </p>
            <Field label="Approval / reference" hint={t('common.optional')}>
              {(id) => <Input id={id} value={reference} onChange={(event) => setReference(event.target.value)} autoFocus />}
            </Field>
          </div>
        ) : null}

        {tab === 'credit' ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
              The whole balance of {money(total)} will be posted to the customer's account. This sale is only permitted because
              credit was explicitly allowed for this transaction.
            </p>
            <Field label="Reference" hint={t('common.optional')}>
              {(id) => <Input id={id} value={reference} onChange={(event) => setReference(event.target.value)} autoFocus />}
            </Field>
          </div>
        ) : null}

        {tab === 'split' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              {splitPayments.length === 0 ? (
                <p className="text-[12px] text-[var(--text-tertiary)]">No tenders added yet.</p>
              ) : (
                splitPayments.map((payment, index) => (
                  <div
                    key={`${payment.method}-${index}`}
                    className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-2 py-1.5"
                  >
                    <span className="text-[12px] text-[var(--text-primary)]">{PAYMENT_METHOD_LABEL[payment.method]}</span>
                    {payment.reference ? (
                      <span className="truncate text-[11px] text-[var(--text-tertiary)]">{payment.reference}</span>
                    ) : null}
                    <span className="tabular ms-auto text-[12px] font-medium text-[var(--text-primary)]">
                      {money(payment.amount)}
                    </span>
                    <IconButton
                      label="Remove tender"
                      size="sm"
                      onClick={() => setSplitPayments((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </IconButton>
                  </div>
                ))
              )}
            </div>

            <Divider />

            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="Tender">
                {(id) => (
                  <Select
                    id={id}
                    value={splitMethod}
                    onChange={(event) => setSplitMethod(event.target.value as PaymentMethod)}
                    options={SPLIT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_LABEL[method] }))}
                  />
                )}
              </Field>
              <Field label="Amount">
                {(id) => (
                  <Input id={id} value={splitAmount} onChange={(event) => setSplitAmount(event.target.value)} inputMode="decimal" />
                )}
              </Field>
              <Button variant="secondary" size="md" onClick={addSplit} disabled={parseAmountInput(splitAmount) <= 0}>
                <Plus size={14} strokeWidth={1.75} />
                Add
              </Button>
            </div>

            <MoneyRow label="Paid so far" value={money(splitPaid)} tone="muted" />
            <MoneyRow
              label="Still to pay"
              value={money(Math.max(0, splitRemaining))}
              tone={splitRemaining > 0 ? 'danger' : 'success'}
              emphasis
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

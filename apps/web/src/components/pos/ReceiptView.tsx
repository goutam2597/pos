/**
 * Receipt.
 *
 * THE HARD CASE IS THE ONE THAT MATTERS: a sale taken with no connection has no
 * invoice number yet, because the number is the server's to assign. The receipt
 * therefore prints the local transaction id and a "pending sync" marker, and
 * says so in plain words. Printing a blank code field and calling it a receipt
 * is how a customer ends up with a till receipt they cannot return against.
 *
 * When the server does assign a code, the till re-renders with the real number —
 * no reprint is needed, because the sale row is updated in place.
 *
 * Printing uses the `@media print` rules already in `index.css`: chrome marked
 * `no-print` disappears, and the receipt body is all that remains.
 */

import { Printer } from 'lucide-react';
import { dateTime, money, qty } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PAYMENT_METHOD_LABEL, type ReceiptView as Receipt } from '../../pos/types';
import { Badge, Button, Divider, Modal, MoneyRow } from './ui';

export interface ReceiptModalProps {
  open: boolean;
  receipt: Receipt | null;
  /** Business name printed at the top; the till never invents one. */
  businessName: string | null;
  onPrint: () => void;
  onNewSale: () => void;
  onClose: () => void;
}

export function ReceiptModal({ open, receipt, businessName, onPrint, onNewSale, onClose }: ReceiptModalProps) {
  const t = useT();
  if (!receipt) return null;

  const pending = receipt.code === null;

  return (
    <Modal
      open={open}
      title={t('pos.receipt')}
      onClose={onClose}
      width="sm"
      printable
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          <Button variant="secondary" onClick={onPrint}>
            <Printer size={14} strokeWidth={1.75} />
            {t('action.print')}
          </Button>
          <Button variant="primary" onClick={onNewSale}>
            New sale
          </Button>
        </>
      }
    >
      <article className="flex flex-col gap-3 text-[var(--text-primary)]">
        <header className="flex flex-col items-center gap-1 text-center">
          <p className="text-[14px] font-semibold">{businessName ?? 'MonoPOS'}</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">{dateTime(receipt.occurredAt)}</p>
          <p className="tabular text-[11px] text-[var(--text-tertiary)]">
            {receipt.code ? `Invoice ${receipt.code}` : `Local ref ${receipt.saleId}`}
          </p>
        </header>

        {pending ? (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning)] bg-[var(--warning-subtle)] px-2.5 py-2">
            <Badge tone="warning">Pending sync</Badge>
            <p className="text-[11px] leading-relaxed text-[var(--warning-text)]">
              This sale is saved on this terminal and will be given an invoice number when the connection returns. The amount and
              items below are final; only the number is outstanding.
            </p>
          </div>
        ) : (
          <div className="flex justify-center">
            <Badge tone="success">Confirmed by server</Badge>
          </div>
        )}

        {receipt.cashierName ? (
          <p className="text-center text-[11px] text-[var(--text-tertiary)]">Served by {receipt.cashierName}</p>
        ) : null}

        <Divider />

        <ul className="flex flex-col gap-2">
          {receipt.lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium">{line.name}</span>
                <span className="tabular text-[12px]">{money(line.total)}</span>
              </div>
              <div className="tabular flex items-baseline justify-between gap-3 text-[11px] text-[var(--text-tertiary)]">
                <span>
                  {qty(line.qtyMilli)} × {money(line.unitPrice)}
                  {line.discountType !== 'NONE' ? ` − ${line.discountType === 'PERCENT' ? `${line.discountValue / 100}%` : money(line.discountValue)}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <Divider />

        <div className="flex flex-col gap-1">
          <MoneyRow label={t('pos.subtotal')} value={money(receipt.subtotal)} />
          {receipt.discountTotal > 0 ? <MoneyRow label={t('pos.discount')} value={`−${money(receipt.discountTotal)}`} tone="muted" /> : null}
          <MoneyRow label={t('pos.tax')} value={money(receipt.taxTotal)} />
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-[var(--border-default)] pt-1.5">
            <span className="text-[13px] font-semibold">{t('pos.total')}</span>
            <span className="tabular text-[16px] font-semibold">{money(receipt.total)}</span>
          </div>
        </div>

        <Divider />

        <div className="flex flex-col gap-1">
          {receipt.payments.map((payment, index) => (
            <MoneyRow
              key={`${payment.method}-${index}`}
              label={`${PAYMENT_METHOD_LABEL[payment.method]}${payment.reference ? ` · ${payment.reference}` : ''}`}
              value={money(payment.amount)}
              tone="muted"
            />
          ))}
          {receipt.change > 0 ? <MoneyRow label={t('pos.change')} value={money(receipt.change)} tone="success" emphasis /> : null}
        </div>

        {receipt.note ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {receipt.note}
          </p>
        ) : null}

        <p className="text-center text-[11px] text-[var(--text-tertiary)]">
          Thank you. Keep this receipt — it is your proof of purchase even before the invoice is issued.
        </p>
      </article>
    </Modal>
  );
}

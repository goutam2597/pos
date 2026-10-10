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
 * THE PAPER: `ReceiptPaper` is styled as a real 72mm thermal slip — monospace,
 * black on white, dashed separators, centred header, cut line — so the on-screen
 * preview is exactly what comes out of the printer. The `@media print` rules in
 * `index.css` isolate `.thermal-receipt` (visibility trick) and set the page up
 * for an 80mm roll: nothing else on the page is ever printed.
 */

import { Printer } from 'lucide-react';
import { money, qty } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PAYMENT_METHOD_LABEL, type ReceiptView as Receipt } from '../../pos/types';
import { Button, Modal } from './ui';

/** Horizontal dashed rule — the thermal receipt's separator. */
function Tear({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`border-t border-dashed border-black/70 ${className}`} />;
}

/** Solid rule used above the TOTAL, where real slips go heavy. */
function Heavy({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`border-t-2 border-black ${className}`} />;
}

/** A row: label left, value right, both in tabular figures. */
function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${strong ? 'font-bold' : ''} ${muted ? 'text-black/60' : ''}`}>
      <span className="uppercase">{label}</span>
      <span className="tabular whitespace-nowrap">{value}</span>
    </div>
  );
}

/** Faux barcode: pure CSS bars, prints on any thermal head. */
function Barcode({ value }: { value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        aria-hidden="true"
        className="h-8 w-48"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, black 0 2px, transparent 2px 4px, black 4px 7px, transparent 7px 8px, black 8px 9px, transparent 9px 12px)',
        }}
      />
      <p className="tracking-[0.3em]">{value}</p>
    </div>
  );
}

function compactDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface ReceiptPaperProps {
  receipt: Receipt;
  businessName: string | null;
}

/**
 * Send the on-screen slip to the printer.
 *
 * The slip is CLONED into a dedicated print root appended to <body>, and every
 * other top-level node is display:none'd for the duration — the one mechanism
 * Chrome's print renderer never gets wrong, no matter how deep the original
 * sits inside modals, overlays and scroll containers. The clone is removed on
 * `afterprint`, with a fallback timer for engines that skip the event.
 */
export function printReceiptSlip(): void {
  const slip = document.querySelector('.thermal-receipt');
  if (!slip) {
    window.print();
    return;
  }

  document.querySelectorAll('.thermal-print-root').forEach((node) => node.remove());

  const root = document.createElement('div');
  root.className = 'thermal-print-root';
  root.appendChild(slip.cloneNode(true));
  document.body.appendChild(root);
  document.body.classList.add('printing-receipt');

  const cleanup = (): void => {
    document.body.classList.remove('printing-receipt');
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 30_000);

  window.print();
}

/**
 * The printable slip itself. Kept separate from the modal so the print rules
 * can isolate it and the screen can show it as a paper preview.
 */
export function ReceiptPaper({ receipt, businessName }: ReceiptPaperProps) {
  const pending = receipt.code === null;

  return (
    <article className="thermal-receipt mx-auto flex w-[272px] flex-col gap-1.5 bg-white px-4 py-5 font-mono text-[11px] leading-[1.45] text-black shadow-[0_2px_14px_rgba(0,0,0,0.35)]">
      <header className="text-center">
        <p className="text-[14px] font-bold uppercase tracking-[0.08em]">{businessName ?? 'MonoPOS'}</p>
        <p className="text-[10px] uppercase text-black/70">{compactDateTime(receipt.occurredAt)}</p>
        <p className="text-[10px] uppercase">{receipt.code ? `Receipt ${receipt.code}` : `Ref ${receipt.saleId.slice(0, 8).toUpperCase()}`}</p>
      </header>

      <Tear />

      {pending ? (
        <p className="text-center text-[10px] font-bold uppercase">
          *** Pending sync ***
          <span className="block font-normal normal-case">invoice number will follow once the till syncs</span>
        </p>
      ) : (
        <p className="text-center text-[10px] uppercase">** Confirmed **</p>
      )}

      {receipt.cashierName ? <p className="text-center text-[10px] uppercase">Served by {receipt.cashierName}</p> : null}

      <Tear />

      <div className="flex justify-between text-[10px] font-bold uppercase">
        <span>Item</span>
        <span>Amount</span>
      </div>

      <ul className="flex flex-col gap-1">
        {receipt.lines.map((line, index) => (
          <li key={`${line.name}-${index}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 break-words uppercase">{line.name}</span>
              <span className="tabular whitespace-nowrap">{money(line.total)}</span>
            </div>
            <div className="tabular flex items-baseline justify-between gap-2 text-[10px] text-black/60">
              <span>
                {qty(line.qtyMilli)} × {money(line.unitPrice)}
                {line.discountType !== 'NONE'
                  ? ` · disc ${line.discountType === 'PERCENT' ? `${line.discountValue / 100}%` : money(line.discountValue)}`
                  : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Tear />

      <div className="flex flex-col gap-0.5">
        <Row label="Subtotal" value={money(receipt.subtotal)} />
        {receipt.discountTotal > 0 ? <Row label="Discount" value={`−${money(receipt.discountTotal)}`} muted /> : null}
        <Row label="Tax" value={money(receipt.taxTotal)} />
      </div>

      <Heavy className="my-1" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold uppercase">Total</span>
        <span className="tabular text-[19px] font-bold leading-none">{money(receipt.total)}</span>
      </div>
      <Heavy className="my-1" />

      <div className="flex flex-col gap-0.5">
        {receipt.payments.map((payment, index) => (
          <Row
            key={`${payment.method}-${index}`}
            label={PAYMENT_METHOD_LABEL[payment.method]}
            value={money(payment.amount)}
            muted
          />
        ))}
        {receipt.change > 0 ? <Row label="Change" value={money(receipt.change)} strong /> : null}
      </div>

      {receipt.note ? (
        <p className="border-t border-dashed border-black/70 pt-1.5 text-[10px] leading-relaxed">
          NOTE: {receipt.note}
        </p>
      ) : null}

      <Tear className="mt-1" />

      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <Barcode value={receipt.code ?? receipt.saleId.slice(0, 12).toUpperCase()} />
        <p className="text-[10px] font-bold uppercase">Thank you for shopping with us</p>
        <p className="text-[9px] uppercase text-black/60">Keep this receipt for returns &amp; exchanges</p>
      </div>

      <Tear className="mt-2" />
      <p aria-hidden="true" className="text-center text-[9px] uppercase tracking-[0.4em] text-black/40">
        ✂
      </p>
    </article>
  );
}

export interface ReceiptModalProps {
  open: boolean;
  receipt: Receipt | null;
  /** Business name printed at the top; the till never invents one. */
  businessName: string | null;
  onNewSale: () => void;
  onClose: () => void;
}

export function ReceiptModal({ open, receipt, businessName, onNewSale, onClose }: ReceiptModalProps) {
  const t = useT();
  if (!receipt) return null;

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
          <Button variant="secondary" onClick={() => printReceiptSlip()}>
            <Printer size={14} strokeWidth={1.75} />
            {t('action.print')}
          </Button>
          <Button variant="primary" onClick={onNewSale}>
            New sale
          </Button>
        </>
      }
    >
      <div className="bg-[var(--bg-sunken)] p-3">
        <ReceiptPaper receipt={receipt} businessName={businessName} />
      </div>
    </Modal>
  );
}

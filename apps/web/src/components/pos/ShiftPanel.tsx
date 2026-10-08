/**
 * Shift open / close.
 *
 * A shift is the unit of accountability: what the drawer started with, what
 * went through it, and what is in it now. The close screen's whole purpose is
 * the variance, so it is the largest thing on the page — a variance of zero
 * says "counted", a variance that does not say "investigate before you leave".
 *
 * Every cash movement (opening float, drop, close count) is queued through the
 * outbox, so a shift opened in a basement with no signal still produces an
 * auditable ledger on the server later.
 */

import { useEffect, useState } from 'react';
import { Banknote, HandCoins, Lock } from 'lucide-react';
import { dateTime, money, parseAmountInput } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { ShiftSummaryView } from '../../pos/types';
import { Badge, Button, Divider, Field, Input, Modal, MoneyRow } from './ui';

export interface ShiftPanelProps {
  open: boolean;
  /** Null when no shift is open. */
  summary: ShiftSummaryView | null;
  busy: boolean;
  onOpen: (openingFloat: number) => Promise<void>;
  onDrop: (amount: number, reason: string) => Promise<void>;
  onClose: (counted: number) => Promise<void>;
  onDismiss: () => void;
}

export function ShiftPanel({ open, summary, busy, onOpen, onDrop, onClose, onDismiss }: ShiftPanelProps) {
  const t = useT();
  const [mode, setMode] = useState<'idle' | 'open' | 'drop'>('idle');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(summary === null ? 'open' : 'idle');
    setAmount('');
    setReason('');
    setError(null);
  }, [open, summary]);

  const counted = parseAmountInput(amount);
  const variance = summary === null ? 0 : counted - summary.expectedCash;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (mode === 'open') {
        await onOpen(counted);
      } else if (mode === 'drop') {
        await onDrop(counted, reason.trim() || 'Cash drop');
      } else if (summary) {
        await onClose(counted);
      }
      setMode('idle');
      setAmount('');
      setReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const inCountMode = mode !== 'idle';

  return (
    <Modal
      open={open}
      title={summary === null ? 'Open the shift' : 'Shift'}
      onClose={onDismiss}
      width="sm"
      footer={
        summary === null ? (
          <>
            <Button variant="ghost" onClick={onDismiss}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              Open drawer
            </Button>
          </>
        ) : inCountMode ? (
          <>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {mode === 'open' ? 'Open drawer' : mode === 'drop' ? 'Record drop' : 'Close the shift'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setMode('drop')} disabled={busy}>
              <HandCoins size={14} strokeWidth={1.75} />
              Cash drop
            </Button>
            <Button variant="primary" onClick={() => setMode('idle')}>
              Count the drawer
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        {summary === null ? (
          <>
            <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
              Count the opening float before selling. It is recorded as a cash count the moment you confirm, online or not.
            </p>
            <Field label="Opening float">
              {(id) => (
                <Input
                  id={id}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="text-[18px]"
                />
              )}
            </Field>
          </>
        ) : mode === 'drop' ? (
          <>
            <Field label="Amount removed from the drawer">
              {(id) => (
                <Input
                  id={id}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="text-[18px]"
                />
              )}
            </Field>
            <Field label={t('common.notes')}>
              {(id) => <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />}
            </Field>
          </>
        ) : mode === 'idle' ? (
          <>
            <div className="flex flex-col gap-1">
              <MoneyRow label="Opened" value={dateTime(summary.openedAt)} tone="muted" />
              <MoneyRow label="Opening float" value={money(summary.openingFloat)} />
              <MoneyRow label="Cash dropped" value={summary.dropped > 0 ? `−${money(summary.dropped)}` : money(0)} tone="muted" />
              <Divider className="my-1" />
              <MoneyRow label="Expected in drawer" value={money(summary.expectedCash)} emphasis />
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Expected is the opening float plus every cash sale taken this shift, minus drops. It is computed from this terminal's
              own records, so it is still correct if nothing has synced.
            </p>
          </>
        ) : (
          <>
            <MoneyRow label="Expected in drawer" value={money(summary.expectedCash)} />
            <Field label="Counted in drawer">
              {(id) => (
                <Input
                  id={id}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="text-[18px]"
                />
              )}
            </Field>
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-3 py-2">
              <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <Banknote size={14} strokeWidth={1.75} />
                Variance
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-[14px] font-semibold text-[var(--text-primary)]">{money(variance)}</span>
                {variance === 0 ? (
                  <Badge tone="success">Balanced</Badge>
                ) : (
                  <Badge tone={variance < 0 ? 'danger' : 'warning'}>{variance < 0 ? 'Short' : 'Over'}</Badge>
                )}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              The count and the variance are sent to the server as a cash count when you close, together with the reason if you
              supply one.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Header button that opens this panel; shows the live shift state. */
export function ShiftButton({
  summary,
  onOpen,
  label,
}: {
  summary: ShiftSummaryView | null;
  onOpen: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Shift (F12)"
      className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)]"
    >
      {summary === null ? <Lock size={14} strokeWidth={1.75} /> : <Banknote size={14} strokeWidth={1.75} />}
      {summary === null ? 'No shift' : money(summary.expectedCash)}
      <span className="sr-only">{label}</span>
    </button>
  );
}

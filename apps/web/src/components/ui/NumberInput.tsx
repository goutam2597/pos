import { forwardRef, useCallback, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';

import { cn } from '../../lib/cn';
import { currencyMeta, formatMoney } from '@monopos/shared';
import { amountInputValue, parseAmountInput, qty as formatQtyValue } from '../../lib/format';
import { FieldFoot, FieldLabel } from './Input';
import { controlBase, controlHeight } from './tokens';

/**
 * Money and quantity inputs.
 *
 * THE RULE: money is an integer of minor units and quantity is an integer of
 * milli-units, everywhere — including inside an `<input>`. The field holds a
 * plain decimal *string* while the user types (so `1.` and `1.05` are both
 * typeable) and only converts to an integer on the way out via `onValueChange`.
 * A field that stored floats would be the one place rounding errors enter the
 * system.
 */

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'size'> {
  /** Integer minor units. */
  value: number;
  onValueChange: (minor: number) => void;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Render the currency symbol inside the control. */
  showCurrency?: boolean;
  /** Allow a negative entry (refunds, adjustments). */
  allowNegative?: boolean;
  min?: number;
  max?: number;
}

const SIZES = {
  sm: controlHeight.sm,
  md: controlHeight.md,
  lg: controlHeight.lg,
} as const;

export const MoneyInput = forwardRef<HTMLInputElement, NumberInputProps>(function MoneyInput(
  {
    value,
    onValueChange,
    currency = 'USD',
    size = 'md',
    label,
    hint,
    error,
    required,
    showCurrency = true,
    allowNegative = false,
    min,
    max,
    className,
    id,
    disabled,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useDecimalDraft(value, (v) => amountInputValue(v, currency));

  const meta = currencyMeta(currency);
  const step = 10 ** meta.exponent;

  const commit = useCallback(
    (raw: string) => {
      let next = parseAmountInput(raw, currency);
      if (!allowNegative && next < 0) next = 0;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      onValueChange(next);
    },
    [allowNegative, currency, max, min, onValueChange],
  );

  const nudge = (direction: 1 | -1) => {
    const base = draft.trim() === '' ? value : parseAmountInput(draft, currency);
    commit(String((base + direction * step) / step));
  };

  return (
    <div className="w-full">
      {label !== undefined && (
        <FieldLabel htmlFor={inputId} required={required}>
          {label}
        </FieldLabel>
      )}
      {/* Shared width for the −/+ pair, so the currency symbol and the value
          can be positioned relative to it without magic numbers in both places. */}
      <div className="relative flex items-center [--stepper-space:3.25rem]">
        {showCurrency && (
          /*
            The symbol sits directly before the digits rather than pinned to the
            far start edge. On a wide field the old absolute position stranded a
            lone "$" three inches from the number it belongs to.
          */
          <span className="pointer-events-none absolute inset-y-0 end-[calc(var(--stepper-space)+0.5rem)] flex items-center text-[13px] text-[var(--text-tertiary)]">
            {meta.symbol}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-valuenow={value}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw !== '' && raw !== '-' && raw !== '.' && !raw.endsWith('.')) commit(raw);
          }}
          onBlur={() => {
            commit(draft);
            setDraft(amountInputValue(value, currency));
          }}
          className={cn(
            controlBase,
            SIZES[size],
            'tabular-nums',
            showCurrency ? 'ps-3 pe-[calc(var(--stepper-space)+1.75rem)]' : 'ps-3',
            'text-end',
            error && 'border-[var(--danger)]',
            className,
          )}
          {...props}
        />
        <span className="absolute inset-y-0 end-1 flex items-center">
          <StepButton
            onClick={() => nudge(-1)}
            disabled={disabled}
            label={`Decrease ${label ?? 'amount'}`}
          >
            <Minus size={14} strokeWidth={1.75} />
          </StepButton>
          <StepButton
            onClick={() => nudge(1)}
            disabled={disabled}
            label={`Increase ${label ?? 'amount'}`}
          >
            <Plus size={14} strokeWidth={1.75} />
          </StepButton>
        </span>
      </div>
      <FieldFoot hint={hint} error={error} id={inputId} />
    </div>
  );
});

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-[22px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--text-primary)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Keeps the visible string in sync with an external value while the user is
 * idle, but never fights them mid-keystroke.
 *
 * The draft is reset during render when the committed value changes — the
 * pattern React recommends — rather than in an effect, which would show the
 * stale amount for one frame every time a parent re-computes the total.
 */
function useDecimalDraft(value: number, format: (value: number) => string) {
  const [draft, setDraft] = useState(() => format(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(format(value));
  }

  return [draft, setDraft] as const;
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export interface QuantityInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'size'> {
  /** Integer milli-units (1.5 -> 1500). */
  value: number;
  onValueChange: (qtyMilli: number) => void;
  unitName?: string | null;
  size?: 'sm' | 'md' | 'lg';
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  min?: number;
  max?: number;
  stepMilli?: number;
}

/** Milli-unit quantity field. Never a float, never a rounding surprise. */
export const QuantityInput = forwardRef<HTMLInputElement, QuantityInputProps>(function QuantityInput(
  {
    value,
    onValueChange,
    unitName,
    size = 'md',
    label,
    hint,
    error,
    min = 0,
    max,
    stepMilli = 1000,
    className,
    id,
    disabled,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [draft, setDraft] = useDecimalDraft(value, formatQtyDraft);

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        onValueChange(min);
        return;
      }
      let next = Math.round(parsed * 1000);
      if (next < min) next = min;
      if (max !== undefined) next = Math.min(max, next);
      onValueChange(next);
    },
    [max, min, onValueChange],
  );

  const nudge = (direction: 1 | -1) => {
    const base = draft.trim() === '' ? value : Math.round(Number.parseFloat(draft.replace(',', '.')) * 1000);
    const next = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, base + direction * stepMilli));
    onValueChange(next);
    setDraft(String(next / 1000));
  };

  return (
    <div className="w-full">
      {label !== undefined && (
        <FieldLabel htmlFor={fieldId}>
          {label}
        </FieldLabel>
      )}
      <div className="relative flex items-center">
        <input
          ref={ref}
          id={fieldId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-valuenow={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw !== '' && raw !== '-' && raw !== '.') commit(raw);
          }}
          onBlur={() => {
            commit(draft);
            setDraft(formatQtyDraft(value));
          }}
          className={cn(
            controlBase,
            SIZES[size],
            'tabular-nums',
            unitName ? 'ps-3 pe-16' : 'px-3 pe-10',
            error && 'border-[var(--danger)]',
            className,
          )}
          {...props}
        />
        {unitName && (
          <span className="pointer-events-none absolute inset-y-0 end-11 flex items-center text-[13px] text-[var(--text-tertiary)]">
            {unitName}
          </span>
        )}
        <span className="absolute inset-y-0 end-1 flex items-center">
          <StepButton onClick={() => nudge(-1)} disabled={disabled} label="Decrease quantity">
            <Minus size={14} strokeWidth={1.75} />
          </StepButton>
          <StepButton onClick={() => nudge(1)} disabled={disabled} label="Increase quantity">
            <Plus size={14} strokeWidth={1.75} />
          </StepButton>
        </span>
      </div>
      <FieldFoot hint={hint} error={error} id={fieldId} />
    </div>
  );
});

function formatQtyDraft(value: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Read-only money display for summary rows. */
export function MoneyValue({ minor, currency }: { minor: number; currency?: string }) {
  const meta = currencyMeta(currency ?? 'USD');
  return <span className="tabular-nums">{formatMoney(minor, meta.exponent)}</span>;
}

/** Quantity with its unit, e.g. `1.5 kg`. */
export function QtyValue({ qtyMilli, unitName }: { qtyMilli: number; unitName?: string | null }) {
  return <span className="tabular-nums">{formatQtyValue(qtyMilli, unitName)}</span>;
}

import { currencyMeta, formatMoney, type QtyMilli } from '@monopos/shared';

/**
 * Display formatting.
 *
 * The server sends every amount as an integer of minor units; the UI is the
 * only place they become decimals. Formatting goes through `Intl` so that a
 * user in Germany sees `1.234,56 €` and a user in the US sees `$1,234.56`,
 * without anyone maintaining a currency format table.
 */

let activeCurrency = 'USD';
let activeLocale: string | undefined;

export function configureFormatting(currency: string, locale?: string): void {
  activeCurrency = currency;
  activeLocale = locale;
}

/**
 * Money for display. `showCents` is false on dense tables where the decimal is
 * noise, but the amount is never rounded — only the display omits it.
 *
 * The symbol comes from the currency table, not `Intl`: the English locale
 * renders BDT as "BDT 0.65" instead of "৳0.65", and a cashier reads SYMBOLS.
 * The number part still goes through `Intl` so grouping and digits follow the
 * locale.
 */
export function money(minor: number, options?: { showCents?: boolean; currency?: string }): string {
  const currency = options?.currency ?? activeCurrency;
  const meta = currencyMeta(currency);
  const showCents = options?.showCents ?? true;

  const digits = showCents ? meta.exponent : 0;
  try {
    const number = new Intl.NumberFormat(activeLocale, {
      style: 'decimal',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** meta.exponent);
    return symbolWith(meta.symbol, number);
  } catch {
    // An unknown currency code should degrade, not crash a till.
    return `${meta.symbol}${formatMoney(minor, meta.exponent)}`;
  }
}

/**
 * Attach a currency symbol to a formatted number. Short alphanumeric symbols
 * ("KSh", "CHF") read better with a space; glyph symbols ("৳", "$", "€") sit
 * flush against the digits the way receipts print them.
 */
function symbolWith(symbol: string, number: string): string {
  const needsSpace = symbol.length > 1 && /^[A-Za-z]/.test(symbol);
  return needsSpace ? `${symbol} ${number}` : `${symbol}${number}`;
}

/** Quantity in milli-units to a human string. */
export function qty(qtyMilli: QtyMilli, unitName?: string | null): string {
  const negative = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');

  const number = frac ? `${whole}.${frac}` : String(whole);
  const withSign = negative ? `−${number}` : number;
  return unitName ? `${withSign} ${unitName}` : withSign;
}

/** Percentage from basis points. */
export function percent(basisPoints: number): string {
  return `${basisPoints / 100}%`;
}

/** Compact count for dashboard tiles: 1200 -> "1.2k". */
export function compactCount(value: number): string {
  try {
    return new Intl.NumberFormat(activeLocale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
}

export function date(value: string | Date | number | null | undefined, style: 'short' | 'medium' | 'long' = 'medium'): string {
  if (value === null || value === undefined) return '—';
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return '—';

  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: '2-digit', month: 'short' }
      : style === 'long'
        ? { day: 'numeric', month: 'long', year: 'numeric' }
        : { day: '2-digit', month: 'short', year: 'numeric' };

  try {
    return new Intl.DateTimeFormat(activeLocale, options).format(dateValue);
  } catch {
    return dateValue.toISOString().slice(0, 10);
  }
}

export function dateTime(value: string | Date | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(activeLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateValue);
  } catch {
    return dateValue.toISOString();
  }
}

/** Relative time for "last synced" labels. */
export function relativeTime(value: string | Date | number | null): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((then - Date.now()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  try {
    const formatter = new Intl.RelativeTimeFormat(activeLocale, { numeric: 'auto' });
    let amount = seconds;
    for (const [unit, size] of units) {
      if (Math.abs(amount) < size) return formatter.format(Math.round(amount), unit);
      amount /= size;
    }
    return formatter.format(Math.round(amount), 'year');
  } catch {
    return date(value, 'medium');
  }
}

/** Parse free-form user input into minor units for an editable amount field. */
export function parseAmountInput(input: string, currency = activeCurrency): number {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const meta = currencyMeta(currency);
  const numeric = Number.parseFloat(cleaned);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 10 ** meta.exponent);
}

/** Format minor units for an editable amount field (no symbol, no grouping). */
export function amountInputValue(minor: number, currency = activeCurrency): string {
  return formatMoney(minor, currencyMeta(currency).exponent);
}

/** Turn a title into a URL slug. Used for category and brand URLs. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

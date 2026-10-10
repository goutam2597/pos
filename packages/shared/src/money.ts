/**
 * Integer money math.
 *
 * Every monetary value in this system is stored as an INTEGER number of minor
 * units (cents, paisa, fils...). Floating point is never used for money, on the
 * server or the client. This is the single most important correctness rule in
 * the codebase: `0.1 + 0.2 !== 0.3` is unacceptable in a ledger.
 *
 * The only place a `number` may hold money is in transport/UI, and even then it
 * is always a minor-unit integer that must be converted via `formatMoney`.
 */

/** A monetary amount in minor units. Always an integer. */
export type Minor = number;

/** ISO-4217-ish currency descriptors we need to render amounts correctly. */
export interface CurrencyMeta {
  code: string;
  /** Number of decimal places (2 for USD, 0 for JPY, 3 for KWD). */
  exponent: number;
  symbol: string;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  // Americas
  USD: { code: 'USD', exponent: 2, symbol: '$' },
  CAD: { code: 'CAD', exponent: 2, symbol: 'C$' },
  MXN: { code: 'MXN', exponent: 2, symbol: 'MX$' },
  GTQ: { code: 'GTQ', exponent: 2, symbol: 'Q' },
  HNL: { code: 'HNL', exponent: 2, symbol: 'L' },
  NIO: { code: 'NIO', exponent: 2, symbol: 'C$' },
  CRC: { code: 'CRC', exponent: 2, symbol: '₡' },
  PAB: { code: 'PAB', exponent: 2, symbol: 'B/.' },
  CUP: { code: 'CUP', exponent: 2, symbol: '$' },
  JMD: { code: 'JMD', exponent: 2, symbol: 'J$' },
  HTG: { code: 'HTG', exponent: 2, symbol: 'G' },
  DOP: { code: 'DOP', exponent: 2, symbol: 'RD$' },
  BBD: { code: 'BBD', exponent: 2, symbol: 'Bds$' },
  TTD: { code: 'TTD', exponent: 2, symbol: 'TT$' },
  BZD: { code: 'BZD', exponent: 2, symbol: 'BZ$' },
  BSD: { code: 'BSD', exponent: 2, symbol: 'B$' },
  GYD: { code: 'GYD', exponent: 2, symbol: 'G$' },
  SRD: { code: 'SRD', exponent: 2, symbol: 'SR$' },
  ARS: { code: 'ARS', exponent: 2, symbol: 'AR$' },
  BOB: { code: 'BOB', exponent: 2, symbol: 'Bs' },
  BRL: { code: 'BRL', exponent: 2, symbol: 'R$' },
  CLP: { code: 'CLP', exponent: 0, symbol: 'CLP$' },
  COP: { code: 'COP', exponent: 2, symbol: 'COL$' },
  PEN: { code: 'PEN', exponent: 2, symbol: 'S/' },
  UYU: { code: 'UYU', exponent: 2, symbol: '$U' },
  PYG: { code: 'PYG', exponent: 0, symbol: '₲' },
  VES: { code: 'VES', exponent: 2, symbol: 'Bs.' },

  // Europe
  EUR: { code: 'EUR', exponent: 2, symbol: '€' },
  GBP: { code: 'GBP', exponent: 2, symbol: '£' },
  CHF: { code: 'CHF', exponent: 2, symbol: 'CHF' },
  SEK: { code: 'SEK', exponent: 2, symbol: 'kr' },
  NOK: { code: 'NOK', exponent: 2, symbol: 'kr' },
  DKK: { code: 'DKK', exponent: 2, symbol: 'kr' },
  ISK: { code: 'ISK', exponent: 0, symbol: 'kr' },
  PLN: { code: 'PLN', exponent: 2, symbol: 'zł' },
  CZK: { code: 'CZK', exponent: 2, symbol: 'Kč' },
  HUF: { code: 'HUF', exponent: 2, symbol: 'Ft' },
  RON: { code: 'RON', exponent: 2, symbol: 'lei' },
  BGN: { code: 'BGN', exponent: 2, symbol: 'лв' },
  RSD: { code: 'RSD', exponent: 2, symbol: 'дин' },
  MKD: { code: 'MKD', exponent: 2, symbol: 'ден' },
  ALL: { code: 'ALL', exponent: 2, symbol: 'L' },
  BAM: { code: 'BAM', exponent: 2, symbol: 'KM' },
  HRK: { code: 'HRK', exponent: 2, symbol: 'kn' },
  RUB: { code: 'RUB', exponent: 2, symbol: '₽' },
  UAH: { code: 'UAH', exponent: 2, symbol: '₴' },
  BYN: { code: 'BYN', exponent: 2, symbol: 'Br' },
  MDL: { code: 'MDL', exponent: 2, symbol: 'L' },
  TRY: { code: 'TRY', exponent: 2, symbol: '₺' },

  // Middle East
  AED: { code: 'AED', exponent: 2, symbol: 'د.إ' },
  SAR: { code: 'SAR', exponent: 2, symbol: 'ر.س' },
  QAR: { code: 'QAR', exponent: 2, symbol: 'ر.ق' },
  KWD: { code: 'KWD', exponent: 3, symbol: 'د.ك' },
  BHD: { code: 'BHD', exponent: 3, symbol: '.د.ب' },
  OMR: { code: 'OMR', exponent: 3, symbol: 'ر.ع.' },
  JOD: { code: 'JOD', exponent: 3, symbol: 'د.ا' },
  ILS: { code: 'ILS', exponent: 2, symbol: '₪' },
  LBP: { code: 'LBP', exponent: 2, symbol: 'ل.ل' },
  IQD: { code: 'IQD', exponent: 3, symbol: 'ع.د' },
  YER: { code: 'YER', exponent: 2, symbol: 'ر.ي' },

  // Africa
  EGP: { code: 'EGP', exponent: 2, symbol: 'E£' },
  MAD: { code: 'MAD', exponent: 2, symbol: 'د.م.' },
  TND: { code: 'TND', exponent: 3, symbol: 'د.ت' },
  DZD: { code: 'DZD', exponent: 2, symbol: 'د.ج' },
  LYD: { code: 'LYD', exponent: 3, symbol: 'ل.د' },
  NGN: { code: 'NGN', exponent: 2, symbol: '₦' },
  GHS: { code: 'GHS', exponent: 2, symbol: '₵' },
  KES: { code: 'KES', exponent: 2, symbol: 'KSh' },
  UGX: { code: 'UGX', exponent: 0, symbol: 'USh' },
  TZS: { code: 'TZS', exponent: 2, symbol: 'TSh' },
  RWF: { code: 'RWF', exponent: 0, symbol: 'FRw' },
  BIF: { code: 'BIF', exponent: 0, symbol: 'FBu' },
  ETB: { code: 'ETB', exponent: 2, symbol: 'Br' },
  XOF: { code: 'XOF', exponent: 0, symbol: 'CFA' },
  XAF: { code: 'XAF', exponent: 0, symbol: 'FCFA' },
  ZAR: { code: 'ZAR', exponent: 2, symbol: 'R' },
  NAD: { code: 'NAD', exponent: 2, symbol: 'N$' },
  BWP: { code: 'BWP', exponent: 2, symbol: 'P' },
  ZMW: { code: 'ZMW', exponent: 2, symbol: 'ZK' },
  MZN: { code: 'MZN', exponent: 2, symbol: 'MT' },
  MWK: { code: 'MWK', exponent: 2, symbol: 'MK' },
  MUR: { code: 'MUR', exponent: 2, symbol: '₨' },
  SCR: { code: 'SCR', exponent: 2, symbol: 'SR' },
  SOS: { code: 'SOS', exponent: 2, symbol: 'Sh' },
  SDG: { code: 'SDG', exponent: 2, symbol: 'ج.س' },
  SLL: { code: 'SLL', exponent: 2, symbol: 'Le' },
  LRD: { code: 'LRD', exponent: 2, symbol: 'L$' },
  GMD: { code: 'GMD', exponent: 2, symbol: 'D' },
  GNF: { code: 'GNF', exponent: 0, symbol: 'FG' },
  CDF: { code: 'CDF', exponent: 2, symbol: 'FC' },
  AOA: { code: 'AOA', exponent: 2, symbol: 'Kz' },
  MGA: { code: 'MGA', exponent: 0, symbol: 'Ar' },

  // South & Southeast Asia
  INR: { code: 'INR', exponent: 2, symbol: '₹' },
  PKR: { code: 'PKR', exponent: 2, symbol: '₨' },
  BDT: { code: 'BDT', exponent: 2, symbol: '৳' },
  NPR: { code: 'NPR', exponent: 2, symbol: 'रू' },
  LKR: { code: 'LKR', exponent: 2, symbol: 'Rs' },
  BTN: { code: 'BTN', exponent: 2, symbol: 'Nu.' },
  MVR: { code: 'MVR', exponent: 2, symbol: 'Rf' },
  AFN: { code: 'AFN', exponent: 2, symbol: '؋' },
  IRR: { code: 'IRR', exponent: 2, symbol: '﷼' },
  MMK: { code: 'MMK', exponent: 2, symbol: 'K' },
  THB: { code: 'THB', exponent: 2, symbol: '฿' },
  KHR: { code: 'KHR', exponent: 2, symbol: '៛' },
  LAK: { code: 'LAK', exponent: 2, symbol: '₭' },
  VND: { code: 'VND', exponent: 0, symbol: '₫' },
  MYR: { code: 'MYR', exponent: 2, symbol: 'RM' },
  SGD: { code: 'SGD', exponent: 2, symbol: 'S$' },
  IDR: { code: 'IDR', exponent: 2, symbol: 'Rp' },
  PHP: { code: 'PHP', exponent: 2, symbol: '₱' },

  // East Asia & Pacific
  JPY: { code: 'JPY', exponent: 0, symbol: '¥' },
  KRW: { code: 'KRW', exponent: 0, symbol: '₩' },
  CNY: { code: 'CNY', exponent: 2, symbol: '¥' },
  TWD: { code: 'TWD', exponent: 2, symbol: 'NT$' },
  HKD: { code: 'HKD', exponent: 2, symbol: 'HK$' },
  MOP: { code: 'MOP', exponent: 2, symbol: 'MOP$' },
  MNT: { code: 'MNT', exponent: 2, symbol: '₮' },
  AUD: { code: 'AUD', exponent: 2, symbol: 'A$' },
  NZD: { code: 'NZD', exponent: 2, symbol: 'NZ$' },
  FJD: { code: 'FJD', exponent: 2, symbol: 'FJ$' },
  PGK: { code: 'PGK', exponent: 2, symbol: 'K' },
  SBD: { code: 'SBD', exponent: 2, symbol: 'SI$' },
  TOP: { code: 'TOP', exponent: 2, symbol: 'T$' },
  WST: { code: 'WST', exponent: 2, symbol: 'WS$' },
  VUV: { code: 'VUV', exponent: 0, symbol: 'VT' },
  XPF: { code: 'XPF', exponent: 0, symbol: '₣' },
};

/** Fallback used when an unknown currency code is supplied. */
export const DEFAULT_CURRENCY: CurrencyMeta = CURRENCIES.USD!;

export function currencyMeta(code: string | null | undefined): CurrencyMeta {
  if (!code) return DEFAULT_CURRENCY;
  return CURRENCIES[code.toUpperCase().trim()] ?? DEFAULT_CURRENCY;
}

/**
 * Scale a major-unit amount (e.g. 12.34) into minor units (1234).
 *
 * Uses string manipulation rather than `Math.round(n * 100)` so that inputs
 * which cannot be represented exactly in binary floating point (12.005, 0.145)
 * round the way a human writing the invoice expects, instead of rounding
 * "wrongly" because the float landed a hair below the midpoint.
 */
export function toMinor(major: number | string, exponent = 2): Minor {
  if (typeof major === 'number') {
    if (!Number.isFinite(major)) throw new RangeError(`toMinor: not finite (${major})`);
    // `toFixed` yields the shortest decimal string that round-trips to `major`,
    // so the digit-shift below operates on what the user actually typed.
    return fromDecimalString(major.toFixed(exponent + 6), exponent);
  }
  return fromDecimalString(major, exponent);
}

/**
 * Convert a decimal string to minor units by shifting the decimal point, with
 * round-half-away-from-zero on the first dropped digit.
 */
function fromDecimalString(input: string, exponent: number): Minor {
  const s = input.trim().replace(/[_,\s]/g, '');
  const negative = s.startsWith('-');
  const unsigned = negative ? s.slice(1) : s;
  if (unsigned === '') throw new RangeError(`toMinor: empty numeric string (${input})`);

  const dot = unsigned.indexOf('.');
  const intPartRaw = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPartRaw = dot === -1 ? '' : unsigned.slice(dot + 1);

  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  if (!/^\d+$/.test(intPart)) throw new RangeError(`toMinor: bad integer part (${input})`);
  if (fracPartRaw !== '' && !/^\d+$/.test(fracPartRaw)) {
    throw new RangeError(`toMinor: bad fraction part (${input})`);
  }

  // Take one more fractional digit than we need so we can round half-up.
  const kept = fracPartRaw.slice(0, exponent);
  const nextChar = exponent < fracPartRaw.length ? fracPartRaw.charAt(exponent) : '';
  const nextDigit = nextChar === '' ? -1 : nextChar.charCodeAt(0) - 48;
  const hasNext = exponent < fracPartRaw.length;

  const frac = kept.padEnd(exponent, '0');
  let magnitude = BigInt(intPart) * 10n ** BigInt(exponent) + BigInt(frac || '0');

  if (hasNext && !Number.isNaN(nextDigit) && nextDigit >= 5) {
    magnitude += 1n;
  }

  const signed = negative ? -magnitude : magnitude;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`toMinor: amount out of safe integer range (${input})`);
  }
  return result;
}

/** Convert minor units back to a major-unit number. Use only for display/IO. */
export function toMajor(minor: Minor, exponent = 2): number {
  assertInteger(minor, 'toMajor');
  if (exponent === 0) return minor;
  return Number(BigInt(minor)) / 10 ** exponent;
}

/**
 * Render minor units as a plain decimal string, e.g. `formatMoney(123456)`
 * with USD -> `"1234.56"`. No symbol, no separators — safe to put in an input.
 */
export function formatMoney(minor: Minor, exponent = 2): string {
  assertInteger(minor, 'formatMoney');
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0');
  const intPart = digits.slice(0, digits.length - exponent) || '0';
  const fracPart = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${intPart}${fracPart}`;
}

/**
 * Format for human display, e.g. `"$1,234.56"`. Deterministic and locale-free
 * by default so that server-rendered output (invoices, PDFs) is stable; the web
 * client passes a locale when it wants localized grouping.
 */
export function displayMoney(
  minor: Minor,
  currency = 'USD',
  locale?: string,
): string {
  const meta = currencyMeta(currency);
  const plain = formatMoney(minor, meta.exponent);
  if (!locale) return `${meta.symbol}${plain}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: meta.exponent,
      maximumFractionDigits: meta.exponent,
    }).format(toMajor(minor, meta.exponent));
  } catch {
    return `${meta.symbol}${plain}`;
  }
}

/** Parse free-form user input ("1,234.56", " 12 ", "12.5") to minor units. */
export function parseMoney(input: string | number, currency = 'USD'): Minor {
  if (typeof input === 'number') return toMinor(input, currencyMeta(currency).exponent);
  const cleaned = input.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  return toMinor(cleaned, currencyMeta(currency).exponent);
}

/**
 * Distribute `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Used for allocating an invoice total across tax lines, or a payment across
 * tenders. Uses largest-remainder so the remainder pennies go to the entries
 * with the biggest fractional part — no money is created or destroyed.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  assertInteger(total, 'allocate');
  if (weights.length === 0) return [];

  const sum = weights.reduce((a, b) => a + b, 0);
  // Degenerate case: no basis to split on, so put everything on the first slot.
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  // Exact rational allocation using integers, avoiding any float accumulation.
  const scaled = weights.map((w) => Math.round((w / sum) * 1_000_000));
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  const base = scaled.map((v) => Math.floor((v * absTotal) / scaledSum));
  let remainder = absTotal - base.reduce((a, b) => a + b, 0);

  const order = scaled
    .map((v, i) => ({ i, frac: (v * absTotal) % scaledSum }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  // Hand out the leftover pennies to the entries with the largest fractional
  // part. `order` is never empty here: `weights.length > 0` was checked above.
  for (let k = 0; remainder > 0; k++, remainder--) {
    const target = order[k % order.length]!;
    base[target.i] = (base[target.i] ?? 0) + 1;
  }

  return base.map((v) => v * sign);
}

/**
 * Percentage of an amount, rounded half away from zero.
 *
 * The rounding matters: tax on 3.85 at 10% is 0.385, which must bill as 0.39.
 * Truncating here would systematically under-collect tax by a fraction of a unit
 * on every line, and the error compounds across a day of sales.
 */
export function percentOf(amount: Minor, percent: number): Minor {
  assertInteger(amount, 'percentOf');
  const scaled = BigInt(Math.round(percent * 100));
  const product = BigInt(amount) * scaled;
  const sign = product < 0n ? -1n : 1n;
  const magnitude = product < 0n ? -product : product;

  // Divide by 10,000 rounding half away from zero, all in integers so no float
  // ever touches the result.
  const quotient = magnitude / 10_000n;
  const remainder = magnitude % 10_000n;
  const rounded = remainder * 2n >= 10_000n ? quotient + 1n : quotient;
  return Number(rounded * sign);
}

/** Convenience inverse of `percentOf`: the tax rate that yields `tax` on `net`. */
export function rateFrom(net: Minor, tax: Minor): number {
  if (net === 0) return 0;
  return (tax / net) * 100;
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((a, b) => a + b, 0);
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((a, b) => a + b, 0);
}

export function subMinor(a: Minor, b: Minor): Minor {
  return a - b;
}

export function negateMinor(a: Minor): Minor {
  return -a;
}

export function multiplyMinor(amount: Minor, qtyMilli: number): Minor {
  assertInteger(amount, 'multiplyMinor');
  return Math.trunc((amount * qtyMilli) / 1000);
}

/** Guard: refuse to let a non-integer enter the money path. */
export function assertInteger(value: number, where: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${where}: expected a safe integer of minor units, got ${value}`);
  }
}

/** Clamp for non-negative money (discounts, refunds) without allowing negatives. */
export function clampNonNegative(a: Minor): Minor {
  return a < 0 ? 0 : a;
}

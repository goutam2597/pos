/**
 * Local POS UI primitives.
 *
 * These live under `components/pos/` rather than the shared `components/ui/`
 * because the till is a distinct surface with distinct ergonomics: bigger hit
 * targets, keyboard affordances, and a control height that a mouse never
 * touches. They are deliberately minimal — a till that renders a modal dialog
 * is a till that already went wrong.
 *
 * STYLING RULES observed throughout:
 *   * every colour, radius and control height comes from an `index.css` token
 *     via `var(--…)`; no hex, no palette class, no magic number;
 *   * logical properties only (`ms-*`, `me-*`, `ps-*`, `start-*`), so the whole
 *     till mirrors correctly in Arabic and Urdu without a single RTL rule;
 *   * flat surfaces with a 1px border. No gradients, no glow, no glass.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { Select as SharedSelect } from '../ui/Select';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Class vocabulary
// ---------------------------------------------------------------------------

export const cx = clsx;

export const CONTROL_H = 'h-[var(--height-control)]';
export const CONTROL_H_LG = 'h-[var(--height-control-lg)]';

export const surface = 'bg-[var(--bg-surface)]';
export const sunken = 'bg-[var(--bg-sunken)]';
export const border = 'border border-[var(--border-default)]';
export const borderStrong = 'border border-[var(--border-strong)]';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-contrast)] border border-[var(--accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:bg-[var(--bg-inset)] disabled:text-[var(--text-disabled)] disabled:border-[var(--border-default)]',
  secondary:
    'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-sunken)] active:bg-[var(--bg-inset)] disabled:text-[var(--text-disabled)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)] disabled:text-[var(--text-disabled)]',
  danger:
    'bg-[var(--danger)] text-[var(--accent-contrast)] border border-[var(--danger)] hover:bg-[var(--danger-hover)] active:bg-[var(--danger-hover)] disabled:bg-[var(--bg-inset)] disabled:text-[var(--text-disabled)] disabled:border-[var(--border-default)]',
  success:
    'bg-[var(--success)] text-[var(--accent-contrast)] border border-[var(--success)] hover:opacity-90 disabled:bg-[var(--bg-inset)] disabled:text-[var(--text-disabled)] disabled:border-[var(--border-default)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: `${CONTROL_H} px-2 text-[12px] gap-1`,
  md: `${CONTROL_H} px-3 text-[13px] gap-1.5`,
  lg: `${CONTROL_H_LG} px-4 text-[14px] gap-2`,
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', fullWidth, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--radius-md)] font-medium whitespace-nowrap',
        'transition-colors duration-100 select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        'disabled:cursor-not-allowed',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
        'border border-transparent text-[var(--text-secondary)]',
        'hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        'disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]',
        size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8',
        className,
      )}
      {...rest}
    />
  );
});

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-3 text-[13px]',
        'text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]',
        'disabled:bg-[var(--bg-sunken)] disabled:text-[var(--text-disabled)]',
        size === 'sm' ? CONTROL_H : size === 'lg' ? CONTROL_H_LG : CONTROL_H,
        invalid ? 'border-[var(--danger)]' : 'border-[var(--border-default)]',
        className,
      )}
      {...rest}
    />
  );
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[11px] text-[var(--danger-text)]">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * The till's dropdown re-exports the shared custom control rather than a native
 * `<select>`.
 *
 * A native select inside the POS looks nothing like the rest of the terminal —
 * OS-styled, unsearchable, and unpaintable. It also breaks the design guarantee
 * that every control in the product is one component. Keeping the local name and
 * the `onChange(event)` signature means the till screens are untouched.
 */
export function Select({
  options,
  id,
  value,
  onChange,
  disabled,
  className,
  placeholder,
  size,
}: {
  options: SelectOption[];
  id?: string;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <SharedSelect
      id={id}
      value={value ?? null}
      options={options}
      disabled={disabled}
      className={className}
      placeholder={placeholder}
      size={size}
      // Every till list is short and fixed (payment methods, discount types);
      // a search box there would be pure friction.
      searchable={false}
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--bg-inset)] text-[var(--text-secondary)] border-[var(--border-default)]',
  success: 'bg-[var(--success-subtle)] text-[var(--success-text)] border-[var(--success)]',
  warning: 'bg-[var(--warning-subtle)] text-[var(--warning-text)] border-[var(--warning)]',
  danger: 'bg-[var(--danger-subtle)] text-[var(--danger-text)] border-[var(--danger)]',
  info: 'bg-[var(--info-subtle)] text-[var(--info-text)] border-[var(--info)]',
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-[var(--accent)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--radius-xs)] border px-1.5 py-0.5',
        'text-[11px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block h-3.5 w-3.5 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]',
        'motion-safe:animate-spin',
        className,
      )}
    />
  );
}

/** Keyboard hint. Rendered as a physical key, not an emoji. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-xs)] border border-[var(--border-strong)] bg-[var(--bg-sunken)] px-1 font-sans text-[10px] font-semibold text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-[var(--text-tertiary)]">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">{title}</p>
        {description ? (
          <p className="max-w-sm text-[12px] leading-relaxed text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Horizontal rule used to separate money rows without visual weight. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cx('border-0 border-t border-[var(--border-subtle)]', className)} />;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width token for the panel. */
  width?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set when Esc must NOT close (e.g. a receipt mid-transaction). */
  dismissible?: boolean;
  /** A printable modal keeps its chrome off the `@media print` hide list. */
  printable?: boolean;
}

const MODAL_WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Modal({ open, title, onClose, children, footer, width = 'md', dismissible = true, printable = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, dismissible]);

  const focusFirst = useCallback(() => {
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, []);

  useEffect(() => {
    if (open) focusFirst();
  }, [open, focusFirst]);

  if (!open) return null;

  return (
    <div className={cx('fixed inset-0 z-50 flex items-center justify-center p-4', !printable && 'no-print')}>
      <div
        className="absolute inset-0 bg-[var(--bg-inset)] opacity-70"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden',
          'rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]',
          MODAL_WIDTHS[width],
        )}
      >
        <header className={cx('flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3', !printable && 'no-print')}>
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h2>
          {dismissible ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <footer className={cx('flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3', !printable && 'no-print')}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money row — used by every totals block so they line up to the cent.
// ---------------------------------------------------------------------------

export function MoneyRow({
  label,
  value,
  emphasis = false,
  tone = 'default',
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'default' | 'muted' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-[var(--danger-text)]'
      : tone === 'success'
        ? 'text-[var(--success-text)]'
        : tone === 'muted'
          ? 'text-[var(--text-tertiary)]'
          : emphasis
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)]';

  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={cx('text-[12px]', emphasis ? 'font-semibold' : 'text-[var(--text-secondary)]', toneClass)}>{label}</span>
      <span className={cx('tabular text-[12px]', emphasis ? 'text-[15px] font-semibold' : '', toneClass)}>{value}</span>
    </div>
  );
}

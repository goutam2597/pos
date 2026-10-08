import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * Button.
 *
 * The one place an action is expressed. `loading` disables the button rather
 * than hiding it, because a control that disappears mid-click loses the
 * layout and tells the user nothing about what happened.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)]',
  secondary:
    'bg-[var(--bg-sunken)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-inset)] hover:border-[var(--border-strong)]',
  outline:
    'bg-transparent text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-sunken)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
  danger:
    'bg-[var(--danger)] text-[var(--text-inverse)] hover:bg-[var(--danger-hover)]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[var(--height-control-sm)] gap-1.5 px-2.5 text-[13px]',
  md: 'h-[var(--height-control)] gap-2 px-3 text-[13px]',
  lg: 'h-[var(--height-control-lg)] gap-2 px-4 text-sm',
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without changing the button width. */
  loading?: boolean;
  /** Leading icon; sized automatically to match `size`. */
  icon?: ReactNode;
  /** Trailing icon, e.g. an external-link or chevron. */
  iconEnd?: ReactNode;
  fullWidth?: boolean;
  /** Square button for icon-only usage — supply `aria-label`. */
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    iconEnd,
    fullWidth,
    iconOnly = false,
    disabled,
    type = 'button',
    children,
    ...props
  },
  ref,
) {
  const iconSize = ICON_SIZE[size];
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-md)]',
        'font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        iconOnly && {
          sm: 'w-[var(--height-control-sm)] px-0',
          md: 'w-[var(--height-control)] px-0',
          lg: 'w-[var(--height-control-lg)] px-0',
        }[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 size={iconSize} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
      ) : (
        icon && (
          <span aria-hidden="true" className="inline-flex">
            {icon}
          </span>
        )
      )}
      {children}
      {iconEnd && !loading && (
        <span aria-hidden="true" className="inline-flex">
          {iconEnd}
        </span>
      )}
    </button>
  );
});

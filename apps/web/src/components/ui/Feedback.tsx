import type { ReactNode } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '../../lib/cn';

/** Inline alert. `role="alert"` on danger/warning so it interrupts a screen reader. */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  /** Trailing controls (a dismiss button, a "View details" link). */
  action?: ReactNode;
  className?: string;
}

const TONES: Record<AlertTone, string> = {
  info: 'bg-[var(--info-subtle)] border-[var(--info)] text-[var(--info-text)]',
  success: 'bg-[var(--success-subtle)] border-[var(--success)] text-[var(--success-text)]',
  warning: 'bg-[var(--warning-subtle)] border-[var(--warning)] text-[var(--warning-text)]',
  danger: 'bg-[var(--danger-subtle)] border-[var(--danger)] text-[var(--danger-text)]',
  neutral: 'bg-[var(--bg-sunken)] border-[var(--border-default)] text-[var(--text-secondary)]',
};

const DEFAULT_ICONS: Record<AlertTone, ReactNode> = {
  info: <Info size={16} strokeWidth={1.75} />,
  success: <CheckCircle2 size={16} strokeWidth={1.75} />,
  warning: <Info size={16} strokeWidth={1.75} />,
  danger: <XCircle size={16} strokeWidth={1.75} />,
  neutral: <Info size={16} strokeWidth={1.75} />,
};

export function Alert({ tone = 'info', title, children, icon, action, className }: AlertProps) {
  const urgent = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-[13px]',
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="mt-[1px] shrink-0">
        {icon ?? DEFAULT_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Determinate progress bar. Never used as decoration. */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'brand',
  size = 'md',
  className,
}: {
  /** 0..100. Values outside the range are clamped rather than overflowing. */
  value: number;
  max?: number;
  label?: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const fill = {
    brand: 'bg-[var(--accent)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--warning)]',
    danger: 'bg-[var(--danger)]',
  }[tone];

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('w-full overflow-hidden rounded-full bg-[var(--bg-inset)]', size === 'sm' ? 'h-1' : 'h-1.5', className)}
    >
      <div className={cn('h-full rounded-full transition-[width]', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Segmented meter, used for stock levels against the reorder point. */
export function LevelBar({ ratio, tone }: { ratio: number; tone?: 'brand' | 'warning' | 'danger' }) {
  return <ProgressBar value={ratio} tone={tone ?? (ratio > 1 ? 'success' : ratio >= 0.5 ? 'brand' : 'danger')} size="sm" />;
}

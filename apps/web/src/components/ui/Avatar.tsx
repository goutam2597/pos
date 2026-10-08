import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Avatar.
 *
 * Initials, not a photo: this product has no image pipeline and a stock photo
 * of a shop owner would be worse than their name. The background is a neutral
 * tint rather than a generated colour so a row of avatars does not turn into a
 * fruit salad.
 */

export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-[13px]',
  lg: 'size-12 text-sm',
} as const;

/** First letter of the first and last word — the standard, readable choice. */
export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const label = name?.trim() || 'Unknown';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cn(
          'shrink-0 rounded-full border border-[var(--border-default)] object-cover',
          SIZES[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full',
        'border border-[var(--border-default)] bg-[var(--bg-sunken)] font-medium text-[var(--text-secondary)]',
        SIZES[size],
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}

/** Avatar + name + secondary line, the standard identity row. */
export function PersonCell({
  name,
  secondary,
  avatarSize = 'sm',
  className,
}: {
  name: string;
  secondary?: ReactNode;
  avatarSize?: AvatarProps['size'];
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Avatar name={name} size={avatarSize} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{name}</div>
        {secondary && <div className="truncate text-[12px] text-[var(--text-tertiary)]">{secondary}</div>}
      </div>
    </div>
  );
}

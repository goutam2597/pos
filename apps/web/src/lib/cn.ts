import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class name helper.
 *
 * `clsx` resolves conditionals/arrays/objects; `tailwind-merge` then collapses
 * conflicting Tailwind utilities so a caller's `className` reliably wins over a
 * component's defaults (passing `px-6` to a Button that sets `px-3` must not
 * produce both).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { ClassValue };

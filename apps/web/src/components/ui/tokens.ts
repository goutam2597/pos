/**
 * Shared class fragments.
 *
 * The design tokens in `index.css` are plain CSS custom properties, so they are
 * consumed through Tailwind arbitrary values (`bg-[var(--bg-surface)]`). These
 * fragments keep that verbosity in one place instead of scattering it across
 * forty components — and give a single edit point if a surface ever changes.
 *
 * Every fragment here is direction-agnostic. Nothing in this file may use a
 * physical property (`ml-`, `pl-`, `left-`, `text-right`); RTL correctness is
 * the layout's job, not a per-component afterthought.
 */

/** The three control heights the whole product agrees on. */
export const controlHeight = {
  sm: 'h-[var(--height-control-sm)]',
  md: 'h-[var(--height-control)]',
  lg: 'h-[var(--height-control-lg)]',
} as const;

/** Base typography for a form control, sized to sit correctly in each height. */
export const controlText = {
  sm: 'text-[13px]',
  md: 'text-[13px]',
  lg: 'text-sm',
} as const;

export const radius = {
  sm: 'rounded-[var(--radius-sm)]',
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
} as const;

/** Border that reads as a real edge without shouting. */
export const border = 'border border-[var(--border-default)]';
export const borderSubtle = 'border border-[var(--border-subtle)]';
export const borderStrong = 'border border-[var(--border-strong)]';

/** The standard interactive border, which tints on hover. */
export const controlBorder =
  'border border-[var(--border-default)] hover:border-[var(--border-strong)]';

/** Every text input, select and textarea shares this skeleton. */
export const controlBase =
  'w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] ' +
  'text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] ' +
  'transition-colors hover:border-[var(--border-strong)] ' +
  'disabled:cursor-not-allowed disabled:bg-[var(--bg-sunken)] disabled:text-[var(--text-disabled)] ' +
  'aria-[invalid=true]:border-[var(--danger)]';

export const surface = 'bg-[var(--bg-surface)] text-[var(--text-primary)]';
export const sunken = 'bg-[var(--bg-sunken)]';
export const raised = 'bg-[var(--bg-raised)]';

export const textPrimary = 'text-[var(--text-primary)]';
export const textSecondary = 'text-[var(--text-secondary)]';
export const textTertiary = 'text-[var(--text-tertiary)]';

/** Ring used when a control is invalid; pairs with `aria-invalid`. */
export const invalidRing = 'aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[var(--danger)]';

/** Consistent shadow for anything that floats above the page. */
export const overlayShadow = 'shadow-[var(--shadow-lg)]';
export const raisedShadow = 'shadow-[var(--shadow-md)]';

/** Numeric columns must line up; the base layer already sets tabular-nums. */
export const numeric = 'tabular-nums text-end';

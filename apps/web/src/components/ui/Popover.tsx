import { useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Portal, overlaySurface, useAnchoredPosition, useDismissable, type AnchorRef } from './overlay';

/**
 * Tooltip and Popover.
 *
 * The tooltip is the hover/focus hint; the popover is the click-triggered panel.
 * Both anchor logically so they follow the text direction, and both dismiss on
 * Esc so a keyboard user is never trapped by something decorative.
 */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'bottom' | 'top';
  className?: string;
  /** Delay before showing; 200ms avoids a tooltip flashing on pointer sweeps. */
  delay?: number;
}

export function Tooltip({ content, children, side = 'top', className, delay = 200 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const position = useAnchoredPosition(anchor, panel, { side, gap: 6 });

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <>
      <span
        ref={setAnchor}
        className="inline-flex"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open && content !== null && content !== undefined && content !== '' && (
        <Portal>
          <span
            ref={setPanel}
            role="tooltip"
            style={{ top: position.top, insetInlineStart: position.start }}
            className={cn(
              'pointer-events-none fixed z-[60] max-w-xs rounded-[var(--radius-md)] border border-[var(--border-default)]',
              'bg-[var(--bg-raised)] px-2 py-1 text-[12px] leading-snug text-[var(--text-primary)]',
              'shadow-[var(--shadow-md)]',
              className,
            )}
          >
            {content}
          </span>
        </Portal>
      )}
    </>
  );
}

export interface PopoverProps {
  trigger: (state: { open: boolean; ref: AnchorRef }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  width?: number;
  className?: string;
  label?: string;
}

export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width = 280,
  className,
  label,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const position = useAnchoredPosition(anchor, panel, { align, side });
  const close = () => setOpen(false);

  const surfaceRef = useDismissable<HTMLDivElement>({
    open,
    onClose: close,
    closeOnOutside: true,
    closeOnEscape: true,
    initialFocus: 'none',
  });

  const panelRef = (node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    setPanel(node);
  };

  return (
    <>
      {trigger({
        open,
        ref: (node: HTMLElement | null) => {
          setAnchor(node);
          if (open) close();
        },
      })}

      {open && (
        <Portal>
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{ top: position.top, insetInlineStart: position.start, width }}
            className={cn('fixed z-50 outline-none', overlaySurface, className)}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </Portal>
      )}
    </>
  );
}

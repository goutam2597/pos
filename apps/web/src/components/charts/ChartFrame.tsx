import { useId, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Chart scaffolding shared by every chart in the product.
 *
 * Two things live here that each chart would otherwise get wrong:
 *
 * 1. ACCESSIBILITY. An SVG chart is opaque to a screen reader, so every chart
 *    ships `role="img"` with a real summary AND a visually-hidden data table
 *    carrying the same numbers. The chart is a picture of the data; the table
 *    is the data.
 * 2. THE TOKENS. Colours come from `--chart-1..8`, which flip with the theme.
 *    A chart that hard-codes a hex stops being readable in dark mode.
 */

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? 'var(--chart-1)';
}

export interface DataTableRow {
  label: string;
  values: Record<string, string | number>;
}

export interface ChartFrameProps {
  title: string;
  description?: string;
  /** Sentences that state what the chart shows, for `aria-label`. */
  summary: string;
  /** Columns of the hidden table; the first is always the category label. */
  columns: string[];
  rows: DataTableRow[];
  legend?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  height?: number;
  className?: string;
  /** Renders the chart area; the frame supplies the responsive box. */
  padded?: boolean;
}

export function ChartFrame({
  title,
  description,
  summary,
  columns,
  rows,
  legend,
  actions,
  children,
  height = 220,
  className,
  padded = true,
}: ChartFrameProps) {
  const tableId = useId();

  return (
    <section className={cn('flex flex-col rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)]', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      {legend && <div className="px-4 pb-2">{legend}</div>}

      <div className={cn('min-w-0 flex-1', padded && 'px-2 pb-3')}>
        <div role="img" aria-label={summary} aria-describedby={tableId} style={{ height }}>
          {children}
        </div>
      </div>

      {/* The data, not the picture of the data. */}
      <table id={tableId} className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {columns.map((column) => (
                <td key={column}>{row.values[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Compute a "nice" axis maximum and tick step.
 *
 * Without this, a chart of values 0..97 draws a top gridline at 97 and every bar
 * looks a bit wrong. Rounding to 1/2/5 x 10^n makes the axis readable.
 */
export function niceScale(max: number, tickCount = 4): { max: number; step: number } {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, step: 0.25 };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = nice * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

/** Shared axis/gridline drawing, so every chart's grid lines up exactly. */
export function GridLines({
  width,
  height,
  padding,
  ticks,
  format,
}: {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  ticks: number[];
  format: (value: number) => string;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const y = height - padding.bottom - (tick / ticks[ticks.length - 1]!) * (height - padding.top - padding.bottom);
        return (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="var(--grid-line)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={padding.left - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Legend swatch + label, used by the bar and donut charts. */
export function Legend({ items, className }: { items: Array<{ label: string; color: string; value?: string }>; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: item.color }}
          />
          <span className="truncate">{item.label}</span>
          {item.value && <span className="tabular-nums text-[var(--text-tertiary)]">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

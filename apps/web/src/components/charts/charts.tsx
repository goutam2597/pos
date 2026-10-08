import { useId, useMemo, useState } from 'react';

import { cn } from '../../lib/cn';
import { compactCount } from '../../lib/format';
import { ChartFrame, GridLines, Legend, chartColor, niceScale, type DataTableRow } from './ChartFrame';

/**
 * Hand-rolled SVG charts.
 *
 * No chart library: these four shapes cover everything a shop owner needs to
 * read, and a general charting dependency is 200 kB of JavaScript to draw four
 * hundred lines of SVG. Series colours come from `--chart-1..8`, which are
 * chosen to stay distinguishable in both themes and under the common forms of
 * colour-vision deficiency.
 *
 * Every chart is responsive without a resize observer: the SVG scales with
 * `preserveAspectRatio="none"` on the geometry only, with text rendered at a
 * fixed size on top. That is crude but reliable; a chart that reflows on every
 * window drag is worse than one whose axis text is a touch small on a phone.
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface MultiSeriesPoint {
  label: string;
  values: number[];
}

const VIEW_WIDTH = 640;

// ---------------------------------------------------------------------------
// Line / area
// ---------------------------------------------------------------------------

export interface LineChartProps {
  title: string;
  description?: string;
  data: SeriesPoint[];
  /** Money values get a currency symbol on the axis; counts get compact form. */
  format?: (value: number) => string;
  valueLabel?: string;
  color?: string;
  height?: number;
  /** Fills the area under the line. Reads better for a single series. */
  area?: boolean;
  actions?: React.ReactNode;
}

export function LineChart({
  title,
  description,
  data,
  format = compactCount,
  valueLabel = 'Value',
  color = 'var(--chart-1)',
  height = 220,
  area = true,
  actions,
}: LineChartProps) {
  const gradientId = useId();

  const geometry = useMemo(() => {
    const values = data.map((point) => point.value);
    const rawMax = values.length ? Math.max(...values) : 0;
    const { max, step } = niceScale(rawMax || 1);
    const padding = { top: 10, right: 12, bottom: 22, left: 44 };
    const plotWidth = VIEW_WIDTH - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const xFor = (index: number) =>
      data.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (data.length - 1)) * plotWidth;
    const yFor = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;

    const points = data.map((point, index) => `${xFor(index)},${yFor(point.value)}`);
    const linePath = points.length ? `M ${points.join(' L ')}` : '';
    const areaPath = points.length
      ? `${linePath} L ${xFor(data.length - 1)},${padding.top + plotHeight} L ${xFor(0)},${padding.top + plotHeight} Z`
      : '';

    const ticks: number[] = [];
    for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);

    return { max, padding, plotWidth, plotHeight, xFor, yFor, linePath, areaPath, ticks };
  }, [data, height]);

  const rows: DataTableRow[] = data.map((point) => ({ label: point.label, values: { [valueLabel]: point.value } }));

  const summary =
    data.length === 0
      ? `${title}: no data`
      : `${title}: ${data.length} points from ${data[0]?.label ?? ''} to ${data[data.length - 1]?.label ?? ''}, highest ${format(Math.max(...data.map((d) => d.value)))}`;

  return (
    <ChartFrame
      title={title}
      description={description}
      summary={summary}
      columns={[valueLabel]}
      rows={rows}
      height={height}
      actions={actions}
    >
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} className="size-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <GridLines
          width={VIEW_WIDTH}
          height={height}
          padding={geometry.padding}
          ticks={geometry.ticks}
          format={format}
        />

        {area && geometry.areaPath && <path d={geometry.areaPath} fill={`url(#${gradientId})`} />}
        {geometry.linePath && (
          <path
            d={geometry.linePath}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {data.map((point, index) => (
          <circle
            key={point.label + index}
            cx={geometry.xFor(index)}
            cy={geometry.yFor(point.value)}
            r={2.5}
            fill={color}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Roughly six x labels, so they never overlap. */}
        {data.map((point, index) =>
          data.length <= 8 || index % Math.ceil(data.length / 6) === 0 ? (
            <text
              key={`x-${point.label}-${index}`}
              x={geometry.xFor(index)}
              y={height - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export interface BarChartProps {
  title: string;
  description?: string;
  data: SeriesPoint[];
  format?: (value: number) => string;
  valueLabel?: string;
  height?: number;
  /** A horizontal bar list reads better for long category names. */
  horizontal?: boolean;
  color?: string;
  actions?: React.ReactNode;
}

export function BarChart({
  title,
  description,
  data,
  format = compactCount,
  valueLabel = 'Value',
  height,
  horizontal = false,
  color = 'var(--chart-1)',
  actions,
}: BarChartProps) {
  const max = data.length ? Math.max(...data.map((point) => point.value)) : 0;
  const rows: DataTableRow[] = data.map((point) => ({ label: point.label, values: { [valueLabel]: point.value } }));
  const computedHeight = height ?? (horizontal ? Math.max(120, data.length * 28 + 24) : 220);

  const summary =
    data.length === 0
      ? `${title}: no data`
      : `${title}: ${data.length} categories, largest ${data[0]?.label ?? ''} at ${format(max)}`;

  if (horizontal) {
    return (
      <ChartFrame
        title={title}
        description={description}
        summary={summary}
        columns={[valueLabel]}
        rows={rows}
        height={computedHeight}
        actions={actions}
        padded={false}
      >
        <ul className="flex h-full flex-col justify-center gap-2.5 px-3">
          {data.map((point) => (
            <li key={point.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2.5">
              <span className="truncate text-[12px] text-[var(--text-secondary)]" title={point.label}>
                {point.label}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${max > 0 ? (point.value / max) * 100 : 0}%`,
                    backgroundColor: point.value === 0 ? 'var(--border-strong)' : color,
                  }}
                />
              </span>
              <span className="w-20 text-end text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
                {format(point.value)}
              </span>
            </li>
          ))}
        </ul>
      </ChartFrame>
    );
  }

  const padding = { top: 10, right: 12, bottom: 22, left: 44 };
  const scale = niceScale(max || 1);
  const axisMax = scale.max;
  const ticks: number[] = [];
  for (let value = 0; value <= axisMax + 1e-9; value += scale.step) ticks.push(value);
  const plotWidth = VIEW_WIDTH - padding.left - padding.right;
  const plotHeight = computedHeight - padding.top - padding.bottom;
  const slot = data.length ? plotWidth / data.length : plotWidth;
  const barWidth = Math.max(2, Math.min(28, slot * 0.62));

  return (
    <ChartFrame
      title={title}
      description={description}
      summary={summary}
      columns={[valueLabel]}
      rows={rows}
      height={computedHeight}
      actions={actions}
    >
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${computedHeight}`} className="size-full" preserveAspectRatio="none">
        <GridLines
          width={VIEW_WIDTH}
          height={computedHeight}
          padding={padding}
          ticks={ticks}
          format={format}
        />
        {data.map((point, index) => {
          const barHeight = axisMax > 0 ? (point.value / axisMax) * plotHeight : 0;
          const x = padding.left + index * slot + (slot - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          return (
            <rect
              key={point.label + index}
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 0)}
              rx={2}
              fill={point.value === 0 ? 'var(--border-strong)' : color}
            />
          );
        })}
        {data.map((point, index) =>
          data.length <= 10 || index % Math.ceil(data.length / 10) === 0 ? (
            <text
              key={`x-${point.label}-${index}`}
              x={padding.left + index * slot + slot / 2}
              y={computedHeight - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export interface DonutChartProps {
  title: string;
  description?: string;
  data: Array<{ label: string; value: number }>;
  format?: (value: number) => string;
  valueLabel?: string;
  /** Rendered in the hole; use for the total, which is the point of a donut. */
  centerLabel?: string;
  centerValue?: string;
  height?: number;
  actions?: React.ReactNode;
}

export function DonutChart({
  title,
  description,
  data,
  format = compactCount,
  valueLabel = 'Value',
  centerLabel,
  centerValue,
  height = 220,
  actions,
}: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = data.reduce((sum, point) => sum + point.value, 0);
  const rows: DataTableRow[] = data.map((point) => ({
    label: point.label,
    values: { [valueLabel]: point.value, Share: total > 0 ? `${Math.round((point.value / total) * 100)}%` : '0%' },
  }));

  const size = 168;
  const radius = 68;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = data.map((point, index) => {
    const fraction = total > 0 ? point.value / total : 0;
    const segment = {
      ...point,
      color: chartColor(index),
      dash: fraction * circumference,
      offset: -offset * circumference,
      percent: fraction,
    };
    offset += fraction;
    return segment;
  });

  const summary =
    data.length === 0
      ? `${title}: no data`
      : `${title}: ${data.length} slices, largest ${data[0]?.label ?? ''} at ${format(data[0]?.value ?? 0)} of ${format(total)}`;

  return (
    <ChartFrame
      title={title}
      description={description}
      summary={summary}
      columns={[valueLabel, 'Share']}
      rows={rows}
      height={height}
      actions={actions}
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
        <svg viewBox={`0 0 ${size} ${size}`} className="size-[168px] shrink-0" role="presentation">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-inset)" strokeWidth={stroke} />
          {total > 0 &&
            segments.map((segment, index) => (
              <circle
                key={segment.label + index}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={hovered === index ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(segment.dash - 2, 0)} ${circumference}`}
                strokeDashoffset={segment.offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                className="transition-[stroke-width]"
              />
            ))}
          {(centerValue || centerLabel) && (
            <>
              <text
                x={size / 2}
                y={size / 2 - 2}
                textAnchor="middle"
                fontSize={16}
                fontWeight={600}
                fill="var(--text-primary)"
              >
                {hovered !== null ? format(segments[hovered]?.value ?? 0) : centerValue}
              </text>
              <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">
                {hovered !== null ? segments[hovered]?.label : centerLabel}
              </text>
            </>
          )}
        </svg>

        <Legend
          className="min-w-0 flex-col !items-start gap-1.5"
          items={segments.map((segment) => ({
            label: segment.label,
            color: segment.color,
            value: total > 0 ? `${Math.round(segment.percent * 100)}%` : '—',
          }))}
        />
      </div>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  className?: string;
}

/** Inline trend for a table cell or a KPI tile. No axes, no labels, no legend. */
export function Sparkline({
  data,
  width = 88,
  height = 24,
  color = 'var(--chart-1)',
  label,
  className,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return '';
    const max = Math.max(...data);
    const min = Math.min(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    return data
      .map((value, index) => {
        const x = index * stepX;
        const y = height - ((value - min) / span) * (height - 2) - 1;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [data, width, height]);

  if (!path) return null;

  const last = data[data.length - 1] ?? 0;
  const first = data[0] ?? 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={width}
        cy={height - ((last - (Math.min(...data))) / (Math.max(...data) - Math.min(...data) || 1)) * (height - 2) - 1}
        r={2}
        fill={color}
      />
      <title>{`${label ?? 'Trend'}: ${first} to ${last}`}</title>
    </svg>
  );
}

/** Multi-series line chart, used for revenue vs. profit over time. */
export function MultiLineChart({
  title,
  description,
  data,
  series,
  format = compactCount,
  height = 240,
  actions,
}: {
  title: string;
  description?: string;
  data: MultiSeriesPoint[];
  series: Array<{ name: string; color?: string }>;
  format?: (value: number) => string;
  height?: number;
  actions?: React.ReactNode;
}) {
  const padding = { top: 10, right: 12, bottom: 22, left: 48 };

  const geometry = useMemo(() => {
    const flat = data.flatMap((point) => point.values);
    const { max, step } = niceScale(flat.length ? Math.max(...flat) : 1);
    const plotWidth = VIEW_WIDTH - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xFor = (index: number) =>
      data.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (data.length - 1)) * plotWidth;
    const yFor = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;
    const ticks: number[] = [];
    for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
    return { max, plotWidth, plotHeight, xFor, yFor, ticks };
  }, [data, height]);

  const rows: DataTableRow[] = data.map((point) => ({
    label: point.label,
    values: Object.fromEntries(series.map((s, index) => [s.name, point.values[index] ?? 0])),
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
      summary={`${title}: ${series.map((s) => s.name).join(' and ')} over ${data.length} periods`}
      columns={series.map((s) => s.name)}
      rows={rows}
      height={height}
      actions={actions}
      legend={
        <Legend
          items={series.map((s, index) => ({ label: s.name, color: s.color ?? chartColor(index) }))}
        />
      }
    >
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} className="size-full" preserveAspectRatio="none">
        <GridLines width={VIEW_WIDTH} height={height} padding={padding} ticks={geometry.ticks} format={format} />
        {series.map((s, seriesIndex) => {
          const path = data
            .map((point, index) => {
              const value = point.values[seriesIndex] ?? 0;
              return `${index === 0 ? 'M' : 'L'} ${geometry.xFor(index).toFixed(1)},${geometry.yFor(value).toFixed(1)}`;
            })
            .join(' ');
          return (
            <path
              key={s.name}
              d={path}
              fill="none"
              stroke={s.color ?? chartColor(seriesIndex)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {data.map((point, index) =>
          data.length <= 8 || index % Math.ceil(data.length / 6) === 0 ? (
            <text
              key={point.label + index}
              x={geometry.xFor(index)}
              y={height - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
    </ChartFrame>
  );
}

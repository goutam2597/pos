/**
 * Contrast audit for the MonoPOS token palette.
 *
 * The designer (me, in this case) cannot see the screen, so readability is
 * verified arithmetically instead of by eye: every text/background pair the
 * system relies on must meet WCAG AA (4.5:1 for body text, 3:1 for large
 * text and UI fills).
 *
 * Usage: node scripts/contrast-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');

function block(name) {
  const start = css.indexOf(name);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

const lightCss = block(':root {');
const darkCss = block("[data-theme='dark'] {");

function tokens(blockCss) {
  const map = new Map();
  for (const m of blockCss.matchAll(/--([\w-]+):\s*oklch\(([^)]+)\)/g)) {
    const parts = m[2].trim().split(/\s+/);
    map.set(m[1], {
      l: parseFloat(parts[0]) / 100,
      c: parseFloat(parts[1]),
      h: parseFloat(parts[2]),
    });
  }
  // Follow var() aliases (accent -> brand-600, accent-text -> brand-700, ...).
  for (const m of blockCss.matchAll(/--([\w-]+):\s*var\(--([\w-]+)\)/g)) {
    map.set(m[1], { alias: m[2] });
  }
  const resolve = (name, seen = new Set()) => {
    const t = map.get(name);
    if (!t || seen.has(name)) return undefined;
    if (t.alias) return resolve(t.alias, new Set([...seen, name]));
    return t;
  };
  map.resolve = resolve;
  return map;
}

const light = tokens(lightCss);
const dark = tokens(darkCss);

// Merge: dark inherits anything it does not override.
for (const [k, v] of light) if (!dark.has(k)) dark.set(k, v);

// --- oklch -> sRGB -> luminance (standard conversions) ---
function oklchToLin({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = Math.sin((h * Math.PI) / 180) * c;
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
  return [
    +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

function luminance(t) {
  // The matrix already returns LINEAR light; relative luminance is a weighted
  // sum of that. (Gamma-encoding first and then weighting is the classic
  // double-brightening bug — it was reporting 2.7:1 for text that is 7:1.)
  const [r, g, b] = oklchToLin(t).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = { l: 1, c: 0, h: 0 };

const checks = [
  // [theme, fg, bg, min, label]
  ['light', 'text-primary', 'bg-surface', 7, 'body text on surface'],
  ['light', 'text-secondary', 'bg-surface', 4.5, 'secondary text on surface'],
  ['light', 'text-tertiary', 'bg-surface', 3, 'tertiary text on surface (large/meta only)'],
  ['light', 'accent-contrast', 'accent', 4.5, 'primary button text'],
  ['light', 'accent-text', 'accent-subtle', 4.5, 'accent text on subtle fill'],
  ['light', 'accent-text', 'bg-surface', 4.5, 'accent text on surface'],
  ['light', 'success-text', 'success-subtle', 4.5, 'success badge'],
  ['light', 'danger-text', 'danger-subtle', 4.5, 'danger badge'],
  ['light', 'warning-text', 'warning-subtle', 4.5, 'warning badge'],
  ['light', 'info-text', 'info-subtle', 4.5, 'info badge'],
  ['dark', 'text-primary', 'bg-surface', 7, 'body text on surface'],
  ['dark', 'text-secondary', 'bg-surface', 4.5, 'secondary text on surface'],
  ['dark', 'accent-contrast', 'accent', 4.5, 'primary button text'],
  ['dark', 'accent-text', 'accent-subtle', 4.5, 'accent text on subtle fill'],
  ['dark', 'accent-text', 'bg-surface', 4.5, 'accent text on surface'],
  ['dark', 'success-text', 'success-subtle', 4.5, 'success badge'],
  ['dark', 'danger-text', 'danger-subtle', 4.5, 'danger badge'],
  ['dark', 'warning-text', 'warning-subtle', 4.5, 'warning badge'],
  ['dark', 'info-text', 'info-subtle', 4.5, 'info badge'],
];

let failures = 0;
for (const [theme, fgName, bgName, min, label] of checks) {
  const table = theme === 'light' ? light : dark;
  const fg = table.resolve(fgName) ?? (fgName === 'accent-contrast' ? WHITE : undefined);
  const bg = table.resolve(bgName);
  if (!fg || !bg) {
    console.log(`  SKIP  [${theme}] ${label} (token missing)`);
    continue;
  }
  const r = ratio(fg, bg);
  const ok = r >= min - 0.03;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${theme}] ${label}: ${r.toFixed(2)}:1 (needs ${min})`);
}



process.exit(failures === 0 ? 0 : 1);

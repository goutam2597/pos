/**
 * Generate retail barcodes for every active product and render them as
 * printable PNGs.
 *
 *   node scripts/generate-barcodes.mjs
 *
 * What it does:
 *   1. Reads the active products straight from Postgres (docker exec psql).
 *   2. Assigns an EAN-13 to every product that does not already carry a valid
 *      one. Codes use the GS1 RESTRICTED ("in-store") 200–299 range: a legal
 *      EAN-13 with a correct check digit that can never collide with a real
 *      registered GTIN — exactly what an internal demo-label run wants.
 *      Bogus existing codes (wrong length / bad check digit) are replaced.
 *   3. Writes the new codes back to the DB (touching `updatedAt` so tills
 *      re-pull the products on their next sync).
 *   4. Renders one PNG per product into `barcodes/`, plus `barcodes.csv`
 *      (name, sku, barcode, file) and `index.html`, a printable label sheet.
 *
 * Idempotent: valid existing barcodes are kept, so re-running only repairs
 * missing/invalid codes and re-renders the images.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import bwipjs from 'bwip-js/node';

const OUT_DIR = new URL('../barcodes/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CONTAINER = 'monopos-postgres';

const psql = (sql, input = '') =>
  execSync(`docker exec -i ${CONTAINER} psql -U monopos -d monopos -v ON_ERROR_STOP=1 -f -`, {
    input: sql + (input ? '\n' + input : ''),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

/** Parse one line of psql CSV output (values may be quoted, may contain commas). */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** EAN-13 check digit: weights 1/3 alternating from the left, 12 data digits. */
function ean13CheckDigit(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isValidEan13(code) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

function newInStoreCode(used) {
  // 200 + 9 random digits + check digit — GS1 restricted range.
  for (;;) {
    const body = `200${String(randomInt(0, 1e9)).padStart(9, '0')}`;
    const full = body + ean13CheckDigit(body);
    if (!used.has(full)) {
      used.add(full);
      return full;
    }
  }
}

function slug(name) {
  return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'product';
}

// ---------------------------------------------------------------------------
// 1. Read products
// ---------------------------------------------------------------------------

const csv = psql(
  `COPY (SELECT id, name, coalesce(sku,''), coalesce(barcode,'') FROM "Product" WHERE status = 'ACTIVE' ORDER BY name) TO STDOUT WITH (FORMAT csv);`,
);
const products = csv
  .trim()
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '')
  .map((line) => {
    const [id, name, sku, barcode] = parseCsvLine(line);
    return { id, name, sku, barcode };
  });
if (products.length === 0) throw new Error('No active products found');

// ---------------------------------------------------------------------------
// 2. Assign codes (keep valid ones, generate the rest)
// ---------------------------------------------------------------------------

const used = new Set(products.filter((p) => isValidEan13(p.barcode)).map((p) => p.barcode));
let generated = 0;
for (const p of products) {
  if (isValidEan13(p.barcode)) continue;
  p.barcode = newInStoreCode(used);
  p.changed = true;
  generated++;
}

// ---------------------------------------------------------------------------
// 3. Write back (only changed rows; updatedAt bump drives the till sync feed)
// ---------------------------------------------------------------------------

const updates = products
  .filter((p) => p.changed)
  .map((p) => `UPDATE "Product" SET barcode = '${p.barcode}', "updatedAt" = now() WHERE id = '${p.id}';`)
  .join('\n');
if (updates) psql(updates);

// ---------------------------------------------------------------------------
// 4. Render PNGs + csv + printable sheet
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const renderPng = (code) =>
  bwipjs.toBuffer({
    bcid: 'ean13',
    text: code,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 4,
    paddingheight: 2,
  });

const rows = [];
for (let i = 0; i < products.length; i++) {
  const p = products[i];
  const file = `${String(i + 1).padStart(2, '0')}_${slug(p.name)}_${p.barcode}.png`;
  writeFileSync(OUT_DIR + file, await renderPng(p.barcode));
  rows.push({ ...p, file });
}

const csvOut = [
  'name,sku,barcode,file',
  ...rows.map((r) => [r.name, r.sku, r.barcode, r.file].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')),
].join('\n');
writeFileSync(OUT_DIR + 'barcodes.csv', csvOut + '\n');

const labels = rows
  .map(
    (r) => `      <div class="label">
        <p class="name" title="${r.name.replaceAll('"', '&quot;')}">${r.name}</p>
        <img src="./${r.file}" alt="Barcode ${r.barcode}" />
        <p class="code">${r.barcode}</p>
      </div>`,
  )
  .join('\n');
const sheet = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MonoPOS — product barcodes (${rows.length})</title>
<style>
  body { font: 12px/1.4 system-ui, sans-serif; margin: 16px; color: #111; }
  h1 { font-size: 15px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52mm, 1fr)); gap: 4mm; }
  .label { border: 1px solid #999; border-radius: 4px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; break-inside: avoid; }
  .label .name { margin: 0; font-size: 10.5px; font-weight: 600; min-height: 2.6em; }
  .label img { width: 100%; height: auto; }
  .label .code { margin: 0; font: 11px ui-monospace, monospace; text-align: center; letter-spacing: 1px; }
  @media print { body { margin: 0; } .label { border-color: #ccc; } }
</style>
</head>
<body>
  <h1>MonoPOS product barcodes — ${rows.length} labels</h1>
  <p>Print this sheet (Ctrl+P) and stick the labels on shelf tags or items. Codes are EAN-13 in the GS1 in-store range.</p>
  <div class="grid">
${labels}
  </div>
</body>
</html>
`;
writeFileSync(OUT_DIR + 'index.html', sheet);

console.log(`Products: ${rows.length}`);
console.log(`Generated: ${generated} new code(s); kept ${rows.length - generated} existing`);
console.log(`DB rows updated: ${generated}`);
console.log(`Output folder: ${OUT_DIR}`);

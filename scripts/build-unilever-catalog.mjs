/**
 * Build the catalog from scraped Shwapno Unilever products.
 * Reads shwapno-products.json, picks 50 balanced items, downloads images from
 * the Shwapno CDN, converts BDT -> USD minor units, and creates everything via
 * the MonoPOS API (including one bulk opening-stock adjustment).
 */
import { readFile } from 'node:fs/promises';

const base = 'http://localhost:4000/api/v1';
const WAREHOUSE_ID = 'cmuzjwxoj006sdkifq8v8jbch'; // Main Store Floor
const BDT_PER_USD = 120;

const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

const token = await (async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@monopos.test', password: 'ChangeMe!2026' }),
  });
  const b = await res.json();
  if (!b.data?.accessToken) throw new Error('login failed: ' + JSON.stringify(b).slice(0, 120));
  return b.data.accessToken;
})();
const auth = { Authorization: `Bearer ${token}` };
console.log('logged in');

// --- reference data ---------------------------------------------------------
const cats = await j(await fetch(`${base}/categories`, { headers: auth }));
const catRows = Array.isArray(cats.body.data) ? cats.body.data : cats.body.data?.rows ?? [];
const brands = await j(await fetch(`${base}/brands`, { headers: auth }));
const brandRows = Array.isArray(brands.body.data) ? brands.body.data : brands.body.data?.rows ?? [];
const units = await j(await fetch(`${base}/units`, { headers: auth }));
const unitRows = Array.isArray(units.body.data) ? units.body.data : units.body.data?.rows ?? [];
const eachUnit = (unitRows.find((u) => /each/i.test(u.name)) ?? unitRows[0])?.id ?? null;

let unileverId = brandRows.find((b) => /unilever/i.test(b.name))?.id;
if (!unileverId) {
  const created = await j(
    await fetch(`${base}/brands`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unilever', isActive: true }),
    }),
  );
  unileverId = created.body.data?.id;
  console.log('created brand Unilever:', unileverId ?? created.body);
}

// --- remove the current active catalog --------------------------------------
const list = await j(await fetch(`${base}/products?pageSize=200`, { headers: auth }));
const rows = Array.isArray(list.body.data) ? list.body.data : list.body.data?.rows ?? [];
let removed = 0;
for (const row of rows) {
  const res = await fetch(`${base}/products/${row.id}`, { method: 'DELETE', headers: auth });
  if (res.status === 204) removed += 1;
}
console.log(`removed ${removed} existing active products`);

// --- pick 50 balanced items -------------------------------------------------
const all = JSON.parse(await readFile(new URL('../shwapno-products.json', import.meta.url), 'utf8'))
  .filter((p) => /^[A-Za-z]/.test(p.name) && p.active > 0 && p.img);

const brandOf = (name) => {
  const m = name.match(/^(POND'S|Ponds|Close ?Up|Closeup|Pepsodent|Domex|Glow & Lovely|TRESemm[ée]|Vim|LUX|Lux|Surf Excel|Surf|Dove|Sunsilk|Clear|Lipton|Knorr|Vaseline|Rexona|Cif|Rin|Wheel|Bru|Red Label|Tiger|Horlicks)/i);
  return (m?.[1] ?? name.split(/\s+/)[0]).toLowerCase();
};
const perBrandCap = 5;
const brandCounts = new Map();
const picked = [];
for (const p of all) {
  if (picked.length >= 50) break;
  const b = brandOf(p.name);
  const n = brandCounts.get(b) ?? 0;
  if (n >= perBrandCap) continue;
  brandCounts.set(b, n + 1);
  picked.push(p);
}
console.log(`picked ${picked.length} products across ${brandCounts.size} brands`);

// --- category mapping -------------------------------------------------------
const categoryFor = (name) => {
  const n = name.toLowerCase();
  if (/(toilet|dishwash|dish wash|floor|fabric|softener|detergent|wash powder|bleach|cleaner)/.test(n)) return 'Household';
  if (/(toothpaste|tooth paste|shampoo|serum|moisturis|moisturiz|face ?wash|body wash|soap|deodorant|lotion|gel skin|hair|skin|cream spf|sunscreen)/.test(n)) return 'Personal Care';
  if (/(tea|coffee|soup|ketchup|mayonnaise|noodles|biscuit)/.test(n)) return 'Beverages';
  return 'Groceries';
};

// --- download + upload images, create products ------------------------------
function sniffWebpOrJpeg(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

async function fetchImage(url) {
  // ask the CDN for a smaller rendition than the 1920px the page uses
  const sized = url.replace(/width=\d+/, 'width=800');
  for (const candidate of [sized, url]) {
    try {
      const res = await fetch(candidate, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = sniffWebpOrJpeg(buf);
      if (mime && buf.length > 2500) return { buf, mime };
    } catch { /* next */ }
  }
  return null;
}

const toUsdMinor = (bdt) => Math.round((bdt / BDT_PER_USD) * 100 / 5) * 5;

const stockLines = [];
let made = 0;
for (const item of picked) {
  const img = await fetchImage(item.img);
  if (!img) {
    console.log(`  SKIP (no image) ${item.name.slice(0, 50)}`);
    continue;
  }
  const fd = new FormData();
  fd.append('file', new Blob([img.buf], { type: img.mime }), 'product.img');
  const up = await j(await fetch(`${base}/uploads`, { method: 'POST', headers: auth, body: fd }));
  if (!up.body.data?.url) {
    console.log(`  SKIP (upload ${up.status}) ${item.name.slice(0, 50)}`);
    continue;
  }

  const price = toUsdMinor(item.active);
  const payload = {
    name: item.name.replace(/\s+/g, ' ').slice(0, 200),
    sku: item.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40),
    price,
    costPrice: Math.max(1, Math.round(price * 0.75)),
    categoryId: catRows.find((c) => c.name === categoryFor(item.name))?.id ?? null,
    brandId: unileverId,
    unitId: eachUnit,
    imageUrl: up.body.data.url,
    trackInventory: true,
    status: 'ACTIVE',
  };
  const created = await j(
    await fetch(`${base}/products`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  if (created.status !== 201 && created.status !== 200) {
    console.log(`  FAIL ${item.name.slice(0, 50)}: ${JSON.stringify(created.body).slice(0, 120)}`);
    continue;
  }
  stockLines.push({
    productId: created.body.data.id,
    countedQtyMilli: (15 + ((made * 7) % 46)) * 1000, // 15-60 units
  });
  made += 1;
  if (made % 10 === 0) console.log(`  ${made} created…`);
}

if (stockLines.length > 0) {
  const adjust = await j(
    await fetch(`${base}/inventory/adjust`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouseId: WAREHOUSE_ID, note: 'Opening stock', lines: stockLines }),
    }),
  );
  console.log(`opening stock set for ${adjust.body.data?.count ?? '?'} products (${adjust.status})`);
}

console.log(`\nDONE: ${made} Unilever products created with images`);

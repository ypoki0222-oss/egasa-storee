import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { defaults } from '../src/shared/types';
import { variantRevisionMix } from '../src/shared/commerce';

let mf: Miniflare;
const origin = 'http://store.test';

async function req(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  return mf.dispatchFetch(origin + '/api' + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const b = await build({
    entryPoints: ['src/server/index.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: b.outputFiles[0].text,
      compatibilityDate: '2025-09-01',
      d1Databases: ['DB'],
      kvNamespaces: ["BACKUPS"],
      bindings: {
        APP_ORIGIN: origin,
        ENVIRONMENT: 'development',
        MEDIA_ORIGIN: origin + '/media',
        ENCRYPTION_KEY: btoa('a'.repeat(32)),
        AUTH_PEPPER: 'test-pepper',
        SETUP_TOKEN: 'test-setup',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  // Apply 0001-0019 explicitly (same proven subset as integration.test.ts).
  // Migrations 0020+ begin with comment/inline-Arabic lines that miniflare's
  // D1 exec splitter rejects; production wrangler apply handles them natively.
  // Here we create the extra tables we need directly.
  for (let i = 1; i <= 19; i++) {
    const n = String(i).padStart(4, '0');
    const files = (await readdir('migrations')).filter((f) => f.startsWith(n + '_'));
    if (files[0]) await db.exec(await readFile('migrations/' + files[0], 'utf8'));
  }
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS product_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT UNIQUE, size_label TEXT, color_name TEXT, color_hex TEXT, price_delta INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, image_id TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)',
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS product_reviews (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', locale TEXT NOT NULL DEFAULT 'ar', approved INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS promo_slides (id TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, image_id TEXT, title TEXT NOT NULL DEFAULT '', subtitle TEXT NOT NULL DEFAULT '', cta_text TEXT NOT NULL DEFAULT '', cta_url TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run();
  await db
    .prepare('INSERT OR REPLACE INTO settings VALUES(1,?)')
    .bind(JSON.stringify(defaults))
    .run();
  await db
    .prepare(
      'INSERT OR REPLACE INTO products(id,slug,sku,parent_id,name,description,image,price,minimum,fulfillment,stock,active,featured,supplier,verified,offers,blocks,color,form_color,revision,presentation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      'vp-1',
      'variant-product',
      'VP-SKU',
      null,
      'Variant Product',
      '',
      '',
      10000,
      0,
      2000,
      50,
      1,
      0,
      'test-supplier',
      1,
      '[]',
      '[]',
      '#173d35',
      '#f3f0e9',
      1,
      '{}',
    )
    .run();
  const insertVariant = db.prepare(
    'INSERT OR REPLACE INTO product_variants(id,product_id,sku,size_label,color_name,color_hex,price_delta,stock,image_id,active,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  );
  await insertVariant
    .bind('var-large', 'vp-1', 'VP-SKU-L', 'Large', 'Red', '#ff0000', 500, 10, null, 1, 0)
    .run();
  await insertVariant
    .bind('var-inactive', 'vp-1', 'VP-SKU-X', 'XL', 'Blue', '#0000ff', 700, 5, null, 0, 1)
    .run();
  await insertVariant
    .bind('var-oos', 'vp-1', 'VP-SKU-O', 'Small', 'Green', '#00ff00', 300, 0, null, 1, 2)
    .run();
}, 120000);

afterAll(async () => mf?.dispose());

const mixedRevision = (id: string, delta: number) =>
  variantRevisionMix(1, { id, priceDelta: delta });

describe('variant checkout quote', () => {
  it('prices a variant line as base + price_delta and includes variantId', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: mixedRevision('var-large', 500),
      variantId: 'var-large',
    };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items[0].unitPrice).toBe(10500);
    expect(body.items[0].variantId).toBe('var-large');
    expect(body.items[0].variantLabel).toContain('Large');
    expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('non-variant line prices exactly as before (backward compat)', async () => {
    const line = { productId: 'vp-1', offerId: '', quantity: 1, revision: 1 };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items[0].unitPrice).toBe(10000);
    expect(body.items[0].variantId).toBeUndefined();
  });

  it('rejects stale (unmixed) revision with 409', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: 1,
      variantId: 'var-large',
    };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe('cart_changed');
  });

  it('rejects unknown variant with 409', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: mixedRevision('nope', 500),
      variantId: 'nope',
    };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('variant_unavailable');
  });

  it('rejects inactive variant with 409', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: mixedRevision('var-inactive', 700),
      variantId: 'var-inactive',
    };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('variant_inactive');
  });

  it('rejects out-of-stock variant with 409', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: mixedRevision('var-oos', 300),
      variantId: 'var-oos',
    };
    const res = await req('/checkout/quote', { cart: [line], city: 'Rabat' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('variant_out_of_stock');
  });

  it('fingerprint changes when variant price changes', async () => {
    const line = {
      productId: 'vp-1',
      offerId: '',
      quantity: 1,
      revision: mixedRevision('var-large', 500),
      variantId: 'var-large',
    };
    const fp1 = ((await (await req('/checkout/quote', { cart: [line], city: 'Rabat' })).json()) as any)
      .fingerprint;
    const db = await mf.getD1Database('DB');
    await db.prepare('UPDATE product_variants SET price_delta=600 WHERE id=?').bind('var-large').run();
    const line2 = { ...line, revision: mixedRevision('var-large', 600) };
    const fp2 = ((await (await req('/checkout/quote', { cart: [line2], city: 'Rabat' })).json()) as any)
      .fingerprint;
    expect(fp1).not.toBe(fp2);
    // restore
    await db.prepare('UPDATE product_variants SET price_delta=500 WHERE id=?').bind('var-large').run();
  });
});

#!/usr/bin/env node
/*
 * ============================================================================
 *  مهاجر بيانات Egasa (Firebase/Firestore) → Mowarid (Cloudflare D1 + R2)
 * ============================================================================
 *
 *  هذا السكربت مستقل (لا يعتمد على أي مكتبة خارجية — فقط Node.js المدمجة).
 *  يقرأ تصديراً JSON لقاعدة Firestore ويُخرج:
 *    - ملف SQL جاهز للتطبيق على D1:  <outdir>/import.sql
 *    - الصور المُشفّرة base64 مفكّكة إلى ملفات:  <outdir>/media/<slug>-<n>.<ext>
 *    - manifest للصور التي تحتاج رفعاً يدوياً إلى R2: <outdir>/media-manifest.json
 *    - تقرير بالعدّادات والأخطاء: <outdir>/migration-report.json
 *
 *  الاستخدام:
 *    node scripts/migrate-from-egasa.mjs --input export.json --outdir migration-out
 *    node scripts/migrate-from-egasa.mjs --input export.json --outdir migration-out --dry-run
 *    node scripts/migrate-from-egasa.mjs --help
 *
 *  يقبل الشكلين التاليين لملف التصدير (يكتشف تلقائياً):
 *    1) متداخل: { "products": { "<id>": {...}, ... }, "orders": {...}, "settings": { "global": {...} } }
 *    2) مسطّح:  { "products": [...], "orders": [...], "settings": {...} }
 *
 *  ملاحظة حول الصور: Mowarid يقدّم الصور من R2 بصيغة webp عبر /media/:id. هذا
 *  السكربت يحتفظ بالصيغة الأصلية؛ للتحويل إلى webp يمكنك استخدام sharp بعد
 *  التثبيت (npm i -D sharp) بسطر واحد:
 *    node -e "const s=require('sharp'),f=require('fs'),p=require('path');\
 *    for(const x of f.readdirSync('migration-out/media').filter(x=>!/\.webp$/.test(x)))\
 *    s('migration-out/media/'+x).webp({quality:82}).toFile('migration-out/media/'+x.replace(/\.[^.]+$/,'')+'.webp');"
 *  ثم ارفع ملفات .webp إلى R2 وحدّد product.image / gallery / variants.image_id
 *  من لوحة التحكم (انظر media-manifest.json).
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// الأدوات المساعدة
// ---------------------------------------------------------------------------
const log = (...a) => console.error('[migrate]', ...a);

function sha12(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

function slugify(s) {
  const out = String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return out || 'product';
}

function skuPart(s) {
  return String(s || 'one')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'one';
}

// تهريب القيم لـ SQL: النصوص تُلفّ بعلامتا اقتباس مفردة وتُضاعف العلامة داخلياً.
function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}
const qj = (v) => q(JSON.stringify(v ?? null));

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function isoDate(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const MIME_EXT = {
  png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif',
  'svg+xml': 'svg', bmp: 'bmp', 'x-icon': 'ico', avif: 'avif',
};

const DATA_URL_RE = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

// ---------------------------------------------------------------------------
// تحليل الوسائط
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { input: null, outdir: null, dryRun: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--input' || a === '-i') args.input = argv[++i];
    else if (a === '--outdir' || a === '-o') args.outdir = argv[++i];
    else if (a.startsWith('--input=')) args.input = a.slice(8);
    else if (a.startsWith('--outdir=')) args.outdir = a.slice(9);
  }
  return args;
}

function printHelp() {
  console.log(`
migrate-from-egasa.mjs — Egasa Firestore → Mowarid D1/R2

USAGE:
  node scripts/migrate-from-egasa.mjs --input <export.json> --outdir <dir> [--dry-run]

OPTIONS:
  --input <path>    مسار ملف تصدير Firestore (JSON). يقبل الشكل المتداخل والمسطّح.
  --outdir <dir>    مجلد الإخراج (يُنشأ تلقائياً).
  --dry-run         لا يكتب أي ملف؛ يطبع العدّادات فقط.
  --help, -h        هذه المساعدة.

OUTPUTS (inside <outdir>):
  import.sql              جميع أوامر INSERT ملفوفة داخل معاملة (transaction).
  media/                  الصور المفكّكة من base64 (<slug>-<n>.<ext>).
  media-manifest.json     خريطة الصور (المستخرجة + تلك التي تحتاج رفعاً يدوياً).
  migration-report.json   عدّادات + أخطاء + عناصر تم تخطيها + خطوات تالية.

IDEMPOTENCY:
  يستخدم INSERT OR IGNORE و slugs فريدة؛ يمكن إعادة التشغيل آمناً.
`);
}

// ---------------------------------------------------------------------------
// تطبيع شكل الإدخال: كائن متداخل {id: doc} أم مصفوفة [doc]؟
// ---------------------------------------------------------------------------
function normalizeCollection(value, fallbackKey) {
  if (Array.isArray(value)) {
    return value.map((doc, i) => ({ ...doc, __id: doc.id || doc.slug || `${fallbackKey}-${i}` }));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, doc]) => ({
      ...(doc && typeof doc === 'object' ? doc : {}),
      __id: (doc && doc.id) || k,
    }));
  }
  return [];
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object') return {};
  // قد تكون { global: {...} } أو مباشرة {...}
  if (value.global && typeof value.global === 'object' && !Array.isArray(value.global)) {
    return value.global;
  }
  return value;
}

// ---------------------------------------------------------------------------
// تعيين حالة الطلب من Egasa إلى حالات Mowarid
// ---------------------------------------------------------------------------
function mapOrderStatus(s) {
  const v = String(s || '').toLowerCase().trim();
  if (['delivered', 'completed', 'done', 'success'].includes(v)) return 'delivered';
  if (['shipped', 'out_for_delivery', 'out_for_delivery', 'shipping', 'in_transit'].includes(v)) return 'shipped';
  if (['confirmed', 'validated', 'processing', 'accepted', 'paid'].includes(v)) return 'confirmed';
  if (['cancelled', 'canceled', 'refused', 'rejected', 'failed', 'returned', 'refunded'].includes(v)) return 'cancelled';
  return 'pending_confirmation';
}

// ---------------------------------------------------------------------------
// الرئيسي
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  if (!args.input) {
    log('خطأ: --input مطلوب. استخدم --help للمساعدة.');
    process.exit(2);
  }
  if (!args.dryRun && !args.outdir) {
    log('خطأ: --outdir مطلوب (أو استخدم --dry-run). استخدم --help للمساعدة.');
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  } catch (e) {
    log('خطأ: تعذر قراءة/تحليل ملف الإدخال:', e.message);
    process.exit(2);
  }

  const shape = Array.isArray(raw.products) ? 'flat' : (raw.products && typeof raw.products === 'object') ? 'nested' : 'unknown';
  const products = normalizeCollection(raw.products, 'product');
  const orders = normalizeCollection(raw.orders, 'order');
  const settings = normalizeSettings(raw.settings);

  const report = {
    generatedAt: new Date().toISOString(),
    inputFile: path.resolve(args.input),
    shapeDetected: shape,
    counts: { products: 0, categories: 0, variants: 0, reviews: 0, orders: 0, orderItems: 0, mediaExtracted: 0, mediaManual: 0, settingsKeys: 0 },
    skipped: [],
    errors: [],
    warnings: [],
    nextSteps: [],
  };
  const mediaManifest = [];
  const sqlLines = [];
  sqlLines.push(`-- Generated by scripts/migrate-from-egasa.mjs at ${new Date().toISOString()}`);
  sqlLines.push(`-- Source: ${path.resolve(args.input)} (shape: ${shape})`);
  sqlLines.push(`PRAGMA foreign_keys=ON;`);
  sqlLines.push(`BEGIN TRANSACTION;`);

  const usedProductIds = new Set();
  const usedSkus = new Set();
  const usedSlugs = new Set();
  const categoryIds = new Map(); // name -> id

  function uniqueId(base, used) {
    let id = base;
    let n = 1;
    while (used.has(id)) { id = `${base}-${n++}`; }
    used.add(id);
    return id;
  }

  // -------------------------------------------------------------------------
  // 1) الإعدادات (settings) — ندمج المفاتيح المعروفة داخل settings JSON
  // -------------------------------------------------------------------------
  const setKeys = {};
  if (settings.storeName || settings.store_name || settings.name) setKeys.brand = settings.storeName || settings.store_name || settings.name;
  if (settings.whatsapp || settings.whatsApp || settings.whatsappNumber) setKeys.whatsapp = settings.whatsapp || settings.whatsApp || settings.whatsappNumber;
  if (settings.currency) setKeys.currency_code = String(settings.currency).toUpperCase();
  if (settings.currencySymbol || settings.currency_symbol) setKeys.currency_symbol = settings.currencySymbol || settings.currency_symbol;
  if (settings.freeShippingThreshold != null) setKeys.cartFreeShippingThreshold = toCents(settings.freeShippingThreshold);
  if (settings.shippingCasa != null) setKeys.shippingCasa = Number(settings.shippingCasa);
  if (settings.shippingOther != null) setKeys.shippingOther = Number(settings.shippingOther);
  if (settings.announcement || settings.announcementBar) setKeys.announcement = settings.announcement || settings.announcementBar;
  if (settings.heroTitle || settings.hero?.title) setKeys.heroTitle = settings.heroTitle || settings.hero?.title;
  if (settings.heroText || settings.hero?.text) setKeys.heroText = settings.heroText || settings.hero?.text;
  if (settings.facebookPixel || settings.pixelId) setKeys.facebookPixel = settings.facebookPixel || settings.pixelId;
  if (settings.tiktokPixel) setKeys.tiktokPixel = settings.tiktokPixel;
  if (settings.googleId || settings.gtagId) setKeys.googleId = settings.googleId || settings.gtagId;
  if (settings.googleAdsId) setKeys.googleAdsId = settings.googleAdsId;
  if (settings.googleSheetsWebhook || settings.sheetsWebhook || settings.webhookUrl) setKeys.google_sheets_webhook = settings.googleSheetsWebhook || settings.sheetsWebhook || settings.webhookUrl;

  if (Object.keys(setKeys).length) {
    report.counts.settingsKeys = Object.keys(setKeys).length;
    // القيم القياسية (نص/رقم) تُمرّر مباشرة؛ json_set يحولها إلى JSON تلقائياً.
    const pairs = Object.entries(setKeys).map(([k, v]) => `'$.${k}', ${q(v)}`).join(', ');
    // عند INSERT أولي نضع الكائن كاملاً؛ عند تعارض المفتاح ندمج json_set.
    const freshJson = q(JSON.stringify(setKeys));
    sqlLines.push(`-- settings (from Egasa settings/global)`);
    sqlLines.push(`INSERT INTO settings(id, json) VALUES(1, json(${freshJson})) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json, ${pairs});`);
  }

  // -------------------------------------------------------------------------
  // 2) التصنيفات (categories) — نجمعها من المنتجات أولاً
  // -------------------------------------------------------------------------
  for (const p of products) {
    const catName = (p.category && typeof p.category === 'object') ? (p.category.name || p.category.slug) : p.category;
    if (!catName) continue;
    const name = String(catName).trim();
    if (!categoryIds.has(name)) {
      categoryIds.set(name, `egc_${sha12('cat:' + name)}`);
    }
  }
  let catPos = 0;
  for (const [name, id] of categoryIds) {
    sqlLines.push(`INSERT OR IGNORE INTO categories(id, name, image, icon, position, active) VALUES(${q(id)}, ${q(name)}, '', '🛍️', ${catPos++}, 1);`);
    report.counts.categories++;
  }

  // -------------------------------------------------------------------------
  // 3) المنتجات + الصور + المتنوعات + التقييمات
  // -------------------------------------------------------------------------
  const productIdByOriginal = new Map(); // originalId -> mowarid id
  const productSlugByOriginal = new Map();

  for (const p of products) {
    const originalId = String(p.__id || p.id || '');
    const name = String(p.name || '').trim() || `Product ${originalId}`;
    let slug = slugify(p.slug || name);
    let slugN = 1;
    const baseSlug = slug;
    while (usedSlugs.has(slug)) { slug = `${baseSlug}-${++slugN}`; }
    usedSlugs.add(slug);
    const sku = uniqueId(skuPart(slug), usedSkus);
    const prodId = uniqueId(`egp_${sha12('prod:' + (originalId || slug))}`, usedProductIds);
    productIdByOriginal.set(originalId, prodId);
    productSlugByOriginal.set(originalId, slug);

    const priceCents = toCents(p.price);
    if (priceCents <= 0) {
      report.warnings.push(`المنتج ${slug}: السعر ${p.price} غير صالح (يجب أن يكون >0)؛ عُيّن إلى 1 سنت.`);
    }
    const finalPrice = priceCents > 0 ? priceCents : 1;

    const hidden = p.hidden === true || p.hidden === 'true' || p.hidden === 1;
    const active = hidden ? 0 : 1;
    const inStock = !(p.inStock === false || p.inStock === 'false' || p.inStock === 0);
    const stock = inStock ? 999 : 0;

    // الوصف النصي + HTML المبني من المميزات
    const features = Array.isArray(p.features) ? p.features.filter(Boolean).map(String) : [];
    const descText = String(p.description || '').trim() || features.join('\n');
    const descriptionHtml = [
      descText ? `<p>${escapeHtml(descText)}</p>` : '',
      features.length ? `<ul>${features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : '',
    ].join('\n');

    // التصنيف
    const catNameRaw = (p.category && typeof p.category === 'object') ? (p.category.name || p.category.slug) : p.category;
    const categoryId = catNameRaw ? categoryIds.get(String(catNameRaw).trim()) : null;

    // استخراج الصور
    let mediaCounter = 0;
    const mediaRefs = { customImage: null, gallery: [] };
    const imageFields = []; // {field, index, value}
    if (p.customImage) imageFields.push({ field: 'customImage', index: 0, value: p.customImage });
    if (Array.isArray(p.galleryImages)) {
      p.galleryImages.forEach((g, i) => imageFields.push({ field: 'gallery', index: i, value: g }));
    }
    for (const im of imageFields) {
      const val = typeof im.value === 'string' ? im.value : (im.value && im.value.url) || null;
      if (!val) continue;
      const m = DATA_URL_RE.exec(val.trim());
      if (m) {
        const ext = MIME_EXT[m[1].toLowerCase()] || 'bin';
        const fname = `${slug}-${mediaCounter}.${ext}`;
        let bytes = 0;
        try {
          const b64 = m[2].replace(/\s+/g, '');
          const buf = Buffer.from(b64, 'base64');
          bytes = buf.length;
          if (!args.dryRun) {
            fs.mkdirSync(path.join(args.outdir, 'media'), { recursive: true });
            fs.writeFileSync(path.join(args.outdir, 'media', fname), buf);
          }
          report.counts.mediaExtracted++;
        } catch (e) {
          report.errors.push(`المنتج ${slug} حقل ${im.field}[${im.index}]: فشل فك base64 — ${e.message}`);
          continue;
        }
        mediaManifest.push({ productId: prodId, productSlug: slug, field: im.field, index: im.index, kind: 'extracted', outputFile: `media/${fname}`, mime: `image/${m[1]}`, bytes });
        if (im.field === 'customImage') mediaRefs.customImage = `media/${fname}`;
        else mediaRefs.gallery.push(`media/${fname}`);
        mediaCounter++;
      } else {
        report.counts.mediaManual++;
        mediaManifest.push({ productId: prodId, productSlug: slug, field: im.field, index: im.index, kind: 'manual', originalPath: val });
      }
    }

    // presentation JSON — نحفظ كل الحقول الإضافية لEgasa للرجوع إليها
    const presentation = {
      badge: p.badge || null,
      pageTemplate: p.pageTemplate || null,
      originalPrice: p.originalPrice != null ? toCents(p.originalPrice) : null,
      rating: Number(p.rating) || null,
      reviewsCount: Number(p.reviewsCount) || 0,
      features,
      fabrics: Array.isArray(p.fabrics) ? p.fabrics : [],
      customizations: Array.isArray(p.customizations) ? p.customizations : [],
      priceCustomizations: Array.isArray(p.priceCustomizations) ? p.priceCustomizations : [],
      formPlaceholders: p.formPlaceholders || null,
      citiesConfig: p.citiesConfig || null,
      reviewsEnabled: p.reviewsEnabled !== false,
      showDetailsBeforeForm: p.showDetailsBeforeForm,
      showBottomOrderForm: p.showBottomOrderForm,
      hasDescriptionBorder: p.hasDescriptionBorder,
      showDescriptionTitle: p.showDescriptionTitle,
      imageSvgType: p.imageSvgType || null,
      currency: p.currency || null,
      language: p.language || p.pageLanguageOverride || null,
      bundleOffer: p.bundleOffer || null,
      descriptionHtml,
      mediaRefs,
      egasaImport: { originalId, importedAt: new Date().toISOString() },
    };

    const keywords = [name, catNameRaw || ''].filter(Boolean).join(' ').slice(0, 500);

    sqlLines.push(`-- product: ${slug} (${name})`);
    sqlLines.push(
      `INSERT OR IGNORE INTO products(id, slug, sku, name, description, image, price, minimum, stock, active, featured, supplier, verified, offers, blocks, color, form_color, revision, category_id, page_mode, storefront_visible, gallery, presentation, keywords) VALUES (` +
      [q(prodId), q(slug), q(sku), q(name), q(descText), q(''), finalPrice, 1, stock, active, 0, q('egasa-import'), 0, qj([]), qj([]), q('#173d35'), q('#f3f0e9'), 1, categoryId ? q(categoryId) : 'NULL', q('product'), active, qj([]), qj(presentation), q(keywords)].join(', ') +
      `);`
    );
    report.counts.products++;

    // 3 أ) المتنوعات: sizes × colors
    const sizes = Array.isArray(p.sizes) ? p.sizes.filter(Boolean).map(String) : [];
    const colors = Array.isArray(p.colors) ? p.colors : [];
    const sizeList = (p.sizesEnabled === false) ? [] : (sizes.length ? sizes : ['']);
    const colorList = (p.colorsEnabled === false) ? [] : (colors.length ? colors : [null]);
    if (sizes.length || colors.length) {
      let sort = 0;
      for (const sz of sizeList) {
        for (const c of colorList) {
          if (!sz && c === null) continue; // لا متنوع إذا لم يكن هناك أبعاد أصلاً
          const colorName = c && typeof c === 'object' ? (c.name || '') : (c ? String(c) : '');
          const colorHex = c && typeof c === 'object' ? (c.hex || '') : '';
          const vsku = uniqueId(`${sku}-${skuPart(sz)}-${skuPart(colorName)}`, usedSkus);
          const vid = `egv_${sha12(`var:${prodId}:${sz}:${colorName}`)}`;
          sqlLines.push(
            `INSERT OR IGNORE INTO product_variants(id, product_id, sku, size_label, color_name, color_hex, price_delta, stock, image_id, active, sort) VALUES (` +
            [q(vid), q(prodId), q(vsku), q(sz || null), q(colorName || null), q(colorHex || null), 0, stock, 'NULL', 1, sort++].join(', ') +
            `);`
          );
          report.counts.variants++;
        }
      }
    }

    // 3 ب) التقييمات المخصصة
    if (Array.isArray(p.customReviews) && p.customReviews.length) {
      const locale = p.language || p.pageLanguageOverride || 'ar';
      p.customReviews.forEach((r, i) => {
        if (!r || typeof r !== 'object') return;
        const rating = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5)));
        const rid = `egr_${sha12(`rev:${prodId}:${i}:${r.author || ''}:${(r.text || '').slice(0, 20)}`)}`;
        sqlLines.push(
          `INSERT OR IGNORE INTO product_reviews(id, product_id, author, rating, text, locale, approved, created_at) VALUES (` +
          [q(rid), q(prodId), q(r.author || ''), rating, q(r.text || ''), q(locale), 1, q(isoDate(r.date))].join(', ') +
          `);`
        );
        report.counts.reviews++;
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4) الطلبات (أرشيف) — تُدرج في جدول orders مع source='egasa-import'
  // -------------------------------------------------------------------------
  let orderSeq = 0;
  for (const o of orders) {
    orderSeq++;
    const originalId = String(o.__id || o.id || `order-${orderSeq}`);
    const oid = `ego_${sha12('order:' + originalId)}`;
    const ref = `EG-${String(orderSeq).padStart(6, '0')}`;
    const customer = {
      name: o.customerName || o.name || o.customer || '',
      phone: o.phone || o.customerPhone || '',
      city: o.city || '',
      address: o.address || o.customerAddress || '',
      source: 'egasa-import',
      originalId,
    };
    const items = Array.isArray(o.items) ? o.items : [];
    const quoteItems = items.map((it) => {
      const origPid = String(it.productId || it.id || it.product_id || '');
      const mPid = productIdByOriginal.get(origPid);
      const mSlug = productSlugByOriginal.get(origPid);
      return {
        productId: mPid || origPid,
        slug: mSlug || null,
        quantity: Number(it.quantity || it.qty || 1),
        size: it.selectedSize || it.size || null,
        color: it.selectedColor || (it.color && it.color.name) || it.color || null,
        unitPrice: toCents(it.price || it.unitPrice || 0),
      };
    });
    const totalCents = toCents(o.total) || quoteItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const quote = { items: quoteItems, total: totalCents, currency: settings.currency || o.currency || 'MAD', source: 'egasa-import' };
    const status = mapOrderStatus(o.status);
    const createdAt = isoDate(o.createdAt || o.created_at || o.timestamp);

    sqlLines.push(`-- order: ${ref} (${customer.name} ${customer.phone})`);
    sqlLines.push(
      `INSERT OR IGNORE INTO orders(id, ref, idempotency, request_hash, customer, supplier, quote, attribution, matching, status, sync_status, source, created_at, delivered_total) VALUES (` +
      [
        q(oid), q(ref), q(`egasa-import-${originalId}`), q(sha12(JSON.stringify(o))),
        qj(customer), q('egasa-import'), qj(quote), qj({ source: 'egasa-import', originalId }), qj({}),
        q(status), q('archived'), q('egasa-import'), q(createdAt),
        status === 'delivered' ? totalCents : 'NULL',
      ].join(', ') + `);`
    );
    report.counts.orders++;

    for (const [i, it] of quoteItems.entries()) {
      const iid = `egi_${sha12(`item:${oid}:${i}`)}`;
      const vsku = it.size || it.color ? `${skuPart(it.slug || 'p')}-${skuPart(it.size)}-${skuPart(it.color)}` : (it.slug || 'egasa');
      sqlLines.push(
        `INSERT OR IGNORE INTO order_items(id, order_id, product_id, sku, quantity, unit_price, snapshot) VALUES (` +
        [q(iid), q(oid), q(it.productId), q(vsku), it.quantity, it.unitPrice, qj({ size: it.size, color: it.color })].join(', ') + `);`
      );
      report.counts.orderItems++;
    }
  }

  sqlLines.push(`COMMIT;`);
  sqlLines.push('');

  // -------------------------------------------------------------------------
  // كتابة المخرجات (أو طباعة العدّادات في dry-run)
  // -------------------------------------------------------------------------
  report.nextSteps = [
    '1) رفع محتويات migration-out/media إلى R2 (wrangler r2 object put ...) أو من لوحة تحكم الوسائط.',
    '2) بعد الرفع، حدّد product.image و gallery و product_variants.image_id بمعرّفات الوسائط UUID الجديدة (انظر media-manifest.json).',
    '3) طبّق import.sql: wrangler d1 execute DB --remote --file migration-out/import.sql',
    '4) تحقق من المنتجات في /admin واختبر طلباً تجريبياً.',
  ];

  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, counts: report.counts, shapeDetected: shape, warnings: report.warnings, errors: report.errors }, null, 2));
    return;
  }

  fs.mkdirSync(args.outdir, { recursive: true });
  fs.writeFileSync(path.join(args.outdir, 'import.sql'), sqlLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(args.outdir, 'media-manifest.json'), JSON.stringify(mediaManifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(args.outdir, 'migration-report.json'), JSON.stringify(report, null, 2), 'utf8');

  log('اكتمل الاستيراد.');
  log('العدّادات:', JSON.stringify(report.counts));
  if (report.warnings.length) log('تحذيرات:', report.warnings.length);
  if (report.errors.length) log('أخطاء:', report.errors.length);
  log('الملفات:', `${args.outdir}/import.sql, ${args.outdir}/media-manifest.json, ${args.outdir}/migration-report.json, ${args.outdir}/media/`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main().catch((e) => {
  log('خطأ غير متوقع:', e.stack || e.message);
  process.exit(1);
});

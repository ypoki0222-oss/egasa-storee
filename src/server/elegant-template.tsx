/** @jsxImportSource hono/jsx */
// Elegant product page template + shared storefront subcomponents.
// Self-contained: does NOT import from views.tsx (avoids circular deps).
// views.tsx renders <OrderForm/> and passes it as the `orderForm` prop.
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Product, ProductPresentation, ProductReview, Settings } from '../shared/types';
import { money as formatMoney, defaults } from '../shared/types';
import { safeProductHtml } from './product-content';

// presentation JSON may carry Egasa-imported keys not yet in the TS type.
export type StorefrontPresentation = ProductPresentation & {
  badge?: string;
  pageTemplate?: 'classic' | 'elegant';
  ratingAvg?: number;
  reviewsCount?: number;
};
export function presentationOf(p: { presentation?: ProductPresentation }): StorefrontPresentation {
  return (p.presentation || {}) as StorefrontPresentation;
}
export function currencyOf(s: Settings) {
  return { code: s.currency_code, symbol: s.currency_symbol, rate: s.currency_rate };
}
export function activeVariants(p: Product) {
  return (p.variants || [])
    .filter((v) => v.active)
    .sort((a, b) => a.sort - b.sort);
}
function variantLabel(v: { sizeLabel?: string | null; colorName?: string | null } | null) {
  if (!v) return '';
  return [v.sizeLabel, v.colorName].filter((x): x is string => !!x).join(' · ');
}

// --- Star rating (★ via unicode, styled by .reviews-stars in styles.css) ---
export function StarRating({
  avg,
  count,
  size = 'md',
}: {
  avg?: number;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const value = Number(avg) || 0;
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const stars = Array.from({ length: 5 }, (_, i) => {
    if (i < full) return '★';
    if (i === full && half) return '⯨';
    return '☆';
  }).join('');
  return (
    <span class={'reviews-stars reviews-stars--' + size} aria-label={value + ' / 5'}>
      <span class="reviews-stars-track" aria-hidden="true">
        {'★★★★★'}
      </span>
      <span class="reviews-stars-fill" aria-hidden="true" style={{ width: Math.min(100, (value / 5) * 100) + '%' }}>
        {'★★★★★'}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span class="reviews-count">({count})</span>
      )}
    </span>
  );
}

// --- Variant picker SSR markup (wired by /variant-picker.js) ---------------
export function VariantPicker({ p, s, originalPrice }: { p: Product; s: Settings; originalPrice?: number }) {
  const variants = activeVariants(p);
  if (!variants.length) return null;
  const first = variants[0];
  const sizes = Array.from(new Set(variants.map((v) => v.sizeLabel).filter((x): x is string => !!x)));
  const colors = Array.from(
    new Map(
      variants
        .filter((v) => !!v.colorName)
        .map((v) => [v.colorName as string, v.colorHex || '#cccccc'] as [string, string]),
    ).entries(),
  );
  const cur = currencyOf(s);
  const unitPrice = p.price + (first?.priceDelta || 0);
  return (
    <div class="variant-picker" data-variant-picker data-product-id={p.id}>
      {sizes.length > 0 && (
        <div class="variant-group">
          <p class="variant-group-label">المقاس</p>
          <div class="variant-sizes" role="group" aria-label="المقاس">
            {sizes.map((size, i) => (
              <button
                type="button"
                class={'variant-size-btn' + (size === first.sizeLabel ? ' is-selected' : '')}
                data-variant-size={size}
                aria-pressed={size === first.sizeLabel}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}
      {colors.length > 0 && (
        <div class="variant-group">
          <p class="variant-group-label">اللون</p>
          <div class="variant-colors" role="group" aria-label="اللون">
            {colors.map(([name, hex]) => (
              <button
                type="button"
                class={'variant-color-swatch' + (name === first.colorName ? ' is-selected' : '')}
                data-variant-color={name}
                title={name}
                aria-pressed={name === first.colorName}
                style={{ '--swatch': hex }}
              >
                <span class="variant-color-dot" style={{ background: hex }} />
                <span class="variant-color-name">{name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="variant-price-row">
        <span class="variant-price" data-variant-price>
          {formatMoney(unitPrice, s.storeLanguage, cur)}
        </span>
        {originalPrice && originalPrice > unitPrice ? (
          <span class="variant-original-price" data-variant-original-price>
            {formatMoney(originalPrice, s.storeLanguage, cur)}
          </span>
        ) : (
          <span class="variant-original-price" data-variant-original-price hidden />
        )}
        <span
          class={'variant-stock' + (first && first.stock < 1 ? ' is-out' : first && first.stock <= 5 ? ' is-low' : '')}
          data-variant-stock
          data-stock={String(first?.stock ?? 0)}
        >
          {first && first.stock < 1
            ? 'نفد من المخزن'
            : first && first.stock <= 5
              ? 'فقط ' + first.stock + ' متبقي'
              : 'متوفر في المخزن'}
        </span>
      </div>
      <input type="hidden" name="variantId" value={first?.id || ''} />
    </div>
  );
}

// --- Reviews summary (stars + count; full list if reviews prop passed) -----
export function ReviewsSection({
  p,
  reviews,
  s,
}: {
  p: Product;
  reviews?: ProductReview[];
  s: Settings;
}) {
  const pres = presentationOf(p);
  const avg = Number(pres.ratingAvg) || 0;
  const count = Number(pres.reviewsCount) || (reviews?.length || 0);
  if (!avg && !count && !reviews?.length) return null;
  return (
    <section class="product-reviews" aria-label="تقييمات المنتج">
      <div class="product-reviews-summary">
        <StarRating avg={avg} count={count} size="lg" />
        {avg > 0 && <span class="reviews-average">{avg.toFixed(1)} / 5</span>}
      </div>
      {reviews && reviews.length > 0 && (
        <ul class="reviews-list">
          {reviews.slice(0, 12).map((r) => (
            <li class="review-item" key={r.id}>
              <header class="review-item-head">
                <span class="review-author">{r.author || 'عميل'}</span>
                <StarRating avg={r.rating} size="sm" />
                {r.createdAt && <time class="review-date">{r.createdAt.slice(0, 10)}</time>}
              </header>
              {r.text && <p class="review-text">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Badge tag -------------------------------------------------------------
export function BadgeTag({ p }: { p: Product }) {
  const badge = presentationOf(p).badge;
  if (!badge) return null;
  return <span class="product-badge">{badge}</span>;
}

// --- Elegant product page (two-column, sticky buy-box) ---------------------
export function ElegantProductPage({
  p,
  s,
  orderForm,
  recommendations = [],
  reviews,
  originalPrice,
}: {
  p: Product;
  s: Settings;
  orderForm: Child;
  recommendations?: Product[];
  reviews?: ProductReview[];
  originalPrice?: number;
}) {
  const cur = currencyOf(s);
  const gallery = Array.from(new Set([p.image, ...(p.gallery || [])].filter(Boolean)));
  const pres = presentationOf(p);
  const descriptionHtml =
    pres.descriptionFormat === 'html'
      ? safeProductHtml(pres.descriptionHtml || '')
      : '';
  return (
    <main class="elegant-product-page">
      <div class="elegant-grid">
        <div class="elegant-gallery" data-variant-image={p.id}>
          <div class="elegant-gallery-main">
            <img src={gallery[0] || p.image} alt={p.name} width={900} height={900} />
            <BadgeTag p={p} />
          </div>
          {gallery.length > 1 && (
            <div class="elegant-gallery-thumbs">
              {gallery.slice(1, 6).map((src) => (
                <button type="button" class="elegant-thumb" data-gallery-image={src}>
                  <img src={src} alt="" width={120} height={120} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div class="elegant-buybox">
          <div class="elegant-buybox-sticky">
            <p class="elegant-eyebrow">{s.home.productsEyebrow || defaults.home.productsEyebrow}</p>
            <h1 class="elegant-title">{p.name}</h1>
            <div class="elegant-rating-row">
              <StarRating avg={pres.ratingAvg} count={pres.reviewsCount} size="sm" />
            </div>
            <div class="elegant-price-row">
              <span class="elegant-price">{formatMoney(p.price, s.storeLanguage, cur)}</span>
              {originalPrice && originalPrice > p.price && (
                <span class="elegant-original-price">{formatMoney(originalPrice, s.storeLanguage, cur)}</span>
              )}
            </div>
            <VariantPicker p={p} s={s} originalPrice={originalPrice} />
            <div class="elegant-trust">
              <span class="trust-badge">✓ الدفع عند الاستلام</span>
              <span class="trust-badge">✓ توصيل لجميع المدن</span>
              <span class="trust-badge">✓ تأكيد هاتفي للطلب</span>
            </div>
            {orderForm}
          </div>
        </div>
      </div>

      <div class="elegant-below">
        <section class="elegant-description">
          <h2>وصف المنتج</h2>
          {descriptionHtml ? (
            <div class="rich-text">{raw(descriptionHtml)}</div>
          ) : (
            <p>{p.description}</p>
          )}
          {pres.deliveryReturns && (
            <div class="elegant-delivery-returns">
              <h3>التوصيل والاسترجاع</h3>
              <p>{pres.deliveryReturns}</p>
            </div>
          )}
        </section>
        <ReviewsSection p={p} reviews={reviews} s={s} />
      </div>

      {recommendations.filter((r) => r.id !== p.id && r.active).length > 0 && (
        <section class="elegant-recommendations">
          <h2>{s.home.productsTitle || defaults.home.productsTitle}</h2>
          <div class="elegant-rec-grid">
            {recommendations
              .filter((r) => r.id !== p.id && r.active)
              .slice(0, 4)
              .map((r) => (
                <a class="elegant-rec-card" href={'/products/' + r.slug} key={r.id}>
                  <img src={r.image} alt={r.name} width={300} height={300} loading="lazy" />
                  <p class="elegant-rec-name">{r.name}</p>
                  <p class="elegant-rec-price">{formatMoney(r.price, s.storeLanguage, cur)}</p>
                </a>
              ))}
          </div>
        </section>
      )}
    </main>
  );
}

# SERVER CORE NOTES — Egasa migration onto Mowarid

Scope: server core (variants, reviews, promo slides, currency, Google Sheets
webhook, legacy redirect). Written by the server-core agent.

## Files owned/modified (absolute paths under `egasa-on-mowarid/`)

- `src/shared/types.ts` — `ProductVariant`, `ProductReview`, `PromoSlide`,
  `CurrencySettings`; `variants?` on `Product`/`PublicProduct`; `variantId?` on
  `CartLine`; `variantId?`/`variantLabel?` on `LocalCartLine` and `QuoteLine`;
  `currency_code`/`currency_symbol`/`currency_rate`/`google_sheets_webhook` on
  `Settings` + defaults; `money()` extended with optional 3rd currency arg.
- `src/shared/commerce.ts` — `variantLabel`, `variantRevisionMix`,
  `variantQuantityPrice`, `resolveVariant`, `pricedVariant`.
- `src/shared/order-pricing.ts` — variant fields passed through in merchant
  snapshot and order-pricing item display.
- `src/server/schemas.ts` — `variantSchema`, `reviewSchema`; `productSchema`
  accepts optional `variants`; `cartSchema` accepts optional `variantId`;
  settings schema accepts currency + Google Sheets webhook keys.
- `src/server/db.ts` — `variantsByProductId`, `attachVariants`, `reviewsByProduct`,
  `promoSlides`, `replacePromoSlides`, `productById`; `productBySlug` now attaches
  variants. Variant/review/promo queries tolerate a missing table (pre-0020 test
  DBs) by returning empty, so non-variant checkout never breaks.
- `src/server/api.ts` — `makeQuote` resolves/validates variants, applies
  `price_delta` on top of base/promotion/offer pricing, folds variant into
  revision check; `POST /api/orders` fires Google Sheets webhook (fire-once,
  `waitUntil`, try/catch) after commit; `order_items` INSERT uses explicit
  column list (0023-safe); `GET /admin/products` attaches variants;
  `PUT /admin/products/:id` upserts variants (delete + insert active);
  `GET/PUT /admin/promo-slides`.
- `src/server/index.tsx` — registers `legacyEgasaRedirect` middleware.
- `src/server/legacy-redirect.ts` — NEW. `?p=`/`?product=`/`?id=` → 301 to
  `/products/<slug>`; passes through otherwise. Hash fragments (`#product/…`)
  cannot be seen server-side; handled by the UI agent client-side.
- `src/client/store.ts` — minimal: `chosen()`/`add()` accept an optional
  variant; `payload()` includes `variantId` when set; cart line shows
  `variantLabel`.
- `src/client/variant-core.ts` — NEW pure helpers for the UI agent's picker.
- `migrations/0023_order_variant.sql` — NEW. Adds indexable `variant_id` /
  `variant_label` columns to `order_items` (snapshot JSON remains authoritative).

## Key design decisions / constraints

1. **`src/shared/domain.ts` is NOT owned by this agent** (contains `quoteCart`).
   Variant price is therefore applied as post-processing in `makeQuote` AFTER
   `quoteCart` returns. Variant validation (exists/active/stock) and the
   variant-aware revision check happen before `quoteCart`; the cart line's
   revision is normalized to the base (unmixed) revision so `quoteCart`'s
   internal check passes, then `price_delta * quantity` is added to the line
   subtotal and `subtotal`/`total` are recomputed before the fingerprint hash.
   A variant price change changes both the revision mix and the fingerprint →
   existing 409 `quote_changed` / `cart_changed` paths reject it.

2. **Non-variant products are untouched.** Every variant helper is a no-op when
   `variantId` is absent. `cartSchema`/`CartLine` keep `variantId` optional.
   Existing cart payloads (no `variantId`) produce byte-identical quotes.

3. **`order_items` variant storage**: the `snapshot` JSON column already stores
   the full `QuoteLine` (now including `variantId`/`variantLabel`), so variant
   choice is persisted without schema change. Migration 0023 adds indexable
   columns for analytics; the INSERT omits them (explicit column list) so it
   works pre- and post-0023. A backfill statement is included in 0023 comments.

4. **Missing-table tolerance**: tests that apply only migrations 0001–0019
   (e.g. `integration.test.ts`) lack `product_variants`/`product_reviews`/
   `promo_slides`. Read queries catch the error and return `[]`. Variant writes
   only run when the admin payload actually includes `variants`.

5. **`money()`**: default (no 3rd arg, or `rate === 1`) is byte-identical to the
   old MAD formatting. Conversion only when `currency_rate` is set and `!== 1`.

6. **Google Sheets webhook**: one `fetch` POST of a JSON row, via
   `c.executionCtx.waitUntil`, swallowed errors. Never blocks or fails the
   order.

7. **Legacy redirect**: registered globally in `index.tsx` but skips
   `/api`, `/admin`, `/media`, `/favicon`, `/robots.txt`, `/sitemap.xml` and
   non-GET/HEAD requests. Unknown legacy params pass through.

## Revision mechanism (summary)

Client at add-to-cart: `variantQuantityPrice(p, qty, variant).revision` =
`variantRevisionMix(baseRevision, {id, priceDelta})`. Server recomputes the same
mix in `makeQuote`; mismatch → 409 `cart_changed`. The quote fingerprint covers
the final variant-adjusted `unitPrice`/`subtotal`/`total`, so order submit with
a stale quote → 409 `quote_changed`. `request_hash` (idempotency) includes the
full cart JSON, so `variantId` is part of the idempotency fingerprint.

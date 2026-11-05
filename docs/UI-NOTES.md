# UI Layer Notes (Admin + Storefront)

Egasa migration UI layer implemented on top of the completed server core.
Verification: `tsc --noEmit` (server) + `tsc --noEmit -p tsconfig.client.json` → 0 errors; `npm run build` → success; `vitest run` → 302 passed / 17 skipped, only the 2 pre-existing miniflare migration-comment failures (meta-events, api-isolation) remain.

## Files created / modified

- `src/server/views.tsx` — modified (Layout: currency indicator + external script tag; Home: optional `promoSlides` prop + `PromoSlider`; ProductPage: variant picker, badge, star rating, reviews summary, elegant-template dispatch; ProductCard: badge).
- `src/server/elegant-template.tsx` — NEW. `ElegantProductPage` (two-column, sticky buy-box, trust badges, gallery, recommendations) + shared exported subcomponents: `StarRating`, `VariantPicker` (SSR markup, wired by client JS), `ReviewsSection`, `BadgeTag`, `presentationOf`, `activeVariants`, `currencyOf`.
- `public/variant-picker.js` — NEW static asset (CSP-safe). Wires size/color buttons, updates price/stock/image, sets hidden `variantId` input + `data-variant-id` on add-to-cart, patches the cart line (variantId/variantLabel/sku/price/revision) and dispatches a synthetic `storage` event so store.ts re-renders. Also handles legacy `#product/<slug>` / `#p/<slug>` hash redirects.
- `src/styles.css` — additive only (variant picker, elegant template, promo slider, reviews stars, badge, currency indicator).
- `src/admin/variant-editor.tsx` — NEW React component. Size×color matrix editor with comma-separated size/color inputs, per-cell price_delta/stock/sku/active. Emits flat `variants[]` matching `variantSchema`.
- `src/admin/main.tsx` — additive sections only: product editor "Variants & Badge & Page Template" section (toggle + VariantEditor + badge input + classic/elegant dropdown); save handler strips non-schema presentation keys (see below); SettingsPage: currency_code/currency_symbol/currency_rate/google_sheets_webhook fields; `PromoSlidesEditor` (rows + add/remove + PUT /admin/promo-slides).
- `docs/UI-NOTES.md` — this file.

## Deviations from the suggested approach (and why)

1. **Client-side picker is an external static file, not an inline IIFE.**
   The storefront CSP (`script-src 'self' https://...` — no `'unsafe-inline'`, no nonce) blocks any inline `<script>` and inline event handlers. An inline IIFE would never execute. `/variant-picker.js` is served from the same origin (allowed by `'self'`), requires no vite.config change, and is copied to `dist/` automatically.

2. **`presentation.badge` / `pageTemplate` / `ratingAvg` / `reviewsCount` are read via a safe cast but NOT persisted by admin save.**
   `productSchema.presentation` is `.strict()` and does not declare these keys; including them in a PUT body makes Zod throw and breaks product save. The admin save handler therefore strips them before PUT (defensive — this also fixes a latent bug where migrator-imported `presentation.badge` would have broken every subsequent save). The storefront reads them from the stored JSON (cast) and renders badge / stars / elegant template whenever they are present. To make them persistently editable, the server-core maintainer should add these four keys to the presentation schema (or drop `.strict()` on it) — a one-line change in `src/server/schemas.ts`.

3. **Full review list requires the route to pass `reviews`.**
   `ProductPage` accepts an optional `reviews?: ProductReview[]` prop and renders the full list when provided. The current routes in `index.tsx` (not modified) do not pass it, so only the stars + count (from `presentation.ratingAvg` / `reviewsCount`) render. One-line fix for the maintainer: in `/products/:slug`, call `reviewsByProduct(c.env.DB, p.id)` and pass `reviews={...}`.

4. **Promo slider renders only when `promoSlides` is passed to `Home`.**
   `Home` accepts an optional `promoSlides?: PromoSlide[]` prop and renders a CSS scroll-snap carousel. The current `/` route does not pass it (index.tsx not modified), so it is a no-op by default. Maintainer: `promoSlides(c.env.DB, true)` and pass it.

5. **Variant add-to-cart works for the cart flow (`#add-offer`); direct/landing checkout variant injection is a documented gap.**
   store.ts (not owned) does not read a selected variant on the direct-buy path. The cart-based add is patched post-hoc by `variant-picker.js` (writes variantId/variantLabel/adjusted price/revision into `dar-cart-v1`, then triggers store.ts re-render via synthetic storage event). Landing-page direct checkout would need store.ts to read `data-variant-id` — out of scope for this layer.

## Variant picker DOM contract (for reference)

SSR markup (both classic and elegant templates) emits:
- container `[data-variant-picker][data-product-id]`
- size buttons `[data-variant-size="<label>"]`, color swatches `[data-variant-color="<name>"]`
- price `[data-variant-price]`, original price `[data-variant-original-price]`, stock `[data-variant-stock]`
- hidden input `input[name="variantId"]`
- add-to-cart button `#add-offer` (receives `data-variant-id` at runtime)

`/variant-picker.js` reads variants from the `#store-data` JSON block (`products[].variants`), pre-selects the first active variant, and updates all of the above on click.

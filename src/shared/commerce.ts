import type { Product, Offer, PublicProduct, PublicQuantityPricing, ProductVariant } from './types';
export function activeOffer(offer: Pick<Offer, 'enabled' | 'endsAt'>, at = Date.now()) {
  return offer.enabled !== false && (!offer.endsAt || Date.parse(offer.endsAt) > at);
}
export function activePromotion(p: Product, at = Date.now()) {
  const promotion = p.presentation?.promotion;
  return (
    !!promotion &&
    promotion.price > 0 &&
    promotion.price < p.price &&
    (!promotion.endsAt || Date.parse(promotion.endsAt) > at)
  );
}
export const QUANTITY_TAIL_ID = 'quantity:more';
export function tailPricing(p: Product, at = Date.now()): PublicQuantityPricing | undefined {
  const rule = p.presentation?.quantityPricing;
  if (
    p.presentation?.bundleMode !== undefined ||
    !rule ||
    !activeOffer(rule, at) ||
    !p.offers.some((o) => o.enabled !== false)
  )
    return;
  const largest = Math.max(
    1,
    ...p.offers.filter((o) => o.enabled !== false).map((o) => o.quantity),
  );
  const fromQuantity = rule.fromQuantity ?? largest + 1;
  if (fromQuantity > 100) return;
  return {
    ...rule,
    fromQuantity,
    freeShipping: rule.freeShipping || !!p.presentation?.freeShipping,
  };
}
export function quantityPrice(
  p: Pick<PublicProduct, 'price' | 'revision' | 'offers' | 'freeShipping' | 'quantityPricing'>,
  quantity: number,
) {
  const exact = p.offers.find((o) => o.quantity === quantity);
  const tail =
    !exact && p.quantityPricing && quantity >= p.quantityPricing.fromQuantity
      ? p.quantityPricing
      : undefined;
  const total = exact ? exact.total : (tail?.unitPrice ?? p.price) * quantity;
  return {
    quantity,
    total,
    unitPrice: Math.round(total / quantity),
    offerId: exact?.id ?? (tail ? QUANTITY_TAIL_ID : ''),
    freeShipping: !!p.freeShipping || !!exact?.freeShipping || !!tail?.freeShipping,
    revision: exact?.revision ?? p.revision,
    label: exact?.label || '',
  };
}
export function pricedProduct(
  p: Product,
  at = Date.now(),
): Product & { freeShipping: boolean; quantityPricing?: PublicQuantityPricing } {
  const active = activePromotion(p, at);
  return {
    ...p,
    freeShipping: !!p.presentation?.freeShipping,
    quantityPricing: tailPricing(p, at),
    offers: p.offers
      .filter((o) => p.presentation?.bundleMode !== false && activeOffer(o, at))
      .map((o) => (p.presentation?.freeShipping ? { ...o, freeShipping: true } : o)),
    price: active ? p.presentation!.promotion!.price : p.price,
    revision: p.presentation?.promotion
      ? 1_000_000_000 + p.revision * 2 + Number(active)
      : p.revision,
  };
}
export function cartOffers(p: PublicProduct): Offer[] {
  // Keep a selected snapshot until the customer explicitly reviews server changes.
  return p.offers;
}

export function promotionClock(endsAt: string, at = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - at) / 1000));
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
    expired: !Number.isFinite(seconds) || seconds === 0,
  };
}
export function promotionRemaining(
  startsAt: string,
  endsAt: string,
  at = Date.now(),
): number | null {
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(1, (end - at) / (end - start)));
}

export function bundleChoices(p: Pick<PublicProduct, 'offers' | 'stock'>) {
  return [1, ...p.offers.map((o) => o.quantity)]
    .filter((q, i, values) => q <= p.stock && values.indexOf(q) === i)
    .sort((a, b) => a - b);
}

// --- Egasa variants -------------------------------------------------------
// A variant adds a per-unit price delta on top of the product's base/promoted
// price and on top of any quantity-offer total. Non-variant products are
// untouched: every helper below is a no-op when variant is null/undefined.
export function variantLabel(
  v: Pick<ProductVariant, 'sizeLabel' | 'colorName'> | null | undefined,
): string {
  if (!v) return '';
  const parts = [v.sizeLabel, v.colorName].filter((x): x is string => !!x);
  return parts.join(' · ');
}
// Fold the variant identity into the cart-line revision so a server-side
// change to a variant's price (or its removal) triggers the existing 409
// "cart changed" path. The mix is deterministic and commutative with the
// promotion-bump already applied inside pricedProduct().
export function variantRevisionMix(
  revision: number,
  variant?: { id: string; priceDelta: number } | null,
): number {
  if (!variant) return revision;
  let h = 2166136261;
  const s = variant.id + ':' + variant.priceDelta;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((revision >>> 0) ^ (h >>> 0)) >>> 0;
}
export type VariantPricing = ReturnType<typeof quantityPrice> & { variantId?: string };
export function variantQuantityPrice(
  p: Parameters<typeof quantityPrice>[0],
  quantity: number,
  variant?: { id: string; priceDelta: number } | null,
): VariantPricing {
  const base = quantityPrice(p, quantity);
  if (!variant) return base;
  const deltaTotal = variant.priceDelta * quantity;
  const total = base.total + deltaTotal;
  return {
    ...base,
    total,
    unitPrice: Math.round(total / quantity),
    revision: variantRevisionMix(base.revision, variant),
    variantId: variant.id,
  };
}
// Resolve a variant against its product; returns null when the product has no
// variants or the id is missing. Throws DomainError-style via returning a
// discriminated status so callers can map to the right HTTP code.
export type VariantResolution =
  | { ok: true; variant: ProductVariant; label: string }
  | { ok: false; reason: 'no_variant' | 'not_found' | 'inactive' | 'out_of_stock' };
export function resolveVariant(
  product: Pick<Product, 'variants'>,
  variantId: string | undefined,
  quantity: number,
): VariantResolution {
  if (!variantId) return { ok: false, reason: 'no_variant' };
  const variant = product.variants?.find((v) => v.id === variantId);
  if (!variant) return { ok: false, reason: 'not_found' };
  if (!variant.active) return { ok: false, reason: 'inactive' };
  if (variant.stock < quantity) return { ok: false, reason: 'out_of_stock' };
  return { ok: true, variant, label: variantLabel(variant) };
}
export function pricedVariant(
  product: Pick<Product, 'price'>,
  variant: Pick<ProductVariant, 'priceDelta' | 'id' | 'sku' | 'sizeLabel' | 'colorName'>,
) {
  return {
    ...variant,
    label: variantLabel(variant),
    unitPrice: product.price + variant.priceDelta,
  };
}

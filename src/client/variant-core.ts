// Egasa variant picker helpers (cart/data logic only). The UI agent wires the
// actual picker interaction; these pure helpers keep store.ts changes tiny.
import {
  variantQuantityPrice,
  variantLabel as variantLabelOf,
  variantRevisionMix,
} from '../shared/commerce';
import type { ProductVariant, PublicProduct } from '../shared/types';

export { variantLabelOf, variantRevisionMix };

export function activeVariants(p: PublicProduct): ProductVariant[] {
  return (p.variants || []).filter((v) => v.active).sort((a, b) => a.sort - b.sort);
}

export function findVariant(p: PublicProduct, variantId?: string | null): ProductVariant | null {
  if (!variantId) return null;
  return p.variants?.find((v) => v.id === variantId) || null;
}

export function variantUnitPrice(p: PublicProduct, variant: ProductVariant | null): number {
  return p.price + (variant?.priceDelta || 0);
}

// Pricing snapshot the UI should display when a variant + quantity is selected.
export function variantPricing(
  p: PublicProduct,
  quantity: number,
  variant: ProductVariant | null,
) {
  const q = Math.max(1, Math.min(100, quantity));
  const selected = variantQuantityPrice(p, q, variant);
  return {
    quantity: q,
    unitPrice: selected.unitPrice,
    total: selected.total,
    revision: selected.revision,
    offerId: selected.offerId,
    freeShipping: selected.freeShipping,
    variantId: variant?.id,
    variantLabel: variant ? variantLabelOf(variant) : '',
  };
}

// Build the add-to-cart arguments for store.add(id, offerId, increment, qty, variant).
export function addToCartArgs(
  p: PublicProduct,
  quantity: number,
  variant: ProductVariant | null,
): [string, string, boolean, number, ProductVariant | null] {
  const pricing = variantPricing(p, quantity, variant);
  return [p.id, pricing.offerId, false, pricing.quantity, variant];
}

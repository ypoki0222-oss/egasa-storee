import { describe, it, expect } from 'vitest';
import { quantityPrice, variantQuantityPrice, variantRevisionMix } from '../src/shared/commerce';
import type { PublicProduct } from '../src/shared/types';

const baseProduct = (over: Partial<PublicProduct> = {}): PublicProduct =>
  ({
    id: 'p1',
    slug: 'p1',
    sku: 'SKU1',
    name: 'P',
    image: '',
    price: 10000,
    stock: 100,
    active: 1,
    supplier: 's1',
    verified: 1,
    offers: [],
    revision: 5,
    categoryId: null,
    storefrontVisible: 1,
    keywords: '',
    ...over,
  }) as PublicProduct;

describe('variantQuantityPrice', () => {
  it('without variant is identical to quantityPrice (backward compat)', () => {
    const p = baseProduct();
    expect(variantQuantityPrice(p, 1, null)).toEqual(quantityPrice(p, 1));
    expect(variantQuantityPrice(p, 3, undefined)).toEqual(quantityPrice(p, 3));
  });
  it('adds price_delta per unit on top of base price', () => {
    const p = baseProduct();
    const r = variantQuantityPrice(p, 1, { id: 'v1', priceDelta: 500 });
    expect(r.total).toBe(10500);
    expect(r.unitPrice).toBe(10500);
    expect(r.variantId).toBe('v1');
  });
  it('adds price_delta times quantity for multi-unit', () => {
    const p = baseProduct();
    const r = variantQuantityPrice(p, 3, { id: 'v1', priceDelta: 500 });
    expect(r.total).toBe(10000 * 3 + 500 * 3);
    expect(r.unitPrice).toBe(Math.round((10000 * 3 + 1500) / 3));
  });
  it('negative delta reduces price but stays consistent', () => {
    const p = baseProduct();
    const r = variantQuantityPrice(p, 2, { id: 'v1', priceDelta: -1000 });
    expect(r.total).toBe(10000 * 2 - 2000);
    expect(r.unitPrice).toBe(9000);
  });
  it('revision is the variant mix of the base revision', () => {
    const p = baseProduct();
    const base = quantityPrice(p, 1);
    const withV = variantQuantityPrice(p, 1, { id: 'v1', priceDelta: 500 });
    expect(withV.revision).toBe(variantRevisionMix(base.revision, { id: 'v1', priceDelta: 500 }));
  });
  it('stacked on top of a fixed quantity offer: delta added to offer total', () => {
    const p = baseProduct({
      offers: [
        { id: 'o1', label: '2 pack', quantity: 2, total: 18000, freeShipping: false, enabled: true },
      ],
    });
    const base = quantityPrice(p, 2);
    expect(base.total).toBe(18000); // offer total, not 20000
    const withV = variantQuantityPrice(p, 2, { id: 'v1', priceDelta: 500 });
    expect(withV.total).toBe(18000 + 1000);
    expect(withV.offerId).toBe('o1');
  });
});

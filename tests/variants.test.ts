import { describe, it, expect } from 'vitest';
import {
  variantLabel,
  variantRevisionMix,
  resolveVariant,
  pricedVariant,
} from '../src/shared/commerce';
import { money } from '../src/shared/types';
import type { Product, ProductVariant } from '../src/shared/types';

const baseVariant = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'var-1',
  productId: 'p1',
  sku: 'SKU-L',
  sizeLabel: 'Large',
  colorName: 'Red',
  colorHex: '#ff0000',
  priceDelta: 500,
  stock: 10,
  imageId: null,
  active: 1,
  sort: 0,
  ...over,
});

const productWith = (variants: ProductVariant[]): Pick<Product, 'variants'> => ({ variants });

describe('variantLabel', () => {
  it('joins size and color', () => {
    expect(variantLabel(baseVariant())).toBe('Large · Red');
  });
  it('handles only size', () => {
    expect(variantLabel(baseVariant({ colorName: null }))).toBe('Large');
  });
  it('empty for null', () => {
    expect(variantLabel(null)).toBe('');
    expect(variantLabel(undefined)).toBe('');
  });
});

describe('variantRevisionMix', () => {
  it('is identity when no variant', () => {
    expect(variantRevisionMix(7, null)).toBe(7);
    expect(variantRevisionMix(7, undefined)).toBe(7);
  });
  it('is deterministic', () => {
    const v = { id: 'var-1', priceDelta: 500 };
    expect(variantRevisionMix(3, v)).toBe(variantRevisionMix(3, v));
  });
  it('changes when priceDelta changes (price-change detection)', () => {
    const a = variantRevisionMix(3, { id: 'var-1', priceDelta: 500 });
    const b = variantRevisionMix(3, { id: 'var-1', priceDelta: 600 });
    expect(a).not.toBe(b);
  });
  it('changes when variant id changes', () => {
    const a = variantRevisionMix(3, { id: 'var-1', priceDelta: 500 });
    const b = variantRevisionMix(3, { id: 'var-2', priceDelta: 500 });
    expect(a).not.toBe(b);
  });
  it('produces a safe positive integer', () => {
    const r = variantRevisionMix(1, { id: 'x'.repeat(50), priceDelta: -99999 });
    expect(Number.isSafeInteger(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});

describe('resolveVariant', () => {
  it('no_variant when id missing', () => {
    expect(resolveVariant(productWith([baseVariant()]), undefined, 1).ok).toBe(false);
    expect((resolveVariant(productWith([baseVariant()]), undefined, 1) as any).reason).toBe(
      'no_variant',
    );
  });
  it('not_found for unknown id', () => {
    const r = resolveVariant(productWith([baseVariant()]), 'nope', 1);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('not_found');
  });
  it('inactive variant rejected', () => {
    const r = resolveVariant(productWith([baseVariant({ active: 0 })]), 'var-1', 1);
    expect((r as any).reason).toBe('inactive');
  });
  it('out_of_stock when quantity exceeds stock', () => {
    const r = resolveVariant(productWith([baseVariant({ stock: 2 })]), 'var-1', 3);
    expect((r as any).reason).toBe('out_of_stock');
  });
  it('ok with label when active and in stock', () => {
    const r = resolveVariant(productWith([baseVariant()]), 'var-1', 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.variant.id).toBe('var-1');
      expect(r.label).toBe('Large · Red');
    }
  });
});

describe('pricedVariant', () => {
  it('adds delta to base price', () => {
    const pv = pricedVariant({ price: 10000 }, baseVariant());
    expect(pv.unitPrice).toBe(10500);
    expect(pv.label).toBe('Large · Red');
  });
});

describe('money currency', () => {
  it('default MAD behavior is byte-identical to old signature', () => {
    expect(money(12500, 'ar')).toBe('125 د.م');
    expect(money(12500, 'fr')).toBe('125 MAD');
    expect(money(12500, 'en')).toBe('125 MAD');
  });
  it('rate === 1 is identical to default', () => {
    expect(money(12500, 'ar', { code: 'MAD', rate: 1 })).toBe(money(12500, 'ar'));
  });
  it('converts and uses symbol when rate != 1', () => {
    const out = money(10000, 'en', { code: 'EUR', symbol: '€', rate: 0.095 });
    expect(out).toContain('€');
    expect(out).toContain('9.5');
  });
  it('Arabic puts symbol after amount', () => {
    const out = money(10000, 'ar', { code: 'EUR', symbol: '€', rate: 0.095 });
    expect(out.endsWith('€')).toBe(true);
  });
});

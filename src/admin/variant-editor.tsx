// Egasa variant matrix editor (size × color). Used inside the product edit
// form in main.tsx. Emits a flat variants[] array matching variantSchema.
import { useMemo, useState } from 'react';
import type { ProductVariant } from '../shared/types';

type Cell = { sizeLabel: string; colorName: string };

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function VariantEditor({
  variants,
  onChange,
  skuPrefix = '',
}: {
  variants: ProductVariant[];
  onChange: (next: ProductVariant[]) => void;
  skuPrefix?: string;
}) {
  const existing = variants || [];
  const initialSizes = useMemo(
    () => Array.from(new Set(existing.map((v) => v.sizeLabel).filter((x): x is string => !!x))).join(', '),
    [existing],
  );
  const initialColors = useMemo(
    () =>
      Array.from(
        new Map(
          existing
            .filter((v) => v.colorName)
            .map((v) => [v.colorName, v.colorHex || '#cccccc']),
        ).keys(),
      ).join(', '),
    [existing],
  );
  const [sizesText, setSizesText] = useState(initialSizes);
  const [colorsText, setColorsText] = useState(initialColors);

  const sizes = sizesText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const colorEntries = colorsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const known = existing.find((v) => v.colorName === name);
      return { name, hex: known?.colorHex || '#cccccc' };
    });

  const cells: Cell[] = [];
  if (sizes.length && colorEntries.length)
    for (const size of sizes) for (const color of colorEntries) cells.push({ sizeLabel: size, colorName: color.name });
  else if (sizes.length) for (const size of sizes) cells.push({ sizeLabel: size, colorName: '' });
  else if (colorEntries.length)
    for (const color of colorEntries) cells.push({ sizeLabel: '', colorName: color.name });

  const findVariant = (cell: Cell) =>
    existing.find(
      (v) =>
        (v.sizeLabel || '') === cell.sizeLabel && (v.colorName || '') === cell.colorName,
    );

  const updateCell = (cell: Cell, patch: Partial<ProductVariant>) => {
    const current = findVariant(cell);
    const colorHex = colorEntries.find((c) => c.name === cell.colorName)?.hex || null;
    const base: ProductVariant = {
      id: current?.id || uid(),
      sku:
        current?.sku ||
        [skuPrefix, cell.sizeLabel, cell.colorName].filter(Boolean).join('-') ||
        null,
      sizeLabel: cell.sizeLabel || null,
      colorName: cell.colorName || null,
      colorHex,
      priceDelta: current?.priceDelta ?? 0,
      stock: current?.stock ?? 0,
      imageId: current?.imageId ?? null,
      active: current?.active ?? 1,
      sort: current?.sort ?? 0,
    };
    const merged = { ...base, ...patch };
    const rest = existing.filter(
      (v) =>
        (v.sizeLabel || '') !== cell.sizeLabel || (v.colorName || '') !== cell.colorName,
    );
    const next = [...rest, merged].sort((a, b) => a.sort - b.sort);
    onChange(next);
  };

  if (!cells.length)
    return (
      <p className="hint">
        أدخل مقاسات (مفصولة بفاصلة) و/أو ألوانًا لإنشاء مصفوفة الخيارات.
      </p>
    );

  return (
    <div className="variant-editor">
      <div className="variant-editor-inputs">
        <label className="field">
          <span>المقاسات (مفصولة بفاصلة)</span>
          <input
            value={sizesText}
            onChange={(e) => setSizesText(e.target.value)}
            placeholder="S, M, L, XL"
          />
        </label>
        <label className="field">
          <span>الألوان (مفصولة بفاصلة)</span>
          <input
            value={colorsText}
            onChange={(e) => setColorsText(e.target.value)}
            placeholder="أبيض, أسود, أزرق"
          />
        </label>
      </div>
      <div className="variant-matrix-wrap">
        <table className="variant-matrix">
          <thead>
            <tr>
              <th>المقاس</th>
              <th>اللون</th>
              <th>الرمز SKU</th>
              <th>فرق السعر (درهم)</th>
              <th>المخزون</th>
              <th>مفعّل</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell, i) => {
              const v = findVariant(cell);
              const key = cell.sizeLabel + '|' + cell.colorName;
              return (
                <tr key={key}>
                  <td>{cell.sizeLabel || '—'}</td>
                  <td>
                    {cell.colorName ? (
                      <span className="variant-color-cell">
                        <span
                          className="variant-color-dot"
                          style={{ background: colorEntries.find((c) => c.name === cell.colorName)?.hex }}
                        />
                        {cell.colorName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mono">
                    {v?.sku ||
                      [skuPrefix, cell.sizeLabel, cell.colorName].filter(Boolean).join('-')}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="small-number"
                      value={v?.priceDelta ?? 0}
                      onChange={(e) =>
                        updateCell(cell, { priceDelta: Number(e.target.value) || 0, sort: i })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="small-number"
                      min={0}
                      value={v?.stock ?? 0}
                      onChange={(e) =>
                        updateCell(cell, { stock: Math.max(0, Number(e.target.value) || 0), sort: i })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!(v?.active ?? 1)}
                      onChange={(e) =>
                        updateCell(cell, { active: e.target.checked ? 1 : 0, sort: i })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {existing.length} خيار محفوظ. عند الحفظ تُستبدل قائمة الخيارات بالكامل بالمصفوفة أعلاه.
      </p>
    </div>
  );
}

CREATE TABLE IF NOT EXISTS product_variants (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku         TEXT UNIQUE,
  size_label  TEXT,
  color_name  TEXT,
  color_hex   TEXT,
  price_delta INTEGER NOT NULL DEFAULT 0,          -- سنتات (cents)، يُضاف إلى سعر المنتج الأساسي
  stock       INTEGER NOT NULL DEFAULT 0,
  image_id    TEXT,                                 -- يشير إلى media.id بعد رفع الصورة إلى R2
  active      INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS product_variants_lookup ON product_variants(product_id, active, sort);
CREATE INDEX IF NOT EXISTS product_variants_sku ON product_variants(sku);

ALTER TABLE order_items ADD COLUMN variant_id TEXT;
ALTER TABLE order_items ADD COLUMN variant_label TEXT;
CREATE INDEX IF NOT EXISTS order_items_variant ON order_items(variant_id)
  WHERE variant_id IS NOT NULL;

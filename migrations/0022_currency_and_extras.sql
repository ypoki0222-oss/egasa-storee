UPDATE settings
SET json = json_set(
  json,
  '$.currency_code',          COALESCE(json_extract(json,'$.currency_code'), 'MAD'),
  '$.currency_symbol',        COALESCE(json_extract(json,'$.currency_symbol'), 'درهم'),
  '$.currency_rate',          COALESCE(json_extract(json,'$.currency_rate'), json('1.0')),
  '$.google_sheets_webhook',  COALESCE(json_extract(json,'$.google_sheets_webhook'), '')
)
WHERE id = 1;
ALTER TABLE orders ADD COLUMN source TEXT;
CREATE TABLE IF NOT EXISTS promo_slides (
  id         TEXT PRIMARY KEY,
  sort       INTEGER NOT NULL DEFAULT 0,
  image_id   TEXT,            -- media.id بعد رفع الصورة إلى R2
  title      TEXT NOT NULL DEFAULT '',
  subtitle   TEXT NOT NULL DEFAULT '',
  cta_text   TEXT NOT NULL DEFAULT '',
  cta_url    TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS promo_slides_lookup ON promo_slides(active, sort);

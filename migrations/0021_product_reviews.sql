CREATE TABLE IF NOT EXISTS product_reviews (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT '',
  rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  text       TEXT NOT NULL DEFAULT '',
  locale     TEXT NOT NULL DEFAULT 'ar',
  approved   INTEGER NOT NULL DEFAULT 1 CHECK(approved IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS product_reviews_lookup ON product_reviews(product_id, approved);
CREATE INDEX IF NOT EXISTS product_reviews_created ON product_reviews(created_at DESC);

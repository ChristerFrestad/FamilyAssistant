'use strict';

function createProductRepos(db) {
  const products = {
    getByKey(key) {
      return db.prepare('SELECT * FROM products WHERE key = ?').get(key);
    },
    getAll() {
      return db.prepare('SELECT * FROM products ORDER BY category, product_name').all();
    },
    getAllAsMap() {
      const rows = products.getAll();
      const map = {};
      for (const r of rows) {
        map[r.key] = {
          productName: r.product_name,
          category: r.category,
          packSize: r.pack_size,
          unit: r.unit,
          estPrice: r.est_price,
          shelfDays: r.shelf_days,
          store: r.store,
          ean: r.ean,
          dairyRule: r.dairy_rule,
        };
      }
      return map;
    },
    search(q) {
      const like = `%${q.toLowerCase()}%`;
      return db
        .prepare(
          `
        SELECT * FROM products
        WHERE lower(key) LIKE ? OR lower(product_name) LIKE ?
        ORDER BY product_name LIMIT 50
      `
        )
        .all(like, like);
    },
    upsert(p) {
      return db
        .prepare(
          `
        INSERT INTO products (key, product_name, category, pack_size, unit, est_price, shelf_days, store, ean, dairy_rule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          product_name=excluded.product_name,
          category=excluded.category,
          pack_size=excluded.pack_size,
          unit=excluded.unit,
          est_price=excluded.est_price,
          shelf_days=excluded.shelf_days,
          store=excluded.store,
          ean=excluded.ean,
          dairy_rule=excluded.dairy_rule,
          updated_at=datetime('now')
      `
        )
        .run(
          p.key,
          p.productName,
          p.category,
          p.packSize,
          p.unit,
          p.estPrice ?? null,
          p.shelfDays ?? null,
          p.store ?? 'Kiwi Vågsbygd',
          p.ean ?? null,
          p.dairyRule ?? null
        );
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    },
  };

  return { products };
}

module.exports = { createProductRepos };

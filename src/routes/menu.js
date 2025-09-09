const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/menu
 * Връща категориите и продуктите СОРТИРАНИ по sort_order, после по име.
 * Показва само продукти is_available = 1.
 */
router.get('/menu', async (_req, res) => {
  try {
    // 1) Категории – по sort_order (NULL/празно в края), после по име
    const [cats] = await pool.query(`
      SELECT id, name, sort_order
      FROM categories
      ORDER BY COALESCE(sort_order, 999999) ASC, name ASC
    `);

    // 2) Всички продукти (само налични), подредени по category_id, sort_order, name
    const [prods] = await pool.query(`
      SELECT id, category_id, name, price, sort_order
      FROM products
      WHERE is_available = 1
      ORDER BY category_id ASC, COALESCE(sort_order, 999999) ASC, name ASC
    `);

    // 3) Групиране по категория
    const byCat = new Map(cats.map(c => [c.id, []]));
    for (const p of prods) {
      if (byCat.has(p.category_id)) {
        byCat.get(p.category_id).push({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          sort_order: p.sort_order ?? null,
        });
      }
    }

    // 4) Резултат – категориите идват в правилния ред, продуктите вътре също
    const categories = cats.map(c => ({
      id: c.id,
      name: c.name,
      sort_order: c.sort_order ?? null,
      items: byCat.get(c.id) || [],
    }));

    res.json({ categories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

module.exports = router;

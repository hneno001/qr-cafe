const express = require('express');
const router = express.Router();
const pool = require('../db');

// Единен служебен ключ (трябва да е еднакъв за WS, /latest, /status, /history)
const STAFF_KEY = process.env.STAFF_KEY || '1234';

// Инжекция на broadcaster от server.js (за WS push)
let broadcast;
function setBroadcaster(fn) { broadcast = fn; }
router.setBroadcaster = setBroadcaster;

/* ============================
   Верификация на служебния ключ
   ============================ */
// GET /api/staff/verify?key=...
router.get('/staff/verify', (req, res) => {
  const key = (req.query.key || req.headers['x-staff-key'] || '').toString();
  if (key && key === STAFF_KEY) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

/* ============================
   Създаване на поръчка (клиент)
   ============================ */
// POST /api/orders
// body: { token, items:[{product_id, qty}], client_key? }
router.post('/orders', async (req, res) => {
  const { token, items, client_key } = req.body || {};
  if (!token || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: 'Invalid input' });
  }
  const cleanToken = String(token).replace(/[^A-Za-z0-9]/g, '');

  const conn = await pool.getConnection();
  try {
    // Проверка на масата
    const [tables] = await conn.query(
      'SELECT id, active FROM table_tokens WHERE token = ?',
      [cleanToken]
    );
    if (!tables.length || !tables[0].active) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Invalid table' });
    }
    const tableId = tables[0].id;

    // Идемпотентност по client_key (ако е подаден)
    if (client_key) {
      const [dup] = await conn.query(
        'SELECT id FROM orders WHERE client_key = ?',
        [client_key]
      );
      if (dup.length) return res.json({ success: true, order_id: dup[0].id });
    }

    // Нормализиране и сливане на items
    const merged = new Map(); // product_id -> qty
    for (const it of items) {
      const pid = parseInt(it.product_id || 0, 10);
      const qty = Math.max(1, parseInt(it.qty || 0, 10));
      if (pid > 0 && qty > 0) merged.set(pid, (merged.get(pid) || 0) + qty);
    }
    if (!merged.size) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No items' });
    }

    // Проверка за наличност и взимане на цена
    const ids = Array.from(merged.keys());
    const [rows] = await conn.query(
      `SELECT id, price, is_available FROM products WHERE id IN (${ids.map(()=>'?').join(',')})`,
      ids
    );
    const dict = new Map(rows.map(r => [r.id, r]));
    for (const pid of ids) {
      const r = dict.get(pid);
      if (!r || !r.is_available) {
        conn.release();
        return res.status(400).json({ success: false, error: 'One or more items unavailable' });
      }
    }

    await conn.beginTransaction();
    const [ins] = await conn.query(
      'INSERT INTO orders (table_id, status, client_key) VALUES (?, "NEW", ?)',
      [tableId, client_key || null]
    );
    const orderId = ins.insertId;

    const values = ids.map(pid => [orderId, pid, merged.get(pid), dict.get(pid).price]);
    await conn.query(
      'INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ?',
      [values]
    );
    await conn.commit();

    // Push към WS слушателите
    broadcast && broadcast({ type: 'order_created', orderId });

    res.json({ success: true, order_id: orderId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error(e);
    res.status(500).json({ success: false, error: 'Could not save order' });
  } finally {
    conn.release();
  }
});

/* ============================
   Промяна на статус (барман)
   ============================ */
// POST /api/orders/status
// body: { key, order_id, status, current_status? }
router.post('/orders/status', async (req, res) => {
  const { key, order_id, status, current_status } = req.body || {};
  if (!key || key !== STAFF_KEY) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const allowed = new Set(['NEW','IN_PROGRESS','READY','SERVED','CANCELLED']);
  if (!allowed.has(status)) {
    return res.status(400).json({ ok: false, error: 'Bad input' });
  }

  try {
    if (current_status) {
      const [r] = await pool.query(
        'UPDATE orders SET status=?, updated_at=NOW() WHERE id=? AND status=?',
        [status, order_id, current_status]
      );
      if (r.affectedRows === 0) {
        return res.status(409).json({ ok: false, error: 'Status changed by someone else. Refresh.' });
      }
    } else {
      await pool.query(
        'UPDATE orders SET status=?, updated_at=NOW() WHERE id=?',
        [status, order_id]
      );
    }

    broadcast && broadcast({ type: 'order_updated', orderId: Number(order_id), status });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Update failed' });
  }
});

/* ============================
   Снимка на активни поръчки
   ============================ */
// GET /api/orders/latest  (изисква ключ – query ?key=... или хедър x-staff-key)
router.get('/orders/latest', async (req, res) => {
  try {
    const provided = (req.query.key || req.headers['x-staff-key'] || '').toString();
    if (provided !== STAFF_KEY) return res.status(403).json({ error: 'Forbidden' });

    const [orders] = await pool.query(`
      SELECT o.id, o.status, o.created_at, t.table_name
      FROM orders o
      JOIN table_tokens t ON t.id = o.table_id
      WHERE o.status IN ('NEW','IN_PROGRESS','READY')
      ORDER BY (o.status='NEW') DESC, o.created_at DESC
      LIMIT 200
    `);

    const results = [];
    for (const o of orders) {
      const [items] = await pool.query(`
        SELECT i.qty, p.name, i.unit_price
        FROM order_items i
        JOIN products p ON p.id = i.product_id
        WHERE i.order_id = ?
        ORDER BY i.id
      `, [o.id]);
      results.push({
        id: o.id,
        status: o.status,
        created_at: o.created_at,
        table: o.table_name,
        items
      });
    }
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/* ============================
   История (по дата/период)
   ============================ */
// GET /api/orders/history
// params:
//   key     - служебен ключ (или хедър x-staff-key)
//   status  - ALL | SERVED | CANCELLED (default ALL = двата приключени)
//   date    - YYYY-MM-DD (всички записи за този ден)
//   from    - YYYY-MM-DD (начало; включително от 00:00:00)
//   to      - YYYY-MM-DD (край; < to + 1 ден)
//   limit   - използва се САМО ако няма нито date, нито from/to (default cap 500)
router.get('/orders/history', async (req, res) => {
  try {
    const provided = (req.query.key || req.headers['x-staff-key'] || '').toString();
    if (provided !== STAFF_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const { status = 'ALL', date, from, to } = req.query;

    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    if (date && !reDate.test(date)) return res.status(400).json({ error: 'Bad date' });
    if (from && !reDate.test(from)) return res.status(400).json({ error: 'Bad from date' });
    if (to   && !reDate.test(to))   return res.status(400).json({ error: 'Bad to date' });

    // Статус
    const where = [];
    if (status === 'SERVED') where.push("o.status = 'SERVED'");
    else if (status === 'CANCELLED') where.push("o.status = 'CANCELLED'");
    else where.push("o.status IN ('SERVED','CANCELLED')");

    // Дати — ИЗБЯГВАМЕ DATE(o.created_at) за да пазим индекси
    const params = [];
    let hasRange = false;

    if (date) {
      // [date 00:00:00, date + 1 ден)
      where.push('o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(`${date} 00:00:00`, date);
      hasRange = true;
    } else {
      if (from) { where.push('o.created_at >= ?'); params.push(`${from} 00:00:00`); hasRange = true; }
      if (to)   { where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); hasRange = true; }
    }

    let sql = `
      SELECT
        o.id,
        o.table_id,
        COALESCE(tt.table_name, o.table_id) AS table_label,
        o.status,
        o.created_at,
        o.updated_at
      FROM orders o
      LEFT JOIN table_tokens tt ON tt.id = o.table_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.created_at DESC
    `;

    // Ако няма нито date, нито from/to → ограничаваме като безопасност
    if (!hasRange) {
      const cap = Math.min(parseInt(req.query.limit || '500', 10) || 500, 500);
      sql += ' LIMIT ?';
      params.push(cap);
    }

    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.json([]);

    // Вземаме артикули за всички избрани поръчки
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(()=>'?').join(',');
    const [items] = await pool.query(
      `
      SELECT oi.order_id, oi.qty, p.name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (${placeholders})
      ORDER BY oi.order_id ASC, oi.id ASC
      `,
      ids
    );

    const byOrder = new Map(ids.map(id => [id, []]));
    for (const it of items) {
      byOrder.get(it.order_id)?.push({ qty: Number(it.qty), name: it.name });
    }

    const out = rows.map(r => ({
      id: r.id,
      table: r.table_label,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      items: byOrder.get(r.id) || []
    }));

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

module.exports = router;

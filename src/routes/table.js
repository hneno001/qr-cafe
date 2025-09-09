const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/table?token=XYZ  → връща { id, name }
router.get('/table', async (req, res) => {
  try {
    const token = (req.query.token || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const [rows] = await pool.query(
      'SELECT id, table_name, active FROM table_tokens WHERE token = ?',
      [token]
    );
    if (!rows.length || !rows[0].active) {
      return res.status(404).json({ error: 'Table not found or inactive' });
    }
    // Връщаме ID (номер на масата) и името (ако искаш да го показваш)
    res.json({ id: rows[0].id, name: rows[0].table_name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load table' });
  }
});

module.exports = router;

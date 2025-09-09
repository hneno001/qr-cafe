const WebSocket = require('ws');
const url = require('url');
const pool = require('./db');

function attach(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Изискваме staff key при свързване
    const { query } = url.parse(req.url, true);
    const provided = (query?.key || '').toString();
    const expected = process.env.STAFF_KEY || 'changeme123';
    if (provided !== expected) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
  });

  // Пинг/heartbeat на 30s
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    });
  }, 30000);

  // Изпращаме snapshot само на АКТИВНИ поръчки
  async function broadcastSnapshot() {
    try {
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

      const msg = JSON.stringify({ type: 'orders_snapshot', data: results });
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(msg); } catch (_) {}
        }
      });
    } catch (e) {
      console.error('snapshot error', e);
    }
  }

  // Периодично snapshot-ване (fallback)
  const periodic = setInterval(broadcastSnapshot, 5000);

  // API-тата викат това след create/update за да push-нем свеж snapshot
  function broadcast(event) {
    if (event && (event.type === 'order_created' || event.type === 'order_updated')) {
      broadcastSnapshot();
    }
  }

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(periodic);
  });

  return { broadcast };
}

module.exports = attach;

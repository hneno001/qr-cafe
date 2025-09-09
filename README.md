# QR Cafe Ordering — Node.js + MySQL + WebSocket

A simple QR table ordering system built with **Node.js (Express)**, **MySQL**, and **WebSocket** for live bartender updates.

## 1) Database
Create DB `qr_cafe` and import `schema.sql`. Optionally import `seed.sql` for demo data.

## 2) Configure
Copy `.env.example` to `.env` and adjust values (especially `DB_*` and `STAFF_KEY`).

## 3) Install & run
```bash
npm install
npm start
```
Server runs at `http://localhost:3000`.

## 4) Try it
- Customer: `http://localhost:3000/index.html?t=TBL1vA9qWb3kS7x2pL0mZn`
- Bartender: `http://localhost:3000/bartender.html` (enter staff key to change status)

## Notes
- Orders are saved in transactions, priced server-side, with idempotency via `client_key`.
- Bartender dashboard streams **live** snapshots via WebSocket whenever orders are created or status changes, and also every 5s as a fallback.
- For production, run behind Nginx and use a process manager (pm2/systemd).

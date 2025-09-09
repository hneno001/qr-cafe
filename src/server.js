require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
const menu = require('./routes/menu');
const orders = require('./routes/orders');
const tableRoute = require('./routes/table'); // 👈 новият маршрут

app.use('/api', menu);
app.use('/api', orders);
app.use('/api', tableRoute);                // 👈 включваме го

// WebSocket
const attachWS = require('./ws');
const { broadcast } = attachWS(server);
orders.setBroadcaster(broadcast);

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

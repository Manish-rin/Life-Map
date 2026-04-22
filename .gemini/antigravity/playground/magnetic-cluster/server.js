require('dotenv').config();
const path    = require('path');
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const { Server } = require('socket.io');

const { runMigrations }    = require('./src/db/migrate');
const { initSocketHandlers } = require('./src/socket/index');
const escalation             = require('./src/services/escalation');

const authRouter       = require('./src/routes/auth');
const donorsRouter     = require('./src/routes/donors');
const requestsRouter   = require('./src/routes/requests');
const bloodBanksRouter = require('./src/routes/bloodBanks');

// ─── APP ─────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Make io accessible inside route handlers
app.set('io', io);

// Initialise escalation engine with Socket.IO reference
escalation.init(io);

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve the frontend statically from project root
app.use(express.static(path.join(__dirname)));

// ─── API ROUTES ───────────────────────────────────────────────
app.use('/api/auth',        authRouter);
app.use('/api/donors',      donorsRouter);
app.use('/api/requests',    requestsRouter);
app.use('/api/blood-banks', bloodBanksRouter);

// Health check
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', env: process.env.NODE_ENV, time: new Date().toISOString() })
);

// Catch-all → serve index.html (SPA fallback)
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

// ─── SOCKET.IO ────────────────────────────────────────────────
initSocketHandlers(io);

// ─── START ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);

async function start() {
  try {
    runMigrations();

    // Only seed if DB is fresh (no donors exist)
    const { getDb } = require('./src/db/database');
    const db = getDb();
    const hasUsers = db.prepare('SELECT COUNT(*) as n FROM users').get();
    if (hasUsers.n === 0) {
      console.log('🌱  Empty database — running seed …');
      require('./src/db/seed').runSeed();
    }

    server.listen(PORT, () => {
      console.log('\n🩸  Praan-setu API  →  http://localhost:' + PORT);
      console.log('📡  Socket.IO ready');
      console.log('📂  SQLite DB       →  ' + (process.env.DB_PATH || './praansetu.db'));
      console.log('⏱   Escalation     →  ' + process.env.ESCALATION_MS + 'ms per mode\n');
    });
  } catch (err) {
    console.error('❌  Failed to start:', err);
    process.exit(1);
  }
}

start();

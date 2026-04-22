const jwt    = require('jsonwebtoken');
const { getDb } = require('../db/database');

/**
 * Wire all Socket.IO events.
 * Called once from server.js after creating the io instance.
 */
function initSocketHandlers(io) {

  io.on('connection', (socket) => {
    console.log(`🔌  Socket connected: ${socket.id}`);

    // ── join:donor ─────────────────────────────────────────────
    // Client sends when donor comes online (after auth).
    // Joins the blood-group room so they receive 'donor:alert' events.
    socket.on('join:donor', ({ token, bloodGroup }) => {
      if (!token) return;
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const bg      = payload.blood_group || bloodGroup;
        socket.join(`blood:${bg}`);
        socket.join(`user:${payload.sub}`);
        socket.data.userId     = payload.sub;
        socket.data.bloodGroup = bg;

        // Mark as available in DB if not already
        getDb()
          .prepare('UPDATE users SET is_available = 1 WHERE id = ?')
          .run(payload.sub);

        socket.emit('connected', { message: `Joined blood:${bg} room`, userId: payload.sub });
        console.log(`👤  Donor ${payload.sub} joined blood:${bg}`);
      } catch {
        socket.emit('error', { message: 'Invalid token' });
      }
    });

    // ── join:request ────────────────────────────────────────────
    // Client sends to watch escalation updates for a specific request.
    socket.on('join:request', (requestId) => {
      socket.join(`request:${requestId}`);
      console.log(`👁  Socket ${socket.id} watching request:${requestId}`);

      // Send current mode immediately
      const req = getDb()
        .prepare('SELECT current_mode FROM emergency_requests WHERE id = ?')
        .get(requestId);
      if (req) {
        socket.emit('request:current-mode', { requestId, mode: req.current_mode });
      }
    });

    // ── location:update ─────────────────────────────────────────
    // Donor sends periodic GPS coordinates.
    socket.on('location:update', ({ lat, lng }) => {
      if (!socket.data.userId) return;
      getDb()
        .prepare('UPDATE users SET lat = ?, lng = ?, updated_at = ? WHERE id = ?')
        .run(lat, lng, Date.now(), socket.data.userId);
    });

    // ── disconnect ──────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌  Socket disconnected: ${socket.id}`);
      // Note: we don't auto-set is_available = 0 on disconnect
      // because the user may just have a brief network blip.
      // The toggle in the UI is the authoritative source.
    });
  });
}

module.exports = { initSocketHandlers };

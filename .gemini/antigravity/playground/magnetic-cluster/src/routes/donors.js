const router = require('express').Router();
const { z }  = require('zod');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');
const { getTrustProfile } = require('../services/trust');

// ─── Haversine distance (km) ──────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R   = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── GET /api/donors/me ───────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(_safe(user));
});

// ─── PATCH /api/donors/me ─────────────────────────────────────
const patchSchema = z.object({
  is_available: z.boolean().optional(),
  lat:          z.number().optional(),
  lng:          z.number().optional(),
  city:         z.string().optional(),
  name:         z.string().optional(),
});

router.patch('/me', authenticate, validate(patchSchema), (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = { ...req.body, updated_at: Date.now() };
  const keys    = Object.keys(updates);
  const sets    = keys.map(k => `${k} = ?`).join(', ');

  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), req.user.sub);

  // Emit live presence change via Socket.IO
  const io = req._io || (req.app && req.app.get('io'));
  if (io && 'is_available' in req.body) {
    const bg = user.blood_group;
    io.to(`blood:${bg}`).emit('donor:presence', {
      donorId:     user.id,
      is_available: req.body.is_available,
    });
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  res.json(_safe(updated));
});

// ─── GET /api/donors/nearby ───────────────────────────────────
const nearbySchema = z.object({
  lat:         z.coerce.number(),
  lng:         z.coerce.number(),
  radius:      z.coerce.number().default(25),        // km
  blood_group: z.string().optional(),
  limit:       z.coerce.number().int().max(50).default(20),
});

router.get('/nearby', validate(nearbySchema, 'query'), (req, res) => {
  const { lat, lng, radius, blood_group, limit } = req.query;
  const db = getDb();

  let query  = 'SELECT * FROM users WHERE is_available = 1 AND lat IS NOT NULL AND lng IS NOT NULL';
  const args = [];

  if (blood_group) {
    query += ' AND blood_group = ?';
    args.push(blood_group);
  }

  const rows = db.prepare(query).all(...args);

  const withDist = rows
    .map(u => ({ ...u, distance_km: haversine(lat, lng, u.lat, u.lng) }))
    .filter(u => u.distance_km <= radius)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit)
    .map(u => ({ ..._safe(u), distance_km: +u.distance_km.toFixed(2) }));

  res.json(withDist);
});

// ─── GET /api/donors/me/history ──────────────────────────────
router.get('/me/history', authenticate, (req, res) => {
  const profile = getTrustProfile(req.user.sub);
  res.json(profile);
});

// ─── GET /api/donors/:id ─────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Donor not found' });
  // Return only public fields for other users
  const { password_hash, otp_code, otp_expires_at, phone, ...pub } = user;
  res.json(pub);
});

function _safe(u) {
  const { password_hash, otp_code, otp_expires_at, ...safe } = u;
  return safe;
}

module.exports = router;

const router = require('express').Router();
const { z }  = require('zod');
const { getDb } = require('../db/database');
const { validate } = require('../middleware/validate');

function haversine(lat1, lon1, lat2, lon2) {
  const R   = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── GET /api/blood-banks ─────────────────────────────────────
const querySchema = z.object({
  lat:         z.coerce.number().optional(),
  lng:         z.coerce.number().optional(),
  radius:      z.coerce.number().default(50),   // km
  blood_group: z.string().optional(),
});

router.get('/', validate(querySchema, 'query'), (req, res) => {
  const { lat, lng, radius, blood_group } = req.query;
  const db = getDb();

  let rows = db.prepare('SELECT * FROM blood_banks ORDER BY name').all();

  // Parse JSON stocks
  rows = rows.map(b => ({ ...b, stocks: JSON.parse(b.stocks || '{}') }));

  // Filter by blood_group availability if specified
  if (blood_group) {
    rows = rows.filter(b => b.stocks[blood_group] === true);
  }

  // Attach distance if coordinates provided
  if (lat != null && lng != null) {
    rows = rows
      .map(b => ({ ...b, distance_km: +haversine(lat, lng, b.lat, b.lng).toFixed(1) }))
      .filter(b => b.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  res.json(rows);
});

// ─── GET /api/blood-banks/:id ─────────────────────────────────
router.get('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM blood_banks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Blood bank not found' });
  res.json({ ...row, stocks: JSON.parse(row.stocks || '{}') });
});

module.exports = router;

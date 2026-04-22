const router  = require('express').Router();
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../db/database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validate }                   = require('../middleware/validate');
const escalation                     = require('../services/escalation');
const { applyTrustDelta, awardBadge, DELTAS } = require('../services/trust');

// ─── POST /api/requests ───────────────────────────────────────
const createSchema = z.object({
  blood_group:   z.enum(['A+','A-','B+','B-','O+','O-','AB+','AB-']),
  hospital:      z.string().min(2),
  hospital_ward: z.string().optional(),
  urgency:       z.enum(['Urgent','Critical']).default('Urgent'),
  lat:           z.number().optional(),
  lng:           z.number().optional(),
  city:          z.string().optional(),
});

router.post('/', optionalAuth, validate(createSchema), (req, res) => {
  const db  = getDb();
  const io  = req.app.get('io');
  const id  = uuidv4();
  const now = Date.now();
  const expiresAt = now + 24 * 3600 * 1000; // 24h

  const requesterId = req.user?.sub || null;

  db.prepare(`
    INSERT INTO emergency_requests
      (id, requester_id, blood_group, hospital, hospital_ward, urgency, current_mode, status, lat, lng, city, created_at, expires_at)
    VALUES (?,?,?,?,?,?,1,'active',?,?,?,?,?)
  `).run(
    id, requesterId,
    req.body.blood_group, req.body.hospital,
    req.body.hospital_ward || null,
    req.body.urgency,
    req.body.lat || null, req.body.lng || null,
    req.body.city || null, now, expiresAt
  );

  const request = db.prepare('SELECT * FROM emergency_requests WHERE id = ?').get(id);

  // Broadcast alert to all online donors with matching blood group
  if (io) {
    io.to(`blood:${req.body.blood_group}`).emit('donor:alert', {
      requestId:   id,
      blood_group: req.body.blood_group,
      hospital:    req.body.hospital,
      urgency:     req.body.urgency,
      city:        req.body.city || null,
    });
  }

  // Start escalation if Critical
  if (req.body.urgency === 'Critical') {
    escalation.startEscalation(id);
  }

  res.status(201).json(request);
});

// ─── GET /api/requests ────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM emergency_requests
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

// ─── GET /api/requests/:id ────────────────────────────────────
router.get('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM emergency_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });

  const responses = db.prepare(`
    SELECT rr.*, u.name, u.blood_group, u.trust_score
    FROM request_responses rr
    JOIN users u ON u.id = rr.donor_id
    WHERE rr.request_id = ?
  `).all(req.params.id);

  res.json({ ...row, responses });
});

// ─── POST /api/requests/:id/respond ──────────────────────────
const respondSchema = z.object({
  action: z.enum(['accepted','declined']),
});

router.post('/:id/respond', authenticate, validate(respondSchema), (req, res) => {
  const db        = getDb();
  const io        = req.app.get('io');
  const requestId = req.params.id;
  const donorId   = req.user.sub;
  const { action } = req.body;

  const request = db.prepare('SELECT * FROM emergency_requests WHERE id = ?').get(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'active') return res.status(409).json({ error: 'Request is no longer active' });

  const existing = db.prepare(
    'SELECT id FROM request_responses WHERE request_id = ? AND donor_id = ?'
  ).get(requestId, donorId);
  if (existing) return res.status(409).json({ error: 'Already responded to this request' });

  // Calculate response time
  const responseTimeMs = Date.now() - request.created_at;

  db.prepare(`
    INSERT INTO request_responses (id, request_id, donor_id, action, response_time_ms, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(uuidv4(), requestId, donorId, action, responseTimeMs, Date.now());

  if (action === 'accepted') {
    // Update request status
    db.prepare("UPDATE emergency_requests SET status = 'matched' WHERE id = ?").run(requestId);
    escalation.cancelEscalation(requestId);

    // Trust: fast response badge
    if (responseTimeMs <= 120_000) { // within 2 min
      applyTrustDelta(donorId, DELTAS.FAST_RESPONSE, `Fast response in ${Math.round(responseTimeMs/1000)}s`);
      awardBadge(donorId, 'first_responder');
    }

    // Notify requester
    if (io && request.requester_id) {
      io.to(`user:${request.requester_id}`).emit('request:matched', {
        requestId,
        donorId,
        message: 'A donor has accepted your request!',
      });
    }
    io.to(`request:${requestId}`).emit('request:matched', { requestId, donorId });

  } else {
    // Trust penalty for declining
    applyTrustDelta(donorId, DELTAS.REQUEST_DECLINED, 'Emergency request declined');
  }

  res.json({ ok: true, action });
});

// ─── POST /api/requests/:id/confirm ──────────────────────────
const confirmSchema = z.object({
  donated: z.boolean(),  // true = confirmed, false = didn't happen
});

router.post('/:id/confirm', authenticate, validate(confirmSchema), (req, res) => {
  const db        = getDb();
  const requestId = req.params.id;
  const donorId   = req.user.sub;
  const { donated } = req.body;

  const request = db.prepare('SELECT * FROM emergency_requests WHERE id = ?').get(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // Find the accepted response
  const response = db.prepare(
    "SELECT * FROM request_responses WHERE request_id = ? AND donor_id = ? AND action = 'accepted'"
  ).get(requestId, donorId);
  if (!response) return res.status(403).json({ error: 'You did not accept this request' });

  if (donated) {
    // Create confirmed donation record
    db.prepare(`
      INSERT INTO donations (id, donor_id, request_id, hospital, status, donated_at, created_at)
      VALUES (?,?,?,?,'confirmed',?,?)
    `).run(uuidv4(), donorId, requestId, request.hospital, Date.now(), Date.now());

    // Mark request as fulfilled
    db.prepare("UPDATE emergency_requests SET status = 'fulfilled' WHERE id = ?").run(requestId);

    // Trust reward
    applyTrustDelta(donorId, DELTAS.DONATION_CONFIRMED, `Donation confirmed · ${request.hospital}`);
    awardBadge(donorId, 'first_drop');
  } else {
    // No donation — trust penalty
    db.prepare("UPDATE emergency_requests SET status = 'cancelled' WHERE id = ?").run(requestId);
    applyTrustDelta(donorId, DELTAS.NO_CONFIRMATION_24H, 'Donation did not happen — unmatched connection');
  }

  // Updated user score for response
  const user = db.prepare('SELECT trust_score FROM users WHERE id = ?').get(donorId);
  res.json({ ok: true, donated, new_trust_score: user.trust_score });
});

module.exports = router;

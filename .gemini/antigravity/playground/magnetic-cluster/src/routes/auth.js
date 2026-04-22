const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { z }    = require('zod');
const { getDb } = require('../db/database');
const { validate } = require('../middleware/validate');
const { applyTrustDelta, awardBadge, DELTAS } = require('../services/trust');

// In-memory OTP store: phone → { code, expiresAt }
const otpStore = new Map();

// ─── Helpers ─────────────────────────────────────────────────
function issueTokens(user) {
  const access = jwt.sign(
    { sub: user.id, blood_group: user.blood_group, tier: user.tier },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshId = uuidv4();
  const refresh = jwt.sign(
    { sub: user.id, jti: refreshId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  // Persist refresh token
  const db = getDb();
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  db.prepare(
    'INSERT INTO sessions (id, user_id, refresh_token, expires_at) VALUES (?,?,?,?)'
  ).run(refreshId, user.id, refresh, expiresAt);

  return { accessToken: access, refreshToken: refresh };
}

// ─── POST /api/auth/register ─────────────────────────────────
const registerSchema = z.object({
  name:        z.string().min(2),
  phone:       z.string().regex(/^\d{10}$/),
  blood_group: z.enum(['A+','A-','B+','B-','O+','O-','AB+','AB-']),
  password:    z.string().min(6),
  city:        z.string().optional(),
});

router.post('/register', validate(registerSchema), (req, res) => {
  const { name, phone, blood_group, password, city } = req.body;
  const db = getDb();

  const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (exists) return res.status(409).json({ error: 'Phone already registered' });

  // Generate OTP
  const otp      = process.env.NODE_ENV === 'development' ? (process.env.DEMO_OTP || '123456') : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min
  otpStore.set(phone, { otp, expiresAt, name, blood_group, password, city });

  console.log(`📱  OTP for ${phone}: ${otp}`);

  res.json({
    message: 'OTP sent. Use POST /api/auth/verify-otp to complete registration.',
    ...(process.env.NODE_ENV === 'development' ? { dev_otp: otp } : {}),
  });
});

// ─── POST /api/auth/verify-otp ───────────────────────────────
const verifySchema = z.object({
  phone: z.string().regex(/^\d{10}$/),
  otp:   z.string().length(6),
});

router.post('/verify-otp', validate(verifySchema), (req, res) => {
  const { phone, otp } = req.body;
  const entry = otpStore.get(phone);

  if (!entry) return res.status(400).json({ error: 'No pending OTP for this phone' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (entry.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

  otpStore.delete(phone);

  const db = getDb();
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(entry.password, 10);

  db.prepare(`
    INSERT INTO users (id, name, phone, password_hash, blood_group, trust_score, aadhaar_verified, city, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, entry.name, phone, passwordHash, entry.blood_group, 5, 1, entry.city || null, Date.now(), Date.now());

  // Award initial trust for profile + aadhaar
  applyTrustDelta(id, DELTAS.PROFILE_CREATED,  'Profile created');
  applyTrustDelta(id, DELTAS.AADHAAR_VERIFIED, 'Aadhaar mock-verified at signup');
  awardBadge(id, 'id_verified');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ message: 'Registration complete', ...issueTokens(user), user: _safeUser(user) });
});

// ─── POST /api/auth/login ─────────────────────────────────────
const loginSchema = z.object({
  phone:    z.string().regex(/^\d{10}$/),
  password: z.string(),
});

router.post('/login', validate(loginSchema), (req, res) => {
  const { phone, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }

  res.json({ ...issueTokens(user), user: _safeUser(user) });
});

// ─── POST /api/auth/demo-login ───────────────────────────────
// Returns a valid JWT for the seeded demo user (Rohan Sharma)
router.post('/demo-login', (_req, res) => {
  const db   = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = 'demo-rohan-sharma-001'").get();
  if (!user) return res.status(503).json({ error: 'Demo user not seeded yet' });
  res.json({ ...issueTokens(user), user: _safeUser(user) });
});

// ─── POST /api/auth/refresh ───────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE refresh_token = ?').get(refreshToken);
    if (!session || session.expires_at < Date.now()) {
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }
    // Rotate: delete old, issue new
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    res.json(issueTokens(user));
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    getDb().prepare('DELETE FROM sessions WHERE refresh_token = ?').run(refreshToken);
  }
  res.json({ message: 'Logged out' });
});

// ─── Helper ──────────────────────────────────────────────────
function _safeUser(u) {
  const { password_hash, otp_code, otp_expires_at, ...safe } = u;
  return safe;
}

module.exports = router;

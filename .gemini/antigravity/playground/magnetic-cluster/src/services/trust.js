const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../db/database');

// ─── BADGE DEFINITIONS ────────────────────────────────────────
const BADGE_RULES = [
  { key: 'first_drop',      label: 'First Drop',       check: (u) => u.donationCount >= 1 },
  { key: 'life_saver',      label: 'Life Saver',        check: (u) => u.donationCount >= 5 },
  { key: 'trusted_hero',    label: 'Trusted Hero',      check: (u) => u.trust_score >= 90  },
  { key: 'first_responder', label: 'First Responder',   check: () => false /* awarded on fast response */ },
  { key: 'on_a_streak',     label: 'On a Streak',       check: () => false /* awarded on 3-mo streak */   },
  { key: 'id_verified',     label: 'ID Verified',       check: (u) => u.aadhaar_verified === 1            },
];

// ─── DELTA VALUES ─────────────────────────────────────────────
const DELTAS = {
  DONATION_CONFIRMED:    +5,
  FAST_RESPONSE:         +2,
  AADHAAR_VERIFIED:      +5,
  PROFILE_CREATED:       +5,
  REQUEST_DECLINED:      -3,
  NO_CONFIRMATION_24H:   -3,
};

/**
 * Apply a trust delta to a user, log it, and check for new badge unlocks.
 * @param {string} userId
 * @param {number} delta   - signed integer
 * @param {string} reason  - human-readable description
 */
function applyTrustDelta(userId, delta, reason) {
  const db = getDb();

  // Update score (clamp 0–100)
  db.prepare(`
    UPDATE users
    SET trust_score = MAX(0, MIN(100, trust_score + ?)),
        updated_at  = ?
    WHERE id = ?
  `).run(delta, Date.now(), userId);

  // Log entry
  db.prepare(`
    INSERT INTO trust_log (id, user_id, delta, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, delta, reason, Date.now());

  // Check badge unlocks
  checkBadges(userId);
}

/**
 * Award a specific badge (no-op if already earned).
 */
function awardBadge(userId, badgeKey) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO badges (id, user_id, badge_key, earned_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), userId, badgeKey, Date.now());
  } catch {
    // already exists — silently ignore
  }
}

/**
 * Check all threshold-based badge rules for a user and award any newly unlocked.
 */
function checkBadges(userId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;

  const donationCount = db.prepare(
    "SELECT COUNT(*) as n FROM donations WHERE donor_id = ? AND status = 'confirmed'"
  ).get(userId).n;

  const ctx = { ...user, donationCount };

  for (const rule of BADGE_RULES) {
    if (rule.check(ctx)) {
      awardBadge(userId, rule.key);
    }
  }
}

/**
 * Get full trust profile for a user (score, log, badges, donations summary).
 */
function getTrustProfile(userId) {
  const db = getDb();

  const log = db.prepare(`
    SELECT delta, reason, created_at
    FROM trust_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(userId);

  const badges = db.prepare(`
    SELECT badge_key, earned_at FROM badges WHERE user_id = ?
  `).all(userId);

  const donations = db.prepare(`
    SELECT hospital, status, donated_at
    FROM donations
    WHERE donor_id = ?
    ORDER BY donated_at DESC
    LIMIT 10
  `).all(userId);

  const summary = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
    FROM donations WHERE donor_id = ?
  `).get(userId);

  return { log, badges, donations, summary };
}

module.exports = { applyTrustDelta, awardBadge, checkBadges, getTrustProfile, DELTAS };

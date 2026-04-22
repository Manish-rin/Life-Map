const { getDb } = require('./database');

function runMigrations() {
  const db = getDb();

  db.exec(`
    /* ── users ─────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS users (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      phone            TEXT UNIQUE NOT NULL,
      password_hash    TEXT NOT NULL,
      blood_group      TEXT NOT NULL,
      trust_score      INTEGER NOT NULL DEFAULT 5,
      tier             TEXT NOT NULL DEFAULT 'individual',
      aadhaar_verified INTEGER NOT NULL DEFAULT 0,
      is_available     INTEGER NOT NULL DEFAULT 1,
      lat              REAL,
      lng              REAL,
      city             TEXT,
      otp_code         TEXT,
      otp_expires_at   INTEGER,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── sessions (refresh token store) ────────────────────────── */
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token TEXT UNIQUE NOT NULL,
      expires_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── emergency_requests ─────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS emergency_requests (
      id            TEXT PRIMARY KEY,
      requester_id  TEXT REFERENCES users(id),
      blood_group   TEXT NOT NULL,
      hospital      TEXT NOT NULL,
      hospital_ward TEXT,
      urgency       TEXT NOT NULL DEFAULT 'Urgent',
      current_mode  INTEGER NOT NULL DEFAULT 1,
      status        TEXT NOT NULL DEFAULT 'active',
      lat           REAL,
      lng           REAL,
      city          TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at    INTEGER
    );

    /* ── escalation_events ──────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS escalation_events (
      id           TEXT PRIMARY KEY,
      request_id   TEXT NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
      from_mode    INTEGER NOT NULL,
      to_mode      INTEGER NOT NULL,
      triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── request_responses (donor accepted/declined) ────────────── */
    CREATE TABLE IF NOT EXISTS request_responses (
      id               TEXT PRIMARY KEY,
      request_id       TEXT NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
      donor_id         TEXT NOT NULL REFERENCES users(id),
      action           TEXT NOT NULL,
      response_time_ms INTEGER,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── donations ──────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS donations (
      id         TEXT PRIMARY KEY,
      donor_id   TEXT NOT NULL REFERENCES users(id),
      request_id TEXT REFERENCES emergency_requests(id),
      hospital   TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      donated_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── badges ─────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS badges (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_key TEXT NOT NULL,
      earned_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(user_id, badge_key)
    );

    /* ── trust_log ──────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS trust_log (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    /* ── blood_banks ────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS blood_banks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      address    TEXT,
      lat        REAL NOT NULL,
      lng        REAL NOT NULL,
      phone      TEXT,
      stocks     TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  console.log('✅  DB migrations complete');
}

// Allow running directly: node src/db/migrate.js
if (require.main === module) {
  require('dotenv').config();
  runMigrations();
}

module.exports = { runMigrations };

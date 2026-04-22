const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../db/database');

// Duration per mode in ms (default 90s; 9s for demo via .env)
const ESCALATION_MS = parseInt(process.env.ESCALATION_MS || '90000', 10);

// Map<requestId, { timer: Timeout }>
const activeTimers = new Map();

let _io = null;

/** Call this once during server startup with the Socket.IO server instance. */
function init(io) {
  _io = io;
}

/**
 * Start escalation for a newly created emergency request.
 * Mode 1 (one-way reveal) → Mode 2 (consent-based full reveal) after ESCALATION_MS.
 * Only 2 modes — Mode 2 is final.
 */
function startEscalation(requestId) {
  if (activeTimers.has(requestId)) return; // already running

  const timer = setTimeout(() => {
    _escalateTo(requestId, 1, 2);
  }, ESCALATION_MS);

  activeTimers.set(requestId, { timer });
  console.log(`⏱  Escalation started for ${requestId} (${ESCALATION_MS}ms → Mode 2)`);
}

/**
 * Cancel pending escalation timer for a request
 * (call when request is fulfilled / cancelled).
 */
function cancelEscalation(requestId) {
  const entry = activeTimers.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  activeTimers.delete(requestId);
}

/** Internal: perform DB update + broadcast. Mode 2 is final — no further timers. */
function _escalateTo(requestId, fromMode, toMode) {
  const db = getDb();

  // Persist mode change
  db.prepare(
    'UPDATE emergency_requests SET current_mode = ? WHERE id = ? AND status = ?'
  ).run(toMode, requestId, 'active');

  // Log escalation event
  db.prepare(`
    INSERT INTO escalation_events (id, request_id, from_mode, to_mode, triggered_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), requestId, fromMode, toMode, Date.now());

  // Broadcast to all clients watching this request
  if (_io) {
    _io.to(`request:${requestId}`).emit('request:mode-change', {
      requestId,
      mode: toMode,
      label: _modeLabel(toMode),
      desc:  _modeDesc(toMode),
    });
    console.log(`📡  Emitted mode-change → ${toMode} for ${requestId}`);
  }

  // Mode 2 is final — clean up
  activeTimers.delete(requestId);
}

function _modeLabel(mode) {
  return { 1: 'Mode 1', 2: 'Mode 2' }[mode] || 'Mode ?';
}
function _modeDesc(mode) {
  return {
    1: "One-way reveal: requester's number pushed to donor immediately.",
    2: 'Full mutual reveal: donor pre-consented to share details with nearby patients in emergencies.',
  }[mode] || '';
}

/** Returns info about all currently running escalations (for debugging). */
function getActiveCount() {
  return activeTimers.size;
}

module.exports = { init, startEscalation, cancelEscalation, getActiveCount };

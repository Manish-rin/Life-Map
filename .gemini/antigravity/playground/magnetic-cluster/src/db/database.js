const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../../praansetu.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');   // better write concurrency
    _db.pragma('foreign_keys = ON');    // enforce FK constraints
    _db.pragma('synchronous = NORMAL'); // balance safety + speed
  }
  return _db;
}

module.exports = { getDb };

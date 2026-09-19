import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR } from './config.js';

export const db = new Database(path.join(DATA_DIR, 'inventory.db'));
db.pragma('journal_mode = WAL');

// Boxes are keyed by their physical box number. Items are soft-deleted
// (deleted_at) so that deletes can be undone from the history table.
db.exec(`
CREATE TABLE IF NOT EXISTS boxes (
  id               INTEGER PRIMARY KEY,
  description      TEXT NOT NULL DEFAULT '',
  label_printed_at TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id     INTEGER NOT NULL,
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  category   TEXT NOT NULL DEFAULT '',
  condition  TEXT NOT NULL DEFAULT 'Working'
             CHECK (condition IN ('Working', 'Broken', 'Not Working', 'Spare')),
  notes      TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_box ON items (box_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action    TEXT NOT NULL,     -- create | update | delete
  entity    TEXT NOT NULL,     -- item | box
  entity_id INTEGER NOT NULL,
  before    TEXT,              -- JSON row before the change
  after     TEXT,              -- JSON row after the change
  summary   TEXT NOT NULL,
  undone    INTEGER NOT NULL DEFAULT 0
);
`);

export const now = () => new Date().toISOString();

export const itemRow = r => ({
  id: r.id,
  box: r.box_id,
  name: r.name,
  qty: r.qty,
  category: r.category,
  condition: r.condition,
  notes: r.notes,
  tags: r.tags,
  updatedAt: r.updated_at,
});

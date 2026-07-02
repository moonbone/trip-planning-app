// SQLite storage for feature-request tickets, using Node's built-in
// node:sqlite (no external dependency, no npm install step at deploy time).
//
// This degrades gracefully rather than crashing: node:sqlite needs Node
// 22.5+ (not available on this project's nodejs20.x Lambda runtime), and
// even where it is available, Lambda's filesystem is read-only outside
// /tmp, which is itself ephemeral per-instance. Both the module import and
// the DB init are wrapped so a failure just leaves isAvailable() false -
// handler.mjs checks that and returns a clean 503 instead of the whole
// Lambda crashing on cold start. Tickets currently only work for
// local/laptop hosting, where both of those constraints are absent. A real
// Lambda deployment would need DynamoDB/RDS/EFS instead.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.TICKETS_DB_PATH || join(__dirname, '..', 'data', 'tickets.db');

export const STATUSES = ['new', 'in_progress', 'processed', 'done'];
const DEFAULT_STATUS = 'new';

let db = null;
let insertStmt, getStmt, listStmt, updateStatusStmt;

try {
  const { DatabaseSync } = await import('node:sqlite');

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '${DEFAULT_STATUS}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrate DBs created before the status column existed.
  const existingColumns = db.prepare('PRAGMA table_info(tickets)').all();
  if (!existingColumns.some((c) => c.name === 'status')) {
    db.exec(`ALTER TABLE tickets ADD COLUMN status TEXT NOT NULL DEFAULT '${DEFAULT_STATUS}'`);
  }

  const TICKET_COLUMNS = 'id, subject, description, email, status, created_at';
  insertStmt = db.prepare('INSERT INTO tickets (subject, description, email) VALUES (?, ?, ?)');
  getStmt = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`);
  listStmt = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets ORDER BY id DESC`);
  updateStatusStmt = db.prepare('UPDATE tickets SET status = ? WHERE id = ?');
} catch (e) {
  db = null;
}

export function isAvailable() {
  return db !== null;
}

export function createTicket({ subject, description, email }) {
  const info = insertStmt.run(subject, description, email);
  return getStmt.get(info.lastInsertRowid);
}

export function listTickets() {
  return listStmt.all();
}

export function getTicket(id) {
  return getStmt.get(id);
}

export function updateTicketStatus(id, status) {
  if (!getTicket(id)) return null;
  updateStatusStmt.run(status, id);
  return getTicket(id);
}

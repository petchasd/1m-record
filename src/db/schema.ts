/**
 * Single source of truth for the benchmark schema and the lookup SQL.
 * Imported by both the Node seed script and the on-device app so the
 * offline-built .db and the in-app-seeded .db are byte-compatible.
 */

export const DB_NAME = 'items.db';

/** qr_code values look like OBK-000000000001 (12-digit zero-padded ordinal). */
export const QR_PREFIX = 'OBK-';
export const QR_DIGITS = 12;

export const qrCodeForId = (id: number): string =>
  QR_PREFIX + String(id).padStart(QR_DIGITS, '0');

export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY,
  qr_code      TEXT NOT NULL,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  location     TEXT NOT NULL,
  qty          INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  payload      TEXT
);`;

/** Shared by both seeding methods so the placeholder order matches RowTuple. */
export const INSERT_SQL =
  'INSERT INTO items (id, qr_code, sku, name, location, qty, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

/** The three index variants the benchmark matrix switches between. */
export const INDEX_SQL = {
  none: null,
  plain: 'CREATE INDEX IF NOT EXISTS idx_items_qr ON items(qr_code);',
  unique: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_items_qr ON items(qr_code);',
} as const;

export type IndexMode = keyof typeof INDEX_SQL;

export const DROP_INDEX_SQL = 'DROP INDEX IF EXISTS idx_items_qr;';

/** The hot-path queries. Nothing else may run inside a measured window. */
export const LOOKUP_SELECT_STAR = 'SELECT * FROM items WHERE qr_code = ? LIMIT 1;';
export const LOOKUP_SELECT_3COL =
  'SELECT id, name, qty FROM items WHERE qr_code = ? LIMIT 1;';

export interface Item {
  id: number;
  qr_code: string;
  sku: string;
  name: string;
  location: string;
  qty: number;
  updated_at: number;
  payload: string | null;
}

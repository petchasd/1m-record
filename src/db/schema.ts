/**
 * Single source of truth for the schema and the lookup query. Imported by both
 * the Node seed script and the on-device app so the .db file and the app agree
 * on column order.
 */

export const DB_NAME = 'profiles.db';

export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  city        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);`;

export const INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);';

/** Shared by seed.ts so the placeholder order matches ProfileTuple. */
export const INSERT_SQL =
  'INSERT INTO profiles (id, email, name, phone, city, created_at) VALUES (?, ?, ?, ?, ?, ?)';

/** Look a profile up by its email — uses idx_profiles_email. */
export const LOOKUP_SQL = 'SELECT * FROM profiles WHERE email = ? LIMIT 1;';

/**
 * Same query, `NOT INDEXED` forces SQLite to ignore idx_profiles_email and
 * scan the table row by row — for comparing indexed vs. unindexed lookup
 * speed without needing a second dataset.
 */
export const LOOKUP_SQL_NO_INDEX =
  'SELECT * FROM profiles NOT INDEXED WHERE email = ? LIMIT 1;';

export interface Profile {
  id: number;
  email: string;
  name: string;
  phone: string;
  city: string;
  created_at: number;
}

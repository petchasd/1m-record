/**
 * On-device SQLite access.
 *
 * Datasets arrive via scripts/seed.ts (built offline with better-sqlite3),
 * `adb push`ed, then copied into the app's files dir by scripts/push-db.ts —
 * this module just opens the result and runs the one query the app needs.
 */

import { ANDROID_FILES_PATH, open, type DB, type Scalar } from '@op-engineering/op-sqlite';

import { DB_NAME, LOOKUP_SQL, LOOKUP_SQL_NO_INDEX, type Profile } from './schema';

/** Where push-db.ts lands the file: /data/data/com.qrbench/files. */
export const DB_LOCATION: string = ANDROID_FILES_PATH;

/**
 * `failOnCreate` matters: without it a missing file silently becomes an empty
 * database and every search just reports "not found". Fail loudly instead.
 */
export const openProfiles = (): DB =>
  open({ name: DB_NAME, location: DB_LOCATION, failOnCreate: true });

export const countProfiles = (db: DB): number => {
  const res = db.executeSync('SELECT COUNT(*) AS n FROM profiles;');
  return Number(res.rows[0]?.n ?? 0);
};

const rowToProfile = (row: Record<string, Scalar> | undefined): Profile | null => {
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    phone: String(row.phone),
    city: String(row.city),
    created_at: Number(row.created_at),
  };
};

export const findByEmail = (db: DB, email: string, useIndex = true): Profile | null => {
  const res = db.executeSync(useIndex ? LOOKUP_SQL : LOOKUP_SQL_NO_INDEX, [email]);
  return rowToProfile(res.rows[0]);
};

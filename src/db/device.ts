/**
 * On-device SQLite access for the benchmark.
 *
 * Everything here is deliberately thin: the measured windows in Phase 2 must
 * contain a single op-sqlite call and nothing else, so no wrapper allocates,
 * logs, or maps rows inside the hot path.
 *
 * Datasets arrive one of two ways (see README):
 *   A. built offline by scripts/seed.ts, `adb push`ed, then copied into the
 *      app's files dir by scripts/push-db.ts — this module just opens them.
 *   B. seeded in-app by src/db/seedInApp.ts.
 */

import {
  ANDROID_FILES_PATH,
  open,
  type DB,
  type PreparedStatement,
  type Scalar,
} from '@op-engineering/op-sqlite';

import { pragmaStatements, type PragmaConfig } from './pragmas';
import {
  DROP_INDEX_SQL,
  INDEX_SQL,
  LOOKUP_SELECT_3COL,
  LOOKUP_SELECT_STAR,
  type IndexMode,
  type Item,
} from './schema';

/** The datasets scripts/seed.ts produces, by logical name. */
export const DATASETS = {
  '1M': 'items.db',
  '1M-noindex': 'items_noindex.db',
  '100k': 'items_100k.db',
  '10k': 'items_10k.db',
} as const;

export type DatasetKey = keyof typeof DATASETS;

/** Where push-db.ts lands the files: /data/data/com.qrbench/files. */
export const DB_LOCATION: string = ANDROID_FILES_PATH;

export type QueryStyle = 'star' | '3col';

export const lookupSql = (style: QueryStyle): string =>
  style === 'star' ? LOOKUP_SELECT_STAR : LOOKUP_SELECT_3COL;

export interface OpenedDb {
  db: DB;
  dataset: DatasetKey;
  fileName: string;
  path: string;
}

/**
 * Open a dataset and apply the runtime pragmas.
 *
 * `failOnCreate` matters: without it a missing file silently becomes an empty
 * database and the benchmark happily reports sub-microsecond lookups over zero
 * rows. Fail loudly instead.
 */
export const openDataset = (
  dataset: DatasetKey,
  pragmas: PragmaConfig,
): OpenedDb => {
  const fileName = DATASETS[dataset];
  const db = open({
    name: fileName,
    location: DB_LOCATION,
    failOnCreate: true,
  });

  for (const stmt of pragmaStatements(pragmas)) {
    db.executeSync(stmt);
  }

  return { db, dataset, fileName, path: `${DB_LOCATION}/${fileName}` };
};

/** Row count, used for the on-screen "1,000,000 rows" proof. */
export const countRows = (db: DB): number => {
  const res = db.executeSync('SELECT COUNT(*) AS n FROM items;');
  return Number(res.rows[0]?.n ?? 0);
};

/** Verbatim `EXPLAIN QUERY PLAN` output — pasted straight into RESULTS.md. */
export const explainQueryPlan = (
  db: DB,
  style: QueryStyle,
  sample: string,
): string => {
  const res = db.executeSync(`EXPLAIN QUERY PLAN ${lookupSql(style)}`, [sample]);
  return res.rows.map(r => String(r.detail ?? '')).join(' | ');
};

/** Which pragma values SQLite actually settled on (WAL can be refused). */
export const readPragmas = (db: DB): Record<string, Scalar> => {
  const read = (name: string): Scalar => {
    const res = db.executeSync(`PRAGMA ${name};`);
    const row = res.rows[0];
    return row ? (Object.values(row)[0] ?? null) : null;
  };
  return {
    journal_mode: read('journal_mode'),
    synchronous: read('synchronous'),
    cache_size: read('cache_size'),
    mmap_size: read('mmap_size'),
    page_size: read('page_size'),
  };
};

/** Switch the index variant in place, so one file serves all three matrix cells. */
export const setIndexMode = (db: DB, mode: IndexMode): void => {
  db.executeSync(DROP_INDEX_SQL);
  const sql = INDEX_SQL[mode];
  if (sql) db.executeSync(sql);
  db.executeSync('ANALYZE;');
};

export const currentIndexMode = (db: DB): IndexMode => {
  const res = db.executeSync(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_qr';",
  );
  const sql = res.rows[0]?.sql;
  if (typeof sql !== 'string') return 'none';
  return sql.toUpperCase().includes('UNIQUE') ? 'unique' : 'plain';
};

/**
 * The four hot-path variants the matrix crosses. Each takes a qr_code and
 * returns nothing but the raw driver result — mapping to `Item` happens outside
 * the measured window.
 *
 * Note the asymmetry: op-sqlite v18's PreparedStatement has `bindSync` but only
 * an async `execute()`, so "prepared + synchronous" is not expressible. That
 * cell of the matrix is reported as N/A rather than faked.
 */
export interface Runners {
  freshSync: (qr: string) => unknown;
  freshAsync: (qr: string) => Promise<unknown>;
  preparedAsync: (qr: string) => Promise<unknown>;
  release: () => void;
}

export const makeRunners = (db: DB, style: QueryStyle): Runners => {
  const sql = lookupSql(style);
  let stmt: PreparedStatement | null = db.prepareStatement(sql);

  return {
    freshSync: qr => db.executeSync(sql, [qr]),
    freshAsync: qr => db.execute(sql, [qr]),
    preparedAsync: async qr => {
      const s = stmt;
      if (!s) throw new Error('prepared statement released');
      s.bindSync([qr]);
      return s.execute();
    },
    release: () => {
      stmt = null;
    },
  };
};

/** Used by ScanScreen — this one does map the row, outside the DB timing window. */
export const rowToItem = (row: Record<string, Scalar> | undefined): Item | null => {
  if (!row) return null;
  return {
    id: Number(row.id),
    qr_code: String(row.qr_code),
    sku: String(row.sku ?? ''),
    name: String(row.name ?? ''),
    location: String(row.location ?? ''),
    qty: Number(row.qty ?? 0),
    updated_at: Number(row.updated_at ?? 0),
    payload: row.payload == null ? null : String(row.payload),
  };
};

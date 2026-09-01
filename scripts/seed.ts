/**
 * Build the profiles .db offline on the dev machine, then `yarn push-db` it
 * onto the device. Never insert 1M rows one-at-a-time from JS.
 *
 *   yarn seed                       # 1,000,000 rows -> artifacts/profiles.db
 *   yarn seed --rows 10000          # a smaller dataset for a quick check
 *
 * Deterministic: the same --rows always produces a byte-identical file, since
 * every row is a pure function of its id (see src/db/rowgen.ts).
 */

import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

import { CREATE_TABLE_SQL, INDEX_SQL, INSERT_SQL } from '../src/db/schema';
import { makeProfile } from '../src/db/rowgen';

interface Options {
  rows: number;
  out: string;
  batch: number;
}

const parseArgs = (argv: string[]): Options => {
  const opts: Options = {
    rows: 1_000_000,
    out: 'artifacts/profiles.db',
    batch: 10_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith('--')) continue;
    const key = flag.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    i += 1;

    switch (key) {
      case 'rows':
      case 'batch': {
        const n = Number(value.replace(/[_,]/g, ''));
        if (!Number.isFinite(n) || n <= 0) throw new Error(`bad --${key}: ${value}`);
        opts[key] = n;
        break;
      }
      case 'out':
        opts.out = value;
        break;
      default:
        throw new Error(`unknown flag --${key}`);
    }
  }

  return opts;
};

const fmtMs = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;

const fmtBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const main = (): void => {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = resolve(process.cwd(), opts.out);
  mkdirSync(dirname(outPath), { recursive: true });

  console.log(`seeding ${opts.rows.toLocaleString()} rows -> ${opts.out}`);

  // Start from a clean file so reruns are deterministic, not additive.
  const db = new Database(outPath);
  db.exec('DROP TABLE IF EXISTS profiles;');
  db.exec(CREATE_TABLE_SQL);

  // Bulk-load pragmas — only affect how fast this build runs, not lookups.
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -200000');
  db.pragma('temp_store = MEMORY');

  const insert = db.prepare(INSERT_SQL);
  const insertBatch = db.transaction((from: number, to: number) => {
    for (let id = from; id <= to; id += 1) {
      insert.run(...makeProfile(id));
    }
  });

  const tInsert = performance.now();
  for (let from = 1; from <= opts.rows; from += opts.batch) {
    const to = Math.min(from + opts.batch - 1, opts.rows);
    insertBatch(from, to);
    if (to % 100_000 === 0 || to === opts.rows) {
      process.stdout.write(
        `  ${to.toLocaleString()} rows  ${fmtMs(performance.now() - tInsert)}\n`,
      );
    }
  }
  const insertMs = performance.now() - tInsert;

  const tIndex = performance.now();
  db.exec(INDEX_SQL);
  const indexMs = performance.now() - tIndex;

  db.exec('ANALYZE;');

  const count = (db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  db.close();

  const size = statSync(outPath).size;
  console.log('');
  console.log(`rows      ${count.toLocaleString()}`);
  console.log(`insert    ${fmtMs(insertMs)} (${Math.round(opts.rows / (insertMs / 1000)).toLocaleString()} rows/s)`);
  console.log(`index     ${fmtMs(indexMs)}`);
  console.log(`file      ${outPath} (${fmtBytes(size)})`);

  if (count !== opts.rows) {
    throw new Error(`row count mismatch: expected ${opts.rows}, got ${count}`);
  }
};

main();

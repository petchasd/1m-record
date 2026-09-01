/**
 * Phase 1 / method A — build the .db offline on the dev machine.
 *
 *   yarn seed                       # 1,000,000 rows -> artifacts/items.db
 *   yarn seed --rows 100000         # scaling-curve dataset
 *   yarn seed --rows 1000000 --index none
 *
 * Deterministic: the same --rows and --seed always produce a byte-identical
 * dataset, so benchmark runs are comparable across rebuilds.
 */

import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

import {
  CREATE_TABLE_SQL,
  INDEX_SQL,
  INSERT_SQL,
  qrCodeForId,
  type IndexMode,
} from '../src/db/schema';
import { makeRng, makeRow } from '../src/db/rowgen';

interface Options {
  rows: number;
  out: string;
  index: IndexMode;
  seed: number;
  batch: number;
}

const parseArgs = (argv: string[]): Options => {
  const opts: Options = {
    rows: 1_000_000,
    out: 'artifacts/items.db',
    index: 'unique',
    seed: 42,
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
      case 'seed':
      case 'batch': {
        const n = Number(value.replace(/[_,]/g, ''));
        if (!Number.isFinite(n) || n <= 0) throw new Error(`bad --${key}: ${value}`);
        opts[key] = n;
        break;
      }
      case 'out':
        opts.out = value;
        break;
      case 'index':
        if (!(value in INDEX_SQL)) {
          throw new Error(`bad --index: ${value} (none|plain|unique)`);
        }
        opts.index = value as IndexMode;
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

  console.log(
    `seeding ${opts.rows.toLocaleString()} rows -> ${opts.out} (index=${opts.index}, seed=${opts.seed})`,
  );

  // Start from a clean file so reruns are deterministic, not additive.
  const db = new Database(outPath);
  db.exec('DROP TABLE IF EXISTS items;');
  db.exec(CREATE_TABLE_SQL);

  // Bulk-load pragmas. These are seed-time only — the runtime pragmas are set
  // by the app and are what the benchmark matrix actually varies.
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -200000');
  db.pragma('temp_store = MEMORY');

  const insert = db.prepare(INSERT_SQL);

  const rng = makeRng(opts.seed);
  const insertBatch = db.transaction((from: number, to: number) => {
    for (let id = from; id <= to; id += 1) {
      insert.run(...makeRow(rng, id, qrCodeForId(id)));
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

  const indexSql = INDEX_SQL[opts.index];
  let indexMs = 0;
  if (indexSql) {
    const tIndex = performance.now();
    db.exec(indexSql);
    indexMs = performance.now() - tIndex;
  }

  const tAnalyze = performance.now();
  db.exec('ANALYZE;');
  const analyzeMs = performance.now() - tAnalyze;

  const count = (db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n;
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN SELECT * FROM items WHERE qr_code = ? LIMIT 1`)
    .all('OBK-000000000001');

  db.close();

  const size = statSync(outPath).size;
  console.log('');
  console.log(`rows         ${count.toLocaleString()}`);
  console.log(`insert       ${fmtMs(insertMs)} (${Math.round(opts.rows / (insertMs / 1000)).toLocaleString()} rows/s, batch=${opts.batch})`);
  console.log(`create index ${indexSql ? fmtMs(indexMs) : 'skipped'}`);
  console.log(`analyze      ${fmtMs(analyzeMs)}`);
  console.log(`total        ${fmtMs(insertMs + indexMs + analyzeMs)}`);
  console.log(`file         ${outPath} (${fmtBytes(size)})`);
  console.log(`query plan   ${JSON.stringify(plan)}`);

  if (count !== opts.rows) {
    throw new Error(`row count mismatch: expected ${opts.rows}, got ${count}`);
  }
};

main();

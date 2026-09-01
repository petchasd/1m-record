/**
 * Phase 4 / output — pull results.db off the device and flatten it.
 *
 *   yarn pull-results                 # -> artifacts/results.json + results.csv
 *
 * The app writes every run into a SQLite table (src/bench/export.ts); this
 * script does the adb pull and the JSON/CSV expansion on the dev machine so the
 * app needs no filesystem native module.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const PACKAGE = 'com.qrbench';
const RESULTS_DB = 'results.db';
const DEVICE_TMP = '/data/local/tmp/qrbench';
const OUT_DIR = 'artifacts';

const ADB = (() => {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  return home ? join(home, 'platform-tools', 'adb') : 'adb';
})();

const adb = (...args: string[]): string =>
  execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

interface RunRow {
  id: number;
  created_at: number;
  kind: string;
  label: string;
  payload: string;
}

/** One flattened line per benchmark cell — the shape RESULTS.md tables use. */
interface FlatCell {
  run_id: number;
  created_at: string;
  run_label: string;
  platform: string;
  clock_resolution_ms: number;
  cell_id: string;
  axis: string;
  variant: string;
  config: string;
  dataset: string;
  rows: number;
  index_mode: string;
  plan: string;
  warmup: number;
  n: number;
  min_ms: number;
  p50_ms: number;
  p90_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  mean_ms: number;
  stddev_ms: number;
  batch_mean_ms: number;
  setup_ms: number;
  error: string;
}

const CSV_COLUMNS: (keyof FlatCell)[] = [
  'run_id',
  'created_at',
  'run_label',
  'platform',
  'clock_resolution_ms',
  'cell_id',
  'axis',
  'variant',
  'config',
  'dataset',
  'rows',
  'index_mode',
  'plan',
  'warmup',
  'n',
  'min_ms',
  'p50_ms',
  'p90_ms',
  'p95_ms',
  'p99_ms',
  'max_ms',
  'mean_ms',
  'stddev_ms',
  'batch_mean_ms',
  'setup_ms',
  'error',
];

const csvCell = (v: unknown): string => {
  const str = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (rows: FlatCell[]): string =>
  [
    CSV_COLUMNS.join(','),
    ...rows.map(r => CSV_COLUMNS.map(c => csvCell(r[c])).join(',')),
  ].join('\n');

const flatten = (runs: RunRow[]): FlatCell[] => {
  const out: FlatCell[] = [];

  for (const run of runs) {
    if (run.kind !== 'matrix') continue;

    const parsed = JSON.parse(run.payload) as {
      env?: { platform?: string; clockResolutionMs?: number };
      results?: Record<string, any>[];
    };
    const env = parsed.env ?? {};

    for (const c of parsed.results ?? []) {
      const st = c.stats ?? {};
      out.push({
        run_id: run.id,
        created_at: new Date(run.created_at).toISOString(),
        run_label: run.label,
        platform: env.platform ?? '',
        clock_resolution_ms: env.clockResolutionMs ?? NaN,
        cell_id: c.id,
        axis: c.axis,
        variant: c.variant,
        config: c.config,
        dataset: c.dataset,
        rows: c.rows,
        index_mode: c.indexMode,
        plan: c.plan,
        warmup: c.warmup,
        n: st.n,
        min_ms: st.min,
        p50_ms: st.p50,
        p90_ms: st.p90,
        p95_ms: st.p95,
        p99_ms: st.p99,
        max_ms: st.max,
        mean_ms: st.mean,
        stddev_ms: st.stddev,
        batch_mean_ms: c.batchMeanMs,
        setup_ms: c.setupMs,
        error: c.error ?? '',
      });
    }
  }

  return out;
};

const main = (): void => {
  const outDir = resolve(process.cwd(), OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const localDb = join(outDir, RESULTS_DB);

  // Same two-stage dance as push-db, in reverse: the app's files dir is not
  // readable by the shell user, so run-as has to hand the file over first.
  adb('shell', 'mkdir', '-p', DEVICE_TMP);
  adb(
    'shell',
    `run-as ${PACKAGE} sh -c 'cat files/${RESULTS_DB}' > ${DEVICE_TMP}/${RESULTS_DB}`,
  );
  adb('pull', `${DEVICE_TMP}/${RESULTS_DB}`, localDb);

  const db = new Database(localDb, { readonly: true });
  const runs = db.prepare('SELECT * FROM runs ORDER BY id').all() as RunRow[];
  db.close();

  const json = runs.map(r => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    kind: r.kind,
    label: r.label,
    payload: JSON.parse(r.payload),
  }));

  const jsonPath = join(outDir, 'results.json');
  const csvPath = join(outDir, 'results.csv');
  const flat = flatten(runs);

  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  writeFileSync(csvPath, toCsv(flat));

  console.log(`runs      ${runs.length}`);
  console.log(`cells     ${flat.length}`);
  console.log(`json      ${jsonPath}`);
  console.log(`csv       ${csvPath}`);
};

main();

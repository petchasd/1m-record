/**
 * Phase 2 benchmark harness — runs the matrix without touching the camera.
 *
 * Measurement rules, enforced by construction:
 *   - the timed window contains exactly one op-sqlite call, nothing else;
 *   - lookup keys are drawn ahead of time (seeded RNG), so no work happens
 *     between the two clock reads;
 *   - every cell is warmed up and the warm-up samples are discarded;
 *   - the total elapsed time of the measured loop is recorded alongside the
 *     per-sample array, so results stay meaningful even if the JS clock turns
 *     out to be too coarse for a single sub-millisecond query.
 */

import {
  countRows,
  currentIndexMode,
  explainQueryPlan,
  makeRunners,
  openDataset,
  readPragmas,
  setIndexMode,
  type DatasetKey,
} from '../db/device';
import { makeRng } from '../db/rowgen';
import { qrCodeForId } from '../db/schema';
import { summarize, type Stats } from './stats';
import { describeCell, type Cell } from './matrix';

export const SAMPLE_SEED = 20260901;

/** Distinct qr_codes drawn uniformly from the dataset, reproducible run to run. */
export const pickSampleKeys = (rowCount: number, count: number, seed = SAMPLE_SEED): string[] => {
  const rng = makeRng(seed);
  const keys = new Array<string>(count);
  for (let i = 0; i < count; i += 1) {
    keys[i] = qrCodeForId(1 + Math.floor(rng() * rowCount));
  }
  return keys;
};

export interface CellResult {
  id: string;
  axis: string;
  variant: string;
  config: string;
  dataset: DatasetKey;
  rows: number;
  indexMode: string;
  plan: string;
  pragmas: Record<string, unknown>;
  warmup: number;
  stats: Stats;
  /** Wall time of the whole measured loop / iterations — clock-resolution proof. */
  batchMeanMs: number;
  setupMs: number;
  error?: string;
}

export interface RunProgress {
  index: number;
  total: number;
  cell: Cell;
  phase: 'setup' | 'warmup' | 'measure' | 'done';
}

/** Yield to the UI thread so progress renders between cells. */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export const runCell = async (cell: Cell): Promise<CellResult> => {
  const tSetup = performance.now();
  const { db } = openDataset(cell.dataset, cell.pragmas);

  const base: Omit<CellResult, 'stats' | 'batchMeanMs' | 'setupMs'> = {
    id: cell.id,
    axis: cell.axis,
    variant: cell.variant,
    config: describeCell(cell),
    dataset: cell.dataset,
    rows: 0,
    indexMode: 'unknown',
    plan: '',
    pragmas: {},
    warmup: cell.warmup,
  };

  try {
    // Rebuilding an index on 1M rows is slow, so only do it when the file on
    // disk does not already match the cell's requested index mode.
    if (currentIndexMode(db) !== cell.indexMode) {
      setIndexMode(db, cell.indexMode);
    }

    const rows = countRows(db);
    const keys = pickSampleKeys(rows, cell.iterations + cell.warmup);
    const runners = makeRunners(db, cell.style);
    const setupMs = performance.now() - tSetup;

    const meta = {
      ...base,
      rows,
      indexMode: currentIndexMode(db),
      plan: explainQueryPlan(db, cell.style, keys[0] as string),
      pragmas: readPragmas(db),
    };

    const run =
      cell.statement === 'prepared'
        ? runners.preparedAsync
        : cell.api === 'async'
          ? runners.freshAsync
          : runners.freshSync;
    const isAsync = cell.api === 'async' || cell.statement === 'prepared';

    // Warm-up: page cache, Hermes JIT, and SQLite's own statement cache.
    for (let i = 0; i < cell.warmup; i += 1) {
      const key = keys[i] as string;
      if (isAsync) await run(key);
      else run(key);
    }

    const samples = new Array<number>(cell.iterations);
    const tLoop = performance.now();
    for (let i = 0; i < cell.iterations; i += 1) {
      const key = keys[cell.warmup + i] as string;
      if (isAsync) {
        const t0 = performance.now();
        await run(key);
        samples[i] = performance.now() - t0;
      } else {
        const t0 = performance.now();
        run(key);
        samples[i] = performance.now() - t0;
      }
    }
    const loopMs = performance.now() - tLoop;

    runners.release();

    return {
      ...meta,
      stats: summarize(samples),
      batchMeanMs: loopMs / cell.iterations,
      setupMs,
    };
  } catch (e) {
    return {
      ...base,
      stats: summarize([]),
      batchMeanMs: NaN,
      setupMs: performance.now() - tSetup,
      error: String(e),
    };
  } finally {
    db.close();
  }
};

export const runMatrix = async (
  cells: Cell[],
  onProgress?: (p: RunProgress) => void,
): Promise<CellResult[]> => {
  const results: CellResult[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i] as Cell;
    onProgress?.({ index: i, total: cells.length, cell, phase: 'setup' });
    await tick();
    results.push(await runCell(cell));
    onProgress?.({ index: i, total: cells.length, cell, phase: 'done' });
    await tick();
  }
  return results;
};

export interface ColdStartResult {
  dataset: DatasetKey;
  rows: number;
  /** open() + pragmas, before any query runs. */
  openMs: number;
  /** The very first lookup on a cold page cache. */
  firstQueryMs: number;
  /** The next nine, to show how fast the cache warms. */
  next9Ms: number[];
  plan: string;
}

/**
 * Cold-start measurement. Only meaningful as the *first* thing the JS bundle
 * does after a process kill — see `yarn cold-start` in the README, which stops
 * the app, drops the OS page cache pressure by rebooting the process, and
 * relaunches so this runs before anything else has touched the file.
 */
export const measureColdStart = async (
  dataset: DatasetKey,
  pragmas: Parameters<typeof openDataset>[1],
): Promise<ColdStartResult> => {
  const tOpen = performance.now();
  const { db } = openDataset(dataset, pragmas);
  const openMs = performance.now() - tOpen;

  try {
    const rows = countRows(db);
    const keys = pickSampleKeys(rows, 10, SAMPLE_SEED + 1);
    const runners = makeRunners(db, 'star');

    const t0 = performance.now();
    runners.freshSync(keys[0] as string);
    const firstQueryMs = performance.now() - t0;

    const next9Ms: number[] = [];
    for (let i = 1; i < 10; i += 1) {
      const t = performance.now();
      runners.freshSync(keys[i] as string);
      next9Ms.push(performance.now() - t);
    }

    runners.release();
    return {
      dataset,
      rows,
      openMs,
      firstQueryMs,
      next9Ms,
      plan: explainQueryPlan(db, 'star', keys[0] as string),
    };
  } finally {
    db.close();
  }
};

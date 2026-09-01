/**
 * The Phase 2 test matrix.
 *
 * Why one-factor-at-a-time rather than a full cross product: the axes below have
 * 3 × 2 × 2 × 2 × 2 × 2 × 2 × 2 × 3 = 2,304 combinations. At 1,100 iterations a
 * cell that is 2,534,400 measured queries, and the no-index cells alone would
 * run for hours. OFAT still visits *every value of every variable* (which is
 * what the brief's table asks for) at 1/100th the cost, and it is the correct
 * design when the question is "which knob matters", not "which knobs interact".
 *
 * Interactions we do care about are added back explicitly as extra cells
 * (`EXTRA_CELLS`), and the dataset-size axis is swept in full for the scaling
 * curve.
 */

import { DEFAULT_PRAGMAS, type PragmaConfig } from '../db/pragmas';
import type { DatasetKey, QueryStyle } from '../db/device';
import type { IndexMode } from '../db/schema';

export type StatementMode = 'fresh' | 'prepared';
export type ApiMode = 'sync' | 'async';

export interface Cell {
  /** Stable id — used as the results-table key, so keep it deterministic. */
  id: string;
  /** Which axis this cell varies from the baseline ('baseline' for the baseline itself). */
  axis: string;
  /** Human label for the varied value, e.g. "journal=DELETE". */
  variant: string;
  dataset: DatasetKey;
  indexMode: IndexMode;
  pragmas: PragmaConfig;
  style: QueryStyle;
  statement: StatementMode;
  api: ApiMode;
  warmup: number;
  iterations: number;
}

export interface CellConfig {
  dataset: DatasetKey;
  indexMode: IndexMode;
  pragmas: PragmaConfig;
  style: QueryStyle;
  statement: StatementMode;
  api: ApiMode;
}

export const DEFAULT_WARMUP = 100;
export const DEFAULT_ITERATIONS = 1000;

/**
 * A full scan of 1M rows costs 10²–10³ ms, so 1,000 iterations would run for
 * up to 15 minutes on its own. 50 samples still gives a usable p50/p95 for a
 * cell whose only job is to show the order-of-magnitude difference.
 */
export const NO_INDEX_WARMUP = 5;
export const NO_INDEX_ITERATIONS = 50;

/**
 * The reference configuration. Every OFAT cell differs from this in exactly
 * one field, so any delta is attributable to that field.
 */
export const BASELINE: CellConfig = {
  dataset: '1M',
  indexMode: 'unique',
  pragmas: DEFAULT_PRAGMAS,
  style: 'star',
  statement: 'fresh',
  api: 'sync',
};

const withPragmas = (patch: Partial<PragmaConfig>): PragmaConfig => ({
  ...DEFAULT_PRAGMAS,
  ...patch,
});

const iterationsFor = (cfg: CellConfig): { warmup: number; iterations: number } =>
  cfg.indexMode === 'none'
    ? { warmup: NO_INDEX_WARMUP, iterations: NO_INDEX_ITERATIONS }
    : { warmup: DEFAULT_WARMUP, iterations: DEFAULT_ITERATIONS };

const cell = (axis: string, variant: string, patch: Partial<CellConfig>): Cell => {
  const cfg: CellConfig = { ...BASELINE, ...patch };
  return {
    id: `${axis}:${variant}`,
    axis,
    variant,
    ...cfg,
    ...iterationsFor(cfg),
  };
};

/**
 * op-sqlite v18's PreparedStatement exposes `bindSync` but only an async
 * `execute()`. "prepared + synchronous" therefore cannot be expressed against
 * this driver — the cell is reported as N/A rather than silently substituted.
 */
export const UNSUPPORTED_CELLS: { id: string; reason: string }[] = [
  {
    id: 'statement:prepared+sync',
    reason:
      'op-sqlite v18 PreparedStatement has bindSync() but no executeSync(); ' +
      'a prepared statement can only be executed asynchronously.',
  },
];

export const buildMatrix = (): Cell[] => [
  cell('baseline', 'baseline', {}),

  // Index — the single biggest factor, and the one the brief predicts.
  cell('index', 'none (full scan)', { dataset: '1M-noindex', indexMode: 'none' }),
  cell('index', 'plain INDEX', { indexMode: 'plain' }),
  // 'unique INDEX' is the baseline; listed here for the report, not re-run.

  // journal_mode
  cell('journal_mode', 'DELETE', { pragmas: withPragmas({ journalMode: 'DELETE' }) }),
  // 'WAL' is the baseline.

  // synchronous
  cell('synchronous', 'FULL', { pragmas: withPragmas({ synchronous: 'FULL' }) }),
  // 'NORMAL' is the baseline.

  // cache_size
  cell('cache_size', 'default', { pragmas: withPragmas({ cacheSize: null }) }),
  // '-20000 (20 MB)' is the baseline.

  // mmap_size
  cell('mmap_size', '0 (off)', { pragmas: withPragmas({ mmapSize: 0 }) }),
  // '256 MB' is the baseline.

  // Query style
  cell('query_style', '3 columns', { style: '3col' }),
  // 'SELECT *' is the baseline.

  // Statement handling / API. Prepared reuse is only reachable via the async
  // API, so this cell varies two fields at once — hence the paired async cell
  // below, which isolates the API cost on its own.
  cell('api', 'async', { api: 'async' }),
  cell('statement', 'prepared (async)', { statement: 'prepared', api: 'async' }),

  // Dataset size — swept in full for the scaling curve.
  cell('dataset', '10k', { dataset: '10k' }),
  cell('dataset', '100k', { dataset: '100k' }),
  // '1M' is the baseline.

  // Interactions worth keeping: the all-conservative and all-tuned corners.
  cell('combined', 'conservative (DELETE/FULL/default/mmap off)', {
    pragmas: {
      journalMode: 'DELETE',
      synchronous: 'FULL',
      cacheSize: null,
      mmapSize: 0,
    },
  }),
  cell('combined', 'tuned + 3col + async prepared', {
    style: '3col',
    statement: 'prepared',
    api: 'async',
  }),
];

export const describeCell = (c: Cell): string =>
  [
    `dataset=${c.dataset}`,
    `index=${c.indexMode}`,
    `journal=${c.pragmas.journalMode}`,
    `sync=${c.pragmas.synchronous}`,
    `cache=${c.pragmas.cacheSize ?? 'default'}`,
    `mmap=${c.pragmas.mmapSize === 0 ? 'off' : `${c.pragmas.mmapSize / 1024 / 1024}MB`}`,
    `select=${c.style}`,
    `stmt=${c.statement}`,
    `api=${c.api}`,
  ].join(' ');

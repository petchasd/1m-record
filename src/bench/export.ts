/**
 * Result export.
 *
 * Results are written into a second SQLite file in the app's files dir rather
 * than through a filesystem module: op-sqlite is already a dependency, the app
 * needs no extra native module, and `adb pull` + scripts/pull-results.ts turn
 * the file into results.json / results.csv on the dev machine.
 */

import { open, type DB } from '@op-engineering/op-sqlite';

import { DB_LOCATION } from '../db/device';
import type { CellResult, ColdStartResult } from './runner';

export const RESULTS_DB = 'results.db';

const CREATE_RESULTS_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  payload     TEXT NOT NULL
);`;

export type RunKind = 'matrix' | 'cold-start' | 'scan' | 'seed';

export interface RunEnvelope {
  kind: RunKind;
  label: string;
  createdAt: number;
  payload: unknown;
}

const withResultsDb = <T>(fn: (db: DB) => T): T => {
  const db = open({ name: RESULTS_DB, location: DB_LOCATION });
  try {
    db.executeSync(CREATE_RESULTS_SQL);
    return fn(db);
  } finally {
    db.close();
  }
};

export const saveRun = (kind: RunKind, label: string, payload: unknown): number =>
  withResultsDb(db => {
    const createdAt = Date.now();
    const res = db.executeSync(
      'INSERT INTO runs (created_at, kind, label, payload) VALUES (?, ?, ?, ?);',
      [createdAt, kind, label, JSON.stringify(payload)],
    );
    return Number(res.insertId ?? 0);
  });

export interface SavedRun {
  id: number;
  createdAt: number;
  kind: string;
  label: string;
}

export const listRuns = (): SavedRun[] =>
  withResultsDb(db => {
    const res = db.executeSync(
      'SELECT id, created_at, kind, label FROM runs ORDER BY id DESC LIMIT 50;',
    );
    return res.rows.map(r => ({
      id: Number(r.id),
      createdAt: Number(r.created_at),
      kind: String(r.kind),
      label: String(r.label),
    }));
  });

export const clearRuns = (): void =>
  withResultsDb(db => {
    db.executeSync('DELETE FROM runs;');
  });

export const resultsDbPath = (): string => `${DB_LOCATION}/${RESULTS_DB}`;

/**
 * Environment stamp saved with every run — a number without the device and
 * driver it came from cannot be compared against anything.
 */
export interface RunEnvironment {
  platform: string;
  clockResolutionMs: number;
  datasetRows: number;
  appVersion: string;
}

export const saveMatrixRun = (
  label: string,
  env: RunEnvironment,
  results: CellResult[],
): number => saveRun('matrix', label, { env, results });

export const saveColdStartRun = (
  label: string,
  env: RunEnvironment,
  result: ColdStartResult,
): number => saveRun('cold-start', label, { env, result });

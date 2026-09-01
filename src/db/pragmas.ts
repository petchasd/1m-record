/**
 * Runtime pragma configuration — the axes the Phase 2 benchmark matrix varies.
 *
 * These are applied to an already-open connection. They are deliberately kept
 * separate from the bulk-load pragmas in scripts/seed.ts: those only affect how
 * fast the file gets built, these affect how fast lookups run.
 */

export type JournalMode = 'DELETE' | 'WAL';
export type Synchronous = 'FULL' | 'NORMAL';

export interface PragmaConfig {
  journalMode: JournalMode;
  synchronous: Synchronous;
  /** Negative = KiB of memory; `null` leaves SQLite's default in place. */
  cacheSize: number | null;
  /** Bytes to memory-map; 0 disables mmap. */
  mmapSize: number;
}

export const DEFAULT_PRAGMAS: PragmaConfig = {
  journalMode: 'WAL',
  synchronous: 'NORMAL',
  cacheSize: -20000,
  mmapSize: 268435456,
};

/** The baseline every "conservative default" comparison is measured against. */
export const CONSERVATIVE_PRAGMAS: PragmaConfig = {
  journalMode: 'DELETE',
  synchronous: 'FULL',
  cacheSize: null,
  mmapSize: 0,
};

export const pragmaStatements = (cfg: PragmaConfig): string[] => {
  const stmts = [
    `PRAGMA journal_mode = ${cfg.journalMode};`,
    `PRAGMA synchronous = ${cfg.synchronous};`,
    `PRAGMA mmap_size = ${cfg.mmapSize};`,
  ];
  if (cfg.cacheSize !== null) {
    stmts.push(`PRAGMA cache_size = ${cfg.cacheSize};`);
  }
  return stmts;
};

export const describePragmas = (cfg: PragmaConfig): string =>
  [
    `journal=${cfg.journalMode}`,
    `sync=${cfg.synchronous}`,
    `cache=${cfg.cacheSize ?? 'default'}`,
    `mmap=${cfg.mmapSize === 0 ? 'off' : `${cfg.mmapSize / 1024 / 1024}MB`}`,
  ].join(' ');

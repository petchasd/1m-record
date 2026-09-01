/**
 * Deterministic row generation, shared by the Node seed script (method A) and
 * the in-app seeder (method B).
 *
 * Both paths MUST consume the RNG in exactly the same order, otherwise the two
 * seeding methods produce different data and their benchmark numbers stop being
 * comparable. Keep the field order in `makeRow` frozen.
 */

export const WAREHOUSES = ['BKK', 'CNX', 'HKT', 'KKC', 'UBP', 'HDY'] as const;

export const CATEGORIES = [
  'Bolt',
  'Bracket',
  'Cable',
  'Filter',
  'Gasket',
  'Hinge',
  'Motor',
  'Panel',
  'Relay',
  'Valve',
] as const;

const HEX = '0123456789abcdef';

/** Epoch anchor so `updated_at` does not drift between seed runs. */
export const SEED_EPOCH = Date.UTC(2026, 0, 1);

/** mulberry32 — small, fast, and identical on Node and Hermes. */
/* eslint-disable no-bitwise */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/* eslint-enable no-bitwise */

export const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)] as T;

/** ~200 bytes of JSON so row size (and therefore page count) is realistic. */
const makePayload = (rng: () => number, id: number): string => {
  let filler = '';
  for (let i = 0; i < 96; i += 1) filler += HEX[Math.floor(rng() * 16)];
  return JSON.stringify({
    lot: `L${(id % 9999).toString().padStart(4, '0')}`,
    bin: `${pick(rng, WAREHOUSES)}-${Math.floor(rng() * 60) + 1}-${Math.floor(rng() * 20) + 1}`,
    grade: pick(rng, ['A', 'B', 'C']),
    checksum: filler,
  });
};

/** Positional row tuple, ordered to match INSERT_SQL's placeholders. */
export type RowTuple = [
  id: number,
  qr_code: string,
  sku: string,
  name: string,
  location: string,
  qty: number,
  updated_at: number,
  payload: string,
];

/**
 * Build one row. `qrCode` is passed in rather than derived here so this module
 * stays free of schema imports and the two callers share one qr formatter.
 */
export const makeRow = (
  rng: () => number,
  id: number,
  qrCode: string,
): RowTuple => {
  const category = pick(rng, CATEGORIES);
  return [
    id,
    qrCode,
    `SKU-${category.slice(0, 3).toUpperCase()}-${(id % 100000).toString().padStart(5, '0')}`,
    `${category} ${Math.floor(rng() * 900) + 100}mm`,
    `${pick(rng, WAREHOUSES)}-${String(Math.floor(rng() * 40) + 1).padStart(2, '0')}-${String(Math.floor(rng() * 12) + 1).padStart(2, '0')}`,
    Math.floor(rng() * 500),
    SEED_EPOCH - Math.floor(rng() * 365 * 86400_000),
    makePayload(rng, id),
  ];
};

/**
 * Deterministic profile generation, shared by scripts/seed.ts (build time) and
 * the app (to compute a random *existing* email without querying the device —
 * see SearchScreen's "random email" button).
 *
 * Each row is seeded from its own id rather than one RNG advanced row-by-row,
 * so any row's data — including its email — can be recomputed standalone from
 * just its id, on either Node or Hermes.
 */

const FIRST_NAMES = [
  'Somchai', 'Suda', 'Anan', 'Malee', 'Kittipong', 'Nualjan', 'Prasert',
  'Ratana', 'Somsak', 'Wanida', 'Chai', 'Duangjai', 'Niran', 'Ploy',
  'Thawatchai', 'Areeya', 'Boonmee', 'Chulee', 'Decha', 'Ekasit',
] as const;

const LAST_NAMES = [
  'Srisuk', 'Chaiyasit', 'Boonmee', 'Thongdee', 'Rattanakul', 'Suwannee',
  'Phromma', 'Kaewkla', 'Wongsa', 'Meesuk', 'Panyawong', 'Intharat',
  'Chantasorn', 'Sombat', 'Yodying',
] as const;

const CITIES = [
  'Bangkok', 'Chiang Mai', 'Phuket', 'Khon Kaen', 'Udon Thani', 'Hat Yai',
  'Nakhon Ratchasima', 'Rayong', 'Chonburi', 'Nonthaburi',
] as const;

/** mulberry32 — small, fast, identical on Node and Hermes. */
/* eslint-disable no-bitwise */
const makeRng = (seed: number): (() => number) => {
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

const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)] as T;

/** Epoch anchor so `created_at` does not drift between seed runs. */
const SEED_EPOCH = Date.UTC(2026, 0, 1);

/** Purely a function of id — every email is guaranteed unique and derivable. */
export const emailForId = (id: number): string => `user${id}@example.com`;

export type ProfileTuple = [
  id: number,
  email: string,
  name: string,
  phone: string,
  city: string,
  created_at: number,
];

export const makeProfile = (id: number): ProfileTuple => {
  const rng = makeRng(id);
  const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
  const phone = `08${String(Math.floor(rng() * 1e8)).padStart(8, '0')}`;
  const city = pick(rng, CITIES);
  const createdAt = SEED_EPOCH - Math.floor(rng() * 365 * 86_400_000);
  return [id, emailForId(id), name, phone, city, createdAt];
};

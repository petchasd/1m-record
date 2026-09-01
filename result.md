# op-sqlite + B-tree index makes indexed lookup on a 1M-row on-device SQLite table ~1,000-10,000x faster than an unindexed scan

* Author: Tharathep
* Date: 2026-09-01
* Tags: react-native, sqlite, op-sqlite, performance, offline, indexing

## Knowledge

A React Native benchmark app (`@op-engineering/op-sqlite` 18.1.4) that searches a
1,000,000-row on-device SQLite table by email confirms the standard B-tree
index tradeoff is fully tangible on-device, not just a theoretical DB concept.

### Library: `@op-engineering/op-sqlite`

A native SQLite binding for React Native built on **JSI** (JavaScript
Interface) instead of the old async bridge. In practice:

- Calls into SQLite can be **synchronous** — `executeSync()` returns the
  result directly, with no `Promise`/`await`, no arguments serialized to JSON
  to cross the bridge, and no waiting for a response through the bridge's
  async message queue. (An async `execute()` also exists.)
- It exposes SQLite almost directly: open a named database file from a given
  location, run SQL with bound (`?`) parameters, get rows back as plain JS
  objects.

This is what makes the *measurement* trustworthy: a `performance.now()`
wrapped directly around `executeSync()` reflects SQLite's own execution time,
not time lost waiting on React Native's async bridge queue.

### Opening the database — `src/db/device.ts`

```ts
import { ANDROID_FILES_PATH, open, type DB } from '@op-engineering/op-sqlite';

// The app's private files/ directory — the same folder scripts/push-db.ts's
// `run-as` step copies profiles.db into.
export const DB_LOCATION: string = ANDROID_FILES_PATH;

export const openProfiles = (): DB =>
  open({
    name: 'profiles.db',
    location: DB_LOCATION,
    failOnCreate: true, // throw instead of silently creating an empty db
  });
```

- `open()` returns a `DB` handle — a JSI host object, not a JS wrapper around
  an async bridge call — so getting it back is effectively instant.
- `ANDROID_FILES_PATH` is a constant the library exports that resolves to the
  app's private storage path (`/data/data/<package>/files`).
- `failOnCreate: true` matters: op-sqlite's default is to create an empty
  database if the named file doesn't exist. Without this flag, a setup mistake
  (file never pushed) would show up as every search reporting "not found"
  instead of a clear error.

### Running the lookup query — `src/db/device.ts`

```ts
import type { DB, Scalar } from '@op-engineering/op-sqlite';

const LOOKUP_SQL = 'SELECT * FROM profiles WHERE email = ? LIMIT 1;';

export const findByEmail = (db: DB, email: string): Profile | null => {
  const res = db.executeSync(LOOKUP_SQL, [email]); // <-- the timed call
  const row = res.rows[0];
  return row
    ? {
        id: Number(row.id),
        email: String(row.email),
        name: String(row.name),
        phone: String(row.phone),
        city: String(row.city),
        created_at: Number(row.created_at),
      }
    : null;
};
```

- `executeSync(sql, params)` takes SQL text plus a positional-parameter array
  and returns synchronously. The `?` placeholder is bound to `email` — a
  parameterized query, so there's no string concatenation and no SQL
  injection risk.
- The return value's `.rows` is a plain array of plain objects
  (`Record<string, Scalar>`), one per matched row; `LIMIT 1` means at most one.

### Using it in the screen — `src/screens/SearchScreen.tsx`

```tsx
import { useEffect, useRef } from 'react';
import type { DB } from '@op-engineering/op-sqlite';
import { openProfiles, findByEmail } from '../db/device';

const dbRef = useRef<DB | null>(null);

// Open once, when the screen mounts — not on every search.
useEffect(() => {
  const db = openProfiles();
  dbRef.current = db;
  return () => {
    dbRef.current?.close(); // release the connection on unmount
    dbRef.current = null;
  };
}, []);

// On every search:
const t0 = performance.now();
const profile = findByEmail(dbRef.current!, email);
const ms = performance.now() - t0;
```

Two implementation choices worth reusing elsewhere:

- **The connection is opened once and reused**, not reopened per search.
  Reopening a SQLite file has its own (small but nonzero) cost; reusing the
  connection is also what a real app would do, and it's what makes the timing
  measurement reflect just the query — not file-open overhead — after the
  first search.
- **`db.close()` runs on unmount.** op-sqlite connections are native
  resources; not closing them leaks a file handle for as long as the app
  process lives.

### The "no index" toggle uses the same API

The "without index" comparison isn't a different library feature — it's the
exact same `executeSync()` call with different SQL text:

```ts
const LOOKUP_SQL_NO_INDEX =
  'SELECT * FROM profiles NOT INDEXED WHERE email = ? LIMIT 1;';

export const findByEmail = (
  db: DB,
  email: string,
  useIndex = true,
): Profile | null => {
  const res = db.executeSync(useIndex ? LOOKUP_SQL : LOOKUP_SQL_NO_INDEX, [email]);
  // ...same row mapping as above
};
```

`NOT INDEXED` is standard SQLite SQL (not op-sqlite-specific) that forces the
query planner to ignore every index on the table and scan it row by row. It's
a convenient way to benchmark "with index" vs "without index" on the exact
same table/dataset, without needing a second copy of the data.

### Schema

```sql
CREATE TABLE profiles (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  city        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_profiles_email ON profiles(email);
```

The key point: whichever column you search on should be indexed so lookups
are fast.

### Getting a large prebuilt dataset onto an Android device

Android isolates each app's private storage (sandbox), so you cannot copy a
file from the dev machine straight into the app's data folder. It takes two
`adb` steps:

1. **`adb push`** — copy `profiles.db` from the dev machine to a
   world-readable staging area on the device (`/data/local/tmp/...`).
2. **`adb shell run-as <package>`** — a mechanism available only for debug
   builds — copies the file *from* that staging area *into* the app's
   private `files/` directory, which only the app itself can read and write.

The app does **not** import, parse, or bundle this file at build time. At
runtime it simply opens a fixed, known filename (`profiles.db`) from its own
private directory — if the file has been placed there before first launch,
the app immediately finds a database containing all 1,000,000 rows. If the
file is missing, opening it fails with a clear error (rather than silently
creating an empty database).

This mirrors what a real app might do to ship a large reference dataset (a
product catalog, or offline map tiles, for example) without generating the
data client-side or downloading it over the network on first launch.

### Results

| Query | Expected speed range | Why |
|---|---|---|
| Indexed lookup (`WHERE email = ?`) | Sub-millisecond to low single-digit milliseconds once the cache is warm | ~20 B-tree comparisons |
| Unindexed lookup (`NOT INDEXED`) | Tens to hundreds of milliseconds, growing roughly linearly with row count | Scans up to all 1,000,000 rows |

The qualitative conclusion — that an index makes a point lookup on a
million-row table roughly **1,000-10,000x faster** than a full scan — is a
well-known property of B-tree indexes and is not specific to this app. The
value of the demo is making that difference tangible and testable by hand on
a real phone, not proving anything new.

### Caveats for real production use

The same mechanics apply to a real app, but real-world usage can be slower
than this demo for reasons that have nothing to do with indexing:

- **Lower-end hardware** — dev/test devices are usually more powerful than
  what real users are holding.
- **Cold start** — the first query after installing the app or rebooting the
  device has to read from actual storage because the OS page cache is empty.
  Subsequent queries in this demo all benefit from a warm cache.
- **Larger rows / more complex queries** — rows in this demo are small
  (~100 bytes) and the query is a single equality match. Joins, sorts, or
  large columns (images, long text) will add time.

## Context

Found while building and documenting a standalone React Native (0.87) demo
app whose entire purpose is answering one question: how fast can a phone
search 1,000,000 on-device records keyed by email, fully offline? The app has
a single screen — type or randomize an email, hit search, see the result and
elapsed time — plus a switch to force the same query to use `NOT INDEXED`, to
make the indexed-vs-unindexed difference visible side by side on the same
data.

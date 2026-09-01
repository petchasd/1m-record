# QrBench — 1M-row SQLite email search

A minimal app: seed 1,000,000 fake user profiles into a SQLite `.db` on the
dev machine, push it onto the device, and search them by email from the app.
Every search shows how long it took, in seconds.

That's the whole thing — no benchmark matrix, no multiple phases, no
in-app seeding. Two moving parts: a seed script and a search screen.

## Stack

| Thing | Version |
|---|---|
| React Native | 0.87.1 (bare CLI) |
| `@op-engineering/op-sqlite` | 18.1.4 — JSI, has a true `executeSync` |
| `better-sqlite3` | 13.0.3 (dev only) — builds the `.db` offline |
| Node | 22.22.0 (`.nvmrc`) |

## Setup

```bash
nvm use
yarn install
```

Android SDK is expected at `$ANDROID_HOME`. `yarn android` writes
`android/local.properties` itself if missing.

## Build the dataset and get it on the device

```bash
yarn setup           # seed 1,000,000 rows -> artifacts/profiles.db, then push it
```

`yarn setup` is `yarn seed && yarn push-db` in one command. The push has two
stages — `adb push` to `/data/local/tmp`, then `run-as` to copy into the app's
sandbox — because an app's `files/` dir isn't writable by `adb` directly. Stage
two needs the app installed, so **before the first `yarn android` it's skipped
automatically; run `yarn setup` again after the build** to finish it.

Each row is a pure function of its id (`src/db/rowgen.ts`), so the dataset is
deterministic and its email is `user<id>@example.com` — e.g. id `500000` is
`user500000@example.com`. The table has a `UNIQUE INDEX` on `email`, so a
lookup is a B-tree search, not a full scan:

```
SEARCH profiles USING INDEX idx_profiles_email (email=?)
```

## Run

```bash
yarn android            # first build compiles op-sqlite's NDK bits — slow
yarn setup               # now that the app exists, finish staging the dataset
yarn start               # Metro, if not already running
```

The app is one screen. Type an email and press **ค้นหา**, or press
**สุ่มอีเมลแล้วค้นหา** to pick a random existing id and search for it (handy
since you don't need to know a real email up front). The result shows the
elapsed time in seconds and the profile: name, phone, city, and when it was
created.

The connection is opened once when the screen mounts and kept open, so only
the very first search pays for opening the file — every search after that is
just the query.

A switch toggles **ใช้ index / ไม่ใช้ index**: off, the same query runs with
`NOT INDEXED`, forcing SQLite to ignore `idx_profiles_email` and scan the
table row by row (`SCAN profiles` instead of
`SEARCH profiles USING INDEX idx_profiles_email`) — same table, no second
dataset needed, just to see the difference an index makes.

## Layout

```
scripts/seed.ts        build profiles.db offline with better-sqlite3
scripts/push-db.ts      adb push + run-as copy into the app sandbox
src/db/schema.ts        table + the one lookup query
src/db/rowgen.ts        deterministic row generation (id -> profile, id -> email)
src/db/device.ts        open the .db on-device, find a profile by email
src/screens/SearchScreen.tsx   the app
```

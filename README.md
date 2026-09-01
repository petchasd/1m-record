# QrBench — QR-scan → 1M-row SQLite lookup benchmark

A **benchmark harness, not a product**. It answers one question with defensible
numbers: *สแกน QR แล้วค้นจาก SQLite บนเครื่อง (offline) ที่มี 1,000,000 records ใช้เวลาเท่าไร* —
and it separates the DB time from the camera/UI time, because those differ by
more than an order of magnitude.

## Stack (versions actually used)

| Thing | Version | Why |
|---|---|---|
| React Native | **0.87.1** (bare CLI, not Expo Go) | native modules required |
| React | 19.2.3 | ships with RN 0.87 |
| TypeScript | 6.0.3, `strict` + `noUncheckedIndexedAccess` | |
| `@op-engineering/op-sqlite` | **18.1.4** | JSI; has a true `executeSync` so bridge overhead does not swamp a sub-ms query |
| `better-sqlite3` | 13.0.3 (dev only) | builds the `.db` offline on the dev machine |
| `react-native-vision-camera` | **not installed yet** — see below | Phase 3 only |
| Node | **22.22.0** (`.nvmrc`) | RN 0.87 declares `engines.node >= 22.11.0` |
| JDK | 17 (Zulu) | |

New architecture (Fabric/TurboModules) is **on**, Hermes is **on** — both are the
RN 0.87 defaults and both are left untouched so the numbers reflect a stock app.

### Deviations from the brief (and why)

- **Emulator is API 36.1 arm64-v8a, not API 34 x86_64.** The host is an Apple
  Silicon Mac; the installed SDK has no `android-34` system image and no x86_64
  image for any recent API. Running x86_64 would mean full CPU emulation, which
  would make every timing meaningless. arm64-v8a runs natively via HVF.
  The AVD used is `Pixel_9_Pro_XL` (4 cores, 2 GB RAM, 6 GB data partition).
- **`reactNativeArchitectures=arm64-v8a` only** (`android/gradle.properties`).
  Building all four ABIs triples NDK link time for op-sqlite + nitro with no
  benefit here. Restore the full list before shipping to real users.
- **vision-camera 5 cannot scan QR codes on Android — Phase 3 is deferred.**
  The brief asks for vision-camera **v4** + its built-in `codeScanner`, and that
  is the right call: v4.7.3 ships `useCodeScanner`, a real `CodeScannerPipeline.kt`,
  and MLKit (`com.google.mlkit:barcode-scanning:17.3.0`) on Android. v5 rewrote
  the library on nitro and replaced code scanning with `useObjectOutput`, whose
  every type is marked `@platform iOS`; the Android factory is a stub:

  ```kotlin
  // HybridCameraFactory.kt:112
  override fun createObjectOutput(options: ObjectOutputOptions): HybridCameraObjectOutputSpec {
    throw Error("CameraObjectOutput is not available on Android!")
  }
  ```

  v5.2.3 was installed by mistake (resolved as "latest" instead of the v4 the
  brief pins). It — and its `nitro-modules` / `nitro-image` peers — have been
  removed from the first build entirely: Phases 1 and 2, which carry the actual
  question, need no camera at all, and dropping them cuts a large amount of NDK
  compilation out of the critical path. Phase 3 will add **v4.7.3** back.
- **One matrix cell is not expressible.** op-sqlite v18's `PreparedStatement`
  exposes `bindSync` but only an **async** `execute()` — there is no
  `executeSync` on a statement. So *prepared-reuse × synchronous API* is
  reported as N/A rather than faked. The other three combinations
  (fresh×sync, fresh×async, prepared×async) are all measured.

## Setup

```bash
nvm use                 # 22.22.0, per .nvmrc
yarn install
```

Android SDK is expected at `$ANDROID_HOME`. `yarn android` writes
`android/local.properties` itself if missing.

## Phase 1 — build the datasets

**Method A (default): build the `.db` offline, then push it.** Never insert 1M
rows one-at-a-time from JS.

```bash
yarn seed                                     # 1,000,000 rows -> artifacts/items.db
yarn seed --rows 100000 --out artifacts/items_100k.db
yarn seed --rows 10000  --out artifacts/items_10k.db
yarn seed --rows 1000000 --out artifacts/items_noindex.db --index none
```

Seeding is deterministic: the same `--rows` + `--seed` produce a byte-identical
file, so runs stay comparable across rebuilds (verified by `shasum`).

Measured on this machine (M-series, better-sqlite3, batch = 10k rows/txn):

| dataset | rows | insert | index | total | file |
|---|---:|---:|---:|---:|---:|
| `items.db` | 1,000,000 | 2.58 s (387k rows/s) | 199 ms | 2.81 s | **254.3 MB** |
| `items_100k.db` | 100,000 | 264 ms | 18 ms | 285 ms | 25.4 MB |
| `items_10k.db` | 10,000 | 28 ms | 2 ms | 31 ms | 2.5 MB |
| `items_noindex.db` | 1,000,000 | 2.63 s | — | 2.67 s | 230.3 MB |

`EXPLAIN QUERY PLAN` at build time confirms the intended access path:

```
items.db          SEARCH items USING INDEX idx_items_qr (qr_code=?)
items_noindex.db  SCAN items
```

### Push to the device

An app's `files/` dir is not writable by `adb` directly, so this is two stages —
`adb push` to `/data/local/tmp`, then `run-as` to copy inside the sandbox:

```bash
yarn push-db                    # all artifacts/*.db
yarn push-db --only items.db    # just the 1M dataset
yarn push-db --stage-only       # push only, skip the run-as copy
```

Before the first `yarn android` the app is not installed, so stage 2 is skipped
automatically — **run `yarn push-db` again after the first build**. All four
datasets total ~513 MB staged plus ~513 MB copied, so the AVD needs a data
partition of at least ~2 GB free (`disk.dataPartition.size=6G` here). The script
prints `df /data` and fails early rather than half-way through a 254 MB push.

Reclaim the staging copy afterwards:

```bash
adb shell rm -rf /data/local/tmp/qrbench
```

**Method B (in-app seeding)** exists to measure the worst case — what a user
would sit through if the app built the dataset itself. It is driven from the
Phase 1 screen ("seed 100,000" / "seed 1,000,000") and uses `executeBatch` with
one tuple and many parameter sets, so a whole 10k batch crosses JSI once and
loops in C++ inside a single transaction. Both methods generate rows from the
same `src/db/rowgen.ts`, so the data is identical; only the physical page layout
differs.

## Run

```bash
yarn android            # first build compiles op-sqlite + nitro NDK — slow
yarn push-db            # now that the app exists, finish stage 2
yarn start              # Metro, if not already running
```

The Phase 1 screen opens each dataset and shows, on-device:
`COUNT(*)`, the index variant, verbatim `EXPLAIN QUERY PLAN`, the pragmas SQLite
actually settled on (WAL can be refused), and a sample lookup result.

## Phase 2 — run the benchmark

Switch to the **Phase 2** tab in the app. One button runs the whole matrix; no
scanning by hand is involved.

- 1,000 lookup keys are drawn ahead of the timed loop from a seeded RNG, so the
  same keys are used every run and no work happens between the two clock reads.
- **100 warm-up iterations are run and discarded**, then 1,000 measured.
- Every cell reports `n / min / p50 / p90 / p95 / p99 / max / mean / stddev`,
  plus a **batch mean** (whole-loop wall time ÷ iterations). The batch mean is
  the fallback truth: Hermes' `performance.now()` may quantise to 1 ms, in which
  case a single sub-millisecond sample is a rounding artefact. The screen prints
  the measured clock resolution at the top so this is checkable, not assumed.
- *run ×3 (variance)* repeats the matrix three times and reports the spread of
  the baseline p50 — the "<10% across 3 runs" acceptance check.

Cold start is a separate button and a separate script, because it is only honest
if the query is the *first* thing a fresh process does:

```bash
yarn cold-start             # force-stop + relaunch: app/SQLite cache cold,
                            # but the Linux page cache still holds the file
yarn cold-start --reboot    # reboot first: OS page cache cold too (pessimistic)
```

Collect everything the app recorded:

```bash
yarn pull-results           # -> artifacts/results.json + artifacts/results.csv
```

## Layout

```
scripts/seed.ts          method A — build .db with better-sqlite3
scripts/push-db.ts       adb push + run-as copy into the app sandbox
src/db/schema.ts         schema, index variants, the two lookup queries
src/db/rowgen.ts         deterministic row generation, shared by both methods
src/db/pragmas.ts        runtime pragma axes of the benchmark matrix
src/db/device.ts         open/inspect + the hot-path query runners
src/db/seedInApp.ts      method B — in-app seeding
src/bench/stats.ts       percentiles, variance, clock-resolution probe
src/bench/matrix.ts      the test matrix (OFAT + explicit interaction cells)
src/bench/runner.ts      the measured loop; cold-start measurement
src/bench/export.ts      results -> results.db on the device
src/bench/coldStartFlag.ts   host↔app handshake for the cold-start run
scripts/cold-start.ts    force-stop / reboot, relaunch, trigger the measurement
scripts/pull-results.ts  adb pull results.db -> results.json + results.csv
src/screens/             one screen per phase
```

## Status

- [x] Phase 0 — scaffold, TS strict, deps
- [x] Phase 1 — seeding (method A + B), push tooling, on-device verification screen
- [x] Phase 2 — benchmark matrix harness *(code complete; not yet run on-device)*
- [ ] Phase 3 — real scan flow (t0…t3 breakdown) — blocked on swapping in vision-camera v4.7.3
- [ ] Phase 4 — `RESULTS.md`, CSV/JSON export

No number in this repo has been measured on-device yet: the first Android build
is still compiling. `RESULTS.md` does not exist until it does.

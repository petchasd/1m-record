/**
 * Phase 2 / cold start — kill the app, relaunch it, and measure the first query
 * on a cold cache.
 *
 *   yarn cold-start                 # force-stop + relaunch (process cache cold)
 *   yarn cold-start --reboot        # reboot the device first (OS page cache cold too)
 *
 * Two levels of "cold" and they are not the same:
 *   - force-stop clears the app process, the JS heap, and SQLite's own page
 *     cache, but the *Linux* page cache still holds items.db pages, so the read
 *     is served from RAM;
 *   - a reboot clears that too, which is the number a user actually sees the
 *     first time they open the app after a restart.
 * Both are worth reporting; --reboot is the pessimistic one.
 *
 * The app cooperates via a marker file (src/bench/coldStartFlag.ts): this script
 * pushes it, the app sees it before mounting any screen, runs the measurement,
 * saves it to results.db, and deletes the marker.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const PACKAGE = 'com.qrbench';
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const FLAG_DB = 'coldstart.flag.db';
const DEVICE_TMP = '/data/local/tmp/qrbench';
const OUT_DIR = 'artifacts';

const ADB = (() => {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  return home ? join(home, 'platform-tools', 'adb') : 'adb';
})();

const adb = (...args: string[]): string =>
  execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const sleep = (ms: number): Promise<void> =>
  new Promise(done => setTimeout(done, ms));

/** Build the marker locally so it is a valid SQLite file the app can open. */
const buildFlagFile = (): string => {
  const outDir = resolve(process.cwd(), OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, FLAG_DB);
  rmSync(path, { force: true });

  const db = new Database(path);
  db.exec('CREATE TABLE flag (requested_at INTEGER NOT NULL);');
  db.prepare('INSERT INTO flag (requested_at) VALUES (?)').run(Date.now());
  db.close();
  return path;
};

const waitForBoot = async (): Promise<void> => {
  for (let i = 0; i < 120; i += 1) {
    try {
      if (adb('shell', 'getprop', 'sys.boot_completed').trim() === '1') return;
    } catch {
      // Device still coming back on the wire.
    }
    await sleep(2000);
  }
  throw new Error('device did not finish booting within 4 minutes');
};

const main = async (): Promise<void> => {
  const reboot = process.argv.includes('--reboot');

  const localFlag = buildFlagFile();

  if (reboot) {
    console.log('rebooting device (clears the OS page cache too)…');
    adb('reboot');
    await sleep(5000);
    adb('wait-for-device');
    await waitForBoot();
    // The launcher is up but the boot animation still competes for I/O.
    await sleep(10_000);
  }

  console.log('force-stopping app…');
  adb('shell', 'am', 'force-stop', PACKAGE);

  console.log('pushing cold-start marker…');
  adb('shell', 'mkdir', '-p', DEVICE_TMP);
  adb('push', localFlag, `${DEVICE_TMP}/${FLAG_DB}`);
  adb(
    'shell',
    `run-as ${PACKAGE} sh -c 'cat ${DEVICE_TMP}/${FLAG_DB} > files/${FLAG_DB}'`,
  );

  console.log('relaunching…');
  adb('shell', 'am', 'start', '-n', ACTIVITY);

  console.log('');
  console.log(`mode        ${reboot ? 'reboot (OS page cache cold)' : 'force-stop (process cache cold)'}`);
  console.log('The app runs the measurement on launch and writes it to results.db.');
  console.log('Collect it with:  yarn pull-results');
};

main();

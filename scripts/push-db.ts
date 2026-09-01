/**
 * Get the offline-built profiles.db onto the device.
 *
 *   yarn push-db                  # push + stage into the app
 *   yarn push-db --stage-only     # adb push only; skip the run-as copy
 *
 * Two stages, because an app's files dir is not writable by adb directly:
 *   1. adb push  artifacts/profiles.db -> /data/local/tmp/qrbench/profiles.db
 *   2. run-as <pkg> cp /data/local/tmp/qrbench/profiles.db files/profiles.db
 *
 * Stage 2 needs the debuggable app installed. Before the first `yarn android`
 * it is skipped automatically — rerun this script after the build.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DB_NAME } from '../src/db/schema';

const PACKAGE = 'com.qrbench';
const ARTIFACTS = 'artifacts';
const DEVICE_TMP = '/data/local/tmp/qrbench';

const adbPath = (): string => {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  return home ? join(home, 'platform-tools', 'adb') : 'adb';
};

const ADB = adbPath();

const adb = (...args: string[]): string =>
  execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const adbQuiet = (...args: string[]): string | null => {
  try {
    return adb(...args);
  } catch {
    return null;
  }
};

const fmtBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fmtMs = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;

/** A device must be attached and past boot, or every later step fails opaquely. */
const requireDevice = (): string => {
  const lines = adb('devices')
    .split('\n')
    .slice(1)
    .map(l => l.trim())
    .filter(Boolean);
  const ready = lines.filter(l => l.endsWith('\tdevice'));

  if (ready.length === 0) {
    throw new Error(`no device ready (adb devices:\n${lines.join('\n') || '  <none>'}\n)`);
  }
  if (ready.length > 1) {
    throw new Error(`${ready.length} devices attached; set ANDROID_SERIAL to pick one`);
  }
  return ready[0]!.split('\t')[0]!;
};

/** run-as only works on a debuggable build of an installed package. */
const appInstalled = (): boolean =>
  adbQuiet('shell', 'pm', 'path', PACKAGE)?.includes('package:') ?? false;

const canRunAs = (): boolean =>
  adbQuiet('shell', 'run-as', PACKAGE, 'true') !== null;

const main = (): void => {
  const stageOnly = process.argv.includes('--stage-only');
  const localPath = resolve(process.cwd(), ARTIFACTS, DB_NAME);
  const size = statSync(localPath).size; // throws with a clear ENOENT if `yarn seed` hasn't run yet

  const serial = requireDevice();
  console.log(`device ${serial}`);

  const dfLine = adb('shell', 'df', '/data').split('\n').find(l => l.startsWith('/'));
  console.log(`pushing ${DB_NAME} (${fmtBytes(size)})`);
  if (dfLine) console.log(`device /data  ${dfLine.trim()}`);
  console.log('');

  adb('shell', 'mkdir', '-p', DEVICE_TMP);

  const t0 = performance.now();
  adb('push', localPath, `${DEVICE_TMP}/${DB_NAME}`);
  const pushMs = performance.now() - t0;
  const mbps = size / 1024 / 1024 / (pushMs / 1000);
  console.log(`  push  ${fmtBytes(size).padStart(9)}  ${fmtMs(pushMs).padStart(7)}  ${mbps.toFixed(0)} MB/s`);

  if (stageOnly) {
    console.log(`\nstaged in ${DEVICE_TMP} (--stage-only; app copy skipped)`);
    return;
  }

  if (!appInstalled()) {
    console.log(
      `\n${PACKAGE} not installed — file staged in ${DEVICE_TMP}.` +
        '\nRun `yarn android`, then rerun `yarn push-db` to copy it into the app.',
    );
    return;
  }
  if (!canRunAs()) {
    console.log(
      `\n${PACKAGE} is installed but not run-as accessible (release build?).` +
        `\nFile is staged in ${DEVICE_TMP}; install the debug variant to finish.`,
    );
    return;
  }

  // files/ only exists once the app has written something; on a fresh install
  // the sandbox holds nothing but cache/ and code_cache/.
  adb('shell', `run-as ${PACKAGE} mkdir -p files`);

  const t1 = performance.now();
  // `cat >` rather than `cp`: the app sandbox is not readable by the shell
  // user, so cp cannot run from outside; run-as owns both ends here.
  adb('shell', `run-as ${PACKAGE} sh -c 'cat ${DEVICE_TMP}/${DB_NAME} > files/${DB_NAME}'`);
  const stageMs = performance.now() - t1;
  const staged = adb('shell', `run-as ${PACKAGE} sh -c 'wc -c < files/${DB_NAME}'`).trim();
  console.log(`  stage ${fmtBytes(Number(staged)).padStart(9)}  ${fmtMs(stageMs).padStart(7)}`);

  console.log(`\ndone — ${DB_NAME} is in /data/data/${PACKAGE}/files/`);
  console.log(`(reclaim device space with: adb shell rm -rf ${DEVICE_TMP})`);
};

main();

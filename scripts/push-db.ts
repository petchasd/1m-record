/**
 * Phase 1 / method A, stage 2 — get the offline-built .db onto the device.
 *
 *   yarn push-db                      # push every artifacts/*.db, stage into the app
 *   yarn push-db --only items.db      # just the 1M dataset
 *   yarn push-db --stage-only         # adb push only; skip the run-as copy
 *
 * Two stages, because an app's files dir is not writable by adb directly:
 *   1. adb push  artifacts/x.db -> /data/local/tmp/qrbench/x.db
 *   2. run-as <pkg> cp /data/local/tmp/qrbench/x.db files/x.db
 *
 * Stage 2 needs the debuggable app installed. Before the first `yarn android`
 * it is skipped automatically — rerun this script after the build.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const fmtBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const fmtMs = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;

interface Options {
  only: string[];
  stageOnly: boolean;
}

const parseArgs = (argv: string[]): Options => {
  const opts: Options = { only: [], stageOnly: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--stage-only') {
      opts.stageOnly = true;
      continue;
    }
    if (flag === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('missing value for --only');
      }
      opts.only.push(value);
      i += 1;
      continue;
    }
    throw new Error(`unknown flag ${flag}`);
  }

  return opts;
};

/** A device must be attached and past boot, or every later step fails opaquely. */
const requireDevice = (): string => {
  const lines = adb('devices')
    .split('\n')
    .slice(1)
    .map(l => l.trim())
    .filter(Boolean);
  const ready = lines.filter(l => l.endsWith('\tdevice'));

  if (ready.length === 0) {
    throw new Error(
      `no device ready (adb devices:\n${lines.join('\n') || '  <none>'}\n)`,
    );
  }
  if (ready.length > 1) {
    throw new Error(
      `${ready.length} devices attached; set ANDROID_SERIAL to pick one`,
    );
  }
  return ready[0]!.split('\t')[0]!;
};

/** run-as only works on a debuggable build of an installed package. */
const appInstalled = (): boolean =>
  adbQuiet('shell', 'pm', 'path', PACKAGE)?.includes('package:') ?? false;

const canRunAs = (): boolean =>
  adbQuiet('shell', 'run-as', PACKAGE, 'true') !== null;

const main = (): void => {
  const opts = parseArgs(process.argv.slice(2));
  const artifactsDir = resolve(process.cwd(), ARTIFACTS);

  const available = readdirSync(artifactsDir).filter(f => f.endsWith('.db'));
  const files = opts.only.length > 0 ? opts.only : available;

  for (const f of files) {
    if (!available.includes(f)) {
      throw new Error(`${f} not in ${ARTIFACTS}/ (have: ${available.join(', ')})`);
    }
  }
  if (files.length === 0) {
    throw new Error(`no .db files in ${ARTIFACTS}/ — run \`yarn seed\` first`);
  }

  const serial = requireDevice();
  console.log(`device ${serial}`);

  // Fail early on a full /data rather than half-way through a 250 MB push.
  const totalBytes = files.reduce(
    (sum, f) => sum + statSync(join(artifactsDir, f)).size,
    0,
  );
  const dfLine = adb('shell', 'df', '/data')
    .split('\n')
    .find(l => l.startsWith('/'));
  console.log(`pushing ${files.length} file(s), ${fmtBytes(totalBytes)}`);
  if (dfLine) console.log(`device /data  ${dfLine.trim()}`);
  console.log('');

  adb('shell', 'mkdir', '-p', DEVICE_TMP);

  for (const f of files) {
    const local = join(artifactsDir, f);
    const size = statSync(local).size;
    const t0 = performance.now();
    adb('push', local, `${DEVICE_TMP}/${f}`);
    const ms = performance.now() - t0;
    const mbps = size / 1024 / 1024 / (ms / 1000);
    console.log(
      `  push ${f.padEnd(20)} ${fmtBytes(size).padStart(9)}  ${fmtMs(ms).padStart(7)}  ${mbps.toFixed(0)} MB/s`,
    );
  }

  if (opts.stageOnly) {
    console.log(`\nstaged in ${DEVICE_TMP} (--stage-only; app copy skipped)`);
    return;
  }

  if (!appInstalled()) {
    console.log(
      `\n${PACKAGE} not installed — files staged in ${DEVICE_TMP}.` +
        '\nRun `yarn android`, then rerun `yarn push-db` to copy them into the app.',
    );
    return;
  }
  if (!canRunAs()) {
    console.log(
      `\n${PACKAGE} is installed but not run-as accessible (release build?).` +
        `\nFiles are staged in ${DEVICE_TMP}; install the debug variant to finish.`,
    );
    return;
  }

  // files/ only exists once the app has written something; on a fresh install
  // the sandbox holds nothing but cache/ and code_cache/.
  adb('shell', `run-as ${PACKAGE} mkdir -p files`);

  console.log('');
  for (const f of files) {
    const t0 = performance.now();
    // `cat >` rather than `cp`: the app sandbox is not readable by the shell
    // user, so cp cannot run from outside; run-as owns both ends here.
    adb('shell', `run-as ${PACKAGE} sh -c 'cat ${DEVICE_TMP}/${f} > files/${f}'`);
    const ms = performance.now() - t0;
    const stat = adb(
      'shell',
      `run-as ${PACKAGE} sh -c 'wc -c < files/${f}'`,
    ).trim();
    console.log(`  stage ${f.padEnd(20)} ${fmtBytes(Number(stat)).padStart(9)}  ${fmtMs(ms).padStart(7)}`);
  }

  console.log(`\ndone — datasets are in /data/data/${PACKAGE}/files/`);
  console.log(`(reclaim device space with: adb shell rm -rf ${DEVICE_TMP})`);
};

main();

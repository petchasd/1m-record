/**
 * Phase 1 verification screen.
 *
 * Proves on-device what the acceptance criteria ask for: the dataset really has
 * 1,000,000 rows, the lookup really uses the index, and the pragmas SQLite
 * settled on are the ones we asked for. Also drives method-B (in-app) seeding
 * so its cost can be compared against the offline build.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  DATASETS,
  countRows,
  currentIndexMode,
  explainQueryPlan,
  openDataset,
  readPragmas,
  rowToItem,
  type DatasetKey,
} from '../db/device';
import { DEFAULT_PRAGMAS, describePragmas } from '../db/pragmas';
import { seedInApp, type SeedReport } from '../db/seedInApp';
import { LOOKUP_SELECT_STAR, qrCodeForId } from '../db/schema';

interface Inspection {
  dataset: DatasetKey;
  fileName: string;
  path: string;
  rows: number;
  indexMode: string;
  plan: string;
  pragmas: Record<string, unknown>;
  sampleQr: string;
  sampleName: string;
  openMs: number;
  countMs: number;
}

const DATASET_KEYS = Object.keys(DATASETS) as DatasetKey[];

/** Open, count, explain — the whole Phase 1 proof for one dataset. */
const inspect = (dataset: DatasetKey): Inspection => {
  const tOpen = performance.now();
  const { db, fileName, path } = openDataset(dataset, DEFAULT_PRAGMAS);
  const openMs = performance.now() - tOpen;

  try {
    const tCount = performance.now();
    const rows = countRows(db);
    const countMs = performance.now() - tCount;

    const sampleQr = qrCodeForId(Math.max(1, Math.floor(rows / 2)));
    const res = db.executeSync(LOOKUP_SELECT_STAR, [sampleQr]);
    const item = rowToItem(res.rows[0]);

    return {
      dataset,
      fileName,
      path,
      rows,
      indexMode: currentIndexMode(db),
      plan: explainQueryPlan(db, 'star', sampleQr),
      pragmas: readPragmas(db),
      sampleQr,
      sampleName: item ? `${item.name} @ ${item.location} (qty ${item.qty})` : 'NOT FOUND',
      openMs,
      countMs,
    };
  } finally {
    db.close();
  }
};

const fmtMs = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;

export const Phase1Screen = (): React.JSX.Element => {
  const [results, setResults] = useState<Inspection[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [seedProgress, setSeedProgress] = useState<string | null>(null);
  const [seedReport, setSeedReport] = useState<SeedReport | null>(null);

  const runInspection = useCallback(() => {
    setBusy(true);
    const found: Inspection[] = [];
    const failed: string[] = [];
    for (const key of DATASET_KEYS) {
      try {
        found.push(inspect(key));
      } catch (e) {
        failed.push(`${key} (${DATASETS[key]}): ${String(e)}`);
      }
    }
    setResults(found);
    setErrors(failed);
    setBusy(false);
  }, []);

  useEffect(runInspection, [runInspection]);

  /** Method B, at 100k. A full 1M in-app seed is offered separately below. */
  const runInAppSeed = useCallback(async (rows: number) => {
    setSeedReport(null);
    setSeedProgress('starting…');
    try {
      const report = await seedInApp({
        fileName: `inapp_${rows}.db`,
        rows,
        onProgress: (done, total, elapsed) =>
          setSeedProgress(
            `${done.toLocaleString()} / ${total.toLocaleString()}  ${fmtMs(elapsed)}`,
          ),
      });
      setSeedReport(report);
      setSeedProgress(null);
    } catch (e) {
      setSeedProgress(`failed: ${String(e)}`);
    }
  }, []);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>Phase 1 — dataset verification</Text>
      <Text style={s.dim}>runtime pragmas: {describePragmas(DEFAULT_PRAGMAS)}</Text>

      {busy && <ActivityIndicator style={s.spinner} />}

      {results.map(r => (
        <View key={r.dataset} style={s.card}>
          <Text style={s.h2}>
            {r.dataset} · {r.fileName}
          </Text>
          <Row k="COUNT(*)" v={r.rows.toLocaleString()} strong />
          <Row k="index" v={r.indexMode} />
          <Row k="query plan" v={r.plan} />
          <Row k="sample" v={`${r.sampleQr} → ${r.sampleName}`} />
          <Row k="open / count" v={`${fmtMs(r.openMs)} / ${fmtMs(r.countMs)}`} />
          {Object.entries(r.pragmas).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} />
          ))}
          <Text style={s.path}>{r.path}</Text>
        </View>
      ))}

      {errors.map(e => (
        <View key={e} style={[s.card, s.errCard]}>
          <Text style={s.err}>{e}</Text>
        </View>
      ))}

      <Pressable style={s.btn} onPress={runInspection}>
        <Text style={s.btnText}>re-inspect</Text>
      </Pressable>

      <Text style={s.h1}>Method B — in-app seeding</Text>
      <Text style={s.dim}>
        worst case if the app had to build the dataset itself
      </Text>

      <View style={s.btnRow}>
        {[100_000, 1_000_000].map(n => (
          <Pressable
            key={n}
            style={[s.btn, s.btnHalf, seedProgress !== null && s.btnDisabled]}
            disabled={seedProgress !== null}
            onPress={() => runInAppSeed(n)}
          >
            <Text style={s.btnText}>seed {n.toLocaleString()}</Text>
          </Pressable>
        ))}
      </View>

      {seedProgress !== null && <Text style={s.mono}>{seedProgress}</Text>}

      {seedReport && (
        <View style={s.card}>
          <Text style={s.h2}>{seedReport.fileName}</Text>
          <Row k="rows" v={seedReport.countVerified.toLocaleString()} strong />
          <Row
            k="insert"
            v={`${fmtMs(seedReport.insertMs)} (${seedReport.rowsPerSecond.toLocaleString()} rows/s, batch ${seedReport.batch.toLocaleString()})`}
          />
          <Row k="create index" v={fmtMs(seedReport.indexMs)} />
          <Row k="analyze" v={fmtMs(seedReport.analyzeMs)} />
          <Row k="total" v={fmtMs(seedReport.totalMs)} strong />
        </View>
      )}
    </ScrollView>
  );
};

const Row = ({
  k,
  v,
  strong,
}: {
  k: string;
  v: string;
  strong?: boolean;
}): React.JSX.Element => (
  <View style={s.row}>
    <Text style={s.key}>{k}</Text>
    <Text style={[s.val, strong && s.valStrong]} selectable>
      {v}
    </Text>
  </View>
);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  h1: { color: '#e6edf3', fontSize: 18, fontWeight: '700', marginTop: 16 },
  h2: { color: '#7ee787', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  dim: { color: '#8b949e', fontSize: 12 },
  spinner: { marginVertical: 24 },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
  },
  errCard: { borderColor: '#f85149' },
  err: { color: '#f85149', fontSize: 12 },
  row: { flexDirection: 'row', paddingVertical: 2 },
  key: { color: '#8b949e', fontSize: 12, width: 104 },
  val: { color: '#c9d1d9', fontSize: 12, flex: 1 },
  valStrong: { color: '#e6edf3', fontWeight: '700' },
  path: { color: '#484f58', fontSize: 10, marginTop: 6 },
  mono: { color: '#c9d1d9', fontSize: 12 },
  btn: {
    backgroundColor: '#238636',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnHalf: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});

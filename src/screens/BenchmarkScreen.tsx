/**
 * Phase 2 — one button runs the whole matrix, no camera involved.
 *
 * The screen deliberately shows the clock resolution first: if Hermes'
 * performance.now() quantises to 1 ms, every sub-millisecond p50 below is a
 * quantisation artefact and the batch-mean column is the number to trust.
 */

import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DEFAULT_PRAGMAS } from '../db/pragmas';
import {
  UNSUPPORTED_CELLS,
  buildMatrix,
  describeCell,
  type Cell,
} from '../bench/matrix';
import {
  measureColdStart,
  runMatrix,
  type CellResult,
  type ColdStartResult,
} from '../bench/runner';
import { clockResolutionMs, fmtMs, relativeVariance } from '../bench/stats';
import {
  listRuns,
  resultsDbPath,
  saveColdStartRun,
  saveMatrixRun,
  type RunEnvironment,
  type SavedRun,
} from '../bench/export';

/** Probed once and reused — the probe itself costs ~200k clock reads. */
let cachedResolution: number | null = null;
const resolution = (): number => {
  if (cachedResolution === null) cachedResolution = clockResolutionMs();
  return cachedResolution;
};

const envStamp = (rows: number): RunEnvironment => ({
  platform: `${Platform.OS} ${String(Platform.Version)}`,
  clockResolutionMs: resolution(),
  datasetRows: rows,
  appVersion: '0.0.1',
});

interface Progress {
  index: number;
  total: number;
  cell: Cell;
}

export const BenchmarkScreen = (): React.JSX.Element => {
  const [results, setResults] = useState<CellResult[]>([]);
  const [cold, setCold] = useState<ColdStartResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [repeatVariance, setRepeatVariance] = useState<string | null>(null);
  const busy = useRef(false);

  const refreshRuns = useCallback(() => {
    try {
      setRuns(listRuns());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** `repeats` > 1 drives the "variance < 10% across 3 runs" acceptance check. */
  const run = useCallback(
    async (repeats: number) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      setRepeatVariance(null);
      setResults([]);

      try {
        const cells = buildMatrix();
        const baselineP50: number[] = [];

        for (let r = 0; r < repeats; r += 1) {
          const label = `matrix run ${r + 1}/${repeats}`;
          const out = await runMatrix(cells, p =>
            setProgress({ index: p.index, total: p.total, cell: p.cell }),
          );
          setResults(out);

          const rows = out.find(c => c.rows > 0)?.rows ?? 0;
          saveMatrixRun(label, envStamp(rows), out);

          const base = out.find(c => c.axis === 'baseline');
          if (base && Number.isFinite(base.stats.p50)) {
            baselineP50.push(base.stats.p50);
          }
        }

        if (baselineP50.length > 1) {
          const v = relativeVariance(baselineP50);
          setRepeatVariance(
            `${(v * 100).toFixed(1)}% across ${baselineP50.length} runs ` +
              `(${baselineP50.map(p => fmtMs(p)).join(', ')})`,
          );
        }
        refreshRuns();
      } catch (e) {
        setError(String(e));
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [refreshRuns],
  );

  const runCold = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const out = await measureColdStart('1M', DEFAULT_PRAGMAS);
      setCold(out);
      saveColdStartRun('cold start', envStamp(out.rows), out);
      refreshRuns();
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
    }
  }, [refreshRuns]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>Phase 2 — benchmark matrix</Text>
      <Text style={s.dim}>
        clock resolution {fmtMs(resolution())} · warm-up discarded · every cell
        reports n and percentiles
      </Text>

      <View style={s.btnRow}>
        <Pressable style={[s.btn, s.btnHalf]} onPress={() => run(1)}>
          <Text style={s.btnText}>run matrix</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnHalf]} onPress={() => run(3)}>
          <Text style={s.btnText}>run ×3 (variance)</Text>
        </Pressable>
      </View>
      <Pressable style={[s.btn, s.btnAlt]} onPress={runCold}>
        <Text style={s.btnText}>measure cold start (1M)</Text>
      </Pressable>

      {progress && (
        <View style={s.card}>
          <ActivityIndicator />
          <Text style={s.mono}>
            {progress.index + 1}/{progress.total} · {progress.cell.id}
          </Text>
          <Text style={s.path}>{describeCell(progress.cell)}</Text>
        </View>
      )}

      {repeatVariance && (
        <View style={s.card}>
          <Text style={s.h2}>baseline p50 variance</Text>
          <Text style={s.mono}>{repeatVariance}</Text>
        </View>
      )}

      {error && (
        <View style={[s.card, s.errCard]}>
          <Text style={s.err}>{error}</Text>
        </View>
      )}

      {cold && (
        <View style={s.card}>
          <Text style={s.h2}>cold start · {cold.dataset}</Text>
          <Row k="rows" v={cold.rows.toLocaleString()} strong />
          <Row k="open+pragmas" v={fmtMs(cold.openMs)} />
          <Row k="1st query" v={fmtMs(cold.firstQueryMs)} strong />
          <Row k="next 9" v={cold.next9Ms.map(m => fmtMs(m)).join(', ')} />
          <Row k="plan" v={cold.plan} />
        </View>
      )}

      {results.length > 0 && (
        <View style={s.card}>
          <Text style={s.h2}>results ({results.length} cells)</Text>
          <View style={s.trHead}>
            <Text style={[s.td, s.tdCell]}>cell</Text>
            <Text style={[s.td, s.tdNum]}>n</Text>
            <Text style={[s.td, s.tdNum]}>p50</Text>
            <Text style={[s.td, s.tdNum]}>p95</Text>
            <Text style={[s.td, s.tdNum]}>p99</Text>
            <Text style={[s.td, s.tdNum]}>batch</Text>
          </View>
          {results.map(r => (
            <View key={r.id} style={s.tr}>
              <Text style={[s.td, s.tdCell]} numberOfLines={1}>
                {r.id}
              </Text>
              <Text style={[s.td, s.tdNum]}>{r.stats.n}</Text>
              <Text style={[s.td, s.tdNum]}>{fmtMs(r.stats.p50)}</Text>
              <Text style={[s.td, s.tdNum]}>{fmtMs(r.stats.p95)}</Text>
              <Text style={[s.td, s.tdNum]}>{fmtMs(r.stats.p99)}</Text>
              <Text style={[s.td, s.tdNum]}>{fmtMs(r.batchMeanMs)}</Text>
            </View>
          ))}
          {results
            .filter(r => r.error)
            .map(r => (
              <Text key={`e-${r.id}`} style={s.err}>
                {r.id}: {r.error}
              </Text>
            ))}
          <Text style={s.path}>plan (baseline): {results[0]?.plan ?? '—'}</Text>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.h2}>not expressible against this driver</Text>
        {UNSUPPORTED_CELLS.map(u => (
          <View key={u.id} style={s.row}>
            <Text style={s.key}>{u.id}</Text>
            <Text style={s.val}>{u.reason}</Text>
          </View>
        ))}
      </View>

      <Pressable style={[s.btn, s.btnAlt]} onPress={refreshRuns}>
        <Text style={s.btnText}>list saved runs</Text>
      </Pressable>
      {runs.length > 0 && (
        <View style={s.card}>
          <Text style={s.h2}>saved runs</Text>
          {runs.map(r => (
            <Row
              key={r.id}
              k={`#${r.id} ${r.kind}`}
              v={`${r.label} · ${new Date(r.createdAt).toISOString()}`}
            />
          ))}
          <Text style={s.path}>{resultsDbPath()}</Text>
          <Text style={s.path}>pull with: yarn pull-results</Text>
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
  h1: { color: '#e6edf3', fontSize: 18, fontWeight: '700', marginTop: 8 },
  h2: { color: '#7ee787', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  dim: { color: '#8b949e', fontSize: 12 },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
    gap: 4,
  },
  errCard: { borderColor: '#f85149' },
  err: { color: '#f85149', fontSize: 11 },
  row: { flexDirection: 'row', paddingVertical: 2 },
  key: { color: '#8b949e', fontSize: 12, width: 104 },
  val: { color: '#c9d1d9', fontSize: 12, flex: 1 },
  valStrong: { color: '#e6edf3', fontWeight: '700' },
  path: { color: '#484f58', fontSize: 10, marginTop: 6 },
  mono: { color: '#c9d1d9', fontSize: 12 },
  trHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#30363d', paddingBottom: 4 },
  tr: { flexDirection: 'row', paddingVertical: 3 },
  td: { color: '#c9d1d9', fontSize: 10 },
  tdCell: { flex: 2.4 },
  tdNum: { flex: 1, textAlign: 'right' },
  btn: {
    backgroundColor: '#238636',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: '#1f6feb' },
  btnHalf: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});

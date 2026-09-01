/**
 * QrBench — benchmark harness, not a product.
 *
 * Two screens for now:
 *   Phase 1 — dataset verification + in-app seeding
 *   Phase 2 — the benchmark matrix
 * Phase 3 (scan flow) is added once vision-camera v4 is back in the build; see
 * README "Camera status" for why v5 was removed.
 *
 * The cold-start branch below runs *before* any screen mounts. That ordering is
 * the whole point: once a screen has rendered, something has already touched
 * items.db and the "first query on a cold cache" number is no longer cold.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { BenchmarkScreen } from './src/screens/BenchmarkScreen';
import { Phase1Screen } from './src/screens/Phase1Screen';
import { clearColdStartRequest, coldStartRequested } from './src/bench/coldStartFlag';
import { measureColdStart, type ColdStartResult } from './src/bench/runner';
import { saveColdStartRun } from './src/bench/export';
import { clockResolutionMs, fmtMs } from './src/bench/stats';
import { DEFAULT_PRAGMAS } from './src/db/pragmas';

type Tab = 'phase1' | 'phase2';

/** Result of the launch-time cold-start branch, shown instead of the tabs. */
type ColdState =
  | { status: 'checking' }
  | { status: 'skipped' }
  | { status: 'measured'; result: ColdStartResult }
  | { status: 'failed'; error: string };

const useColdStartOnLaunch = (): ColdState => {
  const [state, setState] = useState<ColdState>({ status: 'checking' });

  useEffect(() => {
    if (!coldStartRequested()) {
      setState({ status: 'skipped' });
      return;
    }

    try {
      // Deliberately synchronous-ish and first: no await, no render, nothing
      // else touches the dataset before this.
      measureColdStart('1M', DEFAULT_PRAGMAS)
        .then(result => {
          saveColdStartRun(
            'cold start (launch)',
            {
              platform: 'android',
              clockResolutionMs: clockResolutionMs(),
              datasetRows: result.rows,
              appVersion: '0.0.1',
            },
            result,
          );
          clearColdStartRequest();
          setState({ status: 'measured', result });
        })
        .catch((e: unknown) => {
          clearColdStartRequest();
          setState({ status: 'failed', error: String(e) });
        });
    } catch (e) {
      clearColdStartRequest();
      setState({ status: 'failed', error: String(e) });
    }
  }, []);

  return state;
};

const ColdStartReport = ({
  result,
}: {
  result: ColdStartResult;
}): React.JSX.Element => (
  <View style={styles.card}>
    <Text style={styles.h2}>cold start · {result.dataset}</Text>
    <Text style={styles.mono}>rows {result.rows.toLocaleString()}</Text>
    <Text style={styles.mono}>open+pragmas {fmtMs(result.openMs)}</Text>
    <Text style={styles.monoStrong}>
      1st query {fmtMs(result.firstQueryMs)}
    </Text>
    <Text style={styles.mono}>
      next 9 {result.next9Ms.map(m => fmtMs(m)).join(', ')}
    </Text>
    <Text style={styles.dim}>{result.plan}</Text>
    <Text style={styles.dim}>saved to results.db · yarn pull-results</Text>
  </View>
);

const Shell = (): React.JSX.Element => {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('phase1');
  const cold = useColdStartOnLaunch();

  if (cold.status === 'checking') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {cold.status === 'measured' && <ColdStartReport result={cold.result} />}
      {cold.status === 'failed' && (
        <View style={[styles.card, styles.errCard]}>
          <Text style={styles.err}>cold start failed: {cold.error}</Text>
        </View>
      )}

      <View style={styles.tabs}>
        {(
          [
            ['phase1', 'Phase 1 · data'],
            ['phase2', 'Phase 2 · bench'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'phase1' ? <Phase1Screen /> : <BenchmarkScreen />}
    </View>
  );
};

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/* RN 0.87 runs edge-to-edge; StatusBar.backgroundColor was removed.
          The root View below paints behind the bar instead. */}
      <StatusBar barStyle="light-content" />
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
  },
  tabActive: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  tabText: { color: '#8b949e', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
    margin: 16,
    marginBottom: 0,
    gap: 3,
  },
  errCard: { borderColor: '#f85149' },
  err: { color: '#f85149', fontSize: 12 },
  h2: { color: '#7ee787', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  mono: { color: '#c9d1d9', fontSize: 12 },
  monoStrong: { color: '#e6edf3', fontSize: 13, fontWeight: '700' },
  dim: { color: '#8b949e', fontSize: 10, marginTop: 4 },
});

export default App;

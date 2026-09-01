/**
 * Sample statistics for the benchmark.
 *
 * Every reported number carries its sample size and a full percentile spread —
 * a lone mean hides exactly the tail behaviour this benchmark exists to expose.
 */

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Population standard deviation, used for the run-to-run variance check. */
  stddev: number;
}

/**
 * Nearest-rank percentile on an already-sorted array.
 * Nearest-rank (rather than interpolated) keeps every reported value an actual
 * observed sample, which matters when the distribution is this discrete.
 */
const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] as number;
};

export const summarize = (samples: number[]): Stats => {
  if (samples.length === 0) {
    return { n: 0, min: NaN, p50: NaN, p90: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN, stddev: NaN };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / sorted.length;

  return {
    n: sorted.length,
    min: sorted[0] as number,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] as number,
    mean,
    stddev: Math.sqrt(variance),
  };
};

/** Relative spread across repeated runs — the <10% acceptance check. */
export const relativeVariance = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  return (Math.max(...values) - Math.min(...values)) / mean;
};

/**
 * Effective resolution of the clock the benchmark uses.
 *
 * Hermes' performance.now() is documented as millisecond-based; if it really
 * quantises to 1 ms then sub-millisecond lookups are unmeasurable one at a time
 * and the harness must fall back to batch timing. This probe reports the
 * smallest non-zero delta actually observed so RESULTS.md can state it.
 */
export const clockResolutionMs = (probes = 200_000): number => {
  let smallest = Infinity;
  let prev = performance.now();
  for (let i = 0; i < probes; i += 1) {
    const now = performance.now();
    const d = now - prev;
    if (d > 0 && d < smallest) smallest = d;
    prev = now;
  }
  return Number.isFinite(smallest) ? smallest : NaN;
};

export const fmtMs = (ms: number): string => {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  return `${(ms * 1000).toFixed(0)} µs`;
};

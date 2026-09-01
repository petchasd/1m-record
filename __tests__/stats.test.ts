/**
 * The percentile code decides every number in RESULTS.md. An off-by-one here
 * would not crash anything — it would just quietly report the wrong tail — so
 * it is pinned against hand-computed values.
 */

import { relativeVariance, summarize } from '../src/bench/stats';

describe('summarize', () => {
  it('reports nearest-rank percentiles as actual observed samples', () => {
    // 1..100, so the nearest-rank p-th percentile is exactly p.
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const s = summarize(samples);

    expect(s.n).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p90).toBe(90);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
    expect(s.mean).toBeCloseTo(50.5, 10);
  });

  it('does not mutate the caller array', () => {
    const samples = [3, 1, 2];
    summarize(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('keeps the tail when the distribution is skewed', () => {
    // 99 fast samples and one 100 ms outlier: p50 must stay fast, p99 must
    // NOT hide the outlier — this is the whole reason we report percentiles.
    const samples = [...Array.from({ length: 99 }, () => 0.5), 100];
    const s = summarize(samples);

    expect(s.p50).toBe(0.5);
    expect(s.p99).toBe(0.5);
    expect(s.max).toBe(100);
    expect(s.mean).toBeGreaterThan(s.p50);
  });

  it('returns NaN stats rather than throwing on an empty sample', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.p50)).toBe(true);
  });

  it('computes population stddev', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.stddev).toBeCloseTo(2, 10);
  });
});

describe('relativeVariance', () => {
  it('measures spread relative to the mean', () => {
    // range 2 over mean 10 => 20%
    expect(relativeVariance([9, 10, 11])).toBeCloseTo(0.2, 10);
  });

  it('is zero for a single run', () => {
    expect(relativeVariance([42])).toBe(0);
  });

  it('passes the <10% acceptance threshold for tight repeats', () => {
    expect(relativeVariance([1.0, 1.02, 1.04])).toBeLessThan(0.1);
  });
});

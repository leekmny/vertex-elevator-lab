import { it, expect } from 'vitest';
import { saturationObservation } from '../src/research/analysis';
import type { ResearchRow } from '../src/sim/types';
const row = (congestion: number, throughput: number, growth: number, low: number) =>
  ({
    floors: 20,
    cars: 2,
    algorithm: 'eta',
    congestion,
    throughput: { mean: throughput },
    queueGrowth: { mean: growth, low, high: growth + 2, n: 3 },
    runs: [],
  }) as unknown as ResearchRow;
it('reports finite observed growth and peak throughput without inventing an asymptotic capacity', () => {
  const result = saturationObservation(
    [row(50, 10, -1, -2), row(100, 18, 1, -1), row(300, 19, 20, 12)],
    20,
    2,
    'eta',
  );
  expect(result.firstPositiveGrowthPercent).toBe(100);
  expect(result.firstConfidentGrowthPercent).toBe(300);
  expect(result.maxObservedThroughput).toBe(19);
  expect(result.points).toBe(3);
});
it('does not infer a threshold from a single demand level or claim no saturation from missing data', () => {
  const result = saturationObservation([row(100, 18, 1, -1)], 20, 2, 'eta');
  expect(result.firstConfidentGrowthPercent).toBeNull();
  expect(result.thresholdBracket).toBeNull();
  const missing = saturationObservation([], 20, 2, 'eta');
  expect(missing.maxObservedThroughput).toBeNull();
});

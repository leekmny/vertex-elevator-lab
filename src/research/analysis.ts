import type { AlgorithmId, ResearchRow } from '../sim/types';
export interface SaturationObservation {
  points: number;
  firstPositiveGrowthPercent: number | null;
  firstConfidentGrowthPercent: number | null;
  maxObservedThroughput: number | null;
  thresholdBracket: [number, number] | null;
}
export function saturationObservation(
  rows: ResearchRow[],
  floors: number,
  cars: number,
  algorithm: AlgorithmId,
): SaturationObservation {
  const points = rows
    .filter((r) => r.floors === floors && r.cars === cars && r.algorithm === algorithm)
    .sort((a, b) => a.congestion - b.congestion);
  const firstPositive = points.length >= 2 ? points.find((r) => r.queueGrowth.mean > 0) : undefined;
  const firstConfident =
    points.length >= 2
      ? points.find((r) => r.queueGrowth.n >= 2 && r.queueGrowth.low > 0)
      : undefined;
  const precedingStable = firstConfident
    ? points
        .filter(
          (r) =>
            r.congestion < firstConfident.congestion &&
            r.queueGrowth.n >= 2 &&
            r.queueGrowth.high <= 0,
        )
        .at(-1)
    : undefined;
  return {
    points: points.length,
    firstPositiveGrowthPercent: firstPositive?.congestion ?? null,
    firstConfidentGrowthPercent: firstConfident?.congestion ?? null,
    maxObservedThroughput: points.length ? Math.max(...points.map((r) => r.throughput.mean)) : null,
    thresholdBracket:
      precedingStable && firstConfident
        ? [precedingStable.congestion, firstConfident.congestion]
        : null,
  };
}

import { describe, it, expect } from 'vitest';
import { validatePlan, minimumRequiredCars, dimensionConfig } from '../src/research/runner';
import { defaultConfig } from '../src/sim/config';
import type { ExperimentPlan, ResearchRow } from '../src/sim/types';
const plan: ExperimentPlan = {
  floorValues: [20],
  carValues: [1, 2],
  congestionValues: [100],
  algorithms: ['eta'],
  seeds: [1, 2],
  targetWait: 30,
  metric: 'meanWait',
};
describe('experiment safety and selection', () => {
  it('drops manual zone boundaries that no longer fit a smaller fleet', () => {
    const base = {
      ...defaultConfig(),
      cars: 4,
      zoneCount: 3,
      zoneBoundaries: [7, 14],
      groupCars: [1, 1, 2],
    };
    const c = dimensionConfig(base, 20, 1, 100, 1);
    expect(c.zoneCount).toBe(1);
    expect(c.zoneBoundaries).toEqual([]);
    expect(c.groupCars).toEqual([]);
  });
  it('counts Cartesian simulations without silently trimming a plan', () =>
    expect(validatePlan(plan)).toBe(4));
  it('rejects duplicate seeds and out of range dimensions', () => {
    expect(() => validatePlan({ ...plan, seeds: [1, 1] })).toThrow();
    expect(() => validatePlan({ ...plan, carValues: [21] })).toThrow();
    expect(() => validatePlan({ ...plan, algorithms: [] })).toThrow();
  });
  it('does not call a fleet adequate when passengers remain or CI is too broad', () => {
    const row = (cars: number, wait: number, high: number, unfinished: number): ResearchRow =>
      ({
        cars,
        floors: 20,
        congestion: 100,
        algorithm: 'eta',
        wait: { mean: wait, high, low: 0, n: 3, sd: 1 },
        unfinished: { mean: unfinished, high: unfinished, low: unfinished, n: 3, sd: 0 },
      }) as ResearchRow;
    expect(
      minimumRequiredCars([row(1, 10, 15, 50), row(2, 20, 40, 0), row(3, 20, 25, 0)], 30),
    ).toBe(3);
    expect(minimumRequiredCars([row(2, 20, Infinity, 0)], 30)).toBeNull();
  });
});

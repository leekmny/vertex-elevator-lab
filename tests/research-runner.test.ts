import { it, expect } from 'vitest';
import { runExperiment } from '../src/research/runner';
import { defaultConfig } from '../src/sim/config';
import type { ExperimentPlan } from '../src/sim/types';
const plan: ExperimentPlan = {
  floorValues: [5],
  carValues: [1, 2],
  congestionValues: [100],
  algorithms: ['look', 'eta'],
  seeds: [11, 12],
  targetWait: 120,
  metric: 'meanWait',
};
it('runs each grid cell on matching seed records and retains actual passengers', async () => {
  const result = await runExperiment(
    { ...defaultConfig(), duration: 40, rate: 10, drain: true },
    plan,
  );
  expect(result.rows).toHaveLength(4);
  const rows = result.rows.filter((r) => r.cars === 1);
  expect(rows[0].runs.map((r) => r.demandHash)).toEqual(rows[1].runs.map((r) => r.demandHash));
  expect(rows[0].wait.n).toBe(2);
  for (const row of result.rows)
    for (const run of row.runs) {
      const m = run.metrics;
      expect(m.generated).toBe(m.waiting + m.onboard + m.completed);
    }
});
it('cancels between runs and preserves the completed partial sample instead of fabricating results', async () => {
  let stop = false;
  const result = await runExperiment({ ...defaultConfig(), duration: 20, rate: 0 }, plan, {
    onProgress: () => {
      stop = true;
    },
    shouldCancel: () => stop,
  });
  expect(result.cancelled).toBe(true);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].runs).toHaveLength(1);
  expect(result.rows[0].wait.high).toBe(Infinity);
});

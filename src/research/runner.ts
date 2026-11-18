import type {
  AlgorithmId,
  Config,
  ExperimentPlan,
  ResearchRow,
  ResearchResult,
  Metrics,
  Estimate,
} from '../sim/types';
import { generateDemand } from '../sim/demand';
import { validateConfig } from '../sim/config';
import { summarize, pairedEstimate } from './statistics';
const algorithmIds = [
  'fcfs',
  'nearest',
  'direction',
  'collective',
  'look',
  'scan',
  'eta',
  'journey',
  'static',
  'dynamic',
  'destination',
  'multi',
  'genetic',
  'annealing',
];
export function validatePlan(plan: ExperimentPlan): number {
  const check = (values: number[], min: number, max: number) =>
    values.length > 0 &&
    values.every((v) => Number.isInteger(v) && v >= min && v <= max) &&
    new Set(values).size === values.length;
  if (
    !check(plan.floorValues, 5, 100) ||
    !check(plan.carValues, 1, 20) ||
    !check(plan.congestionValues, 0, 500) ||
    !check(plan.seeds, 0, 4294967295)
  )
    throw new Error('층수·차량·혼잡도·Seed 범위가 잘못되었거나 중복되었습니다.');
  if (
    !plan.algorithms.length ||
    plan.algorithms.some((a) => !algorithmIds.includes(a)) ||
    new Set(plan.algorithms).size !== plan.algorithms.length
  )
    throw new Error('비교 알고리즘을 하나 이상 중복 없이 선택하세요.');
  if (!Number.isFinite(plan.targetWait) || plan.targetWait < 0)
    throw new Error('목표 대기시간은 0 이상이어야 합니다.');
  const count =
    plan.floorValues.length *
    plan.carValues.length *
    plan.congestionValues.length *
    plan.seeds.length *
    plan.algorithms.length;
  if (count > 40000)
    throw new Error(`총 ${count.toLocaleString()}회입니다. 한 실험은 40,000회 이하로 설정하세요.`);
  return count;
}
export function minimumRequiredCars(rows: ResearchRow[], target: number): number | null {
  const valid = rows
    .filter((r) => r.wait.n >= 2 && r.wait.high <= target && r.unfinished.mean === 0)
    .map((r) => r.cars);
  return valid.length ? Math.min(...valid) : null;
}
export interface Progress {
  completed: number;
  total: number;
  floors: number;
  cars: number;
  congestion: number;
  algorithm: AlgorithmId;
  seed: number;
}
export interface ExperimentOptions {
  onProgress?: (p: Progress) => void;
  shouldCancel?: () => boolean;
  yieldControl?: () => Promise<void>;
}
/** Preserve user demand weights for overlapping floors, and extend with explicit defaults. */
export function dimensionConfig(
  base: Config,
  floors: number,
  cars: number,
  congestion: number,
  seed: number,
): Config {
  const c = structuredClone(base);
  Object.assign(c, { floors, cars, congestion, seed });
  const size = floors + c.basements;
  c.floorWeights = Array.from({ length: size }, (_, i) => base.floorWeights[i] ?? 1);
  c.floorPopulation = Array.from({ length: size }, (_, i) => base.floorPopulation[i] ?? 50);
  c.initialQueues = Array.from({ length: size }, (_, i) => base.initialQueues[i] ?? 0);
  c.lobby = Math.max(1 - c.basements, Math.min(floors, c.lobby));
  c.transferFloors = c.transferFloors.filter((f) => f >= 1 - c.basements && f <= floors);
  c.car.home = Math.max(1 - c.basements, Math.min(floors, c.car.home));
  c.carOverrides = c.carOverrides.slice(0, cars).map((car) => ({
    ...car,
    home: Math.max(1 - c.basements, Math.min(floors, car.home ?? c.car.home)),
    serviceFloors: car.serviceFloors?.filter((f) => f >= 1 - c.basements && f <= floors),
  }));
  // Fleet sweeps use automatic group allocation when manual counts no longer fit.
  if (c.groupCars.reduce((a, b) => a + b, 0) !== cars) c.groupCars = [];
  c.zoneCount = Math.min(c.zoneCount, cars);
  c.zoneBoundaries = c.zoneBoundaries.filter((f) => f >= 1 - c.basements && f < floors);
  if (c.zoneBoundaries.length !== c.zoneCount - 1) c.zoneBoundaries = [];
  c.failureCar = Math.min(cars - 1, c.failureCar);
  validateConfig(c);
  return c;
}
export async function runExperiment(
  base: Config,
  plan: ExperimentPlan,
  options: ExperimentOptions = {},
): Promise<ResearchResult> {
  const total = validatePlan(plan),
    start = performance.now(),
    { Simulation } = await import('../sim/engine');
  const config = structuredClone(base),
    rows: ResearchRow[] = [],
    groups = new Map<string, ResearchRow>();
  let completed = 0,
    cancelled = false;
  outer: for (const floors of plan.floorValues)
    for (const cars of [...plan.carValues].sort((a, b) => a - b))
      for (const congestion of plan.congestionValues)
        for (const seed of plan.seeds) {
          if (options.shouldCancel?.()) {
            cancelled = true;
            break outer;
          }
          const c = dimensionConfig(config, floors, cars, congestion, seed),
            demand = generateDemand(c);
          for (const algorithm of plan.algorithms) {
            if (options.shouldCancel?.()) {
              cancelled = true;
              break outer;
            }
            const final = new Simulation(c, algorithm, demand).run();
            const key = [floors, cars, congestion, algorithm].join(':');
            let row = groups.get(key);
            if (!row) {
              row = { floors, cars, congestion, algorithm, runs: [] } as unknown as ResearchRow;
              groups.set(key, row);
              rows.push(row);
            }
            row.runs.push({ seed, demandHash: final.demandHash, metrics: final.metrics });
            completed++;
            options.onProgress?.({ completed, total, floors, cars, congestion, algorithm, seed });
            await options.yieldControl?.();
          }
        }
  for (const row of rows) {
    const estimate = (key: keyof Metrics) => summarize(row.runs.map((r) => Number(r.metrics[key])));
    row.wait = estimate('meanWait');
    row.p95 = estimate('p95Wait');
    row.throughput = estimate('throughput');
    row.journey = estimate('meanJourney');
    row.fairness = estimate('fairness');
    row.energy = estimate('energy');
    row.unfinished = estimate('unfinished');
    row.queueGrowth = estimate('queueGrowth');
    row.meanWait = row.wait.mean;
    row.p95Wait = row.p95.mean;
    row.meanThroughput = row.throughput.mean;
    row.supplyMargin = estimate('supplyMargin').mean;
    const previous = rows
      .filter(
        (r) =>
          r.floors === row.floors &&
          r.congestion === row.congestion &&
          r.algorithm === row.algorithm &&
          r.cars < row.cars,
      )
      .sort((a, b) => b.cars - a.cars)[0];
    row.marginalGain = previous
      ? (summarize(previous.runs.map((r) => r.metrics.meanWait)).mean - row.wait.mean) /
        (row.cars - previous.cars)
      : null;
    const baseline = rows
      .filter(
        (r) =>
          r.floors === row.floors &&
          r.congestion === row.congestion &&
          r.algorithm === row.algorithm,
      )
      .sort((a, b) => a.cars - b.cars)[0];
    const baselineUnfinished = summarize(baseline.runs.map((r) => r.metrics.unfinished)).mean;
    row.bottleneckRelief =
      baselineUnfinished > 0 ? 1 - row.unfinished.mean / baselineUnfinished : 0;
  }
  return {
    config,
    plan: structuredClone(plan),
    rows,
    minimumCars: minimumRequiredCars(rows, plan.targetWait),
    createdAt: new Date().toISOString(),
    elapsedMs: performance.now() - start,
    cancelled,
  };
}
/** Returns A-B; negative values favor A for delay/cost metrics. */
export function pairedDifference(a: ResearchRow, b: ResearchRow, metric: keyof Metrics): Estimate {
  if (a.floors !== b.floors || a.cars !== b.cars || a.congestion !== b.congestion)
    throw new Error('동일 건물·차량·혼잡도의 행을 선택하세요');
  const observation = (row: ResearchRow) =>
    row.runs.map((r) => ({
      seed: r.seed,
      demandHash: r.demandHash,
      value: Number(r.metrics[metric]),
    }));
  return pairedEstimate(observation(a), observation(b));
}

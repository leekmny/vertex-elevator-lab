import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform } from 'node:os';
import { defaultConfig } from '../src/sim/config';
import { Simulation } from '../src/sim/engine';
import { generateDemand } from '../src/sim/demand';
import { runExperiment } from '../src/research/runner';
import { saturationObservation } from '../src/research/analysis';
import { resultHtml, serializeResult, resultCsv } from '../src/research/export';
import type { Config, ExperimentPlan } from '../src/sim/types';
await mkdir('docs', { recursive: true });
await mkdir('examples', { recursive: true });
const config: Config = { ...defaultConfig(), duration: 600, rate: 24, drain: false };
const plan: ExperimentPlan = {
  floorValues: [20],
  carValues: [1, 2, 4, 8, 12],
  congestionValues: [100],
  algorithms: ['look', 'eta', 'destination', 'multi'],
  seeds: [2026, 11999, 21972],
  targetWait: 30,
  metric: 'meanWait',
};
console.log('Paired fleet scaling: 60 simulations');
const scaling = await runExperiment(config, plan);
await writeFile('examples/scaling-result.json', serializeResult(scaling), 'utf8');
await writeFile('examples/scaling-result.csv', resultCsv(scaling), 'utf8');
await writeFile('examples/scaling-report.html', resultHtml(scaling), 'utf8');
await writeFile('examples/scaling-config.json', JSON.stringify({ config, plan }, null, 2), 'utf8');
console.log('Finite-horizon saturation: 18 simulations');
const saturation = await runExperiment(
  { ...config, duration: 300 },
  {
    ...plan,
    carValues: [2],
    congestionValues: [100, 300, 500],
    algorithms: ['look', 'eta'],
    seeds: [2026, 11999, 21972],
  },
);
const saturationEstimates = (['look', 'eta'] as const).map((algorithm) => ({
  algorithm,
  ...saturationObservation(saturation.rows, 20, 2, algorithm),
}));
await writeFile('examples/saturation-result.json', serializeResult(saturation), 'utf8');
const cases = [];
for (const [floors, cars, congestion] of [
  [5, 1, 0],
  [20, 2, 100],
  [100, 20, 500],
] as const) {
  const c = {
      ...defaultConfig(),
      floors,
      cars,
      congestion,
      duration: 120,
      floorWeights: Array(floors).fill(1),
      floorPopulation: Array(floors).fill(50),
      initialQueues: Array(floors).fill(0),
    },
    demand = generateDemand(c),
    times: number[] = [];
  let events = 0,
    generated = 0,
    conserved = true;
  for (let i = 0; i < 3; i++) {
    const start = performance.now(),
      s = new Simulation(c, 'eta', demand).run();
    times.push(performance.now() - start);
    events = s.events;
    generated = s.metrics.generated;
    conserved &&=
      s.metrics.generated === s.metrics.waiting + s.metrics.onboard + s.metrics.completed;
  }
  cases.push({
    floors,
    cars,
    congestion,
    duration: c.duration,
    generated,
    events,
    elapsedMs: times,
    medianMs: [...times].sort((a, b) => a - b)[1],
    passengerConservation: conserved,
  });
}
const compact = (r: typeof scaling) =>
  r.rows.map((row) => ({
    floors: row.floors,
    cars: row.cars,
    congestion: row.congestion,
    algorithm: row.algorithm,
    n: row.wait.n,
    meanWait: row.wait.mean,
    p95: row.p95.mean,
    waitCi: [row.wait.low, row.wait.high],
    throughput: row.throughput.mean,
    unfinished: row.unfinished.mean,
    queueGrowth: row.queueGrowth.mean,
    estimatedEnergyKWh: row.energy.mean,
  }));
const benchmark = {
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGB: totalmem() / 1024 ** 3,
  },
  notes: [
    'Wall times device-specific; no rendering or Worker serialization.',
    'Independent seeds paired within conditions.',
    'Finite-horizon queue growth does not prove asymptotic capacity.',
    'Energy estimated; Destination Dispatch has extra information.',
  ],
  microbenchmarks: cases,
  scaling: { elapsedMs: scaling.elapsedMs, config, plan, rows: compact(scaling) },
  saturation: {
    elapsedMs: saturation.elapsedMs,
    estimates: saturationEstimates,
    rows: compact(saturation),
  },
};
await writeFile('docs/benchmark.json', JSON.stringify(benchmark, null, 2), 'utf8');
await writeFile(
  'docs/BENCHMARK.md',
  `# 실제 실행 벤치마크\n\n측정: ${benchmark.measuredAt}\n\n환경: ${benchmark.environment.cpu}, ${benchmark.environment.node}, ${benchmark.environment.platform}. 렌더링·Worker 직렬화 제외. 시간은 장비와 실행 부하에 따라 달라진다.\n\n## 처리 속도\n\n| 층 | 차량 | 혼잡도 | 120초 수요 인원 | 사건 수 | 3회 중앙 실행시간 ms | 보존 검사 |\n|---|---|---|---|---|---|---|\n${cases.map((c) => `| ${c.floors} | ${c.cars} | ${c.congestion}% | ${c.generated} | ${c.events} | ${c.medianMs.toFixed(3)} | ${c.passengerConservation} |`).join('\n')}\n\n## 예제: ETA, 20층, 24명/분, 600초\n\nSeed 2026·11999·21972, Drain 미사용. 세 Seed 평균이며 미완료 승객을 함께 제시한다.\n\n| 차량 | 평균 대기 s | P95 대기 s | 완료 명/분 | 미완료 명 |\n|---|---|---|---|---|\n${scaling.rows
    .filter((r) => r.algorithm === 'eta')
    .map(
      (r) =>
        `| ${r.cars} | ${r.wait.mean.toFixed(2)} | ${r.p95.mean.toFixed(2)} | ${r.throughput.mean.toFixed(2)} | ${r.unfinished.mean.toFixed(2)} |`,
    )
    .join(
      '\n',
    )}\n\n대기 평균은 탑승 관측 표본이다. 과부하에서는 미완료 승객이 증가하고 관측 선택 편향이 있으므로 평균만으로 평가하지 않는다. 전체 신뢰구간과 조건은 [benchmark.json](benchmark.json), [예제 결과](../examples/scaling-result.json), [HTML 보고서](../examples/scaling-report.html)에 있다. 포화 sweep은 2대·100/300/500%·300초·LOOK/ETA를 각3회 반복했다. 이 유한 시간 관측으로 점근 용량을 확정하지 않는다.\n`,
  'utf8',
);
await writeFile(
  'docs/BENCHMARK.md',
  '\n## Finite-horizon saturation observations\n\n20 floors, 2 cars, 300 seconds, 3 paired seeds.\n\n' +
    saturationEstimates
      .map(
        (r) =>
          `- ${r.algorithm}: maximum observed throughput ${r.maxObservedThroughput?.toFixed(2)} passengers/min; first tested demand with queue-growth 95% CI lower bound > 0: ${r.firstConfidentGrowthPercent ?? 'unresolved'}%.`,
      )
      .join('\n') +
    '\n\nNo bounded threshold is inferred without an earlier point whose upper CI is <= 0. These finite observations do not establish sustainable capacity.\n',
  { encoding: 'utf8', flag: 'a' },
);
console.log(
  JSON.stringify(
    {
      microbenchmarks: cases,
      scalingMs: scaling.elapsedMs,
      saturationMs: saturation.elapsedMs,
      results: 'docs/benchmark.json',
    },
    null,
    2,
  ),
);

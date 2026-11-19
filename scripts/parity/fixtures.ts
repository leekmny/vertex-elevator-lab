import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALGORITHMS } from '../../src/sim/algorithms';
import { defaultConfig } from '../../src/sim/config';
import type { Config, ExperimentPlan, Scenario } from '../../src/sim/types';
import type { Command, Request, ResearchRequest } from './reference';

const config = (overrides: Partial<Config> = {}): Config => ({ ...defaultConfig(), ...overrides });
const advance = (time: number): Command => ({ type: 'advance', time });
const run: Command = { type: 'run' };

const experimentConfig = config({
  floors: 8,
  basements: 1,
  cars: 3,
  duration: 37.5,
  warmup: 4,
  drain: true,
  maxDrain: 90,
  policy: 'zoned',
  zoneCount: 3,
  groupCars: [1, 1, 1],
  zoneBoundaries: [3, 6],
  rate: 22,
  initialQueues: [1, 1, 1],
  carOverrides: [{ capacity: 2, home: 8 }, { speed: 0.7 }],
});
const plan: ExperimentPlan = {
  floorValues: [8, 5],
  carValues: [3, 1, 2],
  congestionValues: [125, 30],
  algorithms: ['eta', 'annealing'],
  seeds: [11, 12],
  targetWait: 60,
  metric: 'meanWait',
};

const sparseOverrides: Config['carOverrides'] = [];
sparseOverrides[1] = { capacity: 9 };

const fixtures: Record<string, Request | ResearchRequest> = {
  'research-grid-paired-confidence': { config: experimentConfig, plan },
  'research-cancel-preserves-partial-sample': { config: experimentConfig, plan, cancelAfter: 3 },
  'sparse-car-overrides-and-negative-midpoint': {
    config: config({
      floors: 6,
      basements: 10,
      duration: 15,
      rate: 0,
      idle: 'middle',
      carOverrides: sparseOverrides,
    }),
    algorithms: ['eta'],
    demand: [{ id: 1, at: 0, origin: 1, destination: 4 }],
    commands: [advance(0), advance(4), run],
  },
  'all-fourteen-dispatchers': {
    config: config({
      floors: 10,
      cars: 4,
      duration: 100,
      warmup: 10,
      rate: 14,
      idle: 'predictive',
    }),
    algorithms: ALGORITHMS.map(({ id }) => id),
    commands: [{ type: 'snapshot' }, advance(13), advance(33), advance(70), run],
  },
  'manual-steps-seek-and-failure': {
    config: config({ floors: 8, basements: 2, cars: 3, duration: 65, drain: true, maxDrain: 120 }),
    algorithms: ['nearest', 'look', 'genetic'],
    demand: [
      { id: 1, at: 0, origin: 1, destination: 4 },
      { id: 2, at: 12, origin: -1, destination: 7 },
    ],
    commands: [
      { type: 'step' },
      advance(6),
      { type: 'failure', id: 0 },
      { type: 'callFloors', floors: [-1, 3, 3, 8], count: 2 },
      { type: 'callFloors', floors: [99] },
      advance(14),
      { type: 'inject', records: [{ id: -1000, at: 14, origin: 0, destination: 2 }] },
      { type: 'inject', records: [{ id: -1000, at: 14, origin: 0, destination: 2 }] },
      advance(13),
      { type: 'seek', time: 18 },
      { type: 'callFloors', floors: [1] },
      run,
    ],
  },
  'fractional-empty-drain': {
    config: config({ duration: 15.25, rate: 0, drain: true }),
    algorithms: ['eta', 'dynamic'],
    commands: [{ type: 'step' }, { type: 'step' }, { type: 'step' }, run],
  },
  'exact-horizon-priority': {
    config: config({ duration: 10, rate: 0, cars: 2 }),
    algorithms: ['fcfs'],
    demand: [
      { id: 1, at: 10, origin: 1, destination: 3 },
      { id: 2, at: 10, origin: 1, destination: 5 },
    ],
    commands: [
      ...Array.from({ length: 10 }, (): Command => ({ type: 'step' })),
      { type: 'seek', time: 0 },
      run,
    ],
  },
  'transfer-with-asymmetric-banks': {
    config: config({
      floors: 12,
      basements: 1,
      cars: 4,
      policy: 'parity',
      groupCars: [1, 3],
      duration: 30,
      rate: 0,
      drain: true,
      maxDrain: 350,
      car: { ...defaultConfig().car, capacity: 2 },
    }),
    algorithms: ['look', 'eta', 'destination'],
    demand: Array.from({ length: 10 }, (_, id) => ({
      id,
      at: Math.floor(id / 2),
      origin: id % 2 === 0 ? 9 : 10,
      destination: id % 2 === 0 ? 2 : 3,
    })),
    commands: [advance(0), advance(20.5), advance(60), run],
  },
  'dynamic-zones-with-floor-restrictions': {
    config: config({
      floors: 5,
      cars: 2,
      rate: 0,
      duration: 100,
      carOverrides: [
        { serviceFloors: [1, 2, 3], capacity: 1 },
        { serviceFloors: [1, 4, 5], capacity: 1, speed: 0.5 },
      ],
    }),
    algorithms: ['dynamic'],
    demand: [
      ...Array.from({ length: 10 }, (_, id) => ({ id, at: 0, origin: 1, destination: 5 })),
      { id: 99, at: 50, origin: 2, destination: 3 },
    ],
    commands: [advance(29), advance(30), advance(50), advance(90), run],
  },
  'scan-edge-and-look-reversal': {
    config: config({ floors: 5, cars: 1, duration: 40, rate: 0, drain: true }),
    algorithms: ['scan', 'look'],
    demand: [
      { id: 1, at: 0, origin: 1, destination: 3 },
      { id: 2, at: 0, origin: 2, destination: 1 },
    ],
    commands: [advance(4), advance(13), run],
  },
  'maximum-building-and-fleet': {
    config: config({
      floors: 100,
      basements: 10,
      cars: 20,
      duration: 40,
      rate: 0,
      zoneCount: 10,
      lobby: 0,
      idle: 'high',
      car: { ...defaultConfig().car, home: 0 },
    }),
    algorithms: ['static', 'dynamic', 'multi'],
    demand: [
      { id: 1, at: 0, origin: 0, destination: 100 },
      { id: 2, at: 5, origin: -9, destination: 99 },
    ],
    commands: [advance(0), advance(18.5), run],
  },
};

const scenarios: Scenario[] = [
  'random',
  'downpeak',
  'uppeak',
  'simultaneous',
  'overload',
  'hotspot',
  'lobby',
  'interfloor',
  'failure',
  'changing',
  'custom',
];
for (const [i, scenario] of scenarios.entries()) {
  const initialQueues = [1, 0, 2, 0, 1, 3];
  fixtures[`seeded-demand-${scenario}`] = {
    config: config({
      floors: 5,
      basements: 1,
      cars: 2,
      duration: 140,
      warmup: 5,
      rate: 13,
      congestion: 14 + i * 3,
      seed: i > 5 ? 4_294_967_289 + i : 347 + i,
      scenario,
      initialQueues,
      floorWeights: [0, 0.5, 1, 2, 3, 0],
      floorPopulation: [1, 2, 30, 1, 14, 2],
      policy: i % 2 ? 'parity' : 'shared',
      failureAt: 9,
      idle: i % 2 ? 'middle' : 'high',
    }),
    algorithms: ['eta', 'annealing'],
    commands: [advance(0), advance(35), advance(61.5), run],
  };
}

const destination = process.argv[2];
if (!destination) throw new Error('Usage: tsx scripts/parity/fixtures.ts OUTPUT_DIRECTORY');
mkdirSync(join(destination, 'fixtures'), { recursive: true });
const cases = Object.entries(fixtures).map(([id, request]) => {
  const fixture = `fixtures/${id}.json`;
  writeFileSync(join(destination, fixture), JSON.stringify(request) + '\n');
  return id === 'all-fourteen-dispatchers'
    ? { id, fixture, output_limit: 1048576 }
    : { id, fixture };
});
writeFileSync(join(destination, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');

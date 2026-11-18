export type AlgorithmId =
  | 'fcfs'
  | 'nearest'
  | 'direction'
  | 'collective'
  | 'look'
  | 'scan'
  | 'eta'
  | 'journey'
  | 'static'
  | 'dynamic'
  | 'destination'
  | 'multi'
  | 'genetic'
  | 'annealing';
export type Policy = 'shared' | 'parity' | 'zoned' | 'dynamic';
export type Scenario =
  | 'random'
  | 'downpeak'
  | 'uppeak'
  | 'simultaneous'
  | 'overload'
  | 'hotspot'
  | 'lobby'
  | 'interfloor'
  | 'failure'
  | 'changing'
  | 'custom';
export interface CarSpec {
  capacity: number;
  speed: number;
  acceleration: number;
  doorOpen: number;
  doorClose: number;
  boardTime: number;
  alightTime: number;
  home: number;
  serviceFloors?: number[];
}
export interface Config {
  floors: number;
  basements: number;
  cars: number;
  floorHeight: number;
  duration: number;
  warmup: number;
  drain: boolean;
  maxDrain: number;
  seed: number;
  rate: number;
  congestion: number;
  scenario: Scenario;
  policy: Policy;
  zoneCount: number;
  zoneBoundaries: number[];
  groupCars: number[];
  lobby: number;
  transferFloors: number[];
  floorWeights: number[];
  floorPopulation: number[];
  initialQueues: number[];
  car: CarSpec;
  carOverrides: Partial<CarSpec>[];
  weights: { wait: number; journey: number; fairness: number; energy: number; balance: number };
  idle: 'lobby' | 'middle' | 'high' | 'predictive';
  failureAt: number;
  failureCar: number;
  longWait: number;
}
export interface Demand {
  id: number;
  at: number;
  origin: number;
  destination: number;
}
export interface Passenger extends Demand {
  state: 'waiting' | 'onboard' | 'complete';
  floor: number;
  route: number[];
  leg: number;
  queuedAt: number;
  boardedAt?: number;
  completedAt?: number;
  carId?: number;
  wait: number;
  ride: number;
  transfers: number;
  firstBoardedAt?: number;
}
export interface Motion {
  from: number;
  to: number;
  start: number;
  end: number;
  distance: number;
  acceleration: number;
  speed: number;
}
export interface CarState {
  id: number;
  position: number;
  direction: number;
  status: 'idle' | 'moving' | 'opening' | 'boarding' | 'closing' | 'failed' | 'retiring';
  passengers: number[];
  stops: number[];
  assigned: number[];
  serviceFloors: number[];
  spec: CarSpec;
  motion?: Motion;
  distance: number;
  stopsCount: number;
  busyTime: number;
  loadIntegral: number;
  energy: number;
  failurePending: boolean;
}
export interface Metrics {
  generated: number;
  waiting: number;
  onboard: number;
  completed: number;
  unboarded: number;
  unfinished: number;
  meanWait: number;
  medianWait: number;
  p95Wait: number;
  p99Wait: number;
  maxWait: number;
  meanRide: number;
  meanJourney: number;
  throughput: number;
  throughput5: number;
  currentMeanWait: number;
  oldestWait: number;
  maxQueue: number;
  distance: number;
  energy: number;
  stops: number;
  stopsPerPassenger: number;
  fairness: number;
  longWaitRatio: number;
  transferred: number;
  directMeanJourney: number;
  transferMeanJourney: number;
  floorQueues: number[];
  floorWaits: number[];
  utilization: number[];
  occupancy: number[];
  waitSamples: number[];
  queueGrowth: number;
  supplyMargin: number;
}
export interface Sample {
  time: number;
  meanWait: number;
  p95Wait: number;
  queue: number;
  completed: number;
  demand: number;
  positions: number[];
}
export interface LogEntry {
  time: number;
  type: string;
  message: string;
}
export interface Snapshot {
  time: number;
  done: boolean;
  algorithm: AlgorithmId;
  cars: CarState[];
  passengers: Passenger[];
  metrics: Metrics;
  series: Sample[];
  logs: LogEntry[];
  events: number;
  demandHash: string;
}
export interface AlgorithmInfo {
  id: AlgorithmId;
  name: string;
  short: string;
  description: string;
  pros: string;
  cons: string;
  complexity: string;
  information: 'hall' | 'destination';
}
export interface ExperimentPlan {
  floorValues: number[];
  carValues: number[];
  congestionValues: number[];
  algorithms: AlgorithmId[];
  seeds: number[];
  targetWait: number;
  metric: keyof Metrics;
}
export interface Estimate {
  mean: number;
  sd: number;
  low: number;
  high: number;
  n: number;
}
export interface ResearchRow {
  floors: number;
  cars: number;
  congestion: number;
  algorithm: AlgorithmId;
  wait: Estimate;
  p95: Estimate;
  throughput: Estimate;
  journey: Estimate;
  fairness: Estimate;
  energy: Estimate;
  unfinished: Estimate;
  queueGrowth: Estimate;
  meanWait: number;
  p95Wait: number;
  meanThroughput: number;
  marginalGain: number | null;
  supplyMargin: number;
  bottleneckRelief: number;
  runs: { seed: number; demandHash: string; metrics: Metrics }[];
}
export interface ResearchResult {
  config: Config;
  plan: ExperimentPlan;
  rows: ResearchRow[];
  minimumCars: number | null;
  createdAt: string;
  elapsedMs: number;
  cancelled: boolean;
}

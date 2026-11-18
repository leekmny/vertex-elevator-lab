import type { Config } from './types';
export function defaultConfig(): Config {
  return {
    floors: 20,
    basements: 0,
    cars: 2,
    floorHeight: 3.5,
    duration: 600,
    warmup: 0,
    drain: false,
    maxDrain: 3600,
    seed: 2026,
    rate: 24,
    congestion: 100,
    scenario: 'random',
    policy: 'shared',
    zoneCount: 2,
    zoneBoundaries: [],
    groupCars: [],
    lobby: 1,
    transferFloors: [1],
    floorWeights: Array(20).fill(1),
    floorPopulation: Array(20).fill(50),
    initialQueues: Array(20).fill(0),
    car: {
      capacity: 12,
      speed: 2.5,
      acceleration: 1,
      doorOpen: 1.5,
      doorClose: 1.5,
      boardTime: 0.8,
      alightTime: 0.6,
      home: 1,
    },
    carOverrides: [],
    weights: { wait: 1, journey: 0.5, fairness: 1, energy: 0.1, balance: 0.3 },
    idle: 'lobby',
    failureAt: 180,
    failureCar: 0,
    longWait: 120,
  };
}
export function allFloors(c: Config): number[] {
  return Array.from({ length: c.floors + c.basements }, (_, i) => i + 1 - c.basements);
}
export function validateConfig(c: Config): void {
  if (!c || typeof c !== 'object') throw Error('설정 객체가 필요합니다');
  for (const [k, min, max] of [
    ['floors', 5, 100],
    ['basements', 0, 10],
    ['cars', 1, 20],
    ['duration', 1, 86400],
    ['congestion', 0, 500],
    ['rate', 0, 10000],
    ['floorHeight', 1, 10],
    ['warmup', 0, 86400],
    ['maxDrain', 0, 86400],
  ] as const) {
    const v = c[k];
    if (!Number.isFinite(v) || v < min || v > max)
      throw Error(`${k}: ${min}~${max} 범위가 필요합니다`);
  }
  for (const k of ['floors', 'basements', 'cars', 'zoneCount', 'seed'] as const)
    if (!Number.isInteger(c[k])) throw Error(`${k}: 정수가 필요합니다`);
  if (c.warmup >= c.duration) throw Error('안정화 구간은 실험 시간보다 짧아야 합니다');
  const fs = allFloors(c);
  if (!fs.includes(c.lobby)) throw Error('로비 층이 범위를 벗어났습니다');
  if (!['shared', 'parity', 'zoned', 'dynamic'].includes(c.policy))
    throw Error('지원하지 않는 운영 정책');
  if (
    ![
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
    ].includes(c.scenario)
  )
    throw Error('지원하지 않는 수요 시나리오');
  for (let i = 0; i < c.cars; i++) {
    const s = { ...c.car, ...c.carOverrides?.[i] };
    for (const k of [
      'capacity',
      'speed',
      'acceleration',
      'doorOpen',
      'doorClose',
      'boardTime',
      'alightTime',
    ] as const) {
      if (
        !Number.isFinite(s[k]) ||
        s[k] < 0 ||
        ((k === 'capacity' || k === 'speed' || k === 'acceleration') && s[k] <= 0)
      )
        throw Error(`차량 ${i + 1} ${k} 값이 잘못되었습니다`);
    }
    if (!Number.isInteger(s.capacity)) throw Error('정원은 정수여야 합니다');
  }
  for (const list of [c.floorWeights, c.floorPopulation, c.initialQueues])
    if (!Array.isArray(list) || list.some((v) => !Number.isFinite(v) || v < 0))
      throw Error('층별 수요는 0 이상의 수여야 합니다');
  if (
    c.groupCars.length &&
    (c.groupCars.some((n) => !Number.isInteger(n) || n < 1) ||
      c.groupCars.reduce((a, b) => a + b, 0) !== c.cars)
  )
    throw Error('그룹별 차량 수의 합은 전체 차량 수와 같아야 합니다');
  for (const v of Object.values(c.weights))
    if (!Number.isFinite(v) || v < 0) throw Error('최적화 가중치는 0 이상이어야 합니다');
  if (c.zoneCount < 1 || c.zoneCount > 20) throw Error('zoneCount must be 1..20');
  for (let i = 0; i < c.cars; i++) {
    const spec = { ...c.car, ...c.carOverrides?.[i] };
    if (!fs.includes(spec.home)) throw Error('home must be a building floor');
    if (spec.serviceFloors?.some((f) => !fs.includes(f)))
      throw Error('serviceFloors outside building');
  }
  if (c.transferFloors.some((f) => !fs.includes(f))) throw Error('transfer floor outside building');
  if (
    c.zoneBoundaries.some((f) => !fs.includes(f)) ||
    c.zoneBoundaries.some((f, i) => i > 0 && f <= c.zoneBoundaries[i - 1])
  )
    throw Error('zone boundaries must be ascending building floors');
}

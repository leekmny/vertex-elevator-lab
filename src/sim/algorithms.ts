import type { AlgorithmId, AlgorithmInfo, CarState, Config } from './types';
import { travelTime } from './physics';
const info = (
  id: AlgorithmId,
  name: string,
  description: string,
  pros: string,
  cons: string,
  complexity: string,
  information: 'hall' | 'destination' = 'hall',
): AlgorithmInfo => ({ id, name, short: name, description, pros, cons, complexity, information });
export const ALGORITHMS: AlgorithmInfo[] = [
  info(
    'fcfs',
    'FCFS',
    '호출 생성 순서와 예약 순서를 우선합니다.',
    '명확한 순서',
    '동선 중복',
    'O(C·H)',
  ),
  info(
    'nearest',
    'Nearest Car',
    '호출층까지 현재 거리로 차량을 선택합니다.',
    '빠른 계산',
    '방향과 예약 지연을 무시',
    'O(C·H)',
  ),
  info(
    'direction',
    'Direction-aware',
    '호출 방향과 진행 방향이 맞는 차량을 우선합니다.',
    '역주행 감소',
    '정차 부하 추정이 단순함',
    'O(C·H)',
  ),
  info(
    'collective',
    'Collective Selective',
    '방향별 홀 호출을 묶고 같은 방향으로 순회합니다.',
    '일반 홀 호출에 적합',
    '반대 방향 지연',
    'O(C·H + S log S)',
  ),
  info(
    'look',
    'LOOK',
    '현재 방향의 마지막 요청에서 방향을 전환합니다.',
    '빈 구간 이동 감소',
    '상황에 따라 긴 대기',
    'O(C·H + S log S)',
  ),
  info(
    'scan',
    'SCAN',
    '서비스 범위 끝까지 이동한 후 방향을 반전합니다.',
    '전체 범위 순회',
    '빈 구간 운행 비용',
    'O(C·H + S log S)',
  ),
  info(
    'eta',
    'ETA-based',
    '가감속 이동과 기존 예약 정차 지연으로 도착시간을 추정합니다.',
    '예약 부하 고려',
    '미래 호출을 예측하지 않음',
    'O(C·H·S)',
  ),
  info(
    'journey',
    'Minimum Journey Time',
    'ETA와 호출 방향으로 추정한 탑승 이동시간을 함께 줄입니다.',
    '여정 비용 고려',
    '홀 정보 기반 목적지 추정',
    'O(C·H·S)',
  ),
  info(
    'static',
    'Static Zoning',
    '고정 구역에 차량을 배정하고 구역 내 ETA로 선택합니다.',
    '구역 간 간섭 감소',
    '수요 불균형과 환승 비용',
    'O(C·H·S)',
  ),
  info(
    'dynamic',
    'Dynamic Zoning',
    '30초마다 대기 부하로 경계를 재설정합니다. 기존 예약과 탑승 목적지는 보존합니다.',
    '수요 변화 대응',
    '환승과 경계 변동',
    'O(F·C + C·H·S)',
  ),
  info(
    'destination',
    'Destination Dispatch',
    '승차 전 입력한 목적지까지 완료시간과 목적지 묶음을 사용합니다.',
    '목적지 묶음',
    '홀 호출과 정보 수준이 다름',
    'O(C·H·S)',
    'destination',
  ),
  info(
    'multi',
    'Multi-objective',
    'ETA, 여정, 장기 대기, 부하 균등과 거리를 가중합으로 줄입니다.',
    '가중치 조정',
    '가중치 민감도',
    'O(C·H·S)',
  ),
  info(
    'genetic',
    'Genetic Algorithm',
    '최대 8개 호출의 배정 벡터를 12개 개체·8세대 교차와 변이로 탐색합니다.',
    '실제 조합 탐색',
    '제한된 탐색 예산',
    'O(12·8·8·C·S)',
  ),
  info(
    'annealing',
    'Simulated Annealing',
    '최대 8개 호출의 배정을 64회 이웃 탐색과 지수 냉각으로 최적화합니다.',
    '지역 최적해 탈출 가능',
    '제한된 탐색 예산',
    'O(64·8·C·S)',
  ),
];
export interface HallCall {
  id: number;
  origin: number;
  direction: number;
  queuedAt: number;
  destination?: number;
}
export function eta(car: CarState, call: HallCall, now: number, c: Config): number {
  const start = car.motion?.to ?? car.position,
    remaining = car.motion ? Math.max(0, car.motion.end - now) : 0;
  const handling = car.spec.doorOpen + car.spec.doorClose + car.spec.boardTime;
  const pending = car.stops.filter((f) => f !== call.origin);
  return (
    remaining +
    travelTime(
      Math.abs(start - call.origin) * c.floorHeight,
      car.spec.speed,
      car.spec.acceleration,
    ) +
    pending.length * handling +
    pending.reduce(
      (sum, f) => sum + ((Math.abs(f - start) * c.floorHeight) / car.spec.speed) * 0.2,
      0,
    ) +
    (car.status === 'boarding' ? handling : 0)
  );
}
export function scoreCar(
  id: AlgorithmId,
  car: CarState,
  call: HallCall,
  now: number,
  c: Config,
): number {
  const distance = Math.abs(car.position - call.origin),
    arrival = eta(car, call, now, c);
  const along =
    car.direction === 0 ||
    (car.direction === call.direction && Math.sign(call.origin - car.position) === car.direction);
  const load = (car.passengers.length + car.assigned.length * 0.5) / car.spec.capacity,
    age = Math.max(0, now - call.queuedAt);
  const inferred =
    ((Math.abs((call.direction > 0 ? c.floors : 1 - c.basements) - call.origin) * c.floorHeight) /
      car.spec.speed) *
    0.5;
  switch (id) {
    case 'fcfs':
      return car.assigned.length * 1000 + arrival;
    case 'nearest':
      return distance;
    case 'direction':
      return distance + (along ? 0 : c.floors);
    case 'collective':
      return distance + (along ? 0 : c.floors * 2) + car.assigned.length * 0.3;
    case 'look':
    case 'scan':
      return arrival + (along ? 0 : c.floors * 2);
    case 'journey':
      return arrival + inferred * (1 + load * 0.3);
    case 'destination':
      return (
        arrival +
        (Math.abs((call.destination ?? call.origin) - call.origin) * c.floorHeight) /
          car.spec.speed -
        (car.stops.includes(call.destination ?? NaN) ? 8 : 0) +
        load * 5
      );
    case 'multi':
    case 'genetic':
    case 'annealing':
      return (
        c.weights.wait * arrival +
        c.weights.journey * (arrival + inferred) +
        (c.weights.fairness * arrival * age) / Math.max(1, c.longWait) +
        c.weights.energy * distance * c.floorHeight +
        c.weights.balance * load * 30
      );
    default:
      return arrival + load * 3;
  }
}
export function optimizeAssignments(
  id: AlgorithmId,
  calls: HallCall[],
  eligible: CarState[][],
  now: number,
  c: Config,
  random: () => number,
): number[] {
  const n = calls.length,
    initial = calls.map((call, i) => {
      let best = 0;
      for (let j = 1; j < eligible[i].length; j++)
        if (
          scoreCar('multi', eligible[i][j], call, now, c) <
          scoreCar('multi', eligible[i][best], call, now, c)
        )
          best = j;
      return best;
    });
  const objective = (genes: number[]) => {
    const loads = new Map<number, number>();
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const car = eligible[i][genes[i]];
      cost += scoreCar('multi', car, calls[i], now, c) + (loads.get(car.id) ?? 0) * 8;
      loads.set(car.id, (loads.get(car.id) ?? 0) + 1);
    }
    return cost;
  };
  const mutate = (g: number[]) => {
    const a = g.slice(),
      k = Math.floor(random() * n);
    a[k] = Math.floor(random() * eligible[k].length);
    return a;
  };
  let best = initial,
    bestCost = objective(best);
  if (id === 'annealing') {
    let current = initial,
      currentCost = bestCost;
    for (let k = 0; k < 64; k++) {
      const next = mutate(current),
        cost = objective(next),
        temp = 20 * Math.pow(0.94, k);
      if (cost < currentCost || random() < Math.exp((currentCost - cost) / temp)) {
        current = next;
        currentCost = cost;
      }
      if (currentCost < bestCost) {
        best = current;
        bestCost = currentCost;
      }
    }
  } else {
    let population = [
      initial,
      ...Array.from({ length: 11 }, () =>
        calls.map((_, i) => Math.floor(random() * eligible[i].length)),
      ),
    ];
    for (let generation = 0; generation < 8; generation++) {
      population.sort((a, b) => objective(a) - objective(b));
      if (objective(population[0]) < bestCost) {
        best = population[0];
        bestCost = objective(best);
      }
      const next = population.slice(0, 3);
      while (next.length < 12) {
        const a = population[Math.floor(random() * 6)],
          b = population[Math.floor(random() * 6)],
          cut = Math.floor(random() * n);
        let child = a.map((v, i) => (i < cut ? v : b[i]));
        if (random() < 0.65) child = mutate(child);
        next.push(child);
      }
      population = next;
    }
  }
  return best.map((gene, i) => eligible[i][gene].id);
}

import type {
  AlgorithmId,
  CarState,
  Config,
  Demand,
  LogEntry,
  Metrics,
  Passenger,
  Sample,
  Snapshot,
} from './types';
import { allFloors, validateConfig } from './config';
import { demandHash, generateDemand, rng } from './demand';
import { positionAt, travelTime } from './physics';
import { ALGORITHMS, optimizeAssignments, scoreCar, type HallCall } from './algorithms';
type EventType =
  | 'passenger'
  | 'dispatch'
  | 'arrive'
  | 'open'
  | 'alight'
  | 'board'
  | 'closing'
  | 'close'
  | 'sample'
  | 'zone'
  | 'failure';
interface Event {
  time: number;
  priority: number;
  seq: number;
  type: EventType;
  car?: number;
  passenger?: number;
  demand?: Demand;
  target?: number;
}
class Heap {
  a: Event[] = [];
  less(x: Event, y: Event) {
    return (
      x.time < y.time ||
      (x.time === y.time &&
        (x.priority < y.priority || (x.priority === y.priority && x.seq < y.seq)))
    );
  }
  push(e: Event) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.a,
      first = a[0],
      last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let k = i,
          l = i * 2 + 1,
          r = l + 1;
        if (l < a.length && this.less(a[l], a[k])) k = l;
        if (r < a.length && this.less(a[r], a[k])) k = r;
        if (k === i) break;
        [a[i], a[k]] = [a[k], a[i]];
        i = k;
      }
    }
    return first;
  }
  peek() {
    return this.a[0];
  }
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] : 0;
export class Simulation {
  readonly config: Config;
  readonly algorithm: AlgorithmId;
  readonly cars: CarState[] = [];
  time = 0;
  private queue = new Heap();
  private serial = 0;
  private processed = 0;
  private people = new Map<number, Passenger>();
  private knownIds = new Set<number>();
  private demandRecords: Demand[] = [];
  private series: Sample[] = [];
  private logs: LogEntry[] = [];
  private hash: string;
  private random: () => number;
  private lastAccount = 0;
  private dispatchAt = -1;
  private finished = false;
  private maxQueue = 0;
  private waitingCount = 0;
  private horizon: number;
  private policy: Config['policy'];
  private repositioned = new Set<number>();
  constructor(config: Config, algorithm: AlgorithmId, demand?: Demand[]) {
    validateConfig(config);
    if (!ALGORITHMS.some((a) => a.id === algorithm)) throw Error('Unknown dispatch algorithm');
    this.config = structuredClone(config);
    this.algorithm = algorithm;
    this.random = rng(config.seed ^ 0x5a17);
    this.policy =
      algorithm === 'static' ? 'zoned' : algorithm === 'dynamic' ? 'dynamic' : config.policy;
    this.horizon = config.duration + (config.drain ? config.maxDrain : 0);
    const fs = allFloors(config);
    for (let i = 0; i < config.cars; i++) {
      const spec = { ...config.car, ...config.carOverrides[i] };
      this.cars.push({
        id: i,
        position: spec.home,
        direction: 0,
        status: 'idle',
        passengers: [],
        stops: [],
        assigned: [],
        serviceFloors: [],
        spec,
        distance: 0,
        stopsCount: 0,
        busyTime: 0,
        loadIntegral: 0,
        energy: 0,
        failurePending: false,
      });
    }
    this.allocateZones(false);
    // Validate every OD path before accepting an experiment.
    // Service edges are undirected, so one connected-component traversal suffices
    // to establish a path for every OD pair.
    for (const d of fs) if (fs[0] !== d) this.route(fs[0], d);
    const records = demand ?? generateDemand(config),
      ids = this.knownIds;
    for (const d of records) {
      if (
        ids.has(d.id) ||
        !fs.includes(d.origin) ||
        !fs.includes(d.destination) ||
        d.origin === d.destination ||
        d.at < 0 ||
        !Number.isFinite(d.at)
      )
        throw Error('Invalid passenger demand record');
      ids.add(d.id);
      if (d.at <= config.duration) this.add('passenger', d.at, 20, { demand: { ...d } });
    }
    this.hash = demandHash(records);
    this.demandRecords = records.map(record=>({...record}));
    for (let t = 0; t <= this.horizon; t += 10) this.add('sample', t, 90);
    // Exact source and drain boundaries are events too, even when not multiples
    // of the periodic sampling interval.
    if (config.duration % 10 !== 0) this.add('sample', config.duration, 90);
    if (this.horizon % 10 !== 0 && this.horizon !== config.duration)
      this.add('sample', this.horizon, 90);
    if (this.policy === 'dynamic')
      for (let t = 30; t <= this.horizon; t += 30) this.add('zone', t, 30);
    if (config.scenario === 'failure' && config.failureAt <= this.horizon)
      this.add('failure', Math.max(0, config.failureAt), 5, { car: config.failureCar });
  }
  private add(type: EventType, time: number, priority: number, rest: Partial<Event> = {}) {
    if (time <= this.horizon)
      this.queue.push({ time, priority, seq: this.serial++, type, ...rest });
  }
  private log(type: string, message: string) {
    this.logs.push({ time: this.time, type, message });
    if (this.logs.length > 100) this.logs.shift();
  }
  private scheduleDispatch() {
    if (this.dispatchAt === this.time) return;
    this.dispatchAt = this.time;
    this.add('dispatch', this.time, 40);
  }
  private nextFloor(p: Passenger) {
    return p.route[p.leg + 1];
  }
  private allocateZones(dynamic: boolean) {
    const c = this.config,
      fs = allFloors(c),
      zones =
        this.policy === 'parity' ? Math.min(2, c.cars) : Math.min(c.zoneCount, c.cars, fs.length);
    const previous = this.cars.map((car) => car.serviceFloors.slice());
    let boundaries = c.zoneBoundaries.length
      ? c.zoneBoundaries.slice()
      : Array.from(
          { length: zones - 1 },
          (_, i) => fs[Math.ceil((fs.length * (i + 1)) / zones) - 1],
        );
    if (dynamic) {
      const loads = fs.map(
          (f) =>
            1 +
            [...this.people.values()].filter((p) => p.state === 'waiting' && p.floor === f).length,
        ),
        total = loads.reduce((a, b) => a + b, 0);
      let sum = 0,
        k = 1;
      boundaries = [];
      for (let i = 0; i < fs.length - 1 && k < zones; i++) {
        sum += loads[i];
        if (sum >= (total * k) / zones) {
          boundaries.push(fs[i]);
          k++;
        }
      }
      while (boundaries.length < zones - 1)
        boundaries.push(fs[fs.length - zones + boundaries.length]);
      boundaries.sort((a, b) => a - b);
    }
    let groups: number[] = [];
    if (c.groupCars.length === zones) {
      c.groupCars.forEach((n, g) => {
        for (let k = 0; k < n; k++) groups.push(g);
      });
    } else groups = this.cars.map((_, i) => i % zones);
    for (const car of this.cars) {
      let allowed = fs;
      if (this.policy === 'parity' && c.cars > 1)
        allowed = fs.filter((f) => Math.abs(f) % 2 === groups[car.id]);
      else if (this.policy === 'zoned' || this.policy === 'dynamic')
        allowed = fs.filter((f) => {
          let g = boundaries.findIndex((b) => f <= b);
          if (g < 0) g = zones - 1;
          return g === groups[car.id];
        });
      if (this.policy !== 'shared')
        allowed = [...new Set([...allowed, c.lobby, ...c.transferFloors])];
      if (car.spec.serviceFloors)
        allowed = allowed.filter((f) => car.spec.serviceFloors!.includes(f));
      // Preserve reservations and onboard leg destinations through zone changes.
      const reserved = [...car.passengers, ...car.assigned].flatMap((id) => {
        const p = this.people.get(id);
        return p ? [p.floor, this.nextFloor(p)] : [];
      });
      car.serviceFloors = [...new Set([...allowed, ...reserved])].sort((a, b) => a - b);
    }
    if (dynamic) {
      // A boundary cannot remove a physically restricted floor's last provider.
      // Repair coverage with a capable vehicle; if connectivity would still be
      // lost, retain the previous feasible allocation for this control interval.
      for (const floor of fs)
        if (!this.cars.some((car) => car.serviceFloors.includes(floor))) {
          const capable = this.cars.find(
            (car) => !car.spec.serviceFloors || car.spec.serviceFloors.includes(floor),
          );
          if (capable) capable.serviceFloors.push(floor);
        }
      try {
        for (const floor of fs) if (floor !== fs[0]) this.route(fs[0], floor);
      } catch {
        this.cars.forEach((car, i) => {
          car.serviceFloors = previous[i];
        });
      }
      // A passenger not yet reserved must route against the new service graph.
      // Reserved legs remain valid because both endpoint floors were retained.
      for (const p of this.people.values())
        if (p.state === 'waiting' && p.carId === undefined) {
          p.route = this.route(p.floor, p.destination);
          p.leg = 0;
        }
      this.log('zone', '대기 부하에 따른 구역 경계를 갱신했습니다');
    }
  }
  private route(origin: number, destination: number): number[] {
    if (
      this.cars.some(
        (car) => car.serviceFloors.includes(origin) && car.serviceFloors.includes(destination),
      )
    )
      return [origin, destination];
    const previous = new Map<number, number | undefined>([[origin, undefined]]),
      todo = [origin];
    // Route physical capability separately from availability; failed exclusive
    // groups leave explicit unfinished passengers instead of removing demand.
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      if (f === destination) break;
      for (const car of this.cars) {
        if (!car.serviceFloors.includes(f)) continue;
        for (const d of car.serviceFloors)
          if (!previous.has(d)) {
            previous.set(d, f);
            todo.push(d);
          }
      }
    }
    if (!previous.has(destination)) throw Error(`No service path: ${origin} → ${destination}`);
    const path = [destination];
    while (path[0] !== origin) path.unshift(previous.get(path[0])!);
    return path;
  }
  private account(t: number) {
    const dt = t - this.lastAccount;
    for (const car of this.cars) {
      if (car.status !== 'idle' && car.status !== 'failed') car.busyTime += dt;
      car.loadIntegral += dt * car.passengers.length;
      if (car.motion) car.position = positionAt(car.motion, t, this.config.floorHeight);
    }
    this.lastAccount = t;
  }
  private hall(p: Passenger): HallCall {
    return {
      id: p.id,
      origin: p.floor,
      direction: Math.sign(this.nextFloor(p) - p.floor),
      queuedAt: p.queuedAt,
      ...(this.algorithm === 'destination' ? { destination: this.nextFloor(p) } : {}),
    };
  }
  private eligible(p: Passenger) {
    return this.cars.filter(
      (car) =>
        !car.failurePending &&
        car.status !== 'failed' &&
        car.serviceFloors.includes(p.floor) &&
        car.serviceFloors.includes(this.nextFloor(p)) &&
        car.passengers.length < car.spec.capacity,
    );
  }
  private dispatch() {
    this.dispatchAt = -1;
    const waiting = [...this.people.values()]
      .filter((p) => p.state === 'waiting' && p.carId === undefined)
      .sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id);
    // Bound the optimizer's chromosome while preserving FIFO across batches.
    for (let offset = 0; offset < waiting.length; offset += 8) {
      const batch = waiting.slice(offset, offset + 8).filter((p) => this.eligible(p).length > 0);
      if (!batch.length) continue;
      const candidates = batch.map((p) => this.eligible(p));
      const ids =
        this.algorithm === 'genetic' || this.algorithm === 'annealing'
          ? optimizeAssignments(
              this.algorithm,
              batch.map((p) => this.hall(p)),
              candidates,
              this.time,
              this.config,
              this.random,
            )
          : batch.map(
              (p, i) =>
                candidates[i].reduce((best, car) =>
                  scoreCar(this.algorithm, car, this.hall(p), this.time, this.config) <
                  scoreCar(this.algorithm, best, this.hall(p), this.time, this.config)
                    ? car
                    : best,
                ).id,
            );
      batch.forEach((p, i) => {
        const car = this.cars[ids[i]];
        p.carId = car.id;
        car.assigned.push(p.id);
        this.repositioned.delete(car.id);
      });
    }
    for (const car of this.cars) {
      this.updateStops(car);
      if (car.status === 'idle') this.depart(car);
    }
  }
  private updateStops(car: CarState) {
    car.assigned = car.assigned.filter((id) => {
      const p = this.people.get(id);
      return p?.state === 'waiting' && p.carId === car.id;
    });
    car.stops = [
      ...new Set([
        ...car.passengers.map((id) => this.nextFloor(this.people.get(id)!)),
        ...car.assigned.map((id) => this.people.get(id)!.floor),
      ]),
    ];
  }
  private target(car: CarState): number | undefined {
    this.updateStops(car);
    let stops = car.stops;
    if (!stops.length) return undefined;
    if (this.algorithm === 'fcfs')
      return car.passengers.length
        ? this.nextFloor(this.people.get(car.passengers[0])!)
        : this.people.get(car.assigned[0])!.floor;
    if (car.passengers.length) {
      // Make progress toward onboard commitments. Opposite hall pickups must not
      // pull an occupied vehicle back and forth between two adjacent floors.
      const destinations = car.passengers.map((id) => this.nextFloor(this.people.get(id)!));
      const dir = Math.sign(destinations[0] - car.position) || car.direction || 1;
      const pickups =
        car.passengers.length >= car.spec.capacity
          ? []
          : car.assigned
              .map((id) => this.people.get(id)!)
              .filter(
                (p) =>
                  Math.sign(this.nextFloor(p) - p.floor) === dir &&
                  (p.floor - car.position) * dir >= 0,
              )
              .map((p) => p.floor);
      stops = [...new Set([...destinations, ...pickups])];
      car.direction = dir;
    }
    if (['look', 'scan', 'collective', 'direction'].includes(this.algorithm)) {
      if (!car.direction) car.direction = Math.sign(stops[0] - car.position) || 1;
      const ahead = stops
        .filter((f) => (f - car.position) * car.direction >= 0)
        .sort((a, b) => (a - b) * car.direction);
      if (ahead.length) return ahead[0];
      if (this.algorithm === 'scan') {
        const edge =
          car.direction > 0 ? Math.max(...car.serviceFloors) : Math.min(...car.serviceFloors);
        if (Math.abs(edge - car.position) > 0.00001) return edge;
      }
      car.direction *= -1;
      return [...stops].sort((a, b) => (a - b) * car.direction)[0];
    }
    return stops.reduce((best, f) =>
      Math.abs(f - car.position) < Math.abs(best - car.position) ? f : best,
    );
  }
  private depart(car: CarState) {
    if (car.status === 'failed') return;
    if (car.failurePending && car.passengers.length === 0) {
      car.status = 'failed';
      car.direction = 0;
      this.log('failure', `E${car.id + 1} 안전 퇴역 완료`);
      return;
    }
    let target = this.target(car);
    if (target === undefined) {
      car.status = 'idle';
      car.direction = 0;
      if (!this.repositioned.has(car.id) && !car.failurePending) {
        const c = this.config;
        let home =
          c.idle === 'middle'
            ? Math.round((1 - c.basements + c.floors) / 2)
            : c.idle === 'high'
              ? c.floors
              : c.lobby;
        if (c.idle === 'predictive') {
          const freq = new Map<number, number>();
          for (const p of this.people.values())
            if (p.at >= this.time - 120) freq.set(p.origin, (freq.get(p.origin) ?? 0) + 1);
          home = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? c.lobby;
        }
        target = car.serviceFloors.reduce(
          (a, f) => (Math.abs(f - home) < Math.abs(a - home) ? f : a),
          car.serviceFloors[0] ?? car.position,
        );
        this.repositioned.add(car.id);
        if (target === car.position) return;
      } else return;
    }
    if (Math.abs(target - car.position) < 1e-8) {
      this.arrive(car, target);
      return;
    }
    const distance = Math.abs(target - car.position) * this.config.floorHeight,
      duration = travelTime(distance, car.spec.speed, car.spec.acceleration);
    car.direction = Math.sign(target - car.position);
    car.status = 'moving';
    car.motion = {
      from: car.position,
      to: target,
      start: this.time,
      end: this.time + duration,
      distance,
      acceleration: car.spec.acceleration,
      speed: car.spec.speed,
    };
    this.add('arrive', this.time + duration, 10, { car: car.id, target });
    this.log('depart', `E${car.id + 1} → ${target}층`);
  }
  private arrive(car: CarState, target: number) {
    if (car.motion) {
      car.distance += car.motion.distance;
      car.energy +=
        (car.motion.distance * (600 + 75 * car.passengers.length) * 9.81 * 0.35) / 3600000;
      delete car.motion;
    }
    car.position = target;
    const needed =
      car.passengers.some((id) => this.nextFloor(this.people.get(id)!) === target) ||
      car.assigned.some((id) => this.people.get(id)?.floor === target);
    if (!needed) {
      car.status = 'idle';
      this.depart(car);
      return;
    }
    car.status = 'opening';
    car.stopsCount++;
    car.energy += 0.0015;
    this.add('open', this.time + car.spec.doorOpen, 10, { car: car.id });
    this.log('arrive', `E${car.id + 1} ${target}층 도착`);
  }
  private opened(car: CarState) {
    car.status = 'boarding';
    let handling = this.time;
    for (const id of [...car.passengers])
      if (this.nextFloor(this.people.get(id)!) === car.position) {
        handling += car.spec.alightTime;
        this.add('alight', handling, 10, { car: car.id, passenger: id });
      }
    // A final boarding decision is made after all alighting events, not before.
    this.add('board', handling, 15, { car: car.id });
  }
  private alight(car: CarState, p: Passenger) {
    if (p.state !== 'onboard' || p.carId !== car.id) return;
    car.passengers = car.passengers.filter((id) => id !== p.id);
    p.ride += this.time - (p.boardedAt ?? this.time);
    p.floor = car.position;
    p.leg++;
    delete p.carId;
    if (p.floor === p.destination) {
      p.state = 'complete';
      p.completedAt = this.time;
      this.log('complete', `승객 ${p.id} 여정 완료`);
    } else {
      p.state = 'waiting';
      this.waitingCount++;
      p.queuedAt = this.time;
      p.transfers++;
      if (this.policy === 'dynamic') {
        p.route = this.route(p.floor, p.destination);
        p.leg = 0;
      }
      this.log('transfer', `승객 ${p.id} ${p.floor}층 환승`);
    }
    this.scheduleDispatch();
  }
  private board(car: CarState, p?: Passenger) {
    if (p) {
      if (
        p.state === 'waiting' &&
        p.carId === car.id &&
        p.floor === car.position &&
        car.passengers.length < car.spec.capacity &&
        !car.failurePending
      ) {
        p.state = 'onboard';
        this.waitingCount--;
        p.wait += this.time - p.queuedAt;
        p.boardedAt = this.time;
        p.firstBoardedAt ??= this.time;
        car.passengers.push(p.id);
        car.assigned = car.assigned.filter((id) => id !== p.id);
        this.log('board', `E${car.id + 1} 승객 ${p.id} 탑승`);
      }
      return;
    }
    const candidates = car.assigned
      .map((id) => this.people.get(id)!)
      .filter((p) => p.state === 'waiting' && p.floor === car.position)
      .sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id);
    // Direction is chosen from onboard commitments first, then oldest local call.
    const next = car.passengers.length
      ? this.nextFloor(this.people.get(car.passengers[0])!)
      : candidates.length
        ? this.nextFloor(candidates[0])
        : undefined;
    if (next !== undefined) car.direction = Math.sign(next - car.position);
    let handling = this.time,
      space = car.spec.capacity - car.passengers.length;
    for (const passenger of candidates) {
      const sameDirection =
        Math.sign(this.nextFloor(passenger) - passenger.floor) === car.direction;
      if (space > 0 && sameDirection && !car.failurePending) {
        space--;
        handling += car.spec.boardTime;
        this.add('board', handling, 10, { car: car.id, passenger: passenger.id });
      } else {
        delete passenger.carId;
        car.assigned = car.assigned.filter((id) => id !== passenger.id);
      }
    }
    car.status = 'boarding';
    this.add('closing', handling, 16, { car: car.id });
    this.add('close', handling + car.spec.doorClose, 20, { car: car.id });
  }
  /** Real user hall calls, inserted as a single simultaneous batch at current time. */
  injectPassengers(records: Demand[]):void {
    if(this.finished||this.time>=this.config.duration)throw Error('운행이 끝났어요. 처음부터 다시 시작해 주세요.');
    const fs=allFloors(this.config),batchIds=new Set<number>();
    for(const d of records){
      if(!Number.isInteger(d.id)||this.knownIds.has(d.id)||batchIds.has(d.id)||d.at!==this.time||!fs.includes(d.origin)||!fs.includes(d.destination)||d.origin===d.destination)throw Error('호출 승객의 시각·층·ID가 잘못되었습니다.');
      this.route(d.origin,d.destination);batchIds.add(d.id);
    }
    for(const d of records){this.knownIds.add(d.id);this.demandRecords.push({...d});this.add('passenger',this.time,20,{demand:{...d}});}
    this.hash=demandHash(this.demandRecords);
    this.log('call',`${records.length}명이 ${new Set(records.map(d=>d.origin)).size}개 층에서 동시에 호출했습니다`);
    this.advanceTo(this.time);
  }
  failCar(id: number) {
    const car = this.cars[id];
    if (!car || car.status === 'failed' || car.failurePending) return;
    car.failurePending = true;
    this.log('failure', `E${id + 1} 신규 승차 중단, 탑승객 하차 후 퇴역`);
    for (const pId of car.assigned) {
      const p = this.people.get(pId);
      if (p?.state === 'waiting') delete p.carId;
    }
    car.assigned = [];
    this.updateStops(car);
    if (car.status === 'idle') this.depart(car);
    this.scheduleDispatch();
  }
  private process(e: Event) {
    this.account(e.time);
    this.time = e.time;
    this.processed++;
    const car = e.car === undefined ? undefined : this.cars[e.car];
    switch (e.type) {
      case 'passenger': {
        const d = e.demand!,
          p: Passenger = {
            ...d,
            state: 'waiting',
            floor: d.origin,
            route: this.route(d.origin, d.destination),
            leg: 0,
            queuedAt: d.at,
            wait: 0,
            ride: 0,
            transfers: 0,
          };
        this.people.set(p.id, p);
        this.waitingCount++;
        this.repositioned.clear();
        this.scheduleDispatch();
        break;
      }
      case 'dispatch':
        this.dispatch();
        break;
      case 'arrive':
        this.arrive(car!, e.target!);
        break;
      case 'open':
        this.opened(car!);
        break;
      case 'alight':
        this.alight(car!, this.people.get(e.passenger!)!);
        break;
      case 'board':
        this.board(car!, e.passenger === undefined ? undefined : this.people.get(e.passenger));
        break;
      case 'closing':
        car!.status = 'closing';
        break;
      case 'close':
        car!.status = 'idle';
        this.depart(car!);
        this.scheduleDispatch();
        break;
      case 'failure':
        this.failCar(e.car!);
        break;
      case 'zone':
        this.allocateZones(true);
        this.scheduleDispatch();
        break;
      case 'sample': {
        const m = this.metrics();
        this.series.push({
          time: this.time,
          meanWait: m.meanWait,
          p95Wait: m.p95Wait,
          queue: m.waiting,
          completed: m.completed,
          demand: m.generated,
          positions: this.cars.map((c) => c.position),
        });
        break;
      }
    }
    this.maxQueue = Math.max(this.maxQueue, this.waitingCount);
  }
  private drained() {
    return (
      this.time >= this.config.duration &&
      this.waitingCount === 0 &&
      this.cars.every((c) => c.passengers.length === 0) &&
      (!this.queue.peek() || this.queue.peek().time > this.time)
    );
  }
  advanceTo(target: number): Snapshot {
    if (!Number.isFinite(target) || target < this.time)
      throw Error('Simulation time must be finite and monotonic');
    if (this.finished) return this.snapshot();
    const end = Math.min(target, this.horizon);
    while (this.queue.peek() && this.queue.peek().time <= end) {
      if (this.config.drain && this.drained()) {
        this.finished = true;
        break;
      }
      this.process(this.queue.pop()!);
      if (this.processed > 10000000) throw Error('Event limit exceeded');
    }
    if (!this.finished) this.time = end;
    if (this.time >= this.horizon || (this.config.drain && this.drained())) this.finished = true;
    return this.snapshot();
  }
  step(): Snapshot {
    if (this.finished) return this.snapshot();
    const e = this.queue.pop();
    if (!e) {
      this.time = this.horizon;
      this.finished = true;
      return this.snapshot();
    }
    this.process(e);
    if (this.processed > 10000000) throw Error('Event limit exceeded');
    if (
      (this.time >= this.horizon &&
        (!this.queue.peek() || this.queue.peek().time > this.horizon)) ||
      (this.config.drain && this.drained())
    )
      this.finished = true;
    return this.snapshot();
  }
  run(): Snapshot {
    return this.advanceTo(this.horizon);
  }
  private metrics(): Metrics {
    const ps = [...this.people.values()],
      cohort = ps.filter((p) => p.at >= this.config.warmup),
      boarded = cohort.filter((p) => p.firstBoardedAt !== undefined),
      complete = cohort.filter((p) => p.state === 'complete'),
      waiting = ps.filter((p) => p.state === 'waiting'),
      onboard = ps.filter((p) => p.state === 'onboard');
    const waits = boarded.map((p) => p.wait).sort((a, b) => a - b),
      current = waiting.map((p) => this.time - p.queuedAt),
      fs = allFloors(this.config);
    const floorQueues = fs.map((f) => waiting.filter((p) => p.floor === f).length),
      floorWaits = fs.map((f) => mean(boarded.filter((p) => p.origin === f).map((p) => p.wait))),
      nonempty = floorWaits.filter((v) => v > 0),
      avg = mean(nonempty),
      fairness = avg ? Math.sqrt(mean(nonempty.map((v) => (v - avg) ** 2))) / avg : 0;
    const elapsed = Math.max(0, this.time - this.config.warmup),
      throughput = elapsed > 0 ? (complete.length * 60) / elapsed : 0;
    const back = this.series.find((s) => s.time >= Math.max(0, this.time - 60));
    const queueGrowth =
      back && this.time > back.time
        ? ((waiting.length - back.queue) * 60) / (this.time - back.time)
        : 0;
    const direct = complete.filter((p) => !p.transfers),
      transferred = complete.filter((p) => p.transfers > 0),
      observed = cohort.map((p) => p.wait + (p.state === 'waiting' ? this.time - p.queuedAt : 0));
    const dt = this.time - this.lastAccount;
    return {
      generated: ps.length,
      waiting: waiting.length,
      onboard: onboard.length,
      completed: ps.filter((p) => p.state === 'complete').length,
      unboarded: ps.filter((p) => p.firstBoardedAt === undefined).length,
      unfinished: waiting.length + onboard.length,
      meanWait: mean(waits),
      medianWait: quantile(waits, 0.5),
      p95Wait: quantile(waits, 0.95),
      p99Wait: quantile(waits, 0.99),
      maxWait: waits[waits.length - 1] ?? 0,
      meanRide: mean(complete.map((p) => p.ride)),
      meanJourney: mean(complete.map((p) => p.completedAt! - p.at)),
      throughput,
      throughput5: throughput * 5,
      currentMeanWait: mean(current),
      oldestWait: current.reduce((max, value) => Math.max(max, value), 0),
      maxQueue: this.maxQueue,
      distance: this.cars.reduce(
        (a, c) =>
          a +
          c.distance +
          (c.motion
            ? Math.abs(positionAt(c.motion, this.time, this.config.floorHeight) - c.motion.from) *
              this.config.floorHeight
            : 0),
        0,
      ),
      energy: this.cars.reduce((a, c) => a + c.energy, 0),
      stops: this.cars.reduce((a, c) => a + c.stopsCount, 0),
      stopsPerPassenger: complete.length
        ? this.cars.reduce((a, c) => a + c.stopsCount, 0) / complete.length
        : 0,
      fairness,
      longWaitRatio: observed.length
        ? observed.filter((w) => w > this.config.longWait).length / observed.length
        : 0,
      transferred: transferred.length,
      directMeanJourney: mean(direct.map((p) => p.completedAt! - p.at)),
      transferMeanJourney: mean(transferred.map((p) => p.completedAt! - p.at)),
      floorQueues,
      floorWaits,
      utilization: this.cars.map((c) =>
        this.time
          ? (c.busyTime + (c.status !== 'idle' && c.status !== 'failed' ? dt : 0)) / this.time
          : 0,
      ),
      occupancy: this.cars.map((c) =>
        this.time ? (c.loadIntegral + dt * c.passengers.length) / this.time / c.spec.capacity : 0,
      ),
      waitSamples: waits,
      queueGrowth,
      supplyMargin: cohort.length ? complete.length / cohort.length - 1 : 0,
    };
  }
  snapshot(): Snapshot {
    return {
      time: this.time,
      done: this.finished,
      algorithm: this.algorithm,
      cars: this.cars.map((c) => ({
        ...structuredClone(c),
        position: c.motion ? positionAt(c.motion, this.time, this.config.floorHeight) : c.position,
      })),
      passengers: structuredClone([...this.people.values()]),
      metrics: this.metrics(),
      series: structuredClone(this.series),
      logs: structuredClone(this.logs),
      events: this.processed,
      demandHash: this.hash,
    };
  }
}

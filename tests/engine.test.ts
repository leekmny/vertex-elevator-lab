import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { travelTime, positionAt } from '../src/sim/physics';
import { generateDemand } from '../src/sim/demand';
import { Simulation } from '../src/sim/engine';
import { ALGORITHMS } from '../src/sim/algorithms';
describe('physics', () => {
  it('uses triangular and trapezoid acceleration', () => {
    expect(travelTime(4, 4, 1)).toBe(4);
    expect(travelTime(20, 4, 1)).toBe(9);
    expect(travelTime(0, 4, 1)).toBe(0);
  });
  it('interpolates continuous acceleration and braking', () => {
    const m = { from: 1, to: 6, start: 0, end: 9, distance: 20, acceleration: 1, speed: 4 };
    expect(positionAt(m, 2, 4)).toBe(1.5);
    expect(positionAt(m, 7, 4)).toBe(5.5);
    expect(positionAt(m, 9, 4)).toBe(6);
  });
});
describe('DES', () => {
  it('matches a hand calculated trip including doors and passenger handling', () => {
    const c = defaultConfig();
    Object.assign(c, { floors: 5, cars: 1, rate: 0, duration: 100, drain: true });
    Object.assign(c.car, {
      speed: 4,
      acceleration: 1,
      doorOpen: 1,
      doorClose: 1,
      boardTime: 1,
      alightTime: 1,
    });
    const s = new Simulation(c, 'fcfs', [{ id: 1, at: 0, origin: 1, destination: 2 }]).run();
    expect(s.metrics.completed).toBe(1);
    expect(s.passengers[0].firstBoardedAt).toBe(2);
    expect(s.passengers[0].completedAt).toBeCloseTo(5 + 2 * Math.sqrt(3.5), 8);
  });
  it.each([1, 2, 3, 4, 8, 12, 20])('conserves passengers for %s cars', (cars) => {
    const c = defaultConfig();
    Object.assign(c, { cars, floors: 5, rate: 0, duration: 60, drain: true, maxDrain: 10000 });
    c.car.capacity = 2;
    const d = Array.from({ length: 25 }, (_, id) => ({
      id,
      at: 0,
      origin: 1 + (id % 5),
      destination: 1 + ((id + 2) % 5),
    }));
    const sim = new Simulation(c, 'look', d);
    let s = sim.snapshot();
    for (let i = 0; i < 10000 && !s.done; i++) {
      s = sim.step();
      expect(s.metrics.generated).toBe(s.metrics.waiting + s.metrics.onboard + s.metrics.completed);
      for (const car of s.cars) {
        expect(car.passengers.length).toBeLessThanOrEqual(2);
        expect(new Set(car.passengers).size).toBe(car.passengers.length);
      }
    }
    expect(s.metrics.completed).toBe(25);
  });
  it.each([5, 20, 50, 100])('reproduces %s floors exactly', (floors) => {
    const c = defaultConfig();
    Object.assign(c, { floors, duration: 100, congestion: 500 });
    expect(generateDemand(c)).toEqual(generateDemand(c));
    expect(new Simulation(c, 'eta').run()).toEqual(new Simulation(c, 'eta').run());
  });
  it('retains overload queues and handles zero demand', () => {
    const c = defaultConfig();
    Object.assign(c, { duration: 60, congestion: 0 });
    expect(new Simulation(c, 'eta').run().metrics.generated).toBe(0);
    Object.assign(c, { congestion: 500, rate: 300, cars: 1, scenario: 'overload' });
    const s = new Simulation(c, 'eta').run();
    expect(s.metrics.unfinished).toBeGreaterThan(0);
    expect(s.metrics.waiting).toBeGreaterThan(0);
    expect(s.metrics.generated).toBe(s.metrics.completed + s.metrics.onboard + s.metrics.waiting);
    expect(s.metrics.oldestWait).toBeGreaterThan(0);
  });
  it.each(['shared', 'parity', 'zoned', 'dynamic'] as const)(
    'provides all OD paths with %s',
    (policy) => {
      const c = defaultConfig();
      Object.assign(c, {
        floors: 5,
        cars: 4,
        rate: 0,
        duration: 20,
        drain: true,
        maxDrain: 20000,
        policy,
      });
      const d = [];
      for (let o = 1; o <= 5; o++)
        for (let z = 1; z <= 5; z++)
          if (o !== z) d.push({ id: d.length, at: 0, origin: o, destination: z });
      const s = new Simulation(c, 'look', d).run();
      expect(s.metrics.completed).toBe(20);
      if (policy === 'parity' || policy === 'zoned')
        expect(s.metrics.transferred).toBeGreaterThan(0);
    },
  );
  it.each(ALGORITHMS.map((a) => a.id))('drains algorithm %s', (id) => {
    const c = defaultConfig();
    Object.assign(c, { floors: 5, cars: 2, rate: 0, duration: 30, drain: true, maxDrain: 10000 });
    const d = Array.from({ length: 15 }, (_, id) => ({
      id,
      at: id,
      origin: 1 + (id % 5),
      destination: 1 + ((id + 2) % 5),
    }));
    const s = new Simulation(c, id, d).run();
    expect(s.metrics.completed).toBe(15);
    expect(s.metrics.waitSamples.every((x) => x >= 0)).toBe(true);
  });
  it('delivers loaded passengers before safe failure retirement', () => {
    const c = defaultConfig();
    Object.assign(c, { floors: 5, cars: 2, rate: 0, duration: 50, drain: true });
    const sim = new Simulation(c, 'eta', [{ id: 1, at: 0, origin: 1, destination: 5 }]);
    sim.advanceTo(6);
    sim.failCar(0);
    const s = sim.run();
    expect(s.metrics.completed).toBe(1);
    expect(s.cars[0].status).toBe('failed');
    expect(s.cars[0].passengers).toHaveLength(0);
  });
  it('is independent of snapshot frequency', () => {
    const c = defaultConfig();
    c.duration = 120;
    const a = new Simulation(c, 'eta'),
      b = new Simulation(c, 'eta');
    for (let t = 0; t <= 120; t += 0.25) a.advanceTo(t);
    expect(a.run()).toEqual(b.run());
  });
});

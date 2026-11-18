import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { Simulation } from '../src/sim/engine';
describe('event boundary equivalence', () => {
  it('preserves future service paths when dynamic boundaries meet heterogeneous floor restrictions', () => {
    const c = defaultConfig();
    Object.assign(c, { floors: 5, cars: 2, rate: 0, duration: 100 });
    c.carOverrides = [
      { serviceFloors: [1, 2, 3], capacity: 1 },
      { serviceFloors: [1, 4, 5], capacity: 1, speed: 0.5 },
    ];
    const demand = [
      ...Array.from({ length: 10 }, (_, id) => ({ id, at: 0, origin: 1, destination: 5 })),
      { id: 99, at: 50, origin: 2, destination: 3 },
    ];
    expect(() => new Simulation(c, 'dynamic', demand).run()).not.toThrow();
    const s = new Simulation(c, 'dynamic', demand).run();
    expect(s.metrics.generated).toBe(11);
    expect(s.metrics.completed + s.metrics.unfinished).toBe(11);
  });
  it('makes SCAN travel physically to the range end while LOOK reverses at its last requested floor', () => {
    const c = defaultConfig();
    Object.assign(c, { floors: 5, cars: 1, rate: 0, duration: 100, drain: true });
    const demand = [
      { id: 1, at: 0, origin: 1, destination: 3 },
      { id: 2, at: 0, origin: 2, destination: 1 },
    ];
    const scan = new Simulation(c, 'scan', demand),
      look = new Simulation(c, 'look', demand);
    const a = scan.advanceTo(13),
      b = look.advanceTo(13);
    expect(a.cars[0].motion?.from).toBe(3);
    expect(a.cars[0].motion?.to).toBe(5);
    expect(a.cars[0].position).toBeGreaterThan(3);
    expect(a.cars[0].position).toBeLessThan(5);
    expect(b.cars[0].motion?.from).toBe(3);
    expect(b.cars[0].motion?.to).toBe(2);
    const endA = scan.run(),
      endB = look.run();
    expect(endA.metrics.completed).toBe(2);
    expect(endB.metrics.completed).toBe(2);
    expect(endA.metrics.distance).toBeGreaterThan(endB.metrics.distance);
  });
  it('processes every event at the exact horizon in step mode just as run does', () => {
    const c = defaultConfig();
    Object.assign(c, { duration: 10, rate: 0, cars: 2 });
    const d = [
      { id: 1, at: 10, origin: 1, destination: 3 },
      { id: 2, at: 10, origin: 1, destination: 5 },
    ];
    const sim = new Simulation(c, 'fcfs', d);
    let s = sim.snapshot();
    for (let i = 0; i < 100 && !s.done; i++) s = sim.step();
    expect(s).toEqual(new Simulation(c, 'fcfs', d).run());
    expect(s.metrics.generated).toBe(2);
  });
  it('ends an empty drained experiment at the exact demand horizon for fractional sample intervals', () => {
    const c = defaultConfig();
    Object.assign(c, { duration: 15, rate: 0, drain: true });
    const run = new Simulation(c, 'eta').run(),
      stepped = new Simulation(c, 'eta');
    let s = stepped.snapshot();
    for (let i = 0; i < 100 && !s.done; i++) s = stepped.step();
    expect(run.time).toBe(15);
    expect(s).toEqual(run);
  });
  it('exposes no call-stack error for 150000 simultaneously waiting passengers', () => {
    const c = defaultConfig();
    Object.assign(c, { duration: 1, rate: 0, cars: 1 });
    // Public demand input and step mode avoid hidden engine-state mutation.
    const d = Array.from({ length: 150000 }, (_, id) => ({ id, at: 0, origin: 1, destination: 2 }));
    const sim = new Simulation(c, 'eta', d);
    // Process arrival events without cloning 150k snapshots after every event.
    expect(() => sim.advanceTo(0)).not.toThrow();
    expect(sim.snapshot().metrics.waiting).toBe(150000);
  }, 30000);
});

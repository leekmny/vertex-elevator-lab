import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { generateDemand } from '../src/sim/demand';
import { Simulation } from '../src/sim/engine';
describe('demand boundary integrity', () => {
  it('passes pickup floors while full and preserves the waiting passenger', () => {
    const c = defaultConfig();
    Object.assign(c, { cars: 1, rate: 0, duration: 100 });
    c.car.capacity = 1;
    const s = new Simulation(c, 'nearest', [
      { id: 1, at: 0, origin: 1, destination: 5 },
      { id: 2, at: 0, origin: 2, destination: 4 },
    ]).advanceTo(4);
    expect(s.cars[0].motion?.to).toBe(5);
    expect(s.metrics.waiting).toBe(1);
    expect(s.cars[0].passengers).toEqual([1]);
  });
  it('exposes the physical door-closing interval before departure', () => {
    const c = defaultConfig();
    Object.assign(c, { cars: 1, rate: 0, duration: 100 });
    Object.assign(c.car, { doorOpen: 1, doorClose: 2, boardTime: 1 });
    const s = new Simulation(c, 'fcfs', [{ id: 3, at: 0, origin: 1, destination: 5 }]).advanceTo(3);
    expect(s.cars[0].status).toBe('closing');
    expect(s.cars[0].position).toBe(1);
  });
  it('keeps explicitly configured floor queues at their actual origin in peak scenarios', () => {
    const c = defaultConfig();
    c.rate = 0;
    c.scenario = 'uppeak';
    c.initialQueues = Array(20).fill(0);
    c.initialQueues[17] = 3;
    const demand = generateDemand(c);
    expect(demand).toHaveLength(3);
    expect(demand.every((p) => p.origin === 18)).toBe(true);
  });
  it('retains demand stranded by complete service-group failure', () => {
    const c = defaultConfig();
    Object.assign(c, {
      cars: 2,
      policy: 'parity',
      rate: 0,
      scenario: 'failure',
      failureAt: 5,
      failureCar: 0,
      duration: 100,
    });
    const s = new Simulation(c, 'eta', [{ id: 99, at: 10, origin: 2, destination: 4 }]).run();
    expect(s.metrics.generated).toBe(1);
    expect(s.metrics.waiting).toBe(1);
    expect(s.metrics.completed).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { Simulation } from '../src/sim/engine';
import type { AlgorithmId, Demand, Snapshot } from '../src/sim/types';

function assertConservation(snapshot: Snapshot) {
  const { generated, waiting, onboard, completed } = snapshot.metrics;
  expect(generated).toBe(waiting + onboard + completed);
  const ids = snapshot.cars.flatMap((car) => car.passengers);
  expect(new Set(ids).size).toBe(ids.length);
  for (const car of snapshot.cars) {
    expect(car.passengers.length).toBeLessThanOrEqual(car.spec.capacity);
    expect(car.position).toBeGreaterThanOrEqual(1);
    expect(car.position).toBeLessThanOrEqual(20);
  }
  for (const passenger of snapshot.passengers) {
    if (passenger.state === 'onboard') expect(ids).toContain(passenger.id);
    if (passenger.state === 'complete')
      expect(passenger.completedAt).toBeGreaterThanOrEqual(passenger.at);
    expect(passenger.wait).toBeGreaterThanOrEqual(0);
  }
}

describe('independent adversarial conservation audit', () => {
  it.each(['nearest', 'scan', 'destination', 'dynamic'] as AlgorithmId[])(
    'preserves identities at every event for %s with heterogeneous cars',
    (algorithm) => {
      const config = defaultConfig();
      Object.assign(config, { cars: 3, rate: 0, duration: 90, drain: true, maxDrain: 5000 });
      config.car.capacity = 2;
      config.carOverrides = [
        { capacity: 1, speed: 1 },
        { capacity: 4, speed: 5 },
        { capacity: 2, acceleration: 0.5 },
      ];
      const demand: Demand[] = Array.from({ length: 36 }, (_, id) => ({
        id: id + 100,
        at: id < 18 ? 0 : 10,
        origin: (id % 20) + 1,
        destination: ((id + 7) % 20) + 1,
      }));
      const simulation = new Simulation(config, algorithm, demand);
      let snapshot = simulation.snapshot();
      for (let events = 0; events < 20000 && !snapshot.done; events++) {
        snapshot = simulation.step();
        assertConservation(snapshot);
      }
      expect(snapshot.done).toBe(true);
      expect(snapshot.metrics.completed).toBe(36);
    },
  );

  it('drains asymmetric odd/even groups without losing transfer passengers', () => {
    const config = defaultConfig();
    Object.assign(config, {
      cars: 4,
      policy: 'parity',
      groupCars: [1, 3],
      rate: 0,
      duration: 30,
      drain: true,
      maxDrain: 10000,
    });
    config.car.capacity = 2;
    const demand = Array.from({ length: 20 }, (_, id) => ({
      id,
      at: 0,
      origin: id % 2 === 0 ? 19 : 20,
      destination: id % 2 === 0 ? 2 : 3,
    }));
    const snapshot = new Simulation(config, 'look', demand).run();
    assertConservation(snapshot);
    expect(snapshot.metrics.completed).toBe(20);
    expect(snapshot.metrics.transferred).toBeGreaterThan(0);
  });

  it('keeps not-yet-arrived demand out of generated passenger counts', () => {
    const config = defaultConfig();
    Object.assign(config, { cars: 1, rate: 0, duration: 100 });
    const simulation = new Simulation(config, 'fcfs', [
      { id: 77, at: 50, origin: 1, destination: 20 },
    ]);
    expect(simulation.advanceTo(49).metrics.generated).toBe(0);
    expect(simulation.advanceTo(50).metrics.generated).toBe(1);
  });
});

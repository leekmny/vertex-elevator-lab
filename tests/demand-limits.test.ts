import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { generateDemand } from '../src/sim/demand';

describe('passenger demand resource limit', () => {
  it('rejects excessive imported initial queues without requiring timed arrivals', () => {
    const c = { ...defaultConfig(), rate: 0, congestion: 0, initialQueues: [300001] };
    expect(() => generateDemand(c)).toThrow(/300,000/);
  });

  it('accepts exactly 300000 initial passengers when no other demand is configured', () => {
    const c = { ...defaultConfig(), rate: 0, congestion: 0, initialQueues: [300000] };
    const demand = generateDemand(c);
    expect(demand).toHaveLength(300000);
    expect(demand[299999]).toMatchObject({ id: 299999, at: 0, origin: 1 });
  });

  it('applies one combined limit to initial queues and simultaneous floor demand', () => {
    const c = {
      ...defaultConfig(),
      floors: 5,
      rate: 0,
      congestion: 10,
      initialQueues: [299998],
      scenario: 'simultaneous' as const,
    };
    expect(() => generateDemand(c)).toThrow(/300,000/);
  });

  it('rejects timed arrivals that would exceed the initial queue budget', () => {
    const c = {
      ...defaultConfig(),
      duration: 1,
      rate: 10000,
      congestion: 100,
      initialQueues: [300000],
    };
    expect(() => generateDemand(c)).toThrow(/300,000/);
  });
});

import { describe, expect, it } from 'vitest';
import { sessionTime } from '../src/workers/session';

describe('comparison session clock', () => {
  it('starts an uninitialized session at zero', () => expect(sessionTime([])).toBe(0));
  it('keeps advancing when the first drained algorithm finished earlier', () => {
    expect(sessionTime([{ time: 60 }, { time: 120 }, { time: 90 }])).toBe(120);
  });
  it('does not depend on the algorithm display order', () => {
    expect(sessionTime([{ time: 120 }, { time: 60 }])).toBe(120);
  });
});

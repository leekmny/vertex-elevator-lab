import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig } from '../src/sim/config';

describe('physical configuration boundaries', () => {
  it('rejects a starting floor outside the building', () => {
    const config = defaultConfig();
    config.car.home = 1000;
    expect(() => validateConfig(config)).toThrow();
  });

  it('rejects per-car service floors outside the building', () => {
    const config = defaultConfig();
    config.carOverrides = [{ serviceFloors: [1, 999] }];
    expect(() => validateConfig(config)).toThrow();
  });

  it('rejects zero service zones instead of producing an unserviceable allocation', () => {
    const config = defaultConfig();
    config.zoneCount = 0;
    config.policy = 'zoned';
    expect(() => validateConfig(config)).toThrow();
  });
});

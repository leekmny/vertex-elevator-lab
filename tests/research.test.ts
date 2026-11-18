import { describe, expect, it } from 'vitest';
import { summarize, rangeValues, csvCell, pairedEstimate } from '../src/research/statistics';

describe('research statistical integrity', () => {
  it('uses sample standard deviation and Student t confidence limits', () => {
    const e = summarize([10, 20, 30]);
    expect(e.mean).toBe(20);
    expect(e.sd).toBe(10);
    expect(e.low).toBeCloseTo(-4.8414, 3);
    expect(e.high).toBeCloseTo(44.8414, 3);
  });
  it('reports uncertainty as unbounded for a single observation', () => {
    const e = summarize([7]);
    expect(e.mean).toBe(7);
    expect(e.low).toBe(-Infinity);
    expect(e.high).toBe(Infinity);
  });
  it('rejects empty and non-finite statistical input', () => {
    expect(() => summarize([])).toThrow();
    expect(() => summarize([NaN])).toThrow();
  });
  it('forms paired differences by seed and refuses mismatched demand histories', () => {
    const a = [
      { seed: 1, demandHash: 'same', value: 30 },
      { seed: 2, demandHash: 'same2', value: 20 },
    ];
    const b = [
      { seed: 2, demandHash: 'same2', value: 15 },
      { seed: 1, demandHash: 'same', value: 20 },
    ];
    expect(pairedEstimate(a, b).mean).toBe(7.5);
    expect(() => pairedEstimate(a, [{ seed: 1, demandHash: 'wrong', value: 20 }])).toThrow();
  });
  it('expands bounded inclusive integer ranges and rejects explosive grids', () => {
    expect(rangeValues(1, 5, 2, 1, 20)).toEqual([1, 3, 5]);
    expect(() => rangeValues(1, 21, 1, 1, 20)).toThrow();
    expect(() => rangeValues(1, 5, 0, 1, 20)).toThrow();
  });
  it('escapes spreadsheet formulas, commas, quotes and line breaks', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('  @SUM(A1)')).toBe('"\'  @SUM(A1)"');
    expect(csvCell('hello,"world"\n')).toBe('"hello,""world""\n"');
    expect(csvCell(12.5)).toBe('12.5');
  });
});

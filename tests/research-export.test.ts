import { it, expect } from 'vitest';
import { resultCsv, resultHtml, serializeResult } from '../src/research/export';
import type { ResearchResult } from '../src/sim/types';
const estimate = { mean: 10, sd: 2, low: 5, high: 15, n: 3 };
const result = {
  createdAt: '2026-11-18',
  elapsedMs: 100,
  cancelled: false,
  minimumCars: null,
  config: { seed: 1, duration: 60, warmup: 0, drain: false, scenario: 'random' },
  plan: { targetWait: 30, seeds: [1, 2, 3], algorithms: ['eta'] },
  rows: [
    {
      floors: 20,
      cars: 2,
      congestion: 100,
      algorithm: 'eta',
      wait: estimate,
      p95: estimate,
      throughput: estimate,
      journey: estimate,
      fairness: estimate,
      energy: estimate,
      unfinished: estimate,
      queueGrowth: estimate,
      supplyMargin: 0,
      bottleneckRelief: 0,
      marginalGain: null,
      meanWait: 10,
      p95Wait: 10,
      meanThroughput: 10,
      runs: [],
    },
  ],
} as unknown as ResearchResult;
it('exports actual estimate limits and unfinished counts in RFC4180 CSV', () => {
  const text = resultCsv(result);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('wait_ci95_low_s');
  expect(text).toContain('unfinished');
  expect(text).toContain('20,2,100,"eta",3,10,2,5,15');
});
it('embeds reproducibility config in escaped self-contained HTML', () => {
  const html = resultHtml({ ...result, createdAt: '<script>alert(1)</script>' });
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('seed');
  expect(html).toContain('미완료');
});
it('preserves unknown confidence limits with explicit null fields and status', () => {
  const clone = structuredClone(result);
  clone.rows[0].wait.low = -Infinity;
  clone.rows[0].wait.high = Infinity;
  clone.rows[0].wait.n = 1;
  const json = JSON.parse(serializeResult(clone));
  expect(json.rows[0].wait.low).toBeNull();
  expect(json.uncertaintyNote).toContain('null');
});

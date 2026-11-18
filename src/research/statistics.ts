import type { Estimate } from '../sim/types';
const T975 = [
  0, 12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157,
  2.228139, 2.200985, 2.178813, 2.160369, 2.144787, 2.13145, 2.119905, 2.109816, 2.100922, 2.093024,
  2.085963, 2.079614, 2.073873, 2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048407, 2.04523,
  2.042272,
];
export function summarize(values: number[]): Estimate {
  if (!values.length || values.some((v) => !Number.isFinite(v)))
    throw new Error('통계 입력은 유한한 관측값을 하나 이상 포함해야 합니다.');
  const n = values.length,
    mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, sd: 0, low: -Infinity, high: Infinity, n };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const df = n - 1,
    z = 1.95996398454,
    t =
      df <= 30
        ? T975[df]
        : z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  const half = (t * sd) / Math.sqrt(n);
  return { mean, sd, low: mean - half, high: mean + half, n };
}
export function rangeValues(
  start: number,
  end: number,
  step: number,
  min: number,
  max: number,
): number[] {
  if (
    ![start, end, step].every(Number.isInteger) ||
    start < min ||
    end > max ||
    end < start ||
    step < 1
  )
    throw new Error(`범위는 ${min}~${max}, 간격은 양의 정수여야 합니다.`);
  return Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => start + i * step);
}
export function csvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = String(value ?? '');
  if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export interface PairedObservation {
  seed: number;
  demandHash: string;
  value: number;
}
export function pairedEstimate(a: PairedObservation[], b: PairedObservation[]): Estimate {
  if (
    a.length !== b.length ||
    new Set(a.map((v) => v.seed)).size !== a.length ||
    new Set(b.map((v) => v.seed)).size !== b.length
  )
    throw new Error('대응 비교에는 동일한 고유 Seed 집합이 필요합니다.');
  const matches = new Map(b.map((v) => [v.seed, v]));
  return summarize(
    a.map((v) => {
      const other = matches.get(v.seed);
      if (!other || other.demandHash !== v.demandHash)
        throw new Error('승객 수요 기록이 일치하지 않아 대응 비교를 할 수 없습니다.');
      return v.value - other.value;
    }),
  );
}

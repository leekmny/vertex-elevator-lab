import type { ResearchResult } from '../sim/types';
import { csvCell } from './statistics';
export function resultCsv(result: ResearchResult): string {
  const header = [
    'floors',
    'cars',
    'congestion_pct',
    'algorithm',
    'repetitions',
    'mean_wait_s',
    'wait_sd_s',
    'wait_ci95_low_s',
    'wait_ci95_high_s',
    'p95_wait_s',
    'throughput_per_min',
    'mean_journey_s',
    'floor_inequality',
    'estimated_energy_kWh',
    'unfinished',
    'queue_growth_per_min',
    'supply_margin',
    'bottleneck_relief',
    'marginal_wait_improvement_s',
    'seeds',
    'duration_s',
    'warmup_s',
    'drain',
    'scenario',
  ];
  const rows = result.rows.map((r) => [
    r.floors,
    r.cars,
    r.congestion,
    r.algorithm,
    r.wait.n,
    r.wait.mean,
    r.wait.sd,
    r.wait.low,
    r.wait.high,
    r.p95.mean,
    r.throughput.mean,
    r.journey.mean,
    r.fairness.mean,
    r.energy.mean,
    r.unfinished.mean,
    r.queueGrowth.mean,
    r.supplyMargin,
    r.bottleneckRelief,
    r.marginalGain,
    result.plan.seeds.join(';'),
    result.config.duration,
    result.config.warmup,
    result.config.drain,
    result.config.scenario,
  ]);
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function serializeResult(result: ResearchResult): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      uncertaintyNote:
        'n<2인 신뢰구간 및 유한하지 않은 수치는 null입니다. 추정 불가를 0으로 해석하지 마세요.',
      ...result,
    },
    (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v),
    2,
  );
}
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const number = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '추정 불가');
export function resultHtml(result: ResearchResult): string {
  const rows = result.rows
    .map(
      (r) =>
        `<tr><td>${r.floors}</td><td>${r.cars}</td><td>${r.congestion}%</td><td>${escape(r.algorithm)}</td><td>${r.wait.n}</td><td>${number(r.wait.mean)}</td><td>[${number(r.wait.low)}, ${number(r.wait.high)}]</td><td>${number(r.p95.mean)}</td><td>${number(r.throughput.mean)}</td><td>${number(r.unfinished.mean)}</td><td>${number(r.energy.mean)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>VERTEX 연구 보고서</title><style>body{font:15px system-ui,sans-serif;margin:40px auto;max-width:1200px;padding:20px;color:#203145}h1{letter-spacing:-1px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{text-align:right;padding:10px;border-bottom:1px solid #ddd}th{background:#edf2f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:20px}p{line-height:1.7}.note{padding:16px;background:#edf8f3}</style><h1>VERTEX · 승강기 군관리 연구 보고서</h1><p>생성: ${escape(result.createdAt)} · 실제 계산 ${number(result.elapsedMs)} ms · ${result.cancelled ? '중단된 부분 결과' : '완료된 실험'}</p><p class="note">결과는 설정된 물리·수요 모델의 추정치입니다. 신뢰구간은 독립 Seed 반복 평균의 Student t 95% 구간이며, 반복 1회는 불확실성을 추정할 수 없습니다. 완료/탑승 승객의 대기 통계와 미완료 승객을 함께 검토하세요. 에너지는 단순화된 모델의 추정값입니다.</p><table><thead><tr><th>층</th><th>차량</th><th>혼잡도</th><th>알고리즘</th><th>반복</th><th>대기(초)</th><th>평균 95% CI</th><th>P95(초)</th><th>처리/분</th><th>미완료</th><th>추정 kWh</th></tr></thead><tbody>${rows}</tbody></table><h2>재현 가능한 설정 및 전체 결과</h2><pre>${escape(serializeResult(result))}</pre></html>`;
}
export function downloadFile(name: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

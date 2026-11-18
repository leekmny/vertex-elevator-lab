import { useEffect, useRef, useState } from 'react';
import { BarChart3, Play, Trophy } from 'lucide-react';
import type { Config, ResearchResult, ResearchRow } from '../sim/types';
import { ALGORITHMS } from '../sim/algorithms';
import { SIMPLE_ALGORITHM_NAMES } from './SimpleExplanation';
import './simple-comparison.css';
export default function SimpleComparison({ config }: { config: Config }) {
  const [result, setResult] = useState<ResearchResult>(),
    [working, setWorking] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [metric, setMetric] = useState<'wait' | 'p95' | 'throughput' | 'journey'>('wait');
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    worker.current?.terminate();
    setWorking(false);
    setResult(undefined);
    setError('');
    return () => worker.current?.terminate();
  }, [config]);
  function run() {
    worker.current?.terminate();
    const w = new Worker(new URL('../workers/research.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = w;
    setWorking(true);
    setProgress(0);
    setError('');
    w.onmessage = ({ data }) => {
      if (data.type === 'progress')
        setProgress(Math.round((data.progress.completed / data.progress.total) * 100));
      if (data.type === 'result') {
        setResult(data.result);
        setWorking(false);
      }
      if (data.type === 'error') {
        setError(data.message);
        setWorking(false);
      }
    };
    w.onerror = (e) => {
      setError(e.message);
      setWorking(false);
    };
    w.postMessage({
      type: 'start',
      config,
      plan: {
        floorValues: [config.floors],
        carValues: [config.cars],
        congestionValues: [config.congestion],
        algorithms: ALGORITHMS.map((a) => a.id),
        seeds: [config.seed >>> 0, (config.seed + 9973) >>> 0, (config.seed + 19946) >>> 0],
        targetWait: 30,
        metric:
          metric === 'throughput'
            ? 'throughput'
            : metric === 'p95'
              ? 'p95Wait'
              : metric === 'journey'
                ? 'meanJourney'
                : 'meanWait',
      },
    });
  }
  const sampledRuns = (r: ResearchRow) =>
    r.runs.filter(
      (run) =>
        metric === 'throughput' ||
        (metric === 'journey' ? run.metrics.completed > 0 : run.metrics.waitSamples.length > 0),
    ).length;
  const observed = (r: ResearchRow) => r.runs.length > 0 && sampledRuns(r) === r.runs.length;
  const key = metric,
    rows =
      result?.rows
        .slice()
        .sort(
          (a, b) =>
            Number(observed(b)) - Number(observed(a)) ||
            (metric === 'throughput' ? b[key].mean - a[key].mean : a[key].mean - b[key].mean),
        ) ?? [];
  const hall = rows.filter((r) => r.algorithm !== 'destination' && observed(r));
  const best = hall[0];
  const metricName = {
    wait: '평균 기다린 시간',
    p95: '길게 기다린 사람의 시간',
    throughput: '1분 동안 도착한 사람',
    journey: '목적지까지 걸린 시간',
  }[metric];
  return (
    <section className="simple-comparison">
      <div className="simple-comparison-heading">
        <div>
          <h2>
            <BarChart3 size={20} />
            어떤 알고리즘이 빠를까요?
          </h2>
          <p>같은 건물과 같은 승객으로 14가지 방법을 각각 3번 계산해요.</p>
        </div>
        <button disabled={working} onClick={run}>
          <Play size={15} />
          {working ? `계산 중 ${progress}%` : '알고리즘 비교'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {working && <progress aria-label="알고리즘 비교 진행률" max="100" value={progress} />}
      {result && (
        <div className="simple-comparison-results">
          <div className="simple-ranking-heading">
            <label>
              무엇으로 비교할까요?
              <select
                aria-label="비교 기준"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
              >
                <option value="wait">평균 기다린 시간 · 짧을수록 좋음</option>
                <option value="p95">오래 기다린 시간(P95) · 짧을수록 좋음</option>
                <option value="throughput">도착한 사람 수 · 많을수록 좋음</option>
                <option value="journey">전체 이동 시간 · 짧을수록 좋음</option>
              </select>
            </label>
            {best && (
              <div className="simple-winner">
                <Trophy size={19} />
                <span>
                  일반 호출에서 이번 관측의 {metricName} 1위
                  <br />
                  <b>{SIMPLE_ALGORITHM_NAMES[best.algorithm]}</b>
                </span>
              </div>
            )}
          </div>
          <p className="simple-result-note">
            평균만 낮아도, 못 탄 사람이 많다면 좋은 결과가 아닐 수 있어요. 남은 사람과 반복별 차이도
            함께 보세요. 시간 지표는 모든 반복에 관측값이 있을 때만 순위를 매겨요. 목적지를 미리
            아는 방식은 별도로 표시해요.
          </p>
          <div className="simple-score-table">
            <table aria-label="간단 알고리즘 비교 결과">
              <thead>
                <tr>
                  <th>운행 방법</th>
                  <th>{metricName}</th>
                  <th>평균 도착한 사람/분</th>
                  <th>아직 도착 못한 사람</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.algorithm}
                    className={r.algorithm === best?.algorithm ? 'simple-best' : ''}
                  >
                    <td>
                      {SIMPLE_ALGORITHM_NAMES[r.algorithm]}
                      {r.algorithm === 'destination' && <small>목적지 사전 입력</small>}
                    </td>
                    <td>
                      {observed(r)
                        ? `${r[key].mean.toFixed(1)} ${metric === 'throughput' ? '명/분' : '초'}`
                        : sampledRuns(r) > 0
                          ? `관측 부족 (${sampledRuns(r)}/${r.runs.length}회)`
                          : '관측 표본 없음'}
                      <small>
                        {observed(r) ? `반복 차이(표준편차) ±${r[key].sd.toFixed(1)}` : ''}
                      </small>
                    </td>
                    <td>{r.throughput.mean.toFixed(1)}명</td>
                    <td>{r.unfinished.mean.toFixed(1)}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="simple-result-note">
            초기 설정부터 {config.duration}초 동안의 결과예요. 실시간으로 추가한 호출은 이 비교에
            포함하지 않아요. 3회 관측의 순위이며 통계적 우월성을 확정하지 않습니다. 상세 신뢰구간은
            고급 연구에서 확인할 수 있어요.
          </p>
        </div>
      )}
    </section>
  );
}

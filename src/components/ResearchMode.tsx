import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlaskConical,
  Play,
  Square,
  Download,
  CheckCircle2,
  Info,
  ChartNoAxesCombined,
  RefreshCw,
} from 'lucide-react';
import type { EChartsType, EChartsCoreOption } from 'echarts/core';
import type {
  AlgorithmId,
  Config,
  ExperimentPlan,
  Metrics,
  ResearchResult,
  ResearchRow,
} from '../sim/types';
import { ALGORITHMS } from '../sim/algorithms';
import { rangeValues } from '../research/statistics';
import { pairedDifference, validatePlan, type Progress } from '../research/runner';
import { saturationObservation } from '../research/analysis';
import { downloadFile, resultCsv, resultHtml, serializeResult } from '../research/export';
import Chart from './Chart';
import './research.css';

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const label = (id: AlgorithmId) => ALGORITHMS.find((a) => a.id === id)?.short ?? id;
const METRICS: { value: keyof Metrics; label: string; higher?: boolean }[] = [
  { value: 'meanWait', label: '평균 대기시간' },
  { value: 'p95Wait', label: 'P95 대기시간' },
  { value: 'meanJourney', label: '전체 이동시간' },
  { value: 'throughput', label: '분당 처리량', higher: true },
  { value: 'fairness', label: '층별 서비스 불균형' },
  { value: 'energy', label: '추정 에너지' },
  { value: 'unfinished', label: '미완료 승객' },
];
const rowValue = (r: ResearchRow, m: keyof Metrics) =>
  r.runs.reduce((s, v) => s + Number(v.metrics[m]), 0) / r.runs.length;
export default function ResearchMode({
  config,
  language = 'ko',
}: {
  config: Config;
  language?: 'ko' | 'en';
}) {
  const english = language === 'en';
  const [floorMin, setFloorMin] = useState(config.floors),
    [floorMax, setFloorMax] = useState(config.floors),
    [floorStep, setFloorStep] = useState(10);
  const [carMin, setCarMin] = useState(1),
    [carMax, setCarMax] = useState(Math.max(6, config.cars)),
    [carStep, setCarStep] = useState(1);
  const [congestionMin, setCongestionMin] = useState(config.congestion),
    [congestionMax, setCongestionMax] = useState(config.congestion),
    [congestionStep, setCongestionStep] = useState(50);
  const [repetitions, setRepetitions] = useState(3),
    [seedsText, setSeedsText] = useState(''),
    [duration, setDuration] = useState(config.duration),
    [warmup, setWarmup] = useState(config.warmup),
    [drain, setDrain] = useState(config.drain),
    [target, setTarget] = useState(30);
  const [algorithms, setAlgorithms] = useState<AlgorithmId[]>([
      'eta',
      'look',
      'destination',
      'multi',
    ]),
    [metric, setMetric] = useState<keyof Metrics>('meanWait');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [result, setResult] = useState<ResearchResult | null>(null),
    [error, setError] = useState('');
  const [plot, setPlot] = useState('wait'),
    [plotAlgorithm, setPlotAlgorithm] = useState<AlgorithmId>('eta'),
    [plotFloor, setPlotFloor] = useState(config.floors),
    [plotCongestion, setPlotCongestion] = useState(config.congestion),
    [pairA, setPairA] = useState<AlgorithmId>('eta'),
    [pairB, setPairB] = useState<AlgorithmId>('look');
  const worker = useRef<Worker | null>(null),
    chart = useRef<EChartsType | null>(null);
  useEffect(() => {
    const w = new Worker(new URL('../workers/research.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') setProgress(data.progress);
      if (data.type === 'error') {
        setError(data.message);
        setBusy(false);
      }
      if (data.type === 'result') {
        setResult(data.result);
        setBusy(false);
        setPlotFloor(data.result.plan.floorValues[0]);
        setPlotCongestion(data.result.plan.congestionValues[0]);
        setPlotAlgorithm(data.result.plan.algorithms[0]);
        setPairA(data.result.plan.algorithms[0]);
        setPairB(data.result.plan.algorithms[1] ?? data.result.plan.algorithms[0]);
      }
    };
    w.onerror = (e) => {
      setError(e.message || '연구 Worker 실행 오류');
      setBusy(false);
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  function createPlan(): ExperimentPlan {
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100)
      throw new Error('반복 횟수는 1~100입니다');
    const seeds = seedsText.trim()
      ? seedsText
          .trim()
          .split(/[\s,;]+/)
          .map(Number)
      : Array.from({ length: repetitions }, (_, i) => (config.seed + i * 9973) >>> 0);
    const p: ExperimentPlan = {
      floorValues: rangeValues(floorMin, floorMax, floorStep, 5, 100),
      carValues: rangeValues(carMin, carMax, carStep, 1, 20),
      congestionValues: rangeValues(congestionMin, congestionMax, congestionStep, 0, 500),
      algorithms,
      seeds,
      targetWait: target,
      metric,
    };
    validatePlan(p);
    return p;
  }
  const planned = useMemo(() => {
    try {
      return validatePlan(createPlan());
    } catch {
      return null;
    }
  }, [
    floorMin,
    floorMax,
    floorStep,
    carMin,
    carMax,
    carStep,
    congestionMin,
    congestionMax,
    congestionStep,
    repetitions,
    seedsText,
    algorithms,
    target,
    metric,
    config.seed,
  ]);
  function start() {
    try {
      const plan = createPlan();
      setError('');
      setProgress(null);
      setBusy(true);
      worker.current?.postMessage({
        type: 'start',
        config: { ...config, duration, warmup, drain },
        plan,
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  const ranked = useMemo(
    () =>
      result
        ? [...result.rows].sort(
            (a, b) =>
              (rowValue(a, metric) - rowValue(b, metric)) *
              (METRICS.find((v) => v.value === metric)?.higher ? -1 : 1),
          )
        : [],
    [result, metric],
  );
  const pair = useMemo(() => {
    if (!result) return null;
    const a = result.rows.find(
      (r) => r.floors === plotFloor && r.congestion === plotCongestion && r.algorithm === pairA,
    );
    const b = result.rows.find(
      (r) =>
        r.floors === plotFloor &&
        r.congestion === plotCongestion &&
        r.cars === a?.cars &&
        r.algorithm === pairB,
    );
    if (!a || !b) return null;
    try {
      return { estimate: pairedDifference(a, b, metric), cars: a.cars };
    } catch {
      return null;
    }
  }, [result, pairA, pairB, plotFloor, plotCongestion, metric]);
  const option = useMemo<EChartsCoreOption>(() => {
    if (!result) return {};
    const rows = result.rows.filter(
      (r) => r.floors === plotFloor && r.congestion === plotCongestion,
    );
    const common = {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#91a2b7' } },
      grid: { top: 26, left: 58, right: 25, bottom: 60 },
      xAxis: {
        type: 'value',
        name: '차량 수',
        minInterval: 1,
        axisLine: { lineStyle: { color: '#344356' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#223043' } },
      },
    };
    if (plot === 'heatmap') {
      const cells = result.rows.filter(
          (r) => r.floors === plotFloor && r.algorithm === plotAlgorithm,
        ),
        xs = [...new Set(cells.map((r) => r.cars))].sort((a, b) => a - b),
        ys = [...new Set(cells.map((r) => r.congestion))].sort((a, b) => a - b);
      return {
        ...common,
        tooltip: {
          position: 'top',
          formatter: (p: { value: number[] }) =>
            `${xs[p.value[0]]}대 / ${ys[p.value[1]]}%<br/>평균 대기 ${fmt(p.value[2])}s`,
        },
        legend: undefined,
        grid: { top: 20, left: 70, right: 30, bottom: 78 },
        xAxis: { type: 'category', name: '차량', data: xs },
        yAxis: { type: 'category', name: '혼잡도 %', data: ys },
        visualMap: {
          min: 0,
          max: Math.max(1, ...cells.map((r) => r.wait.mean)),
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          textStyle: { color: '#95a7b8' },
          inRange: { color: ['#163e3a', '#33bca0', '#d4b866', '#e88366'] },
        },
        series: [
          {
            type: 'heatmap',
            data: cells.map((r) => [xs.indexOf(r.cars), ys.indexOf(r.congestion), r.wait.mean]),
            label: {
              show: cells.length < 70,
              formatter: (p: { value: number[] }) => fmt(p.value[2], 0),
              color: '#e6f0f2',
            },
          },
        ],
      };
    }
    if (plot === 'saturation')
      return {
        ...common,
        xAxis: { ...common.xAxis, name: '혼잡도 %' },
        yAxis: { ...common.yAxis, name: '잔여 대기열 증가 / 분' },
        series: result.plan.algorithms.map((algorithm) => ({
          type: 'line',
          name: label(algorithm),
          smooth: false,
          data: result.rows
            .filter(
              (r) =>
                r.floors === plotFloor &&
                r.cars === Math.max(...result.plan.carValues) &&
                r.algorithm === algorithm,
            )
            .sort((a, b) => a.congestion - b.congestion)
            .map((r) => [r.congestion, r.queueGrowth.mean]),
        })),
      };
    if (plot === 'distribution') {
      const bins = Array.from({ length: 16 }, (_, i) => i * 30);
      return {
        ...common,
        xAxis: {
          type: 'category',
          data: bins.map((b, i) => (i === 15 ? '450+' : `${b}–${b + 30}`)),
          axisLabel: { rotate: 30 },
          name: '대기 초',
        },
        yAxis: { ...common.yAxis, name: '관측 승객 수' },
        series: result.plan.algorithms.map((algorithm) => {
          const samples = rows
            .filter(
              (r) => r.algorithm === algorithm && r.cars === Math.max(...result.plan.carValues),
            )
            .flatMap((r) => r.runs.flatMap((run) => run.metrics.waitSamples));
          return {
            type: 'bar',
            name: label(algorithm),
            data: bins.map(
              (b, i) => samples.filter((s) => s >= b && (i === 15 || s < b + 30)).length,
            ),
          };
        }),
      };
    }
    const prop =
      plot === 'throughput'
        ? 'throughput'
        : plot === 'p95'
          ? 'p95'
          : plot === 'energy'
            ? 'energy'
            : 'wait';
    return {
      ...common,
      yAxis: {
        ...common.yAxis,
        name: plot === 'throughput' ? '완료 명 / 분' : plot === 'energy' ? '추정 kWh' : '대기 초',
      },
      series: result.plan.algorithms.map((algorithm) => ({
        name: label(algorithm),
        type: 'line',
        showSymbol: true,
        symbolSize: 7,
        smooth: false,
        data: rows
          .filter((r) => r.algorithm === algorithm)
          .sort((a, b) => a.cars - b.cars)
          .map((r) => [r.cars, r[prop].mean]),
      })),
    };
  }, [result, plot, plotFloor, plotCongestion, plotAlgorithm]);
  function png() {
    if (!chart.current) return;
    const a = document.createElement('a');
    a.download = `vertex-${plot}.png`;
    a.href = chart.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#101923' });
    a.click();
  }
  return (
    <div className="research-mode">
      <div className="research-intro">
        <div>
          <div className="section-label">
            <FlaskConical size={13} /> EXPERIMENT WORKBENCH
          </div>
          <h2>{english ? 'Measure. Repeat. Compare.' : '측정하고, 반복하고, 비교하세요.'}</h2>
          <p className="muted">
            동일 Seed·승객 수요를 재사용하는 대응 실험. 렌더링 없이 별도 Worker에서 실제 사건을
            계산합니다.
          </p>
        </div>
        <span className="research-precision">
          <CheckCircle2 size={15} /> DETERMINISTIC · PAIRED SEEDS
        </span>
      </div>
      <div className="research-layout">
        <section className="panel research-setup">
          <div className="research-panel-title">
            <span className="section-label">01 / 실험 조건</span>
            <span className="badge">
              {planned === null ? '범위 확인' : `${planned.toLocaleString()} RUNS`}
            </span>
          </div>
          <div className="research-ranges">
            <span>변수</span>
            <span>시작</span>
            <span>끝</span>
            <span>간격</span>
            <label>건물 층수</label>
            <input
              type="number"
              aria-label="연구 최소 층수"
              min={5}
              max={100}
              value={floorMin}
              onChange={(e) => setFloorMin(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 최대 층수"
              min={5}
              max={100}
              value={floorMax}
              onChange={(e) => setFloorMax(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 층수 간격"
              min={1}
              max={95}
              value={floorStep}
              onChange={(e) => setFloorStep(+e.target.value)}
            />
            <label>차량 수</label>
            <input
              type="number"
              aria-label="연구 최소 차량"
              min={1}
              max={20}
              value={carMin}
              onChange={(e) => setCarMin(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 최대 차량"
              min={1}
              max={20}
              value={carMax}
              onChange={(e) => setCarMax(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 차량 간격"
              min={1}
              max={19}
              value={carStep}
              onChange={(e) => setCarStep(+e.target.value)}
            />
            <label>혼잡도 %</label>
            <input
              type="number"
              aria-label="연구 최소 혼잡도"
              min={0}
              max={500}
              value={congestionMin}
              onChange={(e) => setCongestionMin(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 최대 혼잡도"
              min={0}
              max={500}
              value={congestionMax}
              onChange={(e) => setCongestionMax(+e.target.value)}
            />
            <input
              type="number"
              aria-label="연구 혼잡도 간격"
              min={1}
              max={500}
              value={congestionStep}
              onChange={(e) => setCongestionStep(+e.target.value)}
            />
          </div>
          <div className="research-fields">
            <label>
              반복 횟수
              <input
                type="number"
                aria-label="연구 반복 횟수"
                min={1}
                max={100}
                value={repetitions}
                onChange={(e) => setRepetitions(+e.target.value)}
              />
            </label>
            <label>
              실험 시간 (초)
              <input
                type="number"
                aria-label="연구 실험 시간"
                min={1}
                max={86400}
                value={duration}
                onChange={(e) => setDuration(+e.target.value)}
              />
            </label>
            <label>
              안정화 구간 (초)
              <input
                type="number"
                aria-label="연구 안정화 구간"
                min={0}
                max={duration - 1}
                value={warmup}
                onChange={(e) => setWarmup(+e.target.value)}
              />
            </label>
            <label>
              목표 평균 대기 (초)
              <input
                type="number"
                aria-label="목표 대기시간"
                min={0}
                value={target}
                onChange={(e) => setTarget(+e.target.value)}
              />
            </label>
          </div>
          <label className="research-check">
            <input type="checkbox" checked={drain} onChange={(e) => setDrain(e.target.checked)} />{' '}
            Drain · 발생 종료 후 잔여 승객 처리
          </label>
          <details className="research-seeds">
            <summary>Seed 목록 직접 입력</summary>
            <textarea
              aria-label="연구 Seed 목록"
              value={seedsText}
              onChange={(e) => setSeedsText(e.target.value)}
              placeholder={`${config.seed}, ${config.seed + 9973}, …`}
            />
            <p>
              비워 두면 기준 Seed + 9973 × 반복 번호. 직접 입력하면 목록 길이가 반복 횟수입니다.
            </p>
          </details>
          <div className="research-subtitle">
            배차 알고리즘 <span>{algorithms.length}개 선택</span>
          </div>
          <div className="research-algorithms">
            {ALGORITHMS.map((a) => (
              <label
                key={a.id}
                title={a.description}
                className={algorithms.includes(a.id) ? 'selected' : ''}
              >
                <input
                  type="checkbox"
                  checked={algorithms.includes(a.id)}
                  onChange={(e) =>
                    setAlgorithms((v) =>
                      e.target.checked ? [...v, a.id] : v.filter((id) => id !== a.id),
                    )
                  }
                />
                <span>{a.short}</span>
                {a.information === 'destination' && <small>목적지</small>}
              </label>
            ))}
          </div>
          <p className="research-note">
            <Info size={13} /> 목적지 사전 입력 방식은 홀 호출 방식과 정보량이 다릅니다. 직접 비교는
            해당 차이를 전제로 해석하세요.
          </p>
          <div className="research-run">
            <button className="primary" disabled={busy || !planned} onClick={start}>
              <Play size={14} />
              {english ? 'Run experiments' : '자동 실험 시작'}
            </button>
            {busy && (
              <button
                className="secondary"
                onClick={() => worker.current?.postMessage({ type: 'cancel' })}
              >
                <Square size={13} />
                중단
              </button>
            )}
          </div>
          {busy && (
            <div className="research-progress">
              <div>
                <span>{progress ? `${progress.completed} / ${progress.total}` : '준비 중'}</span>
                <span>
                  {progress
                    ? `${progress.floors}F · ${progress.cars}대 · ${progress.congestion}% · ${label(progress.algorithm)}`
                    : '별도 Worker에 실행 요청'}
                </span>
              </div>
              <progress value={progress?.completed ?? 0} max={progress?.total ?? planned ?? 1} />
              <small>중단은 현재 실행 완료 후 적용됩니다.</small>
            </div>
          )}
          {error && (
            <p className="research-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <div className="research-results">
          {!result ? (
            <section className="panel research-empty">
              <div className="research-empty-icon">
                <ChartNoAxesCombined size={36} />
              </div>
              <span className="section-label">YOUR NEXT FINDING STARTS HERE</span>
              <h3>
                차량 한 대를 늘리면
                <br />
                대기시간은 얼마나 줄어들까요?
              </h3>
              <p>
                좌측에서 실험 범위를 정하고 실행하세요.
                <br />
                반복 평균, 95% 신뢰구간과 미완료 승객을 함께 확인합니다.
              </p>
              <div className="research-empty-flow">
                <span>동일 수요</span>
                <span>→</span>
                <span>반복 계산</span>
                <span>→</span>
                <span>대응 비교</span>
              </div>
            </section>
          ) : (
            <>
              <div className="research-summary">
                <div className="panel">
                  <small>계산한 실행</small>
                  <strong>
                    {result.rows.reduce((n, r) => n + r.runs.length, 0)}
                    <em> runs</em>
                  </strong>
                  <span>
                    {fmt(result.elapsedMs / 1000, 2)}초 ·{' '}
                    {result.cancelled ? '중단된 부분 결과' : '계산 완료'}
                  </span>
                </div>
                <div className="panel">
                  <small>목표 충족 최소 관측 대수</small>
                  <strong>
                    {result.minimumCars ?? '—'}
                    <em>{result.minimumCars ? ' 대' : ' 조건 없음'}</em>
                  </strong>
                  <span>평균 95% CI 상한 ≤ {result.plan.targetWait}s · 미완료 0</span>
                </div>
                <div className="panel">
                  <small>독립 Seed</small>
                  <strong>
                    {result.plan.seeds.length}
                    <em> seeds</em>
                  </strong>
                  <span>n=1에서는 신뢰구간을 추정하지 않습니다</span>
                </div>
              </div>
              <section className="panel research-chart-panel">
                <div className="research-panel-title">
                  <span className="section-label">02 / 성능 곡선</span>
                  <button className="research-icon-button" title="그래프 PNG 저장" onClick={png}>
                    <Download size={14} /> PNG
                  </button>
                </div>
                <div className="research-plot-controls">
                  <select
                    aria-label="연구 그래프"
                    value={plot}
                    onChange={(e) => setPlot(e.target.value)}
                  >
                    <option value="wait">차량 수 · 평균 대기시간</option>
                    <option value="p95">차량 수 · P95 대기시간</option>
                    <option value="throughput">차량 수 · 처리량</option>
                    <option value="energy">차량 수 · 추정 에너지</option>
                    <option value="heatmap">혼잡도 × 차량 성능 히트맵</option>
                    <option value="saturation">포화 임계점 · 대기열 증가</option>
                    <option value="distribution">알고리즘별 지연 분포</option>
                  </select>
                  <select
                    aria-label="그래프 층수"
                    value={plotFloor}
                    onChange={(e) => setPlotFloor(+e.target.value)}
                  >
                    {result.plan.floorValues.map((n) => (
                      <option key={n} value={n}>
                        {n}층
                      </option>
                    ))}
                  </select>
                  {plot === 'heatmap' ? (
                    <select
                      aria-label="히트맵 알고리즘"
                      value={plotAlgorithm}
                      onChange={(e) => setPlotAlgorithm(e.target.value as AlgorithmId)}
                    >
                      {result.plan.algorithms.map((id) => (
                        <option key={id} value={id}>
                          {label(id)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      aria-label="그래프 혼잡도"
                      value={plotCongestion}
                      onChange={(e) => setPlotCongestion(+e.target.value)}
                    >
                      {result.plan.congestionValues.map((n) => (
                        <option key={n} value={n}>
                          {n}%
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <Chart
                  option={option}
                  height={300}
                  onReady={(c) => {
                    chart.current = c;
                  }}
                />
                {plot === 'saturation' && (
                  <div className="research-capacity">
                    {result.plan.algorithms.map((id) => {
                      const observed = saturationObservation(
                        result.rows,
                        plotFloor,
                        Math.max(...result.plan.carValues),
                        id,
                      );
                      return (
                        <div key={id}>
                          <b>{label(id)}</b>
                          <strong>
                            {fmt(observed.maxObservedThroughput ?? NaN)}
                            <small> 명/분</small>
                          </strong>
                          <span>최대 관측 처리량</span>
                          <p>
                            {observed.points < 2
                              ? '혼잡도 2개 이상을 시험하면 증가 구간을 탐색합니다.'
                              : observed.firstConfidentGrowthPercent === null
                                ? '현 범위에서 대기열 증가의 CI 하한 > 0 관측 없음'
                                : `${observed.firstConfidentGrowthPercent}%에서 대기열 증가 관측 (95% CI 하한 > 0)`}
                          </p>
                          {observed.thresholdBracket && (
                            <small>
                              관측 구간 {observed.thresholdBracket[0]}–
                              {observed.thresholdBracket[1]}%
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="research-caption">
                  {plot === 'saturation'
                    ? `최대 시험 차량 ${Math.max(...result.plan.carValues)}대의 잔여 대기열 증가율. 유한 시간 관측치이며, 지속 처리 용량의 확정값이 아닙니다.`
                    : '점은 Seed 반복 평균입니다. 신뢰구간과 미완료 승객은 아래 표에서 함께 확인하세요.'}
                </p>
              </section>
              <section className="panel research-paired">
                <div className="research-panel-title">
                  <span className="section-label">03 / 대응 차이 · A − B</span>
                  <span className="badge">95% STUDENT t CI</span>
                </div>
                <div className="research-pair-controls">
                  <select
                    aria-label="대응 비교 A"
                    value={pairA}
                    onChange={(e) => setPairA(e.target.value as AlgorithmId)}
                  >
                    {result.plan.algorithms.map((id) => (
                      <option key={id} value={id}>
                        {label(id)}
                      </option>
                    ))}
                  </select>
                  <span>−</span>
                  <select
                    aria-label="대응 비교 B"
                    value={pairB}
                    onChange={(e) => setPairB(e.target.value as AlgorithmId)}
                  >
                    {result.plan.algorithms.map((id) => (
                      <option key={id} value={id}>
                        {label(id)}
                      </option>
                    ))}
                  </select>
                  <span className="mono">
                    {pair
                      ? `${fmt(pair.estimate.mean)} [${fmt(pair.estimate.low)}, ${fmt(pair.estimate.high)}]`
                      : '동일 조건 없음'}
                  </span>
                </div>
                <p className="research-caption">
                  {plotFloor}층 · {pair?.cars ?? '—'}대 · {plotCongestion}% · 선택한 순위 지표 기준.
                  구간에 0이 포함되면 이 표본에서 차이의 방향을 확정할 수 없습니다. 다중 비교 보정은
                  적용하지 않았습니다.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
      {result && (
        <section className="panel research-table-panel">
          <div className="research-panel-title">
            <div>
              <span className="section-label">04 / 전체 관측 결과</span>
              <p className="research-caption">
                순위는 선택 지표의 수치 정렬입니다. 서로 다른 건물·수요 조건 간 우열을 의미하지
                않습니다.
              </p>
            </div>
            <div className="research-exports">
              <button
                className="secondary"
                onClick={() => downloadFile('vertex-results.csv', resultCsv(result), 'text/csv')}
              >
                <Download size={13} />
                CSV
              </button>
              <button
                className="secondary"
                onClick={() => downloadFile('vertex-results.json', serializeResult(result))}
              >
                JSON
              </button>
              <button
                className="secondary"
                onClick={() => downloadFile('vertex-report.html', resultHtml(result), 'text/html')}
              >
                HTML 보고서
              </button>
            </div>
          </div>
          <div className="research-table-toolbar">
            <label>
              정렬 지표{' '}
              <select
                aria-label="결과 순위 지표"
                value={metric}
                onChange={(e) => setMetric(e.target.value as keyof Metrics)}
              >
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">에너지: 단순화된 물리 모델의 추정치</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>조건</th>
                  <th>알고리즘</th>
                  <th>n</th>
                  <th>평균 대기 ± SD</th>
                  <th>평균 95% CI</th>
                  <th>P95 대기</th>
                  <th>완료 / 분</th>
                  <th>미완료</th>
                  <th>한계 개선 / 대</th>
                  <th>병목 해소율</th>
                  <th title="관측 완료/발생 비율−1 · 가용 용량 추정 아님">관측 완료율 차이</th>
                  <th>추정 kWh</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={`${r.floors}-${r.cars}-${r.congestion}-${r.algorithm}`}>
                    <td className="mono muted">{String(i + 1).padStart(2, '0')}</td>
                    <td className="mono">
                      {r.floors}F · {r.cars}대 · {r.congestion}%
                    </td>
                    <td>
                      {label(r.algorithm)}
                      {r.algorithm === 'destination' && (
                        <small className="research-destination-tag">목적지</small>
                      )}
                    </td>
                    <td>{r.wait.n}</td>
                    <td className="mono research-highlight">
                      {fmt(r.wait.mean)} <span className="muted">± {fmt(r.wait.sd)}s</span>
                    </td>
                    <td className="mono muted">
                      [{fmt(r.wait.low)}, {fmt(r.wait.high)}]
                    </td>
                    <td className="mono">{fmt(r.p95.mean)}s</td>
                    <td className="mono">{fmt(r.throughput.mean)}</td>
                    <td className={'mono ' + (r.unfinished.mean > 0 ? 'research-warning' : '')}>
                      {fmt(r.unfinished.mean)}
                    </td>
                    <td className="mono">
                      {r.marginalGain === null ? '—' : `${fmt(r.marginalGain)}s`}
                    </td>
                    <td>{fmt(r.bottleneckRelief * 100)}%</td>
                    <td>{fmt(r.supplyMargin * 100)}%</td>
                    <td>{fmt(r.energy.mean, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="research-caption">
            최소 대수는 시험된 조건 중 목표를 만족한 관측치입니다. 완료된 승객만의 평균으로 충분성을
            판정하지 않으며, 모든 반복의 미완료 0과 평균의 신뢰구간 상한을 요구합니다. Drain 사용
            여부와 조건은 내보내기에 보존됩니다.
          </p>
        </section>
      )}
    </div>
  );
}

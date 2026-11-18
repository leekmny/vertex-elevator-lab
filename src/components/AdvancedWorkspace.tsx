import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ChevronsUpDown,
  FlaskConical,
  Maximize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Users,
  X,
  Zap,
  BookOpen,
} from 'lucide-react';
import { defaultConfig, validateConfig } from '../sim/config';
import { ALGORITHMS } from '../sim/algorithms';
import type { AlgorithmId, Config, Snapshot } from '../sim/types';
import Building, { CAR_COLORS } from './Building';
import Settings from './Settings';
import Analytics from './Analytics';
import { sessionTime } from '../workers/session';
const ResearchMode = lazy(() => import('./ResearchMode'));
export const fmt = (n: number | undefined, d = 1) =>
  n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function download(name: string, data: string) {
  const u = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export default function AdvancedWorkspace() {
  const [config, setConfig] = useState<Config>(defaultConfig),
    [algorithms, setAlgorithms] = useState<AlgorithmId[]>(['eta']),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [running, setRunning] = useState(false),
    [started, setStarted] = useState(false),
    [speed, setSpeed] = useState(5),
    [mode, setMode] = useState<'live' | 'compare' | 'research'>('live'),
    [language, setLanguage] = useState<'ko' | 'en'>('ko'),
    [tab, setTab] = useState('building'),
    [selectedCar, setSelectedCar] = useState(0),
    [floor, setFloor] = useState(1),
    [error, setError] = useState(''),
    [help, setHelp] = useState(false),
    [low, setLow] = useState(1),
    [high, setHigh] = useState(20),
    [resetKey, setResetKey] = useState(0),
    [ready, setReady] = useState(false);
  const worker = useRef<Worker | null>(null),
    busy = useRef(false),
    current = useRef(0),
    importRef = useRef<HTMLInputElement>(null);
  const en = language === 'en',
    t = (ko: string, english: string) => (en ? english : ko);
  const primary = snapshots[0],
    m = primary?.metrics;
  useEffect(() => {
    setReady(false);
    setRunning(false);
    setStarted(false);
    setSnapshots([]);
    current.current = 0;
    busy.current = false;
    setError('');
    const w = new Worker(new URL('../workers/live.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }) => {
      busy.current = false;
      if (data.type === 'error') {
        setError(data.message);
        setRunning(false);
      } else {
        setSnapshots(data.snapshots);
        current.current = sessionTime(data.snapshots);
        setReady(true);
        if (data.snapshots.length && data.snapshots.every((s: Snapshot) => s.done))
          setRunning(false);
      }
    };
    w.onerror = (e) => {
      setError(e.message);
      setRunning(false);
      busy.current = false;
    };
    w.postMessage({ type: 'init', config, algorithms });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [config, algorithms, resetKey]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (!busy.current) {
        busy.current = true;
        worker.current?.postMessage({ type: 'advance', time: current.current + 0.1 * speed });
      }
    }, 100);
    return () => clearInterval(id);
  }, [running, speed]);
  useEffect(() => {
    setLow(1 - config.basements);
    setHigh(config.floors);
    setSelectedCar(0);
  }, [config.floors, config.basements, config.cars]);
  function post(type: string, extra = {}) {
    setRunning(false);
    busy.current = true;
    worker.current?.postMessage({ type, ...extra });
  }
  function changeMode(v: typeof mode) {
    setMode(v);
    if (v === 'research') setRunning(false);
    if (v === 'compare' && algorithms.length === 1) setAlgorithms(['eta', 'look', 'nearest']);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5e6) throw Error('설정 파일은 5MB 이하여야 합니다.');
      const json = JSON.parse(await file.text());
      const next = json.config ?? json;
      validateConfig(next);
      setConfig(next);
      if (Array.isArray(json.algorithms)) {
        const ids = json.algorithms.filter((id: AlgorithmId) =>
          ALGORITHMS.some((a) => a.id === id),
        );
        if (ids.length) setAlgorithms(ids);
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changeMode('live');
          }}
        >
          <span className="brand-symbol">
            <ChevronsUpDown size={23} />
          </span>
          <div>
            VERTEX<span>ELEVATOR RESEARCH LAB</span>
          </div>
          <b className="version">v1.0</b>
        </a>
        <nav className="mode-nav" aria-label="모드">
          <button className={mode === 'live' ? 'active' : ''} onClick={() => changeMode('live')}>
            <Radio size={15} />
            {t('라이브 관제', 'Live control')}
          </button>
          <button
            className={mode === 'compare' ? 'active' : ''}
            onClick={() => changeMode('compare')}
          >
            <Boxes size={15} />
            {t('알고리즘 비교', 'Comparison')}
          </button>
          <button
            className={mode === 'research' ? 'active' : ''}
            onClick={() => changeMode('research')}
          >
            <FlaskConical size={15} />
            {t('연구 모드', 'Research mode')}
          </button>
        </nav>
        <div className="header-actions">
          <span className="local-badge">
            <i /> LOCAL ENGINE
          </span>
          <button
            className="icon-button language"
            onClick={() => setLanguage(en ? 'ko' : 'en')}
            aria-label="언어 변경"
          >
            {en ? 'KO' : 'EN'}
          </button>
          <button className="icon-button" onClick={() => setHelp(true)} aria-label="도움말">
            <BookOpen size={17} />
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">SIMULATION WORKSPACE / {mode.toUpperCase()} MODE</div>
          <h1>
            {mode === 'research'
              ? t('반복 실험실', 'Research laboratory')
              : mode === 'compare'
                ? t('정책을 나란히, 성능을 정확하게.', 'Compare policies. Measure performance.')
                : t('수직 이동의 모든 순간을 분석하다.', 'Every vertical journey, understood.')}
          </h1>
          <p>
            {t(
              '동일한 수요, 다른 전략. 결정적 이산 사건 시뮬레이션으로 운송 효율을 검증하세요.',
              'Same demand. Different strategies. Explore transport efficiency with a deterministic discrete-event engine.',
            )}
          </p>
        </div>
        <div className="heading-actions">
          <input
            ref={importRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button className="secondary" onClick={() => importRef.current?.click()}>
            <ArrowUpFromLine size={14} />
            {t('설정 불러오기', 'Import')}
          </button>
          <button
            className="secondary"
            onClick={() =>
              download(
                'vertex-experiment.json',
                JSON.stringify({ version: 1, config, algorithms, snapshots }, null, 2),
              )
            }
          >
            <ArrowDownToLine size={14} />
            {t('내보내기', 'Export')}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button onClick={() => setError('')} aria-label="오류 닫기">
            <X size={14} />
          </button>
        </div>
      )}
      {mode === 'research' ? (
        <Suspense fallback={<div className="panel loading">실험 모듈 불러오는 중…</div>}>
          <ResearchMode config={config} language={language} />
        </Suspense>
      ) : (
        <>
          <div className="dashboard-grid">
            <Settings
              {...{ config, setConfig, algorithms, setAlgorithms, tab, setTab, floor, setFloor }}
              onHelp={() => setHelp(true)}
            />
            <main className="main-monitor">
              <div className="kpi-grid">
                {[
                  ['평균 대기시간', fmt(m?.meanWait), 's', '탑승 승객 · 환승 포함', 'green'],
                  ['95% 대기시간', fmt(m?.p95Wait), 's', '모든 탑승 표본 기준', 'blue'],
                  [
                    '처리량',
                    fmt(m?.throughput),
                    '명/분',
                    `${m?.completed ?? 0} 명 이동 완료`,
                    'purple',
                  ],
                  [
                    '현재 대기 승객',
                    fmt(m?.waiting, 0),
                    '명',
                    `최장 현재 대기 ${fmt(m?.oldestWait)}s`,
                    'orange',
                  ],
                ].map(([title, value, unit, sub, color]) => (
                  <div className="panel kpi" key={title}>
                    <div className="kpi-title">{title}</div>
                    <div className={`kpi-value ${color}`}>
                      {value}
                      <small>{unit}</small>
                    </div>
                    <div className="kpi-sub">{sub}</div>
                  </div>
                ))}
              </div>
              <section className="panel monitor-panel">
                <div className="panel-heading">
                  <span>
                    <span className={'status-dot ' + (running ? 'pulsing' : '')} />
                    {t('실시간 승강기 관제', 'Building traffic monitor')}
                    <span className="tiny-tag">
                      {config.floors} FLOORS / {config.cars} CARS
                    </span>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="전체 화면"
                    onClick={() => {
                      const el = document.querySelector('.monitor-panel');
                      if (document.fullscreenElement) void document.exitFullscreen();
                      else void el?.requestFullscreen();
                    }}
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
                <div className="monitor-subhead">
                  <div className="legend">
                    <i style={{ background: '#45ddb5' }} />
                    운행 중<i style={{ background: '#ffa856' }} />
                    혼잡 / 만원
                    <i style={{ background: '#68778a' }} />
                    운행 중지
                  </div>
                  <label className="floor-filter">
                    표시 층
                    <select
                      aria-label="표시 층"
                      value={`${low}:${high}`}
                      onChange={(e) => {
                        const [l, h] = e.target.value.split(':').map(Number);
                        setLow(l);
                        setHigh(h);
                      }}
                    >
                      <option value={`${1 - config.basements}:${config.floors}`}>전체</option>
                      {Array.from({ length: Math.ceil(config.floors / 20) }, (_, i) => (
                        <option
                          value={`${i * 20 + 1}:${Math.min((i + 1) * 20, config.floors)}`}
                          key={i}
                        >
                          {i * 20 + 1}–{Math.min((i + 1) * 20, config.floors)}F
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {mode === 'compare' && (
                  <div className="comparison-selector">
                    {ALGORITHMS.map((a) => (
                      <label className={algorithms.includes(a.id) ? 'checked' : ''} key={a.id}>
                        <input
                          type="checkbox"
                          checked={algorithms.includes(a.id)}
                          onChange={(e) => {
                            if (e.target.checked) setAlgorithms([...algorithms, a.id]);
                            else if (algorithms.length > 1)
                              setAlgorithms(algorithms.filter((id) => id !== a.id));
                          }}
                        />
                        {a.short}
                      </label>
                    ))}
                    <span>최대 4개 관제 · 선택 전체 Worker 계산</span>
                  </div>
                )}
                <div className={'buildings ' + (mode === 'compare' ? 'comparison-buildings' : '')}>
                  {(mode === 'compare' ? algorithms.slice(0, 4) : algorithms.slice(0, 1)).map(
                    (id) => (
                      <div className="building-wrap" key={id}>
                        {mode === 'compare' && (
                          <div className="compare-label">
                            <b>{ALGORITHMS.find((a) => a.id === id)?.short}</b>
                            <span>
                              {fmt(snapshots.find((s) => s.algorithm === id)?.metrics.meanWait)}s /{' '}
                              {snapshots.find((s) => s.algorithm === id)?.metrics.completed ?? 0}명
                            </span>
                          </div>
                        )}
                        <Building
                          snapshot={snapshots.find((s) => s.algorithm === id)}
                          config={config}
                          selectedCar={selectedCar}
                          onSelectCar={setSelectedCar}
                          onSelectFloor={(f) => {
                            setFloor(f);
                            setTab('demand');
                          }}
                          low={low}
                          high={high}
                          compact={mode === 'compare'}
                        />
                      </div>
                    ),
                  )}
                </div>
                <div className="timeline">
                  <span className="mono" data-testid="simulation-time">
                    {clock(sessionTime(snapshots))}
                  </span>
                  <input
                    aria-label="기록 탐색"
                    type="range"
                    min="0"
                    max={config.duration + (config.drain ? config.maxDrain : 0)}
                    step="1"
                    value={sessionTime(snapshots)}
                    onChange={(e) => post('seek', { time: +e.target.value, config, algorithms })}
                  />
                  <span className="mono muted">{clock(config.duration)}</span>
                </div>
                <div className="playback-toolbar">
                  <div className="playback-buttons">
                    <button
                      className="primary play"
                      disabled={!ready || !!error || (primary?.done && !running)}
                      onClick={() => {
                        setRunning(!running);
                        setStarted(true);
                      }}
                    >
                      {running ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                      {running
                        ? t('일시정지', 'Pause')
                        : started
                          ? t('재개', 'Resume')
                          : t('시작', 'Start')}
                    </button>
                    <button
                      className="icon-button"
                      title="초기화"
                      aria-label="초기화"
                      onClick={() => setResetKey((k) => k + 1)}
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="한 이벤트"
                      aria-label="한 이벤트"
                      disabled={!ready}
                      onClick={() => {
                        setStarted(true);
                        post('step');
                      }}
                    >
                      <SkipForward size={17} />
                    </button>
                  </div>
                  <label className="speed-select">
                    <span>재생 속도</span>
                    <select
                      aria-label="재생 속도"
                      value={speed}
                      onChange={(e) => setSpeed(+e.target.value)}
                    >
                      {[0.25, 0.5, 1, 2, 5, 10, 25, 50, 100].map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="run-status">
                    <i className={running ? 'on' : ''} />
                    {primary?.done ? '실험 종료' : running ? '실행 중' : '일시 정지'}
                  </span>
                </div>
              </section>
            </main>
            <Fleet
              {...{ primary, config, setConfig, selectedCar, setSelectedCar, ready }}
              fail={() => post('failure', { id: selectedCar })}
            />
          </div>
          <Analytics snapshots={snapshots} config={config} />
          <section className="panel extended-metrics">
            {[
              ['미완료 승객', `${m?.unfinished ?? 0} 명`],
              ['현재까지 평균 대기', `${fmt(m?.currentMeanWait)} s`],
              ['평균 전체 이동', `${fmt(m?.meanJourney)} s`],
              ['최장 / P99 대기', `${fmt(m?.maxWait)} / ${fmt(m?.p99Wait)} s`],
              ['층별 서비스 불균형', `${fmt(m?.fairness)} CV`],
              ['환승 완료 승객', `${m?.transferred ?? 0} 명`],
            ].map(([name, value]) => (
              <div key={name}>
                <span>{name}</span>
                <b>{value}</b>
              </div>
            ))}
          </section>
          <details className="panel all-metrics">
            <summary>전체 지표 · 승객 및 차량 상세</summary>
            <div className="extended-metrics">
              {[
                ['대기시간 중앙값', `${fmt(m?.medianWait)} s`],
                ['평균 탑승 후 이동', `${fmt(m?.meanRide)} s`],
                ['5분 환산 처리량', `${fmt(m?.throughput5)} 명`],
                ['한 번도 미탑승', `${m?.unboarded ?? 0} 명`],
                ['최대 전체 대기열', `${m?.maxQueue ?? 0} 명`],
                ['장기 대기 비율', `${fmt((m?.longWaitRatio ?? 0) * 100)}%`],
                ['총 운행 거리', `${fmt(m?.distance)} m`],
                ['총 정차 횟수', `${m?.stops ?? 0} 회`],
                ['승객당 정차', `${fmt(m?.stopsPerPassenger)} 회`],
                ['직접 이동 평균 여정', `${fmt(m?.directMeanJourney)} s`],
                ['환승 평균 여정', `${fmt(m?.transferMeanJourney)} s`],
                ['에너지 대용 모델', `${fmt(m?.energy, 3)} kWh`],
              ].map(([name, value]) => (
                <div key={name}>
                  <span>{name}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="metric-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>차량</th>
                    <th>현재 탑승 / 정원</th>
                    <th>시간 평균 탑승률</th>
                    <th>이용률</th>
                    <th>정차 횟수</th>
                    <th>차내 승객 ID → 다음 하차층</th>
                  </tr>
                </thead>
                <tbody>
                  {primary?.cars.map((c) => (
                    <tr key={c.id}>
                      <td>E{c.id + 1}</td>
                      <td>
                        {c.passengers.length} / {c.spec.capacity}
                      </td>
                      <td>{fmt((m?.occupancy[c.id] ?? 0) * 100)}%</td>
                      <td>{fmt((m?.utilization[c.id] ?? 0) * 100)}%</td>
                      <td>{c.stopsCount}</td>
                      <td>
                        {c.passengers
                          .map((id) => {
                            const p = primary.passengers.find((p) => p.id === id);
                            return `${id}→${p?.route[(p?.leg ?? 0) + 1] ?? '—'}F`;
                          })
                          .join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <footer>
        <span className="footer-mark">
          <ChevronsUpDown size={13} />
          VERTEX <span>Research-grade exploration</span>
        </span>
        <span>결정적 DES · 브라우저 로컬 실행 · 실제 설계 인증 용도가 아닙니다.</span>
        <button className="text-button" onClick={() => setHelp(true)}>
          MODEL & METHODS →
        </button>
      </footer>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="알고리즘 가이드"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <span>
                <BookOpen size={16} />
                알고리즘 & 모델 가이드
              </span>
              <button className="icon-button" aria-label="닫기" onClick={() => setHelp(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-content">
              <p>
                건물과 차량 수 → 운행 정책과 배차 선택 → 시작. 수요 탭에서 과부하를, 연구 모드에서
                증설 효과를 비교하세요.
              </p>
              <div className="notice">
                일반 홀 호출은 탑승 전 목적지를 공개하지 않습니다. Destination Dispatch만 목적지를
                사용합니다. 두 정보 범주를 구분해 해석하세요. GA·SA는 제한된 예산의 실제 탐색으로
                최적해를 보장하지 않습니다. 강화학습은 미구현입니다.
              </div>
              {ALGORITHMS.map((a) => (
                <article className="algorithm-guide" key={a.id}>
                  <h3>
                    {a.name}
                    <span className="badge">
                      {a.information === 'hall' ? 'HALL CALL' : 'DESTINATION'}
                    </span>
                  </h3>
                  <p>{a.description}</p>
                  <dl>
                    <div>
                      <dt>장점</dt>
                      <dd>{a.pros}</dd>
                    </div>
                    <div>
                      <dt>한계</dt>
                      <dd>{a.cons}</dd>
                    </div>
                    <div>
                      <dt>복잡도</dt>
                      <dd className="mono">{a.complexity}</dd>
                    </div>
                  </dl>
                </article>
              ))}
              <div className="notice">
                대기시간과 미완료 승객을 함께 확인하세요. 단일 실행 순위는 통계적 우월성을 의미하지
                않습니다. 에너지는 단순화된 추정치입니다. 자세한 모델과 제한은 README 및 docs 문서를
                참고하세요.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Fleet({
  primary,
  config,
  setConfig,
  selectedCar,
  setSelectedCar,
  ready,
  fail,
}: {
  primary?: Snapshot;
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  selectedCar: number;
  setSelectedCar: (id: number) => void;
  ready: boolean;
  fail: () => void;
}) {
  const car = primary?.cars[selectedCar];
  return (
    <aside className="details-column">
      <section className="panel fleet-panel">
        <div className="panel-heading">
          <span>
            <Boxes size={15} />
            차량 모니터
          </span>
          <b className="tiny-tag">{config.cars} UNITS</b>
        </div>
        <div className="fleet-list">
          {Array.from({ length: config.cars }, (_, id) => {
            const c = primary?.cars[id],
              p = c?.passengers.length ?? 0,
              cap = c?.spec.capacity ?? config.car.capacity;
            return (
              <button
                key={id}
                onClick={() => setSelectedCar(id)}
                className={'car-card ' + (selectedCar === id ? 'selected' : '')}
                style={{ '--car-color': CAR_COLORS[id % CAR_COLORS.length] } as React.CSSProperties}
              >
                <div className="car-topline">
                  <b>
                    <i />E{String(id + 1).padStart(2, '0')}
                  </b>
                  <span>
                    {c?.status === 'failed'
                      ? 'OFFLINE'
                      : c?.status === 'moving'
                        ? c.direction > 0
                          ? '↑ UP'
                          : '↓ DOWN'
                        : c?.status === 'boarding'
                          ? 'BOARDING'
                          : c?.status === 'idle'
                            ? 'IDLE'
                            : 'DOOR'}
                  </span>
                </div>
                <div className="car-location">
                  <strong>
                    {fmt(c?.position ?? config.car.home, 1)}
                    <small> F</small>
                  </strong>
                  <span>
                    <Users size={11} />
                    {p} / {cap}
                  </span>
                </div>
                <div className="load-track">
                  <i
                    style={{
                      width: `${(100 * p) / cap}%`,
                      background: p >= cap ? '#ffad66' : undefined,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel car-detail">
        <div className="panel-heading">
          <span>E{String(selectedCar + 1).padStart(2, '0')} · 차량 상세</span>
        </div>
        <dl>
          {[
            ['예정 정차', car?.stops.slice(0, 6).join(' → ') || '—'],
            ['총 운행 거리', `${fmt(car?.distance, 0)} m`],
            ['정차 횟수', car?.stopsCount ?? 0],
            ['이용률', `${fmt((primary?.metrics.utilization[selectedCar] ?? 0) * 100, 0)}%`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <details>
          <summary>차량별 제원 변경</summary>
          {(['capacity', 'speed'] as const).map((key) => (
            <label className="number-field" key={key}>
              <span>{key === 'capacity' ? '개별 정원' : '개별 최고속도'}</span>
              <input
                type="number"
                min="1"
                max={key === 'capacity' ? 100 : 12}
                step={key === 'capacity' ? 1 : 0.1}
                value={config.carOverrides[selectedCar]?.[key] ?? config.car[key]}
                onChange={(e) => {
                  const v = +e.target.value;
                  if (v > 0)
                    setConfig((c) => {
                      const a = [...c.carOverrides];
                      a[selectedCar] = { ...a[selectedCar], [key]: v };
                      return { ...c, carOverrides: a };
                    });
                }}
              />
            </label>
          ))}
        </details>
        <button
          className="danger-button"
          disabled={!ready || car?.status === 'failed'}
          onClick={fail}
        >
          <Zap size={13} />
          안전 퇴역 실험
        </button>
        <p className="small-note">
          탑승객 하차 후 운행 중지. 물리적 비상 정지는 모델 범위 밖입니다.
        </p>
      </section>
    </aside>
  );
}

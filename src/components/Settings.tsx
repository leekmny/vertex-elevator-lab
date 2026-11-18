import { useState, type Dispatch, type SetStateAction } from 'react';
import { Building2, Users, SlidersHorizontal, Info, ChevronDown } from 'lucide-react';
import type { AlgorithmId, CarSpec, Config, Policy, Scenario } from '../sim/types';
import { ALGORITHMS } from '../sim/algorithms';
import { floorLabel } from './Building';
import './settings.css';

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  unit,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {unit && <small>{unit}</small>}
      </span>
      <input
        className="number-field"
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = +e.target.value;
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}
const scenarios: { id: Scenario; name: string; note: string }[] = [
  { id: 'random', name: '평상시 · 무작위 이동', note: '층별 수요 가중치에 따른 확률적 발생' },
  { id: 'downpeak', name: '아침 · 하강 집중', note: '상층에서 로비로 이동하는 수요' },
  { id: 'uppeak', name: '저녁 · 상승 집중', note: '로비에서 상층으로 이동하는 수요' },
  { id: 'simultaneous', name: '전 층 동시 호출', note: '모든 층에서 시각 0에 동시 등장' },
  { id: 'overload', name: '전 층 지속 과부하', note: '500% 수요로 포화와 잔여 대기 관측' },
  { id: 'hotspot', name: '일부 층 극단적 혼잡', note: '상층 특정 층에 출발 수요 집중' },
  { id: 'lobby', name: '로비 집중', note: '로비 출발 승객이 약90%' },
  { id: 'interfloor', name: '층간 이동', note: '층 간 균등한 목적지 이동' },
  { id: 'failure', name: '차량 고장', note: '지정 시점에 안전 서비스 종료 후 퇴역' },
  { id: 'changing', name: '시간대별 수요 변화', note: '분 단위 발생률과 중간 시점 방향 변화' },
  { id: 'custom', name: '사용자 정의 패턴', note: '층별 가중치·인구·초기 대기 설정 사용' },
];
export default function Settings({
  config: c,
  setConfig,
  algorithms,
  setAlgorithms,
  tab,
  setTab,
  floor,
  setFloor,
  onHelp,
}: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config>>;
  algorithms: AlgorithmId[];
  setAlgorithms: Dispatch<SetStateAction<AlgorithmId[]>>;
  tab: string;
  setTab: Dispatch<SetStateAction<string>>;
  floor: number;
  setFloor: Dispatch<SetStateAction<number>>;
  onHelp: (id?: AlgorithmId) => void;
}) {
  const [carIndex, setCarIndex] = useState(0),
    [manualZones, setManualZones] = useState(''),
    [manualGroups, setManualGroups] = useState(''),
    [transferText, setTransferText] = useState(c.transferFloors.join(','));
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((v) => ({ ...v, [key]: value }));
  const setCar = <K extends keyof CarSpec>(key: K, value: CarSpec[K]) =>
    setConfig((v) => ({ ...v, car: { ...v.car, [key]: value } }));
  const low = 1 - c.basements,
    index = Math.max(0, Math.min(c.floors + c.basements - 1, floor - low)),
    selectedFloor = low + index;
  const info = ALGORITHMS.find((a) => a.id === algorithms[0]);
  function resize(floors: number, basements: number, cars: number) {
    setConfig((v) => {
      const size = floors + basements,
        map = (arr: number[], fallback: number) =>
          Array.from({ length: size }, (_, i) => arr[i + v.basements - basements] ?? fallback);
      const clip = (f: number) => Math.max(1 - basements, Math.min(floors, f));
      return {
        ...v,
        floors,
        basements,
        cars,
        zoneCount: Math.min(v.zoneCount, cars),
        groupCars: [],
        zoneBoundaries: v.zoneBoundaries.filter((f) => f >= 1 - basements && f < floors),
        car: { ...v.car, home: clip(v.car.home) },
        carOverrides: v.carOverrides.slice(0, cars).map((spec) => ({
          ...spec,
          home: clip(spec.home ?? v.car.home),
          serviceFloors: spec.serviceFloors?.filter((f) => f >= 1 - basements && f <= floors),
        })),
        floorWeights: map(v.floorWeights, 1),
        floorPopulation: map(v.floorPopulation, 50),
        initialQueues: map(v.initialQueues, 0),
        transferFloors: v.transferFloors.filter((f) => f >= 1 - basements && f <= floors),
        lobby: clip(v.lobby),
        failureCar: Math.min(cars - 1, v.failureCar),
      };
    });
    setFloor(Math.min(floors, Math.max(1 - basements, floor)));
  }
  function setFloorValue(key: 'floorWeights' | 'floorPopulation' | 'initialQueues', value: number) {
    setConfig((v) => {
      const arr = [...v[key]];
      arr[index] = value;
      return { ...v, [key]: arr };
    });
  }
  const field = (
    label: string,
    key: keyof CarSpec,
    min: number,
    max: number,
    step = 1,
    unit?: string,
  ) => (
    <NumberField
      key={key}
      label={label}
      value={Number(c.car[key])}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => setCar(key, v)}
    />
  );
  return (
    <aside className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <SlidersHorizontal size={14} />
          <span>실험 설정</span>
        </div>
        <span className="badge">CONFIG</span>
      </div>
      <div className="settings-tabs">
        {[
          { id: 'building', name: '건물', icon: Building2 },
          { id: 'demand', name: '수요', icon: Users },
          { id: 'advanced', name: '고급', icon: SlidersHorizontal },
        ].map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={13} />
            {t.name}
          </button>
        ))}
      </div>
      {tab === 'building' && (
        <>
          <section className="config-section">
            <div className="section-label">BUILDING PROFILE</div>
            <div className="settings-number-grid">
              <NumberField
                label="층수"
                value={c.floors}
                min={5}
                max={100}
                unit="F"
                onChange={(v) => resize(Math.round(v), c.basements, c.cars)}
              />
              <NumberField
                label="차량 수"
                value={c.cars}
                min={1}
                max={20}
                unit="대"
                onChange={(v) => resize(c.floors, c.basements, Math.round(v))}
              />
            </div>
            <label className="range-heading">
              <span>층수 범위</span>
              <strong>
                {c.floors} <small>FLOORS</small>
              </strong>
            </label>
            <input
              aria-label="층수 슬라이더"
              type="range"
              min={5}
              max={100}
              value={c.floors}
              onChange={(e) => resize(+e.target.value, c.basements, c.cars)}
            />
            <div className="range-ends">
              <span>5F</span>
              <span>100F</span>
            </div>
            <div className="settings-number-grid">
              {field('최대 정원', 'capacity', 1, 100, 1, '명')}
              {field('최고 속도', 'speed', 0.1, 15, 0.1, 'm/s')}
            </div>
            <NumberField
              label="Seed"
              value={c.seed}
              min={0}
              max={4294967295}
              onChange={(v) => set('seed', Math.round(v))}
            />
            <div className="mini-summary">
              <span>전체 수송 정원</span>
              <strong>
                {Array.from(
                  { length: c.cars },
                  (_, i) => c.carOverrides[i]?.capacity ?? c.car.capacity,
                ).reduce((a, b) => a + b, 0)}{' '}
                명
              </strong>
            </div>
          </section>
          <section className="config-section">
            <div className="section-label">DISPATCH STRATEGY</div>
            <label className="field">
              <span>
                배차 알고리즘{' '}
                <button
                  className="text-button"
                  title="알고리즘 설명"
                  onClick={(e) => {
                    e.preventDefault();
                    onHelp(algorithms[0]);
                  }}
                >
                  <Info size={13} />
                </button>
              </span>
              <select
                aria-label="배차 알고리즘"
                value={algorithms[0]}
                onChange={(e) =>
                  setAlgorithms((v) => [
                    e.target.value as AlgorithmId,
                    ...v.slice(1).filter((id) => id !== e.target.value),
                  ])
                }
              >
                {ALGORITHMS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="algorithm-summary">
              <span className="badge">
                {info?.information === 'destination' ? 'DESTINATION INPUT' : 'HALL CALL'}
              </span>
              <p>{info?.description}</p>
              <button className="text-button" onClick={() => onHelp(algorithms[0])}>
                특성과 한계 보기 →
              </button>
            </div>
            <label className="field">
              <span>운영 정책</span>
              <select
                aria-label="운영 정책"
                value={c.policy}
                onChange={(e) =>
                  setConfig((v) => ({ ...v, policy: e.target.value as Policy, groupCars: [] }))
                }
              >
                <option value="shared">전체 층 공용 운행</option>
                <option value="parity">홀수 / 짝수층 분리</option>
                <option value="zoned">저층 / 고층 고정 구역</option>
                <option value="dynamic">동적 구역 분리</option>
              </select>
            </label>
            {c.policy !== 'shared' && (
              <>
                <p className="small-note">
                  로비·환승층은 공용입니다. 직접 경로가 없으면 환승을 포함하며 기존 탑승·예약은
                  보장합니다.
                </p>
                {c.policy !== 'parity' && (
                  <NumberField
                    label="구역 수"
                    min={1}
                    max={c.cars}
                    value={c.zoneCount}
                    onChange={(v) =>
                      setConfig((p) => ({
                        ...p,
                        zoneCount: Math.round(v),
                        groupCars: [],
                        zoneBoundaries: [],
                      }))
                    }
                  />
                )}
                <label className="field">
                  <span>수동 구역 경계</span>
                  <input
                    aria-label="구역 경계"
                    placeholder="자동 · 예: 10,20"
                    value={manualZones}
                    onChange={(e) => setManualZones(e.target.value)}
                    onBlur={() => {
                      const ns = manualZones
                        .split(',')
                        .filter((s) => s.trim())
                        .map(Number)
                        .filter(Number.isFinite);
                      if (
                        ns.every(
                          (n, i) =>
                            Number.isInteger(n) &&
                            n >= low &&
                            n < c.floors &&
                            (i === 0 || n > ns[i - 1]),
                        )
                      )
                        setConfig((v) => ({
                          ...v,
                          zoneBoundaries: ns,
                          zoneCount: ns.length ? Math.min(c.cars, ns.length + 1) : v.zoneCount,
                        }));
                    }}
                  />
                </label>
                <label className="field">
                  <span>그룹별 차량 수</span>
                  <input
                    aria-label="그룹별 차량 수"
                    placeholder="자동 · 예: 1,3"
                    value={manualGroups}
                    onChange={(e) => setManualGroups(e.target.value)}
                    onBlur={() => {
                      const ns = manualGroups
                        .split(',')
                        .filter((s) => s.trim())
                        .map(Number);
                      if (
                        !ns.length ||
                        (ns.every((n) => Number.isInteger(n) && n > 0) &&
                          ns.reduce((a, b) => a + b, 0) === c.cars)
                      )
                        set('groupCars', ns);
                    }}
                  />
                </label>
                <p className="small-note">
                  합계 {c.cars}대. 홀짝 순서는 짝수 / 홀수 그룹입니다. 대수 변경 시 자동 배정으로
                  전환됩니다.
                </p>
              </>
            )}
          </section>
          <section className="config-section">
            <div className="section-label">TRAFFIC INTENSITY</div>
            <label className="range-heading">
              <span>혼잡도</span>
              <strong className={c.congestion >= 300 ? 'warning' : ''}>
                {c.congestion}
                <small>%</small>
              </strong>
            </label>
            <input
              type="range"
              aria-label="혼잡도"
              min={0}
              max={500}
              step={10}
              value={c.congestion}
              onChange={(e) => set('congestion', +e.target.value)}
            />
            <div className="range-ends">
              <span>0% · QUIET</span>
              <span>500% · OVERLOAD</span>
            </div>
            <NumberField
              label="기준 승객 발생률"
              value={c.rate}
              min={0}
              max={10000}
              unit="명/분 @100%"
              onChange={(v) => set('rate', v)}
            />
            <p className="small-note">
              현재 총 발생률 {((c.rate * c.congestion) / 100).toFixed(1)}명/분 · 100% 기준을 직접
              수정할 수 있습니다.
            </p>
          </section>
        </>
      )}
      {tab === 'demand' && (
        <>
          <section className="config-section">
            <div className="section-label">DEMAND SCENARIO</div>
            <label className="field">
              <span>혼잡 시나리오</span>
              <select
                aria-label="혼잡 시나리오"
                value={c.scenario}
                onChange={(e) =>
                  setConfig((v) => ({
                    ...v,
                    scenario: e.target.value as Scenario,
                    ...(e.target.value === 'overload' ? { congestion: 500 } : {}),
                  }))
                }
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="small-note">{scenarios.find((s) => s.id === c.scenario)?.note}</p>
            <NumberField
              label="혼잡도 수치"
              value={c.congestion}
              min={0}
              max={500}
              unit="%"
              onChange={(v) => set('congestion', v)}
            />
            <NumberField
              label="기준 발생률"
              value={c.rate}
              min={0}
              max={10000}
              unit="명/분"
              onChange={(v) => set('rate', v)}
            />
          </section>
          <section className="config-section">
            <div className="section-label">FLOOR DEMAND EDITOR</div>
            <label className="field">
              <span>
                선택한 층 <small>건물의 층 번호 클릭</small>
              </span>
              <select
                aria-label="수요 편집 층"
                value={selectedFloor}
                onChange={(e) => setFloor(+e.target.value)}
              >
                {Array.from({ length: c.floors + c.basements }, (_, i) => low + i)
                  .reverse()
                  .map((f) => (
                    <option key={f} value={f}>
                      {floorLabel(f)}
                      {f === c.lobby ? ' · 로비' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className="range-heading">
              <span>발생 수요 가중치</span>
              <strong>
                {(c.floorWeights[index] ?? 1).toFixed(1)}
                <small>×</small>
              </strong>
            </label>
            <input
              aria-label="층별 수요 가중치"
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={c.floorWeights[index] ?? 1}
              onChange={(e) => setFloorValue('floorWeights', +e.target.value)}
            />
            <div className="settings-number-grid">
              <NumberField
                label="층 이용자 수"
                value={c.floorPopulation[index] ?? 50}
                min={0}
                max={10000}
                unit="명"
                onChange={(v) => setFloorValue('floorPopulation', Math.round(v))}
              />
              <NumberField
                label="초기 대기 인원"
                value={c.initialQueues[index] ?? 0}
                min={0}
                max={1000}
                unit="명"
                onChange={(v) => setFloorValue('initialQueues', Math.round(v))}
              />
            </div>
            <div className="floor-bars" aria-label="층별 수요 막대">
              {Array.from({ length: c.floors + c.basements }, (_, i) => i)
                .reverse()
                .map((i) => (
                  <label
                    key={i}
                    title={`${floorLabel(low + i)} · 가중치 ${c.floorWeights[i] ?? 1}`}
                    className={i === index ? 'selected' : ''}
                  >
                    <button onClick={() => setFloor(low + i)}>{floorLabel(low + i)}</button>
                    <input
                      aria-label={`${floorLabel(low + i)} 수요 가중치`}
                      type="range"
                      min={0}
                      max={10}
                      step={0.1}
                      value={c.floorWeights[i] ?? 1}
                      onChange={(e) => {
                        const value = +e.target.value;
                        setConfig((v) => {
                          const weights = [...v.floorWeights];
                          weights[i] = value;
                          return { ...v, floorWeights: weights };
                        });
                      }}
                    />
                  </label>
                ))}
            </div>
            <p className="small-note">
              출발층의 가중치 × 이용자 수를 정규화합니다. 총 발생률은 유지됩니다. 초기 대기는 혼잡도
              0%에서도 별도로 생성됩니다.
            </p>
          </section>
          <section className="config-section">
            <div className="section-label">FAILURE EXPERIMENT</div>
            <NumberField
              label="고장 발생 시각"
              value={c.failureAt}
              min={0}
              max={86400}
              unit="초"
              onChange={(v) => set('failureAt', v)}
            />
            <NumberField
              label="고장 차량 번호"
              value={c.failureCar + 1}
              min={1}
              max={c.cars}
              onChange={(v) => set('failureCar', Math.round(v) - 1)}
            />
            <p className="small-note">
              차량 고장 시나리오에서 적용됩니다. 승객 탑승 중 급정지는 범위 밖이며, 기존 승객 하차
              후 퇴역합니다.
            </p>
          </section>
        </>
      )}
      {tab === 'advanced' && (
        <>
          <section className="config-section">
            <div className="section-label">REPRODUCIBILITY</div>
            <NumberField
              label="실험 시간"
              value={c.duration}
              min={1}
              max={86400}
              unit="초"
              onChange={(v) =>
                setConfig((p) => ({ ...p, duration: v, warmup: Math.min(p.warmup, v - 1) }))
              }
            />
            <NumberField
              label="초기 안정화 구간"
              value={c.warmup}
              min={0}
              max={c.duration - 1}
              unit="초"
              onChange={(v) => set('warmup', v)}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={c.drain}
                onChange={(e) => set('drain', e.target.checked)}
              />{' '}
              발생 종료 후 Drain
            </label>
            <NumberField
              label="최대 Drain 시간"
              value={c.maxDrain}
              min={0}
              max={86400}
              unit="초"
              onChange={(v) => set('maxDrain', v)}
            />
            <NumberField
              label="장기 대기 기준"
              value={c.longWait}
              min={1}
              max={86400}
              unit="초"
              onChange={(v) => set('longWait', v)}
            />
          </section>
          <section className="config-section">
            <div className="section-label">PHYSICAL MODEL</div>
            <NumberField
              label="지하층 수"
              value={c.basements}
              min={0}
              max={10}
              onChange={(v) => resize(c.floors, Math.round(v), c.cars)}
            />
            <NumberField
              label="층간 높이"
              value={c.floorHeight}
              min={1}
              max={10}
              step={0.1}
              unit="m"
              onChange={(v) => set('floorHeight', v)}
            />
            <NumberField
              label="로비 층"
              value={c.lobby}
              min={low}
              max={c.floors}
              onChange={(v) => set('lobby', Math.round(v))}
            />
            <NumberField
              label="초기 차량 층"
              value={c.car.home}
              min={low}
              max={c.floors}
              onChange={(v) => setCar('home', Math.round(v))}
            />
            <label className="field">
              <span>환승·공용 층</span>
              <input
                aria-label="환승 공용 층"
                value={transferText}
                placeholder="1,10"
                onChange={(e) => setTransferText(e.target.value)}
                onBlur={() => {
                  const values = transferText
                    .split(',')
                    .filter((s) => s.trim())
                    .map(Number);
                  if (values.every((f) => Number.isInteger(f) && f >= low && f <= c.floors))
                    set('transferFloors', [...new Set(values)]);
                }}
              />
            </label>
            {field('가속도', 'acceleration', 0.1, 5, 0.1, 'm/s²')}
            {field('문 열림 시간', 'doorOpen', 0, 15, 0.1, '초')}
            {field('문 닫힘 시간', 'doorClose', 0, 15, 0.1, '초')}
            {field('1인 탑승 시간', 'boardTime', 0, 10, 0.1, '초')}
            {field('1인 하차 시간', 'alightTime', 0, 10, 0.1, '초')}
            <label className="field">
              <span>유휴 차량 배치</span>
              <select
                aria-label="유휴 차량 배치"
                value={c.idle}
                onChange={(e) => set('idle', e.target.value as Config['idle'])}
              >
                <option value="lobby">로비</option>
                <option value="middle">중간층</option>
                <option value="high">고층</option>
                <option value="predictive">최근 수요 기반 통계 배치</option>
              </select>
            </label>
          </section>
          <section className="config-section">
            <div className="section-label">HETEROGENEOUS FLEET</div>
            <label className="field">
              <span>개별 차량 제원</span>
              <select
                aria-label="제원 편집 차량"
                value={Math.min(carIndex, c.cars - 1)}
                onChange={(e) => setCarIndex(+e.target.value)}
              >
                {Array.from({ length: c.cars }, (_, i) => (
                  <option key={i} value={i}>
                    E{String(i + 1).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            {(['capacity', 'speed', 'acceleration'] as const).map((k) => (
              <NumberField
                key={k}
                label={
                  k === 'capacity'
                    ? '개별 차량 정원'
                    : k === 'speed'
                      ? '개별 차량 속도'
                      : '개별 차량 가속도'
                }
                value={c.carOverrides[Math.min(carIndex, c.cars - 1)]?.[k] ?? c.car[k]}
                min={k === 'capacity' ? 1 : 0.1}
                max={k === 'capacity' ? 100 : 15}
                step={k === 'capacity' ? 1 : 0.1}
                onChange={(v) =>
                  setConfig((p) => {
                    const overrides = [...p.carOverrides],
                      i = Math.min(carIndex, p.cars - 1);
                    overrides[i] = { ...overrides[i], [k]: v };
                    return { ...p, carOverrides: overrides };
                  })
                }
              />
            ))}
            <button className="text-button" onClick={() => set('carOverrides', [])}>
              모든 차량을 기본 제원으로 복원
            </button>
          </section>
          <section className="config-section">
            <div className="section-label">MULTI-OBJECTIVE WEIGHTS</div>
            {(
              [
                { key: 'wait', name: '대기시간' },
                { key: 'journey', name: '전체 이동시간' },
                { key: 'fairness', name: '장기 대기 방지' },
                { key: 'balance', name: '이용률 균등' },
                { key: 'energy', name: '에너지 절감' },
              ] as const
            ).map((w) => (
              <label className="weight-control" key={w.key}>
                <span>
                  {w.name}
                  <strong>{c.weights[w.key].toFixed(1)}</strong>
                </span>
                <input
                  aria-label={`${w.name} 가중치`}
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={c.weights[w.key]}
                  onChange={(e) => {
                    const value = +e.target.value;
                    setConfig((v) => ({ ...v, weights: { ...v.weights, [w.key]: value } }));
                  }}
                />
              </label>
            ))}
            <p className="small-note">
              설정 변경 시 같은 Seed로 초기화합니다. 다목적·GA·SA에서 사용하며, 목적지 사전 정보는
              이용하지 않습니다.
            </p>
          </section>
        </>
      )}
      <div className="settings-foot">
        <span className="status-dot" />
        설정은 자동 적용 · 변경 시 실행 초기화
      </div>
    </aside>
  );
}

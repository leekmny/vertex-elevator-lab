import { useRef, useState } from 'react';
import { Activity, ArrowDownToLine, BarChart3, Waypoints } from 'lucide-react';
import type { Config, Snapshot } from '../sim/types';
import { ALGORITHMS } from '../sim/algorithms';
import Chart from './Chart';
import { floorLabel } from './Building';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
const fmt = (n: number, d = 0) => n.toFixed(d),
  clock = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
export default function Analytics({
  snapshots,
  config,
}: {
  snapshots: Snapshot[];
  config: Config;
}) {
  const [tab, setTab] = useState('wait'),
    chart = useRef<EChartsType | null>(null);
  const s = snapshots[0],
    m = s?.metrics;
  const axis = {
    axisLine: { lineStyle: { color: '#273344' } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: '#1e2a39' } },
    axisLabel: { color: '#6e829c', fontSize: 10 },
  };
  const base = {
    grid: { top: 28, bottom: 32, left: 48, right: 25 },
    tooltip: { trigger: 'axis' },
    legend: { right: 15, top: 0, textStyle: { color: '#8a9bb0', fontSize: 10 } },
    animation: false,
  };
  let option: EChartsCoreOption;
  if (tab === 'floor')
    option = {
      ...base,
      visualMap: {
        min: 0,
        max: Math.max(1, ...(m?.floorWaits ?? [])),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 150,
        itemWidth: 9,
        textStyle: { color: '#8a9bb0' },
        inRange: { color: ['#153b3b', '#45d9aa', '#ffd17b', '#eb7f59'] },
      },
      grid: { left: 48, right: 25, top: 20, bottom: 70 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: config.floors + config.basements }, (_, i) =>
          floorLabel(i + 1 - config.basements),
        ),
        ...axis,
      },
      yAxis: { type: 'category', data: ['대기 (s)'], ...axis },
      series: [
        {
          type: 'heatmap',
          data: (m?.floorWaits ?? []).map((v, i) => [i, 0, v]),
          label: {
            show: config.floors <= 25,
            color: '#e0f5ee',
            formatter: (p: any) => fmt(p.data[2]),
          },
        },
      ],
    };
  else if (tab === 'distribution') {
    const w = m?.waitSamples ?? [],
      bins = [0, 15, 30, 60, 120, 240, 480, Infinity];
    option = {
      ...base,
      xAxis: {
        type: 'category',
        data: ['<15', '15–30', '30–60', '60–120', '120–240', '240–480', '480+'],
        name: 's',
        ...axis,
      },
      yAxis: { type: 'value', name: '명', ...axis },
      series: [
        {
          type: 'bar',
          barMaxWidth: 35,
          data: bins.slice(0, -1).map((b, i) => w.filter((v) => v >= b && v < bins[i + 1]).length),
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  } else if (tab === 'trajectory')
    option = {
      ...base,
      xAxis: { type: 'value', name: 's', ...axis },
      yAxis: { type: 'value', name: 'F', ...axis },
      series: Array.from({ length: config.cars }, (_, i) => ({
        name: `E${i + 1}`,
        type: 'line',
        showSymbol: false,
        lineStyle: { width: 1.3 },
        data: (s?.series ?? []).map((p) => [p.time, p.positions[i]]),
      })),
    };
  else if (tab === 'energy')
    option = {
      ...base,
      xAxis: { type: 'category', data: s?.cars.map((c) => `E${c.id + 1}`) ?? [], ...axis },
      yAxis: { type: 'value', name: 'kWh (est.)', ...axis },
      series: [
        {
          type: 'bar',
          barMaxWidth: 34,
          data: s?.cars.map((c) => c.energy) ?? [],
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  else
    option = {
      ...base,
      xAxis: { type: 'value', name: 's', ...axis },
      yAxis: { type: 'value', name: tab === 'wait' ? '대기 (s)' : '명', ...axis },
      series: snapshots.flatMap<any>((run, i) =>
        tab === 'wait'
          ? [
              {
                name: ALGORITHMS.find((a) => a.id === run.algorithm)?.short,
                type: 'line',
                showSymbol: false,
                lineStyle: { width: 2 },
                data: run.series.map((p) => [p.time, p.meanWait]),
              },
              ...(i === 0
                ? [
                    {
                      name: 'P95',
                      type: 'line',
                      showSymbol: false,
                      lineStyle: { type: 'dashed', width: 1, color: '#ffa766' },
                      data: run.series.map((p) => [p.time, p.p95Wait]),
                    },
                  ]
                : []),
            ]
          : [
              {
                name: `${ALGORITHMS.find((a) => a.id === run.algorithm)?.short} ${tab === 'demand' ? '유입' : '대기열'}`,
                type: 'line',
                showSymbol: false,
                areaStyle: { opacity: 0.04 },
                data: run.series.map((p) => [p.time, tab === 'demand' ? p.demand : p.queue]),
              },
            ],
      ),
    };
  return (
    <div className="analytics-grid">
      <section className="panel analytics-panel">
        <div className="panel-heading">
          <span>
            <BarChart3 size={15} />
            성능 분석
          </span>
          <button
            className="text-button"
            onClick={() => {
              const u = chart.current?.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: '#101923',
              });
              if (u) {
                const a = document.createElement('a');
                a.href = u;
                a.download = 'vertex-chart.png';
                a.click();
              }
            }}
          >
            <ArrowDownToLine size={12} />
            PNG
          </button>
        </div>
        <div className="chart-tabs">
          {[
            ['wait', '대기시간'],
            ['queue', '대기열'],
            ['floor', '층별 히트맵'],
            ['demand', '누적 수요'],
            ['trajectory', '이동 궤적'],
            ['distribution', '지연 분포'],
            ['energy', '에너지'],
          ].map(([id, name]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {name}
            </button>
          ))}
        </div>
        <Chart option={option} height={225} onReady={(c) => (chart.current = c)} />
        <div className="chart-foot">
          실제 이벤트 계산값 · 에너지는 단순화된 모델 추정치
          <span>
            SEED {config.seed} · {s?.events ?? 0} EVENTS
          </span>
        </div>
      </section>
      <section className="panel event-panel">
        <div className="panel-heading">
          <span>
            <Activity size={15} />
            이벤트 스트림
          </span>
          <span className="live-tag">EVENT LOG</span>
        </div>
        <div className="event-list">
          {!s?.logs.length ? (
            <div className="empty-log">
              <Waypoints size={26} />
              <p>시뮬레이션 시작을 기다리고 있습니다.</p>
              <span>첫 이벤트부터 모든 운행이 기록됩니다.</span>
            </div>
          ) : (
            s.logs
              .slice(-35)
              .reverse()
              .map((l, i) => (
                <div className="event" key={`${i}-${l.time}`}>
                  <time>{clock(l.time)}</time>
                  <span className="event-type">{l.type}</span>
                  <p>{l.message}</p>
                </div>
              ))
          )}
        </div>
        <div className="conservation">
          <span data-testid="generated-count">{m?.generated ?? 0}</span> 유입 = {m?.waiting ?? 0}{' '}
          대기 + {m?.onboard ?? 0} 탑승 + {m?.completed ?? 0} 완료
        </div>
      </section>
    </div>
  );
}

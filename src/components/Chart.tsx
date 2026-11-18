import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, HeatmapChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
  TitleComponent,
  ToolboxComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
  TitleComponent,
  ToolboxComponent,
  CanvasRenderer,
]);
export default function Chart({
  option,
  height = 240,
  className = '',
  onReady,
}: {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
  onReady?: (instance: EChartsType) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    instance = useRef<EChartsType | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    instance.current = c;
    onReady?.(c);
    const observer = new ResizeObserver(() => c.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      c.dispose();
      instance.current = null;
    };
  }, []);
  useEffect(() => {
    instance.current?.setOption(
      {
        backgroundColor: 'transparent',
        color: ['#38dfb4', '#5c9cff', '#ffa856', '#b19bff'],
        textStyle: { color: '#8493a7', fontFamily: 'Inter, Segoe UI, sans-serif' },
        ...option,
      },
      true,
    );
  }, [option]);
  return (
    <div
      className={'chart ' + className}
      ref={ref}
      style={{ height }}
      role="img"
      aria-label="시뮬레이션 결과 분석 그래프"
    />
  );
}

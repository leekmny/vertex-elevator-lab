import { useEffect, useRef } from 'react';
import type { Config, Snapshot } from '../sim/types';
import { positionAt } from '../sim/physics';
import { displayTime, occupiedColor } from './animation';
import './building.css';
export const CAR_COLORS = ['#45ddb5', '#5c9eff', '#b69aff', '#ffb265', '#ed7f9b', '#65c9df'];
export const floorLabel = (f: number) => (f <= 0 ? `B${1 - f}` : `${f}F`);
export default function Building({
  snapshot,
  config,
  selectedCar,
  onSelectCar,
  onSelectFloor,
  low,
  high,
  compact = false,
  friendly = false,
  running = false,
  playbackSpeed = 1,
  onCallFloor,
}: {
  snapshot?: Snapshot;
  config: Config;
  selectedCar: number;
  onSelectCar: (id: number) => void;
  onSelectFloor: (f: number) => void;
  low: number;
  high: number;
  compact?: boolean;
  friendly?: boolean;
  running?: boolean;
  playbackSpeed?: number;
  onCallFloor?: (floor: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const receivedAt = performance.now();
    let frame = 0;
    const render = () => {
      const ctx = canvas.getContext('2d')!;
      const box = canvas.getBoundingClientRect();
      const w = box.width,
        h = box.height,
        dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      const left = compact ? 44 : 61,
        right = friendly ? 154 : compact ? 48 : 94,
        top = 44,
        bottom = 27;
      const fh = (h - top - bottom) / (high - low + 1),
        shaft = (w - left - right) / config.cars;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0e1621';
      ctx.fillRect(0, 0, w, h);
      const y = (floor: number) => top + (high - floor + 0.5) * fh;
      ctx.font = `${friendly ? 12 : 10}px ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      for (let f = low; f <= high; f++) {
        const q = snapshot?.metrics.floorQueues[f - (1 - config.basements)] ?? 0;
        ctx.fillStyle = f === config.lobby ? '#182b2c' : f % 2 === 0 ? '#121c28' : '#101923';
        ctx.fillRect(left, y(f) - fh / 2, w - left - right, fh);
        if (q > 0) {
          ctx.fillStyle = `rgba(247,166,70,${Math.min(0.18, q / 180)})`;
          ctx.fillRect(left, y(f) - fh / 2, w - left - right, fh);
        }
        ctx.strokeStyle = '#202c3b';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(left - 5, y(f) + fh / 2);
        ctx.lineTo(w - right + 5, y(f) + fh / 2);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillStyle = f === config.lobby ? '#44d9b4' : '#72859b';
        ctx.fillText(floorLabel(f), left - 14, y(f));
        ctx.textAlign = 'left';
        ctx.fillStyle = q > 15 ? '#ffad63' : q > 0 ? '#a3b1c4' : '#3e5066';
        ctx.fillText(friendly ? `${q}명 대기` : String(q).padStart(2, '0'), w - right + 12, y(f));
        if (friendly && fh >= 27) {
          for (let p = 0; p < Math.min(q, 4); p++) {
            const px = w - right + 14 + p * 11,
              py = y(f) + 10;
            ctx.fillStyle = '#f7aa60';
            ctx.beginPath();
            ctx.arc(px, py - 2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(px - 2, py + 1, 4, 5);
          }
        }
        if (!compact && !friendly) {
          const bw = Math.min(31, q * 1.8);
          ctx.fillStyle = q > 25 ? '#e58d57' : '#5c826f';
          ctx.fillRect(w - right + 42, y(f) - 2, bw, 4);
        }
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#54677f';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(friendly ? '층' : 'FLOOR', 12, 20);
      ctx.fillText(friendly ? '기다리는 사람' : 'QUEUE', w - right + 10, 20);
      for (let id = 0; id < config.cars; id++) {
        const color = CAR_COLORS[id % CAR_COLORS.length],
          x = left + shaft * (id + 0.5),
          c = snapshot?.cars[id];
        ctx.strokeStyle = '#223143';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, h - bottom);
        ctx.stroke();
        ctx.fillStyle = id === selectedCar ? color : '#8495ac';
        ctx.textAlign = 'center';
        ctx.font = `${friendly ? 12 : 10}px ui-monospace, monospace`;
        ctx.fillText(friendly ? `${id + 1}호기` : `E${String(id + 1).padStart(2, '0')}`, x, 20);
        const visual = displayTime(
          snapshot?.time ?? 0,
          performance.now() - receivedAt,
          playbackSpeed,
          running,
        );
        const position = c?.motion
          ? positionAt(c.motion, visual, config.floorHeight)
          : (c?.position ?? config.car.home);
        if (position < low - 0.5 || position > high + 0.5) {
          ctx.fillStyle = color;
          ctx.fillText(position > high ? '▲' : '▼', x, position > high ? top + 5 : h - bottom - 5);
          continue;
        }
        const cw = Math.max(5, Math.min(friendly ? 64 : compact ? 34 : 43, shaft - 7)),
          ch = Math.min(friendly ? 39 : 29, fh * 0.88),
          cy = y(position);
        const full = c && c.passengers.length >= c.spec.capacity,
          failed = c?.status === 'failed';
        const occupied = (c?.passengers.length ?? 0) > 0;
        ctx.fillStyle = failed ? '#333942' : occupied ? '#4b301d' : '#153c38';
        ctx.strokeStyle = failed ? '#697283' : occupied ? '#ffb05f' : color;
        ctx.lineWidth = id === selectedCar ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(x - cw / 2, cy - ch / 2, cw, ch, 3);
        ctx.fill();
        ctx.stroke();
        const opening = c?.status === 'opening' || c?.status === 'boarding';
        if (friendly && ch > 16) {
          ctx.fillStyle = occupiedColor(c?.passengers.length ?? 0);
          ctx.shadowColor = '#ff9f43';
          ctx.shadowBlur = occupied ? 12 : 0;
          ctx.beginPath();
          ctx.arc(x + cw / 2 - 6, cy - ch / 2 - 5, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = occupied
          ? opening
            ? '#8b5c2c'
            : '#614426'
          : opening
            ? '#3d8479'
            : '#264a4a';
        ctx.fillRect(x - cw / 2 + 3, cy - ch / 2 + 3, (cw - 6) * (opening ? 0.22 : 0.47), ch - 6);
        ctx.fillRect(
          x + cw / 2 - 3 - (cw - 6) * (opening ? 0.22 : 0.47),
          cy - ch / 2 + 3,
          (cw - 6) * (opening ? 0.22 : 0.47),
          ch - 6,
        );
        ctx.font = `${Math.max(8, Math.min(11, cw / 3))}px ui-monospace, monospace`;
        ctx.fillStyle = failed ? '#8694a4' : '#e0f5ed';
        ctx.fillText(
          failed
            ? '×'
            : `${c?.passengers.length ?? 0}${friendly ? '명' : ''}${shaft > 45 ? (c?.direction === 1 ? ' ↑' : c?.direction === -1 ? ' ↓' : ' ·') : ''}`,
          x,
          cy + 1,
        );
        if (c?.motion) {
          ctx.strokeStyle = color + '50';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, cy);
          ctx.lineTo(x, y(Math.min(high, Math.max(low, c.motion.to))));
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#466477';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${config.floorHeight.toFixed(1)}m / FLOOR`, left, h - 11);
    };
    const animate = () => {
      render();
      if (running) frame = requestAnimationFrame(animate);
    };
    animate();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [snapshot, config, selectedCar, low, high, compact, friendly, running, playbackSpeed]);
  const canvas = (
    <canvas
      ref={ref}
      className="building-canvas"
      aria-label="실시간 승강기 관제"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect(),
          x = e.clientX - box.left,
          y = e.clientY - box.top;
        const left = compact ? 44 : 61,
          right = friendly ? 154 : compact ? 48 : 94;
        if (x > box.width - right || x < left) {
          const f = Math.round(high + 0.5 - (y - 44) / ((box.height - 71) / (high - low + 1)));
          onSelectFloor(Math.max(low, Math.min(high, f)));
        } else
          onSelectCar(
            Math.max(
              0,
              Math.min(
                config.cars - 1,
                Math.floor((x - left) / ((box.width - left - right) / config.cars)),
              ),
            ),
          );
      }}
    />
  );
  if (!friendly) return canvas;
  return (
    <div className="friendly-building" aria-label="건물 보기 · 층과 차량이 많으면 스크롤하세요">
      <div
        className="friendly-building-scene"
        style={
          {
            minWidth: config.cars > 3 ? config.cars * 62 + 215 : undefined,
            '--building-height': `${(high - low + 1) * 28 + 71}px`,
          } as React.CSSProperties
        }
      >
        {canvas}
        <div className="floor-call-buttons" aria-label="층별 엘리베이터 호출">
          {Array.from({ length: high - low + 1 }, (_, i) => high - i).map((f) => {
            const ratio = (high - f + 0.5) / (high - low + 1);
            return (
              <button
                key={f}
                type="button"
                disabled={!onCallFloor || snapshot?.done}
                aria-label={`${floorLabel(f)} 엘리베이터 호출`}
                title={`${floorLabel(f)}에서 승객 1명 호출`}
                style={{ top: `calc(${ratio * 100}% + ${44 - 71 * ratio}px)` }}
                onClick={() => onCallFloor?.(f)}
              >
                {floorLabel(f)} 호출
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

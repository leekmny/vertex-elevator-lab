import type { Motion } from './types';
export function travelTime(distance: number, speed: number, acceleration: number): number {
  if (distance < 0 || speed <= 0 || acceleration <= 0) throw Error('invalid physical parameters');
  return distance <= (speed * speed) / acceleration
    ? 2 * Math.sqrt(distance / acceleration)
    : distance / speed + speed / acceleration;
}
export function positionAt(m: Motion, t: number, floorHeight: number): number {
  if (t <= m.start) return m.from;
  if (t >= m.end) return m.to;
  const duration = m.end - m.start,
    dt = t - m.start,
    ta = Math.min(m.speed / m.acceleration, duration / 2),
    peak = m.acceleration * ta;
  const x =
    dt < ta
      ? 0.5 * m.acceleration * dt * dt
      : dt > duration - ta
        ? m.distance - 0.5 * m.acceleration * (duration - dt) ** 2
        : 0.5 * m.acceleration * ta * ta + peak * (dt - ta);
  return m.from + (Math.sign(m.to - m.from) * x) / floorHeight;
}

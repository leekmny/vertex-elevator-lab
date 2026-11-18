import type { Config, Demand } from './types';
import { allFloors, validateConfig } from './config';
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s += 0x6d2b79f5;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateDemand(c: Config): Demand[] {
  validateConfig(c);
  const random = rng(c.seed),
    fs = allFloors(c),
    list: Demand[] = [];
  const limitError = () =>
    new Error('수요가 300,000명을 초과했습니다. 시간 또는 발생률을 줄이세요');
  const initialCount = fs.reduce((sum, _, i) => sum + Math.ceil(c.initialQueues[i] ?? 0), 0);
  if (initialCount > 300000) throw limitError();
  const weights = fs.map((_, i) => (c.floorWeights[i] ?? 1) * (c.floorPopulation[i] ?? 50));
  const total = weights.reduce((a, b) => a + b, 0);
  const choose = () => {
    let x = random() * total;
    for (let i = 0; i < fs.length; i++) {
      x -= weights[i];
      if (x <= 0) return fs[i];
    }
    return fs[fs.length - 1];
  };
  const other = (o: number) => {
    let z = fs[Math.floor(random() * fs.length)];
    if (z === o) z = fs[(fs.indexOf(o) + 1 + Math.floor(random() * (fs.length - 1))) % fs.length];
    return z;
  };
  const add = (at: number, forced?: number) => {
    if (list.length >= 300000) throw limitError();
    let o = forced ?? choose(),
      d = other(o);
    switch (c.scenario) {
      case 'downpeak':
        if (random() < 0.85) {
          o = o === c.lobby ? other(c.lobby) : o;
          d = c.lobby;
        }
        break;
      case 'uppeak':
      case 'lobby':
        if (random() < 0.9) {
          o = c.lobby;
          d = other(o);
        }
        break;
      case 'hotspot':
        if (random() < 0.8) {
          o = fs[Math.max(0, fs.length - 2)];
          d = other(o);
        }
        break;
      case 'changing':
        if (at < c.duration / 2) {
          o = c.lobby;
          d = other(o);
        } else {
          o = o === c.lobby ? other(c.lobby) : o;
          d = c.lobby;
        }
        break;
    }
    if (forced !== undefined) {
      o = forced;
      if (d === o) d = other(o);
    }
    list.push({ id: list.length, at, origin: o, destination: d });
  };
  fs.forEach((f, i) => {
    for (let n = 0; n < (c.initialQueues[i] ?? 0); n++) add(0, f);
  });
  if (c.scenario === 'simultaneous') {
    if (c.congestion > 0)
      for (const f of fs)
        for (let n = 0; n < Math.max(1, Math.round(c.congestion / 10)); n++) add(0, f);
  } else if (c.rate > 0 && c.congestion > 0 && total > 0) {
    const base = (c.rate * c.congestion) / 100 / 60;
    let t = 0;
    while (t < c.duration) {
      const segment = Math.floor(t / 60),
        factor = c.scenario === 'changing' ? (segment % 2 === 0 ? 0.5 : 1.5) : 1;
      const boundary = Math.min(c.duration, (segment + 1) * 60);
      const next = t - Math.log(Math.max(1e-12, 1 - random())) / (base * factor);
      if (next >= boundary) {
        t = boundary;
        continue;
      }
      t = next;
      add(t);
    }
  }
  return list.sort((a, b) => a.at - b.at || a.id - b.id);
}
export function demandHash(d: Demand[]): string {
  let h = 2166136261;
  for (const p of d) {
    const s = `${p.id}:${p.at}:${p.origin}:${p.destination};`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

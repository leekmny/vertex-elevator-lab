import type { Progress } from '../research/runner';
import type {
  AlgorithmId,
  Config,
  Estimate,
  ExperimentPlan,
  ResearchResult,
  ResearchRow,
  Snapshot,
} from '../sim/types';

export interface EngineExports {
  memory: WebAssembly.Memory;
  vertex_alloc: (length: number) => number;
  vertex_free: (pointer: number, length: number) => void;
  vertex_request: (pointer: number, length: number) => bigint;
}

export function connectRustBackend(engine: EngineExports) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return <T>(request: object): T => {
    const input = encoder.encode(JSON.stringify(request));
    const pointer = engine.vertex_alloc(input.length);
    try {
      new Uint8Array(engine.memory.buffer, pointer, input.length).set(input);
      const address = engine.vertex_request(pointer, input.length);
      const resultPointer = Number(BigInt.asUintN(32, address >> 32n));
      const resultLength = Number(BigInt.asUintN(32, address));
      try {
        const bytes = new Uint8Array(engine.memory.buffer, resultPointer, resultLength);
        const response = JSON.parse(decoder.decode(bytes)) as
          { ok: true; result: T } | { ok: false; error: string };
        if (!response.ok) throw new Error(response.error);
        return response.result;
      } finally {
        engine.vertex_free(resultPointer, resultLength);
      }
    } finally {
      engine.vertex_free(pointer, input.length);
    }
  };
}

export async function loadRustBackend() {
  const response = await fetch(new URL('./generated/vertex_core.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Rust engine load failed (HTTP ${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const invoke = connectRustBackend(instance.exports as unknown as EngineExports);

  return {
    init: (config: Config, algorithms: AlgorithmId[], time?: number) =>
      invoke<Snapshot[]>({ op: 'init', config, algorithms, time }),
    live: (command: { type: string }) => invoke<Snapshot[]>({ op: 'live', command }),
    startResearch: (config: Config, plan: ExperimentPlan) =>
      invoke<null>({ op: 'researchStart', config, plan }),
    stepResearch: () => invoke<Progress | null>({ op: 'researchStep' }),
    finishResearch: (cancelled: boolean) => {
      const result = invoke<SerializedResearchResult>({ op: 'researchFinish', cancelled });
      return { ...result, rows: result.rows.map(restoreLimits) };
    },
  };
}

const estimateKeys = [
  'wait',
  'p95',
  'throughput',
  'journey',
  'fairness',
  'energy',
  'unfinished',
  'queueGrowth',
] as const;
type EstimateKey = (typeof estimateKeys)[number];
type SerializedEstimate = Omit<Estimate, 'low' | 'high'> & {
  low: number | null;
  high: number | null;
};
type SerializedRow = Omit<ResearchRow, EstimateKey> & Record<EstimateKey, SerializedEstimate>;
type SerializedResearchResult = Omit<ResearchResult, 'createdAt' | 'elapsedMs' | 'rows'> & {
  rows: SerializedRow[];
};

function restoreLimits(row: SerializedRow): ResearchRow {
  const normalized = { ...row };
  for (const key of estimateKeys) {
    const { low, high, ...estimate } = row[key];
    normalized[key] = { ...estimate, low: low ?? -Infinity, high: high ?? Infinity };
  }
  return normalized as ResearchRow;
}

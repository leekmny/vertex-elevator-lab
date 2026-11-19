import { loadRustBackend } from './rust-backend';
let cancelled = false,
  busy = false;
let backend: ReturnType<typeof loadRustBackend> | undefined;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (data.type !== 'start' || busy) return;
  busy = true;
  cancelled = false;
  const start = performance.now();
  try {
    const engine = await (backend ??= loadRustBackend());
    engine.startResearch(data.config, data.plan);
    while (!cancelled) {
      const progress = engine.stepResearch();
      if (!progress) break;
      self.postMessage({ type: 'progress', progress });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const result = {
      ...engine.finishResearch(cancelled),
      createdAt: new Date().toISOString(),
      elapsedMs: performance.now() - start,
    };
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy = false;
  }
};

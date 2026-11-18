import { runExperiment } from '../research/runner';
let cancelled = false,
  busy = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (data.type !== 'start' || busy) return;
  busy = true;
  cancelled = false;
  try {
    const result = await runExperiment(data.config, data.plan, {
      shouldCancel: () => cancelled,
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
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

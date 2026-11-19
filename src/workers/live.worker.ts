import { loadRustBackend } from './rust-backend';

let backend: ReturnType<typeof loadRustBackend> | undefined;

self.onmessage = async ({ data }) => {
  try {
    const engine = await (backend ??= loadRustBackend());
    const snapshots =
      data.type === 'init' || data.type === 'seek'
        ? engine.init(data.config, data.algorithms, data.type === 'seek' ? data.time : undefined)
        : engine.live(data);
    self.postMessage({ type: 'snapshots', snapshots });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

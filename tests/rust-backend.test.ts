import { describe, expect, it } from 'vitest';
import { connectRustBackend, type EngineExports } from '../src/workers/rust-backend';

describe('Rust engine transport', () => {
  it('passes UTF-8 JSON and frees the response and request even on an engine error', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const released: [number, number][] = [];
    const output = new TextEncoder().encode('{"ok":false,"error":"층수 오류"}');
    const request = { op: 'test', input: '한글' };
    const exports: EngineExports = {
      memory,
      vertex_alloc: () => 128,
      vertex_free: (pointer, length) => released.push([pointer, length]),
      vertex_request: (pointer, length) => {
        const input = new Uint8Array(memory.buffer, pointer, length);
        expect(JSON.parse(new TextDecoder().decode(input))).toEqual(request);
        new Uint8Array(memory.buffer, 1024, output.length).set(output);
        return (1024n << 32n) | BigInt(output.length);
      },
    };
    expect(() => connectRustBackend(exports)(request)).toThrow('층수 오류');
    expect(released).toEqual([
      [1024, output.length],
      [128, new TextEncoder().encode(JSON.stringify(request)).length],
    ]);
  });
});

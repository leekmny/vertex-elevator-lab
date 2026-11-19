import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = 'wasm32-unknown-unknown';
const crate = 'rust/Cargo.toml';
const cargoArgs = [
  'build',
  '--locked',
  '--release',
  '--target',
  target,
  '--lib',
  '--manifest-path',
  crate,
];

function run(command, args) {
  const process = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (process.error) throw process.error;
  if (process.status !== 0) throw new Error(`${command} exited with code ${process.status}`);
}

const localCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
if (localCargo.status === 0) {
  run('cargo', cargoArgs);
} else {
  run('docker', [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--mount',
    `type=bind,source=${root},target=/workspace`,
    '--workdir',
    '/workspace',
    'rust:1.96-bookworm',
    'sh',
    '-ec',
    'rustup target add wasm32-unknown-unknown && exec cargo "$@"',
    'cargo',
    ...cargoArgs,
  ]);
}
const destination = path.join(root, 'src/workers/generated');
mkdirSync(destination, { recursive: true });
copyFileSync(
  path.join(root, 'rust/target', target, 'release/vertex_core.wasm'),
  path.join(destination, 'vertex_core.wasm'),
);

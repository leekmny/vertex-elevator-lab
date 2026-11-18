import { packager } from '@electron/packager';
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.desktop-build');
const release = path.join(root, 'release');
const destination = path.join(release, 'VERTEX-Windows');
const archive = path.join(release, 'VERTEX-Windows.zip');
function workspacePath(target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Refusing to change path outside project');
  return target;
}
async function removeWorkspace(target) {
  await rm(workspacePath(target), { recursive: true, force: true });
}
await access(path.join(root, 'dist', 'index.html'));
await access(path.join(root, 'LICENSE'));
const original = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  await readFile(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
await removeWorkspace(stage);
await mkdir(stage, { recursive: true });
await cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
await cp(path.join(root, 'desktop'), path.join(stage, 'desktop'), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
await writeFile(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'vertex-desktop',
      version: original.version,
      private: true,
      license: original.license,
      main: 'desktop/main.cjs',
      description: 'VERTEX Elevator Simulator',
      author: 'VERTEX',
    },
    null,
    2,
  ),
);
await mkdir(release, { recursive: true });
await removeWorkspace(path.join(release, 'VERTEX-win32-x64'));
console.log(`Packaging Windows x64 with Electron ${electronVersion}...`);
const [packaged] = await packager({
  dir: stage,
  name: 'VERTEX',
  out: release,
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  executableName: 'VERTEX',
  appVersion: original.version,
  asar: true,
  prune: false,
  overwrite: false,
  quiet: true,
  win32metadata: {
    ProductName: 'VERTEX',
    FileDescription: 'VERTEX Elevator Simulator',
    CompanyName: 'VERTEX',
    OriginalFilename: 'VERTEX.exe',
  },
});
await removeWorkspace(destination);
workspacePath(packaged);
workspacePath(destination);
await rename(packaged, destination);
await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE-VERTEX.txt'));
const thirdPartyLicenses = [];
for (const name of ['react', 'react-dom', 'scheduler', 'echarts', 'zrender', 'lucide-react']) {
  const dependencyRoot = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(dependencyRoot, 'package.json'), 'utf8'));
  const files = await readdir(dependencyRoot);
  const licenseName = files.find((file) => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(file));
  if (!licenseName) throw new Error(`Missing redistribution license for ${name}`);
  thirdPartyLicenses.push(
    `${name} ${metadata.version}\n${await readFile(path.join(dependencyRoot, licenseName), 'utf8')}`,
  );
  for (const notice of files.filter((file) => /^notice(?:\.(?:md|txt))?$/i.test(file))) {
    thirdPartyLicenses.push(
      `${name} ${notice}\n${await readFile(path.join(dependencyRoot, notice), 'utf8')}`,
    );
  }
  if (files.includes('licenses')) {
    for (const license of await readdir(path.join(dependencyRoot, 'licenses'), {
      withFileTypes: true,
    })) {
      if (license.isFile()) {
        thirdPartyLicenses.push(
          `${name}/licenses/${license.name}\n${await readFile(path.join(dependencyRoot, 'licenses', license.name), 'utf8')}`,
        );
      }
    }
  }
}
await writeFile(
  path.join(destination, 'THIRD-PARTY-LICENSES.txt'),
  thirdPartyLicenses.join('\n\n----------------\n\n'),
);
await writeFile(
  path.join(destination, '사용방법.txt'),
  '\uFEFFVERTEX 엘리베이터 시뮬레이터\r\n\r\n1. ZIP 파일을 받았다면 먼저 전체 압축을 풀어주세요.\r\n2. 이 폴더 안의 VERTEX.exe를 더블클릭하세요.\r\n3. 화면이 열리면 바로 애니메이션이 시작됩니다.\r\n\r\n인터넷, Node.js, npm, 별도 서버 실행은 필요하지 않습니다.\r\nEXE 옆의 resources, locales, DLL 파일은 프로그램에 필요합니다. EXE만 따로 옮기지 마세요.\r\n실행 종료는 창의 X 버튼입니다.\r\n\r\n이 빌드는 코드 서명되지 않았습니다. Windows에서 게시자를 확인할 수 없다는 안내가 표시될 수 있습니다.\r\n',
  'utf8',
);
await removeWorkspace(archive);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
await new Promise((resolve, reject) => {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath ${quote(destination)} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`ZIP creation failed: ${code}`)),
  );
});
const executable = path.join(destination, 'VERTEX.exe');
const manifest = {
  builtAt: new Date().toISOString(),
  electronVersion,
  platform: 'win32',
  arch: 'x64',
  executable: path.relative(root, executable),
  archive: path.relative(root, archive),
  archiveBytes: (await stat(archive)).size,
  usesHttpServer: false,
};
await writeFile(path.join(release, 'desktop-manifest.json'), JSON.stringify(manifest, null, 2));
await removeWorkspace(stage);
console.log(JSON.stringify(manifest, null, 2));

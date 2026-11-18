import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { extractFile } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.join(root, 'release', 'VERTEX-Windows', 'VERTEX.exe');
await stat(executablePath);
const bundledProjectLicense = path.join(path.dirname(executablePath), 'LICENSE-VERTEX.txt');
assert.ok(
  await stat(bundledProjectLicense).catch(() => false),
  'Windows bundle must include LICENSE-VERTEX.txt beside the executable',
);
const projectLicense = await readFile(path.join(root, 'LICENSE'), 'utf8');
assert.equal(await readFile(bundledProjectLicense, 'utf8'), projectLicense);
const packagedAsar = path.join(path.dirname(executablePath), 'resources', 'app.asar');
assert.equal(extractFile(packagedAsar, 'LICENSE').toString('utf8'), projectLicense);
assert.equal(JSON.parse(extractFile(packagedAsar, 'package.json').toString('utf8')).license, 'MIT');
const bundledLicenses = await readFile(
  path.join(path.dirname(executablePath), 'THIRD-PARTY-LICENSES.txt'),
  'utf8',
);
for (const licenseFile of ['NOTICE', 'licenses/LICENSE-d3']) {
  const expected = await readFile(path.join(root, 'node_modules', 'echarts', licenseFile), 'utf8');
  assert.ok(
    bundledLicenses.includes(expected.trim()),
    `Windows bundle must preserve ECharts ${licenseFile}`,
  );
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let application;
const errors = [],
  requests = [];
try {
  application = await electron.launch({ executablePath, env, timeout: 45000 });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await page
    .getByLabel('실시간 승강기 관제', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 20000 });
  assert.ok(page.url().startsWith('vertex://app/'), `Expected bundled protocol: ${page.url()}`);
  await page.waitForFunction(
    () => {
      const clock = document.querySelector('[data-testid="simulation-time"]')?.textContent;
      return typeof clock === 'string' && /^\d+:\d{2}$/.test(clock) && clock !== '00:00';
    },
    undefined,
    { timeout: 15000 },
  );
  const firstTime = await page.getByTestId('simulation-time').textContent();
  await page.context().setOffline(true);
  await page.reload();
  await page
    .getByLabel('실시간 승강기 관제', { exact: true })
    .first()
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="generated-count"]')?.textContent?.match(/[1-9]/),
    undefined,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => {
      const clock = document.querySelector('[data-testid="simulation-time"]')?.textContent;
      return typeof clock === 'string' && /^\d+:\d{2}$/.test(clock) && clock !== '00:00';
    },
    undefined,
    { timeout: 15000 },
  );
  const secondTime = await page.getByTestId('simulation-time').textContent();
  const beforeCall = Number(await page.getByTestId('generated-count').textContent());
  await page.getByRole('button', { name: '여러 층 동시 호출', exact: true }).click();
  await page.waitForFunction(
    (before) =>
      Number(document.querySelector('[data-testid="generated-count"]')?.textContent) >= before + 8,
    beforeCall,
    { timeout: 15000 },
  );
  const afterCall = Number(await page.getByTestId('generated-count').textContent());
  assert.ok(afterCall >= beforeCall + 8, 'Simultaneous calls must inject real passengers');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid^="simple-car-load-"]')].some((car) =>
        /탑승\s*[1-9]\d*명\s*\/\s*정원\s*\d+명/.test(car.textContent ?? ''),
      ),
    undefined,
    { timeout: 15000 },
  );
  const security = await page.evaluate(() => ({
    node: typeof window.require,
    protocol: location.protocol,
    worker: typeof Worker,
  }));
  assert.equal(security.node, 'undefined');
  assert.equal(security.protocol, 'vertex:');
  assert.equal(security.worker, 'function');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await mkdir(path.join(root, 'docs', 'screenshots'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'docs', 'screenshots', 'desktop-simple.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
  const comparison = page.getByRole('table', { name: '간단 알고리즘 비교 결과', exact: true });
  await comparison.waitFor({ state: 'visible', timeout: 60000 });
  const comparisonRows = await comparison.locator('tbody tr').count();
  assert.equal(comparisonRows, 14, 'Offline research Worker must compute all 14 algorithms');
  assert.ok(!(await comparison.textContent()).includes('NaN'));
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await page.screenshot({
    path: path.join(root, 'docs', 'screenshots', 'desktop-comparison.png'),
    fullPage: true,
  });
  const result = {
    checkedAt: new Date().toISOString(),
    executablePath: path.relative(root, executablePath),
    scheme: security.protocol,
    offlineReload: true,
    workerSimulationAdvances: true,
    simultaneousCallsAddPassengers: true,
    occupiedCarCapacityVisible: true,
    beforeCall,
    afterCall,
    offlineComparisonAlgorithms: comparisonRows,
    firstTime,
    secondTime,
    rendererNodeIntegration: false,
    projectLicense: 'MIT',
    projectLicensePreserved: true,
    pageErrors: errors,
    httpRequests: requests,
  };
  await writeFile(
    path.join(root, 'release', 'desktop-smoke.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (application) await application.close();
}

// Verify the normal double-click process separately: Playwright's own debugging
// instrumentation opens inspector ports, while a recipient launch must not.
const child = spawn(executablePath, [], { env, windowsHide: true, stdio: 'ignore' });
if (!child.pid) throw new Error('Could not launch packaged executable');
try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(child.exitCode, null, 'The regular EXE launch must stay open');
  const command = `$vertexIds = [System.Collections.Generic.HashSet[int]]::new(); [void]$vertexIds.Add(${child.pid}); $vertexProcesses = Get-CimInstance Win32_Process; for($vertexPass=0; $vertexPass -lt 5; $vertexPass++){ foreach($vertexProcess in $vertexProcesses){ if($vertexIds.Contains([int]$vertexProcess.ParentProcessId)){ [void]$vertexIds.Add([int]$vertexProcess.ProcessId) } } }; @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $vertexIds.Contains([int]$_.OwningProcess) } | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`;
  const output = await new Promise((resolve, reject) => {
    const check = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
    });
    let stdout = '';
    check.stdout.on('data', (chunk) => (stdout += chunk));
    check.on('error', reject);
    check.on('exit', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`Listener check failed: ${code}`)),
    );
  });
  assert.ok(!output || output === '[]', `Packaged app unexpectedly listens on TCP: ${output}`);
  const recordPath = path.join(root, 'release', 'desktop-smoke.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  record.normalLaunchNoListeningTCP = true;
  await writeFile(recordPath, JSON.stringify(record, null, 2));
  console.log('Normal EXE launch: no listening TCP ports.');
} finally {
  child.kill();
}

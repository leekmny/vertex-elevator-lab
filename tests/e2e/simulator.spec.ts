import { test, expect, type Page } from '@playwright/test';
import { defaultConfig } from '../../src/sim/config';

async function openAdvanced(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '고급 연구', exact: true }).click();
}

const runtimeErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  runtimeErrors.length = 0;
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
});
test.afterEach(() => expect(runtimeErrors).toEqual([]));

test('simulation advances, pauses, resumes and resets with changed fleet size', async ({
  page,
}) => {
  await openAdvanced(page);
  await expect(page.getByRole('link', { name: /VERTEX/ })).toBeVisible();
  await page.getByLabel('층수', { exact: true }).fill('5');
  await page.getByLabel('차량 수', { exact: true }).fill('3');
  await page.getByLabel('Seed', { exact: true }).fill('123');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  const clock = page.getByTestId('simulation-time');
  await expect(clock).not.toHaveText('00:00');
  await expect(page.getByLabel('실시간 승강기 관제', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const paused = await clock.innerText();
  await page.waitForTimeout(700);
  await expect(clock).toHaveText(paused);
  await page.getByRole('button', { name: '한 이벤트', exact: true }).click();
  await page.getByRole('button', { name: '재개', exact: true }).click();
  await expect(clock).not.toHaveText(paused);
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(clock).toHaveText('00:00');
});

test('live export downloads JSON with reproducible settings and calculated metrics', async ({
  page,
}) => {
  await openAdvanced(page);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('simulation-time')).not.toHaveText('00:00');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(/\.json$/);
  const stream = await artifact.createReadStream();
  expect(stream).toBeTruthy();
  let text = '';
  for await (const chunk of stream!) text += chunk.toString();
  const exported = JSON.parse(text);
  expect(exported.config.seed).toEqual(expect.any(Number));
  expect(exported.snapshots.length).toBeGreaterThan(0);
  for (const snapshot of exported.snapshots) {
    expect(snapshot.metrics.generated).toBe(
      snapshot.metrics.waiting + snapshot.metrics.onboard + snapshot.metrics.completed,
    );
    expect(snapshot.demandHash).toMatch(/^[0-9a-f]{8}$/);
  }
});

test('calculated analysis chart renders after simulation and speed control works', async ({
  page,
}) => {
  await openAdvanced(page);
  await page.getByLabel('재생 속도', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('generated-count')).not.toHaveText('0');
  await expect(
    page.getByRole('img', { name: '시뮬레이션 결과 분석 그래프' }).first(),
  ).toBeVisible();
  await expect(page.locator('.chart canvas').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const png = await download;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const stream = await png.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('uses the default car spec for an empty imported override slot', async ({ page }) => {
  const config = defaultConfig();
  config.carOverrides[1] = { capacity: 9 };
  await openAdvanced(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'sparse-config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(config)),
  });
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('simulation-time')).not.toHaveText('00:00');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const stream = await (await download).createReadStream();
  let json = '';
  for await (const chunk of stream!) json += chunk.toString();
  const exported = JSON.parse(json);
  expect(exported.config.carOverrides).toEqual([null, { capacity: 9 }]);
  expect(
    exported.snapshots[0].cars.map((car: { spec: { capacity: number } }) => car.spec.capacity),
  ).toEqual([config.car.capacity, 9]);
});

test('comparison workers reuse demand and advance algorithms to a common time', async ({
  page,
}) => {
  await openAdvanced(page);
  await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
  await page.getByLabel('재생 속도', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('generated-count')).not.toHaveText('0');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const stream = await (await download).createReadStream();
  let json = '';
  for await (const chunk of stream!) json += chunk.toString();
  const { snapshots } = JSON.parse(json);
  expect(snapshots).toHaveLength(3);
  expect(new Set(snapshots.map((s: { demandHash: string }) => s.demandHash)).size).toBe(1);
  expect(new Set(snapshots.map((s: { time: number }) => s.time)).size).toBe(1);
  await expect(page.getByLabel('실시간 승강기 관제', { exact: true })).toHaveCount(3);
});

test('imported comparison drains every algorithm after the primary has already finished', async ({
  page,
}) => {
  const config = {
    ...defaultConfig(),
    floors: 5,
    cars: 2,
    rate: 0,
    duration: 30,
    drain: true,
    maxDrain: 1000,
    initialQueues: [3, 3, 3, 3, 3],
  };
  config.car.capacity = 2;
  const imported = { config, algorithms: ['eta', 'nearest'] };
  await openAdvanced(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'reproducible-config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByLabel('층수', { exact: true })).toHaveValue('5');
  await page.getByLabel('재생 속도', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).not.toBeVisible({
    timeout: 15000,
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const stream = await (await download).createReadStream();
  let json = '';
  for await (const chunk of stream!) json += chunk.toString();
  const exported = JSON.parse(json);
  expect(exported.config).toEqual(config);
  expect(exported.algorithms).toEqual(['eta', 'nearest']);
  expect(exported.snapshots.every((snapshot: { done: boolean }) => snapshot.done)).toBe(true);
  expect(exported.snapshots[0].time).toBeLessThan(exported.snapshots[1].time);
  for (const snapshot of exported.snapshots) {
    expect(snapshot.metrics.completed).toBe(15);
    expect(snapshot.metrics.unfinished).toBe(0);
    expect(snapshot.metrics.generated).toBe(
      snapshot.metrics.completed + snapshot.metrics.waiting + snapshot.metrics.onboard,
    );
  }
});

test('research mode is reachable and contains an experiment runner', async ({ page }) => {
  await openAdvanced(page);
  await page.getByRole('button', { name: '연구 모드', exact: true }).click();
  await page.getByLabel('연구 최대 차량', { exact: true }).fill('1');
  await page.getByLabel('연구 반복 횟수', { exact: true }).fill('2');
  await page.getByLabel('연구 실험 시간', { exact: true }).fill('60');
  await page.getByRole('button', { name: '자동 실험 시작', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const stream = await csv.createReadStream();
  let csvText = '';
  for await (const chunk of stream!) csvText += chunk.toString();
  expect(csvText).toContain('mean_wait_s');
  expect(csvText.trim().split('\n')).toHaveLength(5);
});

test('mobile layout keeps settings and playback controls accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdvanced(page);
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
  await expect(page.getByLabel('층수', { exact: true })).toBeVisible();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(395);
});

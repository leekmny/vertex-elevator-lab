import { test, expect } from '@playwright/test';
test('simple app starts animation and pauses without opening research controls', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '엘리베이터 실험실', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '멈춤', exact: true })).toBeEnabled();
  await expect(page.getByTestId('simulation-time')).not.toHaveText('00:00');
  await expect(page.getByLabel('실시간 승강기 관제', { exact: true })).toBeVisible();
  expect(
    await page.locator('.friendly-building').evaluate((el) => el.scrollHeight),
  ).toBeLessThanOrEqual(await page.locator('.friendly-building').evaluate((el) => el.clientHeight));
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  await page.waitForTimeout(150);
  const paused = await page.getByTestId('simulation-time').innerText();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('simulation-time')).toHaveText(paused);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('simulation-time')).not.toHaveText(paused);
});
test('algorithm explanation follows selection and random changes a reproducible experiment', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('알고리즘', { exact: true }).selectOption('fcfs');
  await expect(page.getByTestId('algorithm-explanation')).toContainText('먼저 누른 호출');
  const seed = await page.getByTestId('random-seed').innerText();
  await page.getByRole('button', { name: '랜덤 운행', exact: true }).click();
  await expect(page.getByTestId('random-seed')).not.toHaveText(seed);
  await expect(page.getByRole('button', { name: '멈춤', exact: true })).toBeEnabled();
  await expect(page.getByTestId('algorithm-explanation')).toBeVisible();
  await expect(page.getByText('연속 랜덤', { exact: true })).toBeVisible();
});
test('simple screen fits a narrow window and keeps controls discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '랜덤 운행', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '5F 엘리베이터 호출', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '고급 연구', exact: true }).click();
  await expect(page.getByRole('button', { name: '연구 모드', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '간단 화면으로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '엘리베이터 실험실', exact: true })).toBeVisible();
});

test('continuous random starts a new real experiment after a run ends', async ({ page }) => {
  await page.goto('/');
  const seed = await page.getByTestId('random-seed').innerText();
  await page.getByLabel('연속 랜덤', { exact: true }).check();
  await page.getByLabel('재생 속도', { exact: true }).selectOption('1000');
  await expect(page.getByTestId('random-seed')).not.toHaveText(seed);
  await expect(page.getByLabel('연속 랜덤', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
});

test('a tall building keeps every floor call separate and many cars readable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('층수', { exact: true }).fill('100');
  await page.getByLabel('층수', { exact: true }).press('Enter');
  await page.getByLabel('차량 수', { exact: true }).fill('20');
  await page.getByLabel('차량 수', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '멈춤', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  const buttons = page.locator('.floor-call-buttons button');
  await expect(buttons).toHaveCount(100);
  const topTwo = await buttons.evaluateAll((els) =>
    els.slice(0, 2).map((el) => {
      const { y, height } = el.getBoundingClientRect();
      return { y, height };
    }),
  );
  expect(topTwo[1].y).toBeGreaterThanOrEqual(topTwo[0].y + topTwo[0].height);
  expect(topTwo[0].height).toBeGreaterThanOrEqual(24);
  const canvas = page.getByLabel('실시간 승강기 관제', { exact: true });
  expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(20 * 50 + 215);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: '1F 엘리베이터 호출', exact: true })).toContainText(
    '1F',
    { timeout: 1000 },
  );
  await page.getByRole('button', { name: '1F 엘리베이터 호출', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1층');
});

test('simple comparison calculates all fourteen methods with the real research worker', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
  const table = page.getByRole('table', { name: '간단 알고리즘 비교 결과' });
  await expect(table).toBeVisible({ timeout: 30000 });
  await expect(table.getByRole('row')).toHaveCount(15);
  await expect(table.getByText('목적지 사전 입력', { exact: true })).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText(/\d+\.\d/);
  await page.getByLabel('비교 기준', { exact: true }).selectOption('throughput');
  await expect(table.getByRole('columnheader').nth(1)).toHaveText('1분 동안 도착한 사람');
  await expect(table.getByRole('row').nth(1)).toContainText('명/분');
  expect(errors).toEqual([]);
});

test('a timed comparison cannot rank an unsampled repetition as a zero-second trip', async ({
  page,
}) => {
  await page.goto('/tests/e2e/comparison-fixture.html');
  await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
  const table = page.getByRole('table', { name: '간단 알고리즘 비교 결과' });
  await expect(table).toBeVisible({ timeout: 30000 });
  await page.getByLabel('비교 기준', { exact: true }).selectOption('journey');
  const staticRow = table.getByRole('row').filter({ hasText: '구역을 나누어 담당하기' });
  await expect(staticRow).toContainText('관측 부족 (2/3회)');
  await expect(page.locator('.simple-winner')).not.toContainText('구역을 나누어 담당하기');
});

test('dimension drafts accept ordinary typing without restarting the run before commit', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('simulation-time')).not.toHaveText('00:00');
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  await page.waitForTimeout(150);
  const floors = page.getByLabel('층수', { exact: true });
  const cars = page.getByLabel('차량 수', { exact: true });
  const scene = page.locator('.simple-scene-note');
  const time = await page.getByTestId('simulation-time').innerText();
  await floors.focus();
  await floors.press('ControlOrMeta+A');
  await floors.press('Backspace');
  await expect(floors).toHaveValue('');
  await floors.pressSequentially('25');
  await expect(floors).toHaveValue('25');
  await expect(scene).toContainText('10층');
  await expect(page.getByTestId('simulation-time')).toHaveText(time);
  await floors.press('Enter');
  await expect(scene).toContainText('25층');
  await expect(page.getByRole('button', { name: '멈춤', exact: true })).toBeEnabled();
  await cars.focus();
  await cars.press('ControlOrMeta+A');
  await cars.press('Backspace');
  await expect(cars).toHaveValue('');
  await cars.pressSequentially('12');
  await expect(cars).toHaveValue('12');
  await expect(scene).toContainText('엘리베이터 3대');
  await cars.press('Tab');
  await expect(scene).toContainText('엘리베이터 12대');
});

test('dimension commits accept supported limits and restore invalid drafts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '멈춤', exact: true }).waitFor();
  const floors = page.getByLabel('층수', { exact: true });
  const cars = page.getByLabel('차량 수', { exact: true });
  const scene = page.locator('.simple-scene-note');
  for (const count of ['100', '5']) {
    await floors.fill(count);
    await floors.press('Enter');
    await expect(scene).toContainText(`${count}층`);
  }
  for (const count of ['20', '1']) {
    await cars.fill(count);
    await cars.press('Enter');
    await expect(scene).toContainText(`엘리베이터 ${count}대`);
  }
  for (const invalid of ['', '4', '101', '5.5']) {
    await floors.fill(invalid);
    await floors.press('Tab');
    await expect(floors).toHaveValue('5');
    await expect(scene).toContainText('5층');
  }
  for (const invalid of ['', '0', '21', '1.5']) {
    await cars.fill(invalid);
    await cars.press('Tab');
    await expect(cars).toHaveValue('1');
    await expect(scene).toContainText('엘리베이터 1대');
  }
  await floors.fill('60');
  await page.getByRole('button', { name: '랜덤 운행', exact: true }).click();
  const expectedFloor = (await scene.innerText()).match(/^(\d+)층/)![1];
  const expectedCars = (await scene.innerText()).match(/엘리베이터 (\d+)대/)![1];
  await expect(floors).toHaveValue(expectedFloor);
  await expect(cars).toHaveValue(expectedCars);
  await floors.fill('');
  await page.getByRole('button', { name: '처음부터', exact: true }).click();
  await expect(floors).toHaveValue(expectedFloor);
});

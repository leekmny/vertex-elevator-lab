import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('docs/screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1080 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto('http://127.0.0.1:5173');
await page.getByRole('heading', { name: '엘리베이터 실험실', exact: true }).waitFor();
await page.getByRole('button', { name: '멈춤', exact: true }).waitFor();
await page.getByLabel('재생 속도', { exact: true }).selectOption('25');
await page.waitForFunction(() => {
  return Array.from(document.querySelectorAll('.simple-car-legend button')).some((button) =>
    /탑승 [1-9]\d*명/.test(button.textContent ?? ''),
  );
});
await page.getByRole('button', { name: '멈춤', exact: true }).click();
await page.screenshot({ path: 'docs/screenshots/simple-desktop.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'docs/screenshots/simple-mobile.png', fullPage: true });
const simpleMobileWidth = await page.evaluate(() => document.documentElement.scrollWidth);
if (simpleMobileWidth > 395) throw new Error(`Simple mobile overflow: ${simpleMobileWidth}px`);
await page.setViewportSize({ width: 1600, height: 1080 });
await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
await page.getByRole('table', { name: '간단 알고리즘 비교 결과' }).waitFor();
await page.screenshot({ path: 'docs/screenshots/simple-comparison-desktop.png', fullPage: true });
await page.getByLabel('층수', { exact: true }).fill('100');
await page.getByLabel('층수', { exact: true }).press('Enter');
await page.getByLabel('차량 수', { exact: true }).fill('20');
await page.getByLabel('차량 수', { exact: true }).press('Enter');
await page.getByRole('button', { name: '멈춤', exact: true }).click();
await page.getByLabel('표시 층', { exact: true }).selectOption('1:20');
await page.locator('.friendly-building').evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.screenshot({
  path: 'docs/screenshots/building-100f-20cars-desktop.png',
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.friendly-building').evaluate((el) => {
  el.scrollTop = el.scrollHeight;
  el.scrollLeft = el.scrollWidth;
});
await page.screenshot({ path: 'docs/screenshots/building-100f-20cars-mobile.png', fullPage: true });
await page.setViewportSize({ width: 1600, height: 1080 });
await page.getByRole('button', { name: '고급 연구', exact: true }).click();
await page.getByLabel('재생 속도', { exact: true }).selectOption('100');
await page.getByRole('button', { name: '시작', exact: true }).click();
await page.waitForFunction(() => {
  const clock = document.querySelector('[data-testid="simulation-time"]')?.textContent ?? '';
  return Number(clock.split(':')[0]) >= 1;
});
await page.getByRole('button', { name: '일시정지', exact: true }).click();
await page.screenshot({ path: 'docs/screenshots/live-desktop.png', fullPage: true });
await page.getByRole('button', { name: '알고리즘 비교', exact: true }).click();
await page.getByRole('button', { name: '시작', exact: true }).click();
await page.waitForFunction(
  () =>
    Number(
      (document.querySelector('[data-testid="simulation-time"]')?.textContent ?? '0').split(':')[0],
    ) >= 1,
);
await page.getByRole('button', { name: '일시정지', exact: true }).click();
await page.screenshot({ path: 'docs/screenshots/comparison-desktop.png', fullPage: true });
await page.getByRole('button', { name: '연구 모드', exact: true }).click();
await page.getByLabel('연구 최대 차량', { exact: true }).fill('2');
await page.getByLabel('연구 반복 횟수', { exact: true }).fill('2');
await page.getByLabel('연구 실험 시간', { exact: true }).fill('60');
await page.getByRole('button', { name: '자동 실험 시작', exact: true }).click();
await page.getByRole('table').waitFor();
await page.screenshot({ path: 'docs/screenshots/research-desktop.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: '라이브 관제', exact: true }).click();
await page.screenshot({ path: 'docs/screenshots/live-mobile.png', fullPage: true });
const width = await page.evaluate(() => document.documentElement.scrollWidth);
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
if (width > 395) throw new Error(`Mobile overflow: ${width}px`);
console.log(
  JSON.stringify({
    screenshots: 9,
    runtimeErrors: errors,
    mobileScrollWidth: width,
    simpleMobileWidth,
  }),
);

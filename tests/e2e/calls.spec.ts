import { test, expect } from '@playwright/test';

test('many-floor calls add real passengers and car capacity is readable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const call = page.getByRole('button', { name: '여러 층 동시 호출', exact: true });
  await expect(call).toBeVisible({ timeout: 2000 });
  const pause = page.getByRole('button', { name: '멈춤', exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.waitForTimeout(150);
  const generated = page.getByTestId('generated-count');
  const before = Number(await generated.innerText());
  await call.click();
  await expect
    .poll(async () => Number(await generated.innerText()))
    .toBeGreaterThanOrEqual(before + 8);
  await expect(page.getByTestId('simple-car-load-0')).toContainText(
    /탑승\s*\d+명\s*\/\s*정원\s*\d+명/,
  );
  expect(errors).toEqual([]);
});

test('a floor button adds a real passenger and occupied cars light orange', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '멈춤', exact: true }).click();
  const before = Number(await page.getByTestId('generated-count').innerText());
  await page.getByRole('button', { name: '5F 엘리베이터 호출', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('5층');
  await expect
    .poll(async () => Number(await page.getByTestId('generated-count').innerText()))
    .toBeGreaterThanOrEqual(before + 1);
  await page.getByLabel('재생 속도', { exact: true }).selectOption('25');
  await expect
    .poll(() =>
      page
        .locator('.simple-car-legend button')
        .evaluateAll((buttons) =>
          buttons.some(
            (button) =>
              /탑승 [1-9]\d*명/.test(button.textContent ?? '') &&
              getComputedStyle(button.querySelector('i')!).backgroundColor === 'rgb(255, 173, 85)',
          ),
        ),
    )
    .toBe(true);
});

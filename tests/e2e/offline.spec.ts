import { test, expect } from '@playwright/test';
import securityHeaders from '../../security-headers.json' with { type: 'json' };

test('built shell, pitch worker and codecs work after going offline and reloading', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const response = await page.goto('/');
  for (const [name, value] of Object.entries(securityHeaders))
    expect(response?.headers()[name.toLowerCase()]).toBe(value);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state;
        }),
      { timeout: 15000 },
    )
    .toBe('activated');
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByLabel('Generator duration (s)').fill('0.4');
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('slider', { name: /^Independent pitch/ }).fill('-7');
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await page.getByLabel('Export format').selectOption('mp3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP3', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mp3$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Export MP3', exact: true }).click();
  await page.getByLabel('Export format').selectOption('ogg');
  const oggDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download OGG', exact: true }).click();
  expect((await oggDownload).suggestedFilename()).toMatch(/\.ogg$/);
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Portable backup', exact: true }).click();
  expect((await backup).suggestedFilename()).toMatch(/\.vafx$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

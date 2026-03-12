import { test } from '@playwright/test';

test('mbd pipe screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(
    'http://192.168.11.138:3101/?output_project=AvevaMarineSample&mbd_pipe=24381/145018',
    { waitUntil: 'networkidle', timeout: 60_000 },
  );

  await page.waitForTimeout(10000);

  await page.screenshot({
    path: 'e2e/screenshots/mbd-pipe-load.png',
    fullPage: false,
  });
});

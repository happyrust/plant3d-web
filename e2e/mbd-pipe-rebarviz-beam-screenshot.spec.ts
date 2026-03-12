import { test, expect } from '@playwright/test';

test('mbd pipe rebarviz beam demo screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(
    '/?dtx_demo=mbd_pipe&mbd_pipe_case=rebarviz_beam&mbd_dim_mode=rebarviz',
    {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    },
  );

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = (window as any).__xeokitViewer;
          return !!v?.scene;
        }),
      { timeout: 20000, message: '等待 mbd_pipe rebarviz_beam demo 初始化' },
    )
    .toBeTruthy();

  await page.waitForTimeout(4000);
  await page.screenshot({
    path: 'e2e/screenshots/mbd-pipe-rebarviz-beam.png',
    fullPage: false,
  });
});

import { test, expect } from '@playwright/test'

test('mbd sandbox annotation screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/mbd-pipe-sandbox.html', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })

  // 等待 sandbox 初始化完成
  await expect
    .poll(() => page.evaluate(() => (window as any).__mbdPipeSandboxReady), {
      message: '等待 sandbox 初始化',
      timeout: 15_000,
    })
    .toBeTruthy()

  // 等待几帧渲染
  await page.waitForTimeout(3000)

  await page.screenshot({
    path: 'e2e/screenshots/mbd-sandbox.png',
    fullPage: false,
  })
})

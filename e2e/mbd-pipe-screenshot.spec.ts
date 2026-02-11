import { test } from '@playwright/test'

test('mbd pipe screenshot', async ({ page }) => {
  // 设置较大视口
  await page.setViewportSize({ width: 1920, height: 1080 })

  await page.goto(
    '/?output_project=AvevaMarineSample&mbd_pipe=24381/145018',
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
  )

  // 等待 MBD pipe API 响应
  await page.waitForResponse(
    resp => resp.url().includes('/api/mbd/pipe/'),
    { timeout: 20_000 },
  )

  // 等待 toast 出现（"已生成标注"表示渲染完成）
  await page.waitForTimeout(8000)

  await page.screenshot({
    path: 'e2e/screenshots/mbd-pipe-load.png',
    fullPage: false,
  })
})

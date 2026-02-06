import { test, expect } from '@playwright/test'

test('dimension pipe sandbox should expose expected clearance texts', async ({ page }) => {
  await page.goto('/dimension-pipe-sandbox.html', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => (window as any).__dimensionPipeSandboxReady === true)

  const texts = await page.evaluate(() => (window as any).__dimensionPipeSandbox?.getTexts?.())
  const distances = await page.evaluate(() => (window as any).__dimensionPipeSandbox?.getDistances?.())

  expect(texts.pipe_wall).toBe('0.50')
  expect(texts.pipe_column).toBe('0.50')

  expect(Number(distances.pipe_wall)).toBeCloseTo(0.5, 6)
  expect(Number(distances.pipe_column)).toBeCloseTo(0.5, 6)
})


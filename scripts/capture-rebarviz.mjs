import { chromium } from 'playwright'

async function captureRebarViz() {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.goto('https://brucelee1024.github.io/RebarViz/beam', {
    waitUntil: 'networkidle',
    timeout: 30000
  })

  await page.waitForTimeout(3000)

  await page.screenshot({
    path: 'rebarviz-reference.png',
    fullPage: false
  })

  console.log('截图已保存到 rebarviz-reference.png')
  await browser.close()
}

captureRebarViz().catch(console.error)

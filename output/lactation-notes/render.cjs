const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(__dirname, 'render.html').replace(/\\/g, '/')}`);
  await page.evaluate(() => document.fonts.ready);
  const pages = await page.locator('.page').all();
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: path.join(__dirname, `产后乳房胀满处理笔记-${String(i + 1).padStart(2, '0')}.png`) });
  }
  await browser.close();
})();

import { chromium } from 'playwright';

async function screenshotLargestCanvas(page, path) {
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.some((c) => c.clientWidth > 400 && c.clientHeight > 240);
  });

  const handles = await page.$$('canvas');
  let best = null;
  let bestArea = -1;
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      best = handle;
      bestArea = area;
    }
  }
  if (!best) throw new Error('未找到可截图的 canvas');
  await best.screenshot({ path });
}

async function compareAnnotations() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1536, height: 768 },
  });

  // 截取 RebarViz
  console.log('截取 RebarViz...');
  await page.goto('https://brucelee1024.github.io/RebarViz/beam', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  const skip = page.getByRole('button', { name: '跳过教程' });
  if (await skip.count()) {
    await skip
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  const dimBtn = page.getByRole('button', { name: '尺寸标注' });
  if (await dimBtn.count()) {
    await dimBtn
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  const standardBeamBtn = page.getByRole('button', { name: '标准梁' });
  if (await standardBeamBtn.count()) {
    await standardBeamBtn
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);

  await screenshotLargestCanvas(page, 'comparison-rebarviz.png');

  // 截取我们的 demo
  console.log('截取本地 demo...');
  await page.goto('http://127.0.0.1:5173/rebar-beam-demo.html', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__rebarBeamDemoReady === true, {
    timeout: 30000,
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const status = document.getElementById('status');
    const info = document.getElementById('info');
    if (status) status.style.display = 'none';
    if (info) info.style.display = 'none';
  });
  await screenshotLargestCanvas(page, 'comparison-our-demo.png');

  console.log('截图完成:');
  console.log('  - comparison-rebarviz.png');
  console.log('  - comparison-our-demo.png');

  await browser.close();
}

compareAnnotations().catch(console.error);

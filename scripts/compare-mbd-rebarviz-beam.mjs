import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

function parseArgs(argv) {
  const args = {
    outDir: process.env.OUT_DIR || 'e2e/screenshots/rebarviz-beam',
    stamp: process.env.OUT_STAMP || '',
    baseUrl: process.env.BASE_URL || 'http://127.0.0.1:5173',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!val) continue;
    if (key === '--out-dir') {
      args.outDir = val;
      i += 1;
      continue;
    }
    if (key === '--stamp') {
      args.stamp = val;
      i += 1;
      continue;
    }
    if (key === '--base-url') {
      args.baseUrl = val;
      i += 1;
    }
  }

  return args;
}

function resolveStamp(rawStamp) {
  if (rawStamp === 'none' || rawStamp === 'off') return '';
  if (rawStamp && rawStamp.trim().length > 0) return rawStamp.trim();
  return new Date()
    .toISOString()
    .replaceAll(':', '')
    .replaceAll('.', '-');
}

async function screenshotLargestCanvas(page, path) {
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.some((c) => c.clientWidth > 480 && c.clientHeight > 320);
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

async function captureRebarvizReference(page, outPath) {
  console.log('[compare] 打开 RebarViz 参考页...');
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
  await screenshotLargestCanvas(page, outPath);
}

async function captureOurViewerCase(page, baseUrl, outPath) {
  const caseUrl =
    `${baseUrl}/?dtx_demo=mbd_pipe` +
    '&mbd_pipe_case=rebarviz_beam' +
    '&mbd_dim_mode=rebarviz';
  console.log('[compare] 打开本地 DTX 对标案例...', caseUrl);
  await page.goto(caseUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForFunction(
    () => {
      const v = window.__xeokitViewer;
      if (v?.scene) return true;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.some((c) => c.clientWidth > 480 && c.clientHeight > 320);
    },
    { timeout: 90000 },
  );
  await page.waitForTimeout(4500);

  await page.evaluate(() => {
    const hideSelectors = [
      '.viewer-toolbar',
      '.viewer-right-toolbar',
      '.viewer-left-toolbar',
      '.ribbon-app-bar',
      '.dockview-theme-abyss',
      '.v-overlay',
      '.v-snackbar',
      '.v-navigation-drawer',
      '.v-app-bar',
    ];
    for (const selector of hideSelectors) {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = 'none';
      });
    }
  });

  await screenshotLargestCanvas(page, outPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = resolveStamp(args.stamp);
  const prefix = stamp ? `${stamp}-` : '';

  await mkdir(args.outDir, { recursive: true });
  const outRef =
    process.env.OUT_REBARVIZ ||
    path.join(args.outDir, `${prefix}comparison-rebarviz-beam.png`);
  const outOur =
    process.env.OUT_OURS ||
    path.join(args.outDir, `${prefix}comparison-our-mbd-pipe-rebarviz-beam.png`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1728, height: 900 },
  });

  try {
    console.log('[compare] 输出目录:', args.outDir);
    console.log('[compare] 时间戳:', stamp || '(关闭)');
    await captureRebarvizReference(page, outRef);
    await captureOurViewerCase(page, args.baseUrl, outOur);
    console.log('[compare] 截图完成:');
    console.log('  -', outRef);
    console.log('  -', outOur);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[compare] 失败:', err);
  process.exitCode = 1;
});

/**
 * 截图脚本 · 设计端批注处理双胞胎面板 token 迁移前后对比（#46/#47）
 *
 * 前置：`npx vite --port 5192 --strictPort` 已在仓库根目录跑起来。
 * 用法：`node harness/review-twins.shots.mjs before|after`
 * 输出：scripts/pen-preview/out-review-twins/<label>-designer-comment-panel*.png（目录被 gitignore）
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const label = process.argv[2];
if (label !== 'before' && label !== 'after') {
  console.error('usage: node harness/review-twins.shots.mjs before|after');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'scripts', 'pen-preview', 'out-review-twins');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1620, height: 1060 }, deviceScaleFactor: 1 });
  // 后端 API 静默失败，保证 harness 种子数据不被覆盖（不拦截 vite 模块请求）。
  await page.route('**/*', (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    const isBackendApi = pathname.startsWith('/api/') && (req.resourceType() === 'fetch' || req.resourceType() === 'xhr');
    if (isBackendApi) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    }
    return route.continue();
  });

  await page.goto('http://localhost:5192/harness/review-twins.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="designer-comment-annotation-list"]', { timeout: 20000 });
  await page.waitForTimeout(600);

  const host = page.locator('[data-shot="designer-comment-panel"]');
  await host.screenshot({ path: resolve(outDir, `${label}-designer-comment-panel.png`) });
  console.log(`shot ${label}-designer-comment-panel.png`);

  // 选中一行（单击）以展示选中态描边，再截一张
  await page.locator('[data-testid="designer-comment-annotation-list"] button.block').first().click();
  await page.waitForTimeout(400);
  await host.screenshot({ path: resolve(outDir, `${label}-designer-comment-panel-selected.png`) });
  console.log(`shot ${label}-designer-comment-panel-selected.png`);
} finally {
  await browser.close();
}

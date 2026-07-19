/**
 * 截图脚本 · 批注呈现面 token 迁移前后对比（#46/#47）
 *
 * 前置：`npx vite --port 5192 --strictPort` 已在仓库根目录跑起来。
 * 用法：`node harness/review-annot.shots.mjs before|after`
 * 输出：scripts/pen-preview/out-review-annot/<label>-<section>.png（该目录被 gitignore，产物仅本地留存）
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const label = process.argv[2];
if (label !== 'before' && label !== 'after') {
  console.error('usage: node harness/review-annot.shots.mjs before|after');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'scripts', 'pen-preview', 'out-review-annot');
mkdirSync(outDir, { recursive: true });

const SECTIONS = ['table-wide', 'table-compact', 'workspace-list', 'timeline-normal', 'timeline-dock'];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5192/harness/review-annot.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-shot="table-wide"] [data-testid="annotation-table-view"]', { timeout: 20000 });

  // 在两个时间线 composer 里输入文字，让“发送/提交”主按钮进入 enabled（着色）态
  const textareas = page.locator('[data-shot="timeline-normal"] textarea, [data-shot="timeline-dock"] textarea');
  const count = await textareas.count();
  for (let i = 0; i < count; i++) {
    await textareas.nth(i).fill('示例：主操作按钮着色态');
  }
  // 选中一个处理结果动作，让提交按钮 enabled
  await page.locator('[data-shot="timeline-normal"] button:has-text("已修改")').first().click().catch(() => {});
  await page.locator('[data-shot="timeline-dock"] button:has-text("已修改")').first().click().catch(() => {});
  await page.waitForTimeout(500);

  for (const section of SECTIONS) {
    const el = page.locator(`[data-shot="${section}"]`);
    await el.screenshot({ path: resolve(outDir, `${label}-${section}.png`) });
    console.log(`shot ${label}-${section}.png`);
  }
} finally {
  await browser.close();
}

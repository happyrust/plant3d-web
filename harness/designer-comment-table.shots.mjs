/**
 * 截图场景 · 设计端「批注处理」面板方案 A
 *
 * 用法（仓库根目录）：
 *   SHOT_STAGE=p1 node scripts/visual-baseline/shot.mjs harness/designer-comment-table.html --port 5190 --out <dir>
 * SHOT_STAGE 只决定文件名前缀（p0 / p1 / …），便于同一目录里按批次对比。
 */
const stage = process.env.SHOT_STAGE || 'p1';

export const viewport = { width: 1232, height: 932 };

export async function routes(page) {
  // 谓词式 catch-all：只拦后端接口，不拦 /src/api/*.ts 模块请求（见 harness/README.md 踩坑）
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: false }),
  }));
}

async function openAt(page, base, width, height) {
  await page.setViewportSize({ width: width + 32, height: height + 32 });
  await page.goto(`${base}/harness/designer-comment-table.html?w=${width}&h=${height}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('[data-testid^="annotation-table-row-"]', { timeout: 20000 });
  await page.waitForTimeout(400);
}

export async function run({ page, shot, base }) {
  await openAt(page, base, 1200, 900);
  await shot(`${stage}-1200x900`);

  await page.locator('[data-testid="designer-task-switcher-trigger"]').click();
  await page.waitForSelector('[data-testid="designer-task-switcher-list"]');
  await shot(`${stage}-1200x900-switcher-open`);
  await page.keyboard.press('Escape');

  const allTab = page.locator('[data-testid="designer-status-tab-all"]');
  if (await allTab.count()) {
    await allTab.click();
    await page.waitForTimeout(300);
    await shot(`${stage}-1200x900-tab-all`);
  }

  await page.locator('[data-testid^="annotation-table-row-"]').first().click();
  await page.waitForSelector('[data-testid="annotation-inline-detail-card"]');
  await page.waitForTimeout(300);
  await shot(`${stage}-1200x900-row-expanded`);

  await openAt(page, base, 1200, 640);
  await shot(`${stage}-1200x640`);

  await openAt(page, base, 760, 768);
  await shot(`${stage}-760x768`);
}

/**
 * 截图场景 · 设计端「批注处理」面板方案 A
 *
 * 用法（仓库根目录）：
 *   SHOT_STAGE=p3 node scripts/visual-baseline/shot.mjs harness/designer-comment-table.html --port 5193 --out <dir>
 * SHOT_STAGE 只决定文件名前缀（p0 / p1 / …），便于同一目录里按批次对比。
 * 出图：面板宽 720 / 1000 / 1200 × 三种状态（有批注 / 空单 / 加载失败）。有批注的展开第一行，看展开区按面板宽度分列；
 * 另补一张 720×600，看最窄最矮时的顶栏和底栏。
 */
const stage = process.env.SHOT_STAGE || 'p3';

export const viewport = { width: 1232, height: 932 };

const WIDTHS = [720, 1000, 1200];

const READY_SELECTOR = {
  annotated: '[data-testid^="annotation-table-row-"]',
  empty: '[data-testid="annotation-table-empty"]',
  error: '[data-testid="designer-comment-task-entry"]',
};

export async function routes(page) {
  // 谓词式 catch-all：只拦后端接口，不拦 /src/api/*.ts 模块请求（见 harness/README.md 踩坑）
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: false }),
  }));
}

async function openAt(page, base, width, height, state = 'annotated') {
  await page.setViewportSize({ width: width + 32, height: height + 32 });
  await page.goto(`${base}/harness/designer-comment-table.html?w=${width}&h=${height}&state=${state}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector(READY_SELECTOR[state], { timeout: 20000 });
  await page.waitForTimeout(400);
}

export async function run({ page, shot, base }) {
  for (const width of WIDTHS) {
    await openAt(page, base, width, 900);
    await page.locator('[data-testid^="annotation-table-row-"]').first().click();
    await page.waitForSelector('[data-testid="annotation-inline-detail-card"]');
    await page.waitForTimeout(300);
    await shot(`${stage}-annotated-${width}x900-row-expanded`);
  }

  await openAt(page, base, 720, 600);
  await shot(`${stage}-annotated-720x600`);

  for (const state of ['empty', 'error']) {
    for (const width of WIDTHS) {
      await openAt(page, base, width, 900, state);
      await shot(`${stage}-${state}-${width}x900`);
    }
  }
}

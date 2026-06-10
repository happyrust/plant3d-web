// spec 004 T403: 日志抽屉浏览器冒烟(Playwright chromium,与系统 Chrome 隔离)。
// 用法: node debug_scripts/log-drawer-smoke.mjs <admin_token>
// 产物: artifacts/log-drawer-*.png + stdout 断言结果。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const token = process.argv[2];
if (!token) {
  console.error('missing admin token arg');
  process.exit(2);
}
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3101';
mkdirSync('artifacts', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200));
});

await page.addInitScript(([tok]) => {
  localStorage.setItem('review.flag.REVIEW_H_LOG_DRAWER', '1');
  localStorage.setItem('review_auth_token', tok);
  localStorage.setItem('plant3d_debug_ui', '1');
}, [token]);

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000); // viewer 初始化
await page.screenshot({ path: 'artifacts/log-drawer-0-app.png' });

// 找日志抽屉悬浮按钮(在 ReviewPanel 内,需要先经 ribbon「校审」tab → 「校审面板」按钮打开 dock)
const trigger = page.getByTestId('log-drawer-trigger');
if (!(await trigger.isVisible().catch(() => false))) {
  const reviewTab = page.locator('button, [role="tab"]').filter({ hasText: /^校审$/ }).first();
  if (await reviewTab.isVisible().catch(() => false)) {
    await reviewTab.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const panelBtn = page.locator('button').filter({ hasText: '校审面板' }).first();
  console.log('panel-btn visible =', await panelBtn.isVisible().catch(() => false));
  if (await panelBtn.isVisible().catch(() => false)) {
    await panelBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
}

const triggerVisible = await trigger.isVisible().catch(() => false);
console.log('ASSERT trigger-visible =', triggerVisible);
await page.screenshot({ path: 'artifacts/log-drawer-1-before-open.png' });

if (triggerVisible) {
  await trigger.click();
  await page.waitForTimeout(2500);
  const drawer = page.getByTestId('log-drawer');
  console.log('ASSERT drawer-visible =', await drawer.isVisible().catch(() => false));

  const tabTexts = await drawer.locator('button').allTextContents();
  console.log('drawer tabs:', JSON.stringify(tabTexts.filter(t => t.trim()).slice(0, 12)));
  await page.screenshot({ path: 'artifacts/log-drawer-2-open.png' });

  // 切到接口日志 tab
  const apiTab = drawer.locator('button', { hasText: '接口日志' }).first();
  if (await apiTab.isVisible().catch(() => false)) {
    await apiTab.click();
    await page.waitForTimeout(2000);
    const entryCount = await drawer.locator('ul > li').count();
    console.log('ASSERT api.request entries =', entryCount);
    await page.screenshot({ path: 'artifacts/log-drawer-3-api-request.png' });
  }

  // 切到站点日志·parse tab
  const parseTab = drawer.locator('button', { hasText: 'parse' }).first();
  if (await parseTab.isVisible().catch(() => false)) {
    await parseTab.click();
    await page.waitForTimeout(2000);
    const parseEntries = await drawer.locator('ul > li').count();
    const emptyHint = await drawer.getByText('没有匹配的日志记录').isVisible().catch(() => false);
    console.log('ASSERT site.file.parse entries =', parseEntries, 'emptyHint =', emptyHint);
    await page.screenshot({ path: 'artifacts/log-drawer-4-site-parse.png' });
  }
}

await browser.close();
console.log('DONE');

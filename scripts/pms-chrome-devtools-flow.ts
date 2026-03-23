/**
 * PowerPMS 完整入口：http://pms.powerpms.net:1801/sysin.html
 *
 * 流程：登录 → 设计交付 → 三维校审单 →「新增」→（可选）轮询填写 PMS 弹窗 →（可选）URL 断言
 * →（可选）plant3d 内注入构件 + 填数据包名 + 点击「创建提资数据」→ 等待成功提示。
 *
 * 通过 Playwright 驱动 Chromium，底层使用 **Chrome DevTools Protocol (CDP)**。
 *
 * 运行：
 * - `npm run test:pms:cdp` — 按需用环境变量打开各阶段
 * - `npm run test:pms:cdp:full` — 等价于开启「全流程」常用开关（仍须配置密码与嵌入域名片段）
 *
 * 环境变量见 docs/verification/pms-3d-review-integration-e2e.md
 */
import { chromium } from 'playwright';

import {
  assertNoCaptchaBarrier,
  pollTryFillPmsDialogsInContext,
  registerPlant3dAutomationReviewInitScript,
  runSubmitReviewAcrossContext,
  tryFillPmsNewDocumentDialog,
} from './pms-plant3d-initiate-flow';

const base = (process.env.PMS_E2E_BASE || 'http://pms.powerpms.net:1801').replace(/\/$/, '');
const username = (process.env.PMS_E2E_USERNAME || 'SJ').trim();
const password = process.env.PMS_E2E_PASSWORD?.trim();
const openSubstringRaw =
  process.env.PMS_EMBEDDED_SITE_SUBSTRING ?? process.env.PMS_E2E_OPEN_URL_SUBSTRING;
const openSubstring =
  openSubstringRaw === undefined || String(openSubstringRaw).trim() === ''
    ? null
    : String(openSubstringRaw).trim();
const cdpUrl = process.env.CHROME_CDP_URL?.trim();
const headless = process.env.PMS_CDP_HEADLESS === '1';

/** 一键开启：自动填 PMS 弹窗 + plant3d 发起提资（可用 PMS_CDP_SKIP_* 单独关闭） */
const fullFlow = process.env.PMS_CDP_FULL_FLOW === '1' || process.env.PMS_CDP_FULL_FLOW === 'true';
const submitReview =
  process.env.PMS_CDP_SUBMIT_REVIEW === '1'
  || (fullFlow && process.env.PMS_CDP_SKIP_PLANT3D_SUBMIT !== '1');
const fillPmsDialog =
  process.env.PMS_CDP_FILL_PMS_DIALOG === '1'
  || (fullFlow && process.env.PMS_CDP_SKIP_PMS_DIALOG !== '1');

const popupWaitMs = fullFlow ? 45_000 : 25_000;
const pmsDialogPollMs = fullFlow ? 45_000 : 28_000;

async function login(page: import('playwright').Page): Promise<void> {
  await page.goto(`${base}/sysin.html`, { waitUntil: 'domcontentloaded' });
  const userInput = page.locator('input[type="text"]').first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 20_000 });
  await passInput.waitFor({ state: 'visible', timeout: 10_000 });
  await userInput.fill(username);
  await passInput.fill(password!);
  await assertNoCaptchaBarrier(page);

  const loginBtn = page.getByRole('button', { name: /登录|登陆|登\s*录/ }).first();
  if (await loginBtn.count()) {
    await loginBtn.click();
  } else {
    await page.locator('button[type="submit"]').first().click();
  }

  await page
    .getByText('业务中心', { exact: false })
    .or(page.getByText('设计交付', { exact: false }))
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
}

async function openReviewFormList(page: import('playwright').Page): Promise<void> {
  await page.getByText('设计交付', { exact: false }).first().click({ timeout: 15_000 }).catch(async () => {
    await page.getByTitle('设计交付').click();
  });
  const reviewLink = page.getByRole('link', { name: '三维校审单', exact: true });
  if (await reviewLink.count()) {
    await reviewLink.first().click({ timeout: 15_000 });
  } else {
    await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 15_000 });
  }
  await page.getByText('三维校审单', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });

  await Promise.race([
    page.locator('iframe').first().waitFor({ state: 'attached', timeout: 45_000 }),
    page.getByText('新增', { exact: false }).first().waitFor({ state: 'visible', timeout: 45_000 }),
  ]).catch(() => undefined);

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
}

async function tryClickNewInFrame(root: import('playwright').Page | import('playwright').Frame): Promise<boolean> {
  const locators = [
    root.getByRole('button', { name: /新增/ }),
    root.getByRole('link', { name: /新增/ }),
    root.locator('[class*="toolbar"], .toolbar, .x-toolbar').getByText('新增', { exact: false }),
    root.getByText(/^\+?\s*新增\s*$/),
    root.getByText('新增', { exact: true }),
  ];
  for (const loc of locators) {
    const target = loc.first();
    try {
      await target.waitFor({ state: 'visible', timeout: 2500 });
      await target.click({ timeout: 8000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function clickNewInAnyFrame(page: import('playwright').Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await tryClickNewInFrame(page)) return;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (frame.isDetached()) continue;
      if (await tryClickNewInFrame(frame)) return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('未找到可点击的「新增」');
}

async function main(): Promise<void> {
  if (!password) {
    console.error('缺少 PMS_E2E_PASSWORD');
    process.exit(1);
  }

  let browser: import('playwright').Browser;
  let context: import('playwright').BrowserContext;
  let page: import('playwright').Page;

  if (cdpUrl) {
    console.error(`[cdp] connectOverCDP: ${cdpUrl}`);
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0];
    if (!context) {
      throw new Error('未找到 BrowserContext：请用 --remote-debugging-port 启动 Chrome 并至少保留一个普通标签页');
    }
    const pages = context.pages();
    page = pages.find((p) => !p.url().startsWith('chrome://')) || pages[0] || (await context.newPage());
  } else {
    browser = await chromium.launch({
      channel: 'chrome',
      headless,
    });
    context = await browser.newContext({ locale: 'zh-CN', ignoreHTTPSErrors: true });
    page = await context.newPage();
  }

  if (fullFlow) {
    console.error('[cdp] PMS_CDP_FULL_FLOW：已合并启用弹窗轮询 + plant3d 提资（可用 SKIP 环境变量关闭子步骤）');
  }
  if (submitReview) {
    await registerPlant3dAutomationReviewInitScript(context);
    console.error('[cdp] 已注册 initScript：localStorage plant3d_automation_review=1');
  }

  try {
    console.error(`[cdp] 入口: ${base}/sysin.html  用户: ${username}`);
    await login(page);
    await openReviewFormList(page);

    const initialUrl = page.url();
    const popupPromise = context.waitForEvent('page', { timeout: popupWaitMs }).catch(() => null);
    console.error('[cdp] 查找并点击「新增」…');
    await clickNewInAnyFrame(page);

    const popup = await popupPromise;
    await new Promise((r) => setTimeout(r, 1500));

    if (fillPmsDialog) {
      console.error(`[cdp] 轮询 PMS 弹窗（最长 ${pmsDialogPollMs}ms）…`);
      await pollTryFillPmsDialogsInContext(context, pmsDialogPollMs, 900);
    } else {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const allPages = context.pages().filter((p) => !p.isClosed());
    for (const p of allPages) {
      await p.waitForLoadState('domcontentloaded').catch(() => undefined);
    }

    if (fillPmsDialog) {
      for (const p of allPages) {
        await tryFillPmsNewDocumentDialog(p).catch(() => undefined);
      }
    }

    let target: import('playwright').Page | null = popup;
    if (target?.isClosed()) target = null;

    if (openSubstring) {
      target = allPages.find((p) => p.url().includes(openSubstring)) || target;
    }
    if (!target) {
      target =
        allPages.find((p) => p !== page && p.url() !== initialUrl && !p.url().startsWith('about:')) || page;
    }
    if (!target) target = page;

    const url = target.url();
    console.error(`[cdp] 主会话 URL: ${initialUrl}`);
    console.error(`[cdp] 选用页 URL: ${url}`);
    console.error(`[cdp] 当前所有标签: ${allPages.map((p) => p.url()).join(' | ')}`);

    if (openSubstring) {
      const hit = allPages.some((p) => p.url().includes(openSubstring));
      if (!hit) {
        throw new Error(
          `没有任何标签页 URL 包含「${openSubstring}」；若外链尚未配置，可先不设该环境变量以只测到「新增」点击。`,
        );
      }
    }
    console.error(
      '[cdp] 流程结束（' + (openSubstring ? 'URL 子串校验通过' : '未校验 URL，仅完成登录与新增点击') + '）',
    );

    if (submitReview) {
      console.error('[cdp] PMS_CDP_SUBMIT_REVIEW=1：扫描各页/iframe 发起提资并提交…');
      await runSubmitReviewAcrossContext(context);
      console.error('[cdp] plant3d：已检测到「提资单创建成功」');
    }
  } finally {
    if (!cdpUrl) {
      await browser.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

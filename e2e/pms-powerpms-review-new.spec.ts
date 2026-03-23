/**
 * PowerPMS：设计交付 → 三维校审单 →「新增」应打开三维布置 / plant3d-web 页面。
 *
 * ## 手工验收计划（与自动化并列）
 * 1. 打开登录页，使用角色账号（SJ/SH/JD/PZ 等大写简写）登录。
 * 2. 左侧：设计交付 → 三维校审单；确认列表与工具栏可见。
 * 3. 点击「新增」，确认新标签页或当前页跳转到预期三维地址（含 form_id / project 等参数视联调而定）。
 * 4. 换账号重复 1–3，确认权限与打开地址是否符合业务。
 *
 * ## 自动化运行（勿将密码写入仓库）
 * ```bash
 * export PMS_E2E_ENABLED=1
 * export PMS_E2E_PASSWORD='你的密码'
 * export PMS_E2E_USERNAME=SJ          # 可选，默认 SJ
 * export PMS_E2E_ROLES=SJ,SH,JD       # 可选，逗号分隔多角色串行测
 * export PMS_EMBEDDED_SITE_SUBSTRING=你的-plant3d-线上域名   # 推荐：嵌入页为部署站点非本地
 * # 或与 PMS_E2E_OPEN_URL_SUBSTRING 二选一
 * # 可选：全流程「发起提资」（需已部署含自动化钩子的 plant3d-web）
 * export PMS_E2E_SUBMIT_REVIEW=1
 * # export PMS_E2E_FILL_PMS_DIALOG=1   # 若「新增」后先出 PMS 弹窗表单
 * # 或一键：export PMS_E2E_FULL_FLOW=1（等同打开 FILL + SUBMIT，可用 SKIP 环境变量关闭子步骤）
 * npm run test:e2e:pms   # 本地默认有头打开浏览器；CI 无头
 * ```
 *
 * 若登录页强制验证码，自动化会失败，需对方提供免验证码测试账号或内网策略。
 */
import { test, expect, type BrowserContext, type Frame, type Page } from '@playwright/test';

import {
  assertNoCaptchaBarrier,
  pollTryFillPmsDialogsInContext,
  registerPlant3dAutomationReviewInitScript,
  runSubmitReviewAcrossContext,
  tryFillPmsNewDocumentDialog,
} from '../scripts/pms-plant3d-initiate-flow';

const enabled = process.env.PMS_E2E_ENABLED === '1' || process.env.PMS_E2E_ENABLED === 'true';
const password = process.env.PMS_E2E_PASSWORD?.trim();
const fullFlowEnabled =
  process.env.PMS_E2E_FULL_FLOW === '1' || process.env.PMS_E2E_FULL_FLOW === 'true';
const submitReviewEnabled =
  process.env.PMS_E2E_SUBMIT_REVIEW === '1'
  || (fullFlowEnabled && process.env.PMS_E2E_SKIP_PLANT3D_SUBMIT !== '1');
const fillPmsDialogEnabled =
  process.env.PMS_E2E_FILL_PMS_DIALOG === '1'
  || (fullFlowEnabled && process.env.PMS_E2E_SKIP_PMS_DIALOG !== '1');

/** 嵌入的 plant3d-web 线上地址片段（与 OPEN_URL_SUBSTRING 二选一）；未设则只测到点击「新增」不校验 URL */
function embedUrlSubstring(): string | null {
  const a = process.env.PMS_EMBEDDED_SITE_SUBSTRING?.trim();
  const b = process.env.PMS_E2E_OPEN_URL_SUBSTRING?.trim();
  return a || b || null;
}

function rolesToRun(): string[] {
  const raw = process.env.PMS_E2E_ROLES?.trim();
  if (raw) {
    const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) return list;
  }
  const single = process.env.PMS_E2E_USERNAME?.trim().toUpperCase() || 'SJ';
  return [single];
}

async function loginIfNeeded(page: Page, username: string): Promise<void> {
  await page.goto('/sysin.html', { waitUntil: 'domcontentloaded' });

  const userInput = page.locator('input[type="text"]').first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 20_000 });
  await passInput.waitFor({ state: 'visible', timeout: 10_000 });

  await userInput.fill(username);
  await passInput.fill(password!);
  await assertNoCaptchaBarrier(page);

  const loginByRole = page.getByRole('button', { name: /登录|登陆|登\s*录/ }).first();
  if (await loginByRole.count()) {
    await loginByRole.click();
  } else {
    await page.locator('button[type="submit"]').first().click();
  }

  // 进入业务后常见：侧栏「业务中心」或菜单「设计交付」
  const afterLogin = page.getByText('业务中心', { exact: false }).or(page.getByText('设计交付', { exact: false }));
  await expect(afterLogin.first()).toBeVisible({ timeout: 45_000 });
}

async function openReviewFormList(page: Page): Promise<void> {
  const design = page.getByText('设计交付', { exact: false }).first();
  await design.click({ timeout: 15_000 }).catch(async () => {
    await page.getByTitle('设计交付').click();
  });

  const reviewLink = page.getByRole('link', { name: '三维校审单', exact: true });
  if (await reviewLink.count()) {
    await reviewLink.first().click({ timeout: 15_000 });
  } else {
    await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 15_000 });
  }

  await expect(page.getByText('三维校审单', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 列表与工具栏多在 iframe 内加载，等待至少出现一个 iframe 或主文档出现「新增」
  await Promise.race([
    page.locator('iframe').first().waitFor({ state: 'attached', timeout: 45_000 }),
    page.getByText('新增', { exact: false }).first().waitFor({ state: 'visible', timeout: 45_000 }),
  ]).catch(() => {});

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

/**
 * 在单帧（主页面或 iframe）内尝试点击「新增」，覆盖 button / link / 工具栏 span 等。
 */
async function tryClickNewInFrame(root: Page | Frame): Promise<boolean> {
  const locators = [
    root.getByRole('button', { name: /新增/ }),
    root.getByRole('link', { name: /新增/ }),
    root.locator('[class*="toolbar"], .toolbar, .x-toolbar').getByText('新增', { exact: false }),
    root.getByText(/^\+?\s*新增\s*$/, { exact: true }),
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

/**
 * 主文档 + 所有子 frame（含嵌套）中查找并点击「新增」。
 */
function anyFrameUrlIncludes(context: BrowserContext, sub: string): boolean {
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    for (const f of p.frames()) {
      try {
        const u = f.url();
        if (u && u.includes(sub)) return true;
      } catch {
        /* cross-origin */
      }
    }
  }
  return false;
}

async function clickNewInAnyFrame(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await tryClickNewInFrame(page)) return;

    const frames = page.frames().filter((f) => f !== page.mainFrame());
    for (const frame of frames) {
      if (frame.isDetached()) continue;
      if (await tryClickNewInFrame(frame)) return;
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(
    '未找到可点击的「新增」：请确认已进入三维校审单列表页，或菜单是否在额外嵌套 iframe / shadow DOM 中。'
  );
}

async function resolvePageAfterClickNew(
  page: Page,
  context: BrowserContext,
  sub: string | null,
  options: { fillPmsDialog: boolean; fullFlow: boolean },
): Promise<{ target: Page; allUrls: string[] }> {
  const initialUrl = page.url();
  const popupMs = options.fullFlow ? 45_000 : 25_000;
  const popupPromise = context.waitForEvent('page', { timeout: popupMs }).catch(() => null);
  await clickNewInAnyFrame(page);
  const popup = await popupPromise;
  await new Promise((r) => setTimeout(r, 1500));

  if (options.fillPmsDialog) {
    const pollMs = options.fullFlow ? 45_000 : 28_000;
    await pollTryFillPmsDialogsInContext(context, pollMs, 900);
  } else {
    await new Promise((r) => setTimeout(r, 1000));
  }

  const allPages = context.pages().filter((p) => !p.isClosed());
  for (const p of allPages) {
    await p.waitForLoadState('domcontentloaded').catch(() => {});
  }

  if (options.fillPmsDialog) {
    for (const p of allPages) {
      await tryFillPmsNewDocumentDialog(p).catch(() => undefined);
    }
  }

  let target: Page = page;
  if (popup && !popup.isClosed()) {
    target = popup;
  }
  if (sub) {
    const hit = allPages.find((p) => p.url().includes(sub));
    if (hit) target = hit;
  } else {
    const other = allPages.find(
      (p) => p !== page && p.url() !== initialUrl && !p.url().startsWith('about:')
    );
    if (other) target = other;
  }

  const allUrls = allPages.map((p) => p.url());
  return { target, allUrls };
}

for (const role of rolesToRun()) {
  test.describe.serial(`PowerPMS 三维校审单新增（角色 ${role}）`, () => {
    test.beforeEach(async ({ context }) => {
      test.skip(!enabled, '设置 PMS_E2E_ENABLED=1 启用外网 PMS E2E');
      test.skip(!password, '设置 PMS_E2E_PASSWORD 为登录密码（勿提交仓库）');
      if (submitReviewEnabled) {
        await registerPlant3dAutomationReviewInitScript(context);
      }
    });

    test(`登录 ${role} → 新增${embedUrlSubstring() ? ` → 部署页 URL 含「${embedUrlSubstring()}」` : ''}${submitReviewEnabled ? ' → plant3d 发起提资' : ''}`, async ({
      page,
      context,
    }) => {
      await loginIfNeeded(page, role);
      await openReviewFormList(page);

      const sub = embedUrlSubstring();
      const { target, allUrls } = await resolvePageAfterClickNew(page, context, sub, {
        fillPmsDialog: fillPmsDialogEnabled,
        fullFlow: fullFlowEnabled,
      });

      if (sub) {
        const pageHit = allUrls.some((u) => u.includes(sub));
        const frameHit = pageHit ? false : anyFrameUrlIncludes(context, sub);
        const ok = pageHit || frameHit || submitReviewEnabled;
        expect(
          ok,
          `期望顶层 URL 或 iframe 含「${sub}」，或已开启发起提资以便在同页 iframe 场景下降级校验。当前标签：\n${allUrls.join('\n')}`,
        ).toBe(true);
      } else {
        // 未配置部署域名时：仍完成自动化点击，便于有头观察行为
        expect(target.url().length).toBeGreaterThan(0);
      }

      if (submitReviewEnabled) {
        test.slow();
        await runSubmitReviewAcrossContext(context);
      }
    });
  });
}

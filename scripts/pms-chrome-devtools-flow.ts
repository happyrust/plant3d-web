/**
 * PowerPMS 完整入口：http://pms.powerpms.net:1801/sysin.html
 *
 * 流程：登录 → 设计交付 → 三维校审单 →「新增」→（可选）轮询填写 PMS 弹窗 →（可选）URL 断言
 * →（可选）plant3d 内注入构件 + 填数据包名 + 点击「创建编校审数据」→ 等待成功提示
 * →（默认）回到三维校审单，嗅探 PMS 域名下 JSON 接口响应体是否含包名/测试 BRAN（`PMS_CDP_VERIFY_PMS_API=0` 可关）。
 *
 * 通过 Playwright 驱动 Chromium，底层使用 **Chrome DevTools Protocol (CDP)**。
 *
 * **推荐（本机 Chrome + DevTools 肉眼调试）**：先 `./scripts/launch-chrome-cdp.sh` 启动带 `--remote-debugging-port=9222` 的 Chrome，
 * 再设 `CHROME_CDP_URL=http://127.0.0.1:9222` 后执行 `npm run test:pms:cdp:attach:full`（脚本会 `connectOverCDP` 附加到该浏览器，不会关掉你的窗口，可在 DevTools 看 Network/DOM）。
 *
 * 运行：
 * - `npm run test:pms:cdp` — 按需用环境变量打开各阶段（Playwright 自启 Chrome）
 * - `npm run test:pms:cdp:full` — 同上 + 全流程开关
 * - `npm run test:pms:cdp:extended` — full + SJ→PMS 可见→JH 校核
 * - `npm run test:pms:cdp:attach` / `:attach:full` / `:attach:extended` — 必须已用调试端口启动 Chrome，等价于自带 `CHROME_CDP_URL=http://127.0.0.1:9222`
 *
 * 环境变量见 docs/verification/pms-3d-review-integration-e2e.md
 */
import { chromium } from 'playwright';

import { startPmsApiSniffer, startPmsApiSnifferV2, type PmsReviewEntryCandidate } from './pms-api-sniffer';
import {
  assertNoCaptchaBarrier,
  PMS_DEFAULT_TEST_BRAN_REFNO,
  pollTryFillPmsDialogsInContext,
  registerPlant3dAutomationReviewInitScript,
  reloadReviewerWorkbenchAcrossContext,
  runCheckerWorkflowAcrossContext,
  runReviewerAnnotationAcrossContext,
  runSubmitReviewAcrossContext,
  tryFillPmsNewDocumentDialog,
  tryOpenReviewEntryByCandidates,
  tryOpenReviewEntryByNeedles,
  waitForAnySubstringInPageOrChildFrames,
} from './pms-plant3d-initiate-flow';

const base = (process.env.PMS_E2E_BASE || 'http://pms.powerpms.net:1801').replace(/\/$/, '');
const username = (process.env.PMS_E2E_USERNAME || 'SJ').trim();
const checkerUsername = (process.env.PMS_CHECKER_USERNAME || 'JH').trim();
const password = process.env.PMS_E2E_PASSWORD?.trim();
/** SJ 编校审 → PMS 可见性校验 → 清 Cookie → JH 登录 → 打开条目 → plant3d 校核提交 */
const extendedFlow =
  process.env.PMS_CDP_EXTENDED_FLOW === '1' || process.env.PMS_CDP_EXTENDED_FLOW === 'true';
const pmsVerifyTimeoutMs = (() => {
  const n = Number(process.env.PMS_CDP_PMS_VERIFY_MS?.trim());
  return Number.isFinite(n) && n >= 5000 ? n : 90_000;
})();
/** 嗅探 PMS 域名下 JSON 响应体是否含包名或测试 BRAN；`PMS_CDP_VERIFY_PMS_API=0` 关闭 */
const verifyPmsApi =
  process.env.PMS_CDP_VERIFY_PMS_API !== '0' && process.env.PMS_CDP_VERIFY_PMS_API !== 'false';
/** 嗅探嵌入 plant3d 域名下 JSON 响应体是否含包名或测试 BRAN；默认仅在设置 PMS_EMBEDDED_SITE_SUBSTRING 时开启；`PMS_CDP_VERIFY_EMBED_API=0` 关闭 */
const verifyEmbedApi =
  process.env.PMS_CDP_VERIFY_EMBED_API !== '0' && process.env.PMS_CDP_VERIFY_EMBED_API !== 'false';
const pmsApiVerifyTimeoutMs = (() => {
  const n = Number(process.env.PMS_CDP_PMS_API_MS?.trim());
  return Number.isFinite(n) && n >= 10_000 ? n : 120_000;
})();

const embedApiVerifyTimeoutMs = (() => {
  const n = Number(process.env.PMS_CDP_EMBED_API_MS?.trim());
  return Number.isFinite(n) && n >= 10_000 ? n : 120_000;
})();

function pmsHostnameFromBase(b: string): string {
  try {
    const u = b.startsWith('http://') || b.startsWith('https://') ? b : `http://${b}`;
    return new URL(u).hostname;
  } catch {
    return 'pms.powerpms.net';
  }
}
const openSubstringRaw =
  process.env.PMS_EMBEDDED_SITE_SUBSTRING ?? process.env.PMS_E2E_OPEN_URL_SUBSTRING;
const openSubstring =
  openSubstringRaw === undefined || String(openSubstringRaw).trim() === ''
    ? null
    : String(openSubstringRaw).trim();

function hostnameFromNeedle(needle: string): string | null {
  const raw = needle.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) return new URL(raw).hostname;
    if (raw.includes('/') || raw.includes('?') || raw.includes('#')) return new URL(`http://${raw}`).hostname;
    return raw;
  } catch {
    return null;
  }
}

function uniqNeedles(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
}

function formatReviewEntryCandidate(candidate: PmsReviewEntryCandidate): string {
  return [
    `needle=${candidate.matchedNeedle}`,
    `ModelFormId=${candidate.modelFormId || '-'}`,
    `formId=${candidate.formId || '-'}`,
    `Id=${candidate.id || '-'}`,
    `Title=${candidate.title || '-'}`,
    `RegHumName=${candidate.regHumName || '-'}`,
    `RegDate=${candidate.regDate || '-'}`,
    `Status=${candidate.status || '-'}`,
    `path=${candidate.path}`,
    `url=${candidate.sourceUrl}`,
  ].join(' | ');
}
const cdpUrl = process.env.CHROME_CDP_URL?.trim();
const headless = process.env.PMS_CDP_HEADLESS === '1';

/** 一键开启：自动填 PMS 弹窗 + plant3d 发起编校审（可用 PMS_CDP_SKIP_* 单独关闭） */
const fullFlow = process.env.PMS_CDP_FULL_FLOW === '1' || process.env.PMS_CDP_FULL_FLOW === 'true';
const submitReview =
  process.env.PMS_CDP_SUBMIT_REVIEW === '1'
  || (fullFlow && process.env.PMS_CDP_SKIP_PLANT3D_SUBMIT !== '1');
const fillPmsDialog =
  process.env.PMS_CDP_FILL_PMS_DIALOG === '1'
  || (fullFlow && process.env.PMS_CDP_SKIP_PMS_DIALOG !== '1');

const popupWaitMs = fullFlow ? 45_000 : 25_000;
const pmsDialogPollMs = fullFlow ? 45_000 : 28_000;

function pageUrlsInclude(context: import('playwright').BrowserContext, sub: string): boolean {
  return context.pages().some((p) => !p.isClosed() && p.url().includes(sub));
}

async function capturePmsPageScreenshot(
  page: import('playwright').Page,
  prefix: string,
): Promise<string | null> {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const path = `artifacts/${safePrefix}-${Date.now()}.png`;
  try {
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return null;
  }
}

async function describeContextRoots(context: import('playwright').BrowserContext): Promise<string> {
  const pages = context.pages().filter((p) => !p.isClosed());
  const lines: string[] = [];
  for (const p of pages) {
    lines.push(`[page] ${p.url() || '(blank)'}`);
    for (const root of [p, ...p.frames().filter((f) => f !== p.mainFrame() && !f.isDetached())]) {
      const summary = await root.evaluate(() => {
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
        const pick = (selector: string) => !!document.querySelector(selector);
        const knownMessages = [
          '嵌入链接校验失败：缺少可信身份声明',
          '请从外部流程平台重新打开带 form_id 的嵌入链接',
          '当前单据已经被识别，但内部 review_tasks 中尚未找到对应任务',
          '外部流程',
          '校审工作区',
          '待处理',
        ].filter((text) => bodyText.includes(text));
        return {
          url: location.href,
          hasReviewerHook: typeof (window as unknown as Record<string, unknown>).__plant3dReviewerE2E === 'object',
          hasReviewerLanding: pick('[data-testid="reviewer-landing-workspace"]'),
          hasReviewerWorkbench: pick('[data-testid="review-workbench-workflow-zone"]'),
          hasDesignerLanding: pick('[data-testid="designer-landing-workspace"]'),
          knownMessages,
          textPreview: bodyText.slice(0, 240),
        };
      }).catch(() => null);
      if (!summary) {
        lines.push('  [root] <unavailable>');
        continue;
      }
      lines.push(
        `  [root] url=${summary.url || '(blank)'}`
        + ` reviewerHook=${summary.hasReviewerHook ? '1' : '0'}`
        + ` reviewerLanding=${summary.hasReviewerLanding ? '1' : '0'}`
        + ` reviewerWorkbench=${summary.hasReviewerWorkbench ? '1' : '0'}`
        + ` designerLanding=${summary.hasDesignerLanding ? '1' : '0'}`,
      );
      if (summary.knownMessages.length) {
        lines.push(`    knownMessages=${summary.knownMessages.join(' | ')}`);
      }
      if (summary.textPreview) {
        lines.push(`    text=${summary.textPreview}`);
      }
    }
  }
  return lines.join('\n');
}

/** 嵌入的 plant3d 常在 PMS 同页 iframe 内，顶层 URL 仍为 WebCenter */
function anyFrameUrlIncludes(context: import('playwright').BrowserContext, sub: string): boolean {
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    for (const f of p.frames()) {
      try {
        const u = f.url();
        if (u && u.includes(sub)) return true;
      } catch {
        /* 跨域 frame 的 url 可能不可读 */
      }
    }
  }
  return false;
}

async function waitForEmbeddedReviewSurface(
  page: import('playwright').Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const topUrl = page.url();
    if (openSubstring && topUrl.includes(openSubstring)) return true;
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const frameUrl = frame.url();
        if (openSubstring && frameUrl.includes(openSubstring)) return true;
        if (frameUrl.includes('/review/3d-view')) return true;
      } catch {
        /* ignore */
      }
      const reviewWorkbench = await frame.locator('[data-testid="review-workbench-workflow-zone"]').first().isVisible().catch(() => false);
      const designerLanding = await frame.locator('[data-testid="designer-landing-workspace"]').first().isVisible().catch(() => false);
      const reviewerLanding = await frame.locator('[data-testid="reviewer-landing-workspace"]').first().isVisible().catch(() => false);
      const plantText = await frame.getByText('Plant3D Web', { exact: false }).first().isVisible().catch(() => false);
      const modelText = await frame.getByText('模型工程', { exact: false }).first().isVisible().catch(() => false);
      if (reviewWorkbench || designerLanding || reviewerLanding || plantText || modelText) {
        return true;
      }
    }
    await page.waitForTimeout(500).catch(() => undefined);
  }
  return false;
}

async function promoteSelectedReviewEntryIntoViewer(page: import('playwright').Page): Promise<boolean> {
  if (await waitForEmbeddedReviewSurface(page, 12_000)) {
    return true;
  }
  const actionButtons = [
    page.getByText('编辑', { exact: false }).first(),
    page.getByText('查看', { exact: false }).first(),
  ];
  for (const button of actionButtons) {
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;
    try {
      await button.click({ timeout: 12_000 });
      if (await waitForEmbeddedReviewSurface(page, 30_000)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function login(page: import('playwright').Page, user: string, pwd: string): Promise<void> {
  await page.goto(`${base}/sysin.html`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(500);
  const userInput = page.locator('input[type="text"]').first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 30_000 });
  await passInput.waitFor({ state: 'visible', timeout: 15_000 });
  await userInput.fill(user);
  await passInput.fill(pwd);
  await assertNoCaptchaBarrier(page);

  const loginBtn = page.getByRole('button', { name: /登录|登陆|登\s*录/ }).first();
  if (await loginBtn.count()) {
    await loginBtn.click();
  } else {
    await page.locator('button[type="submit"]').first().click();
  }

  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  const totalTimeoutMs = 150_000;
  const startedAt = Date.now();
  const deadline = startedAt + totalTimeoutMs;

  const postLoginMarkers = page
    .getByText('业务中心', { exact: false })
    .or(page.getByText('设计交付', { exact: false }))
    .or(page.getByText('工作台', { exact: false }))
    .first();
  const menuSearchBox = page.getByText('菜单名称查询', { exact: false }).first();

  const tryWait = async (fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };

  const waitForSuccessSignals = async (): Promise<void> => {
    // 1) URL changes away from /sysin.html (e.g. WebCenter)
    while (Date.now() < deadline) {
      const url = page.url();
      if (url && !url.includes('/sysin.html')) return;
      if (await tryWait(() => page.waitForURL((u) => !u.toString().includes('/sysin.html'), { timeout: 4000 }))) return;
      if (await tryWait(() => menuSearchBox.waitFor({ state: 'visible', timeout: 4000 }))) return;
      if (await tryWait(() => postLoginMarkers.waitFor({ state: 'visible', timeout: 4000 }))) return;
      await page.waitForTimeout(300);
    }
    throw new Error('PMS 登录后标记等待超时');
  };

  try {
    await waitForSuccessSignals();
  } catch (e) {
    const url = page.url();
    console.error(`[cdp] 登录失败：等待登录成功信号超时（user=${user} url=${url}）`);
    try {
      const safeUser = user.replace(/[^a-zA-Z0-9_-]+/g, '_');
      const shot = `artifacts/pms-login-failed-${safeUser}-${Date.now()}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      console.error(`[cdp] 登录失败截图已保存: ${shot}`);
    } catch {
      // ignore
    }
    throw e;
  }
}

async function openReviewFormList(page: import('playwright').Page): Promise<void> {
  const waitForListReady = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const roots: (import('playwright').Page | import('playwright').Frame)[] = [
        page,
        ...page.frames().filter((frame) => frame !== page.mainFrame() && !frame.isDetached()),
      ];
      let ready = false;
      for (const root of roots) {
        const listVisible = await root.getByText('三维校审单', { exact: true }).first().isVisible().catch(() => false);
        const newVisible = await root.getByText('新增', { exact: false }).first().isVisible().catch(() => false);
        const editVisible = await root.getByText('编辑', { exact: false }).first().isVisible().catch(() => false);
        const viewVisible = await root.getByText('查看', { exact: false }).first().isVisible().catch(() => false);
        const refreshVisible = await root.getByText('刷新', { exact: false }).first().isVisible().catch(() => false);
        const rowVisible = await root.locator('tbody tr').first().isVisible().catch(() => false);
        const textReady = await root.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes('模型表单编号')
            || bodyText.includes('录入日期')
            || bodyText.includes('每页')
            || bodyText.includes('项目代码');
        }).catch(() => false);
        if (listVisible && (newVisible || editVisible || viewVisible || refreshVisible || rowVisible || textReady)) {
          ready = true;
          break;
        }
      }
      if (ready) {
        return true;
      }
      await page.waitForTimeout(400).catch(() => undefined);
    }
    return false;
  };
  const alreadyThere = await waitForListReady(3000);
  if (alreadyThere) {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    return;
  }

  const tryOpenViaVisibleReviewEntry = async (): Promise<boolean> => {
    const reviewTexts = page.getByText('三维校审单', { exact: true });
    const total = await reviewTexts.count().catch(() => 0);
    for (let i = 0; i < total; i++) {
      const item = reviewTexts.nth(i);
      const visible = await item.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await item.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.x > 260 || box.y < 70 || box.y > 260) continue;
      try {
        await item.click({ timeout: 12_000 });
        if (await waitForListReady(45_000)) {
          console.error('[cdp] openReviewFormList: 通过左侧可见「三维校审单」菜单进入');
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  };

  const tryOpenViaDesignDeliver = async (): Promise<boolean> => {
    try {
      const reviewLink = page.getByRole('link', { name: '三维校审单', exact: true });
      const reviewLinkVisible = await reviewLink.first().isVisible().catch(() => false);
      if (reviewLinkVisible) {
        await reviewLink.first().click({ timeout: 20_000 });
      } else {
        const designDeliver = page.getByText('设计交付', { exact: false }).first();
        await designDeliver.waitFor({ state: 'visible', timeout: 45_000 });
        await designDeliver.click({ timeout: 25_000 }).catch(async () => {
          await page.locator('[title="设计交付"]').first().click({ timeout: 25_000 });
        });
        await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 20_000 });
      }
      if (!(await waitForListReady(45_000))) return false;
      console.error('[cdp] openReviewFormList: 通过「设计交付 → 三维校审单」进入');
      return true;
    } catch {
      return false;
    }
  };

  const tryOpenViaMenuSearch = async (): Promise<boolean> => {
    const candidates = [
      page.getByPlaceholder('菜单名称查询').first(),
      page.getByLabel('菜单名称查询').first(),
      page.getByRole('textbox', { name: '菜单名称查询' }).first(),
      // 兜底：顶部/侧边的搜索框一般是 textbox
      page.getByRole('textbox').first(),
    ];

    for (const box of candidates) {
      try {
        await box.waitFor({ state: 'visible', timeout: 6000 });
        await box.click({ timeout: 5000 }).catch(() => undefined);
        await box.fill('三维校审单', { timeout: 8000 });
        await box.press('Enter', { timeout: 3000 }).catch(() => undefined);

        const reviewLink = page.getByRole('link', { name: '三维校审单', exact: false });
        const reviewLinkVisible = await reviewLink.first().isVisible().catch(() => false);
        if (reviewLinkVisible) {
          await reviewLink.first().click({ timeout: 12_000 });
        } else {
          await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 12_000 });
        }

        if (!(await waitForListReady(45_000))) continue;
        console.error('[cdp] openReviewFormList: 通过「菜单搜索 → 三维校审单」进入');
        return true;
      } catch {
        continue;
      }
    }
    return false;
  };

  const tryOpenViaBusinessCenter = async (): Promise<boolean> => {
    try {
      const entry = page.getByText('业务中心', { exact: false }).first();
      await entry.waitFor({ state: 'visible', timeout: 10_000 });
      await entry.click({ timeout: 10_000 });

      const reviewLink = page.getByRole('link', { name: '三维校审单', exact: false });
      const reviewLinkVisible = await reviewLink.first().isVisible().catch(() => false);
      if (reviewLinkVisible) {
        await reviewLink.first().click({ timeout: 12_000 });
      } else {
        await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 12_000 });
      }

      if (!(await waitForListReady(45_000))) return false;
      console.error('[cdp] openReviewFormList: 通过「业务中心 → 三维校审单」进入');
      return true;
    } catch {
      return false;
    }
  };

  const ok =
    (await tryOpenViaVisibleReviewEntry()) ||
    (await tryOpenViaDesignDeliver()) ||
    (await tryOpenViaMenuSearch()) ||
    (await tryOpenViaBusinessCenter()) ||
    (await tryOpenViaMenuSearch());
  if (!ok && (await waitForListReady(3000))) {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    return;
  }
  if (!ok) {
    const shot = await capturePmsPageScreenshot(page, 'pms-open-review-form-list-failed');
    if (shot) {
      console.error(`[cdp] openReviewFormList 失败截图：${shot}`);
    }
    throw new Error('openReviewFormList: 无法打开「三维校审单」列表');
  }

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
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await tryClickNewInFrame(page)) return;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (frame.isDetached()) continue;
      if (await tryClickNewInFrame(frame)) return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const shot = await capturePmsPageScreenshot(page, 'pms-click-new-failed');
  if (shot) {
    console.error(`[cdp] clickNewInAnyFrame 失败截图：${shot}`);
  }
  throw new Error('未找到可点击的「新增」');
}

async function main(): Promise<void> {
  if (!password) {
    console.error('缺少 PMS_E2E_PASSWORD');
    process.exit(1);
  }

  if (!process.env.PMS_CDP_SELECTION_MODE?.trim()) {
    console.error(
      '[cdp] 提示：可设 PMS_CDP_SELECTION_MODE=console，在控制台输入「= 24381/145018」式命令选中 CE，再自动点「添加构件」写入列表（可用 PMS_CDP_ADD_COMPONENT_READY_MS / PMS_CDP_ADD_COMPONENT_LIST_MS 调超时；失败则回退 mock）。',
    );
  }

  if (extendedFlow && !process.env.PMS_MOCK_PACKAGE_NAME?.trim()) {
    process.env.PMS_MOCK_PACKAGE_NAME = `E2E-PMS-JH-${Date.now()}`;
    console.error(`[cdp] PMS_CDP_EXTENDED_FLOW：未设 PMS_MOCK_PACKAGE_NAME，已生成 ${process.env.PMS_MOCK_PACKAGE_NAME}`);
  }
  if (extendedFlow && !process.env.PMS_CDP_WORKFLOW_MODE?.trim()) {
    process.env.PMS_CDP_WORKFLOW_MODE = 'manual';
    console.error('[cdp] PMS_CDP_EXTENDED_FLOW：未设 PMS_CDP_WORKFLOW_MODE，已默认切到 manual，以便 reviewer 工作区显示内部提交流转按钮');
  }
  if (extendedFlow && !process.env.PMS_INITIATE_CHECKER_SUBSTRING?.trim()) {
    process.env.PMS_INITIATE_CHECKER_SUBSTRING = checkerUsername;
    console.error(
      `[cdp] PMS_CDP_EXTENDED_FLOW：未设 PMS_INITIATE_CHECKER_SUBSTRING，发起编校审时将优先选校核下拉中含「${checkerUsername}」的项`,
    );
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
    console.error('[cdp] PMS_CDP_FULL_FLOW：已合并启用弹窗轮询 + plant3d 编校审（可用 SKIP 环境变量关闭子步骤）');
  }
  if (submitReview) {
    await registerPlant3dAutomationReviewInitScript(context);
    console.error('[cdp] 已注册 initScript：localStorage plant3d_automation_review=1');
  }

  const apiUrlSub = process.env.PMS_API_URL_SUBSTRING?.trim() || null;
  /** 与 submitReview 脱钩：登录后「新增」即可抓到 GetZy* JSON，便于单独抓包（不必跑完 plant3d 编校审） */
  const pmsApiSniffer = verifyPmsApi
    ? startPmsApiSniffer(context, {
      hostNeedle: pmsHostnameFromBase(base),
      urlSubstring: apiUrlSub,
    })
    : null;
  if (pmsApiSniffer) {
    console.error(
      `[cdp] 已启用 PMS 数据接口嗅探（host=*${pmsHostnameFromBase(base)}*${apiUrlSub ? ` url*${apiUrlSub}*` : ''}，${pmsApiVerifyTimeoutMs}ms 内需在 JSON 响应中出现包名或 BRAN）`,
    );
  }

  const embedHost = openSubstring ? hostnameFromNeedle(openSubstring) : null;
  const embedApiUrlSub = process.env.PMS_EMBED_API_URL_SUBSTRING?.trim() || null;
  const embedApiSniffer =
    submitReview && verifyEmbedApi && !!embedHost
      ? startPmsApiSnifferV2(context, {
        hostNeedles: [embedHost],
        urlSubstring: embedApiUrlSub,
      })
      : null;
  if (embedApiSniffer) {
    console.error(
      `[cdp] 已启用嵌入站点接口嗅探（host=*${embedHost}*${embedApiUrlSub ? ` url*${embedApiUrlSub}*` : ''}，${embedApiVerifyTimeoutMs}ms 内需在 JSON 响应中出现包名或 BRAN）`,
    );
  }

  try {
    console.error(`[cdp] 入口: ${base}/sysin.html  用户: ${username}`);
    await login(page, username, password);
    await openReviewFormList(page);
    /** 编校审后 iframe 可能抢走焦点，extended 阶段先回到此 URL 再进菜单 */
    const pmsWebCenterUrl = page.url();

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
      const pageHit = pageUrlsInclude(context, openSubstring);
      const frameHit = pageHit ? false : anyFrameUrlIncludes(context, openSubstring);
      const hit = pageHit || frameHit;
      if (!hit) {
        if (submitReview) {
          console.error(
            `[cdp] 警告：未在顶层 URL 或可读 iframe URL 中发现「${openSubstring}」；仍将扫描 DOM 尝试 plant3d 发起编校审（跨域 iframe 可能无法操作）。`,
          );
        } else {
          throw new Error(
            `没有任何标签页 URL 包含「${openSubstring}」；若 plant3d 仅在同页 iframe 内，请同时开启 PMS_CDP_SUBMIT_REVIEW / FULL_FLOW 以跳过纯顶层校验，或暂时不设该变量。`,
          );
        }
      } else {
        console.error(
          `[cdp] 嵌入地址校验：${pageHit ? '顶层标签页' : '子 frame'} 已匹配「${openSubstring}」`,
        );
      }
    }
    console.error(
      '[cdp] 流程结束（' + (openSubstring ? '嵌入地址已核对或已降级继续' : '未校验 URL，仅完成登录与新增点击') + '）',
    );

    if (submitReview) {
      console.error('[cdp] PMS_CDP_SUBMIT_REVIEW=1：扫描各页/iframe 发起编校审并提交…');
      const pkg = await runSubmitReviewAcrossContext(context);
      console.error('[cdp] plant3d：已检测到「编校审单创建/保存成功」');
      console.error(`[cdp] 本次编校审包名（用于 PMS 检索）: ${pkg}`);

      const strictEmbedEnabled = !!embedApiSniffer;
      const bran = (process.env.PMS_TARGET_BRAN_REFNO || PMS_DEFAULT_TEST_BRAN_REFNO).trim();
      const branAlt = bran.includes('_') ? bran.replace(/_/g, '/') : bran.replace(/\//g, '_');
      let reviewEntryCandidates: PmsReviewEntryCandidate[] = [];
      let reviewLookupNeedles = uniqNeedles([pkg]);
      if (pmsApiSniffer) {
        console.error('[cdp] 回到三维校审单以触发列表接口…');
        await page.bringToFront().catch(() => undefined);
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press('Escape').catch(() => undefined);
        }
        if (pmsWebCenterUrl.includes('WebCenter')) {
          await page.goto(pmsWebCenterUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await new Promise((r) => setTimeout(r, 1200));
        }
        await openReviewFormList(page);

        if (strictEmbedEnabled) {
          // When strict embed verification is enabled, do not fail early on PMS-domain sniff.
          // We'll consider strict verification passed if either PMS sniffer hits OR embed strict hits on re-enter.
          console.error('[cdp] 严格校验已启用（嵌入站点）：先触发 PMS 列表接口；PMS 嗅探将作为可选通过条件，不在此处提前失败…');
        } else {
          console.error('[cdp] 断言 PMS JSON 中含包名或 BRAN…');
          await pmsApiSniffer.waitForAnyNeedleInBodies([pkg, bran, branAlt], pmsApiVerifyTimeoutMs);
          console.error('[cdp] PMS 数据接口：已在某条 JSON 响应中发现编校审包名或测试 BRAN');
        }
        reviewEntryCandidates = pmsApiSniffer.findReviewEntryCandidates([pkg, bran, branAlt], 6);
        if (!reviewEntryCandidates.length) {
          reviewEntryCandidates = pmsApiSniffer.findRecentReviewEntryCandidates(6);
          if (reviewEntryCandidates.length) {
            console.error('[cdp] PMS 候选记录：未命中包名/BRAN，已回退为最近可读的三维校审单记录');
          }
        }
        if (reviewEntryCandidates.length) {
          console.error('[cdp] PMS 候选记录：');
          for (const [index, candidate] of reviewEntryCandidates.entries()) {
            console.error(`  [${index + 1}] ${formatReviewEntryCandidate(candidate)}`);
          }
        } else {
          console.error('[cdp] PMS 候选记录：未能从已捕获 JSON 中提取到可用的结构化记录，将只能按包名回查列表');
        }
        reviewLookupNeedles = uniqNeedles([
          ...reviewEntryCandidates.flatMap((candidate) => [
            candidate.modelFormId,
            candidate.formId,
            candidate.id,
            candidate.title,
          ]),
          pkg,
        ]);
        console.error(`[cdp] PMS reopen 匹配键：${reviewLookupNeedles.join(' | ') || '(空)'}`);
      }

      // Strict verification: re-enter the just-created record and confirm embed pulls component data from plant3d.
      if (embedApiSniffer) {
        console.error('[cdp] 严格校验：重新进入刚创建的记录，并断言「PMS 嗅探命中」或「嵌入站点拉取命中」任一成立…');

        const pmsNeedles = [pkg, bran, branAlt];
        const pmsOkPromise = pmsApiSniffer
          ? pmsApiSniffer.waitForAnyNeedleInBodies(pmsNeedles, pmsApiVerifyTimeoutMs).then(() => true).catch(() => false)
          : Promise.resolve(false);

        await page.bringToFront().catch(() => undefined);
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press('Escape').catch(() => undefined);
        }
        if (pmsWebCenterUrl.includes('WebCenter')) {
          await page.goto(pmsWebCenterUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await new Promise((r) => setTimeout(r, 1200));
        }
        await openReviewFormList(page);

        const strictOpenResult = reviewEntryCandidates.length
          ? await tryOpenReviewEntryByCandidates(page, reviewEntryCandidates).then((result) =>
            result.opened ? result : tryOpenReviewEntryByNeedles(page, reviewLookupNeedles),
          )
          : await tryOpenReviewEntryByNeedles(page, reviewLookupNeedles);
        if (!strictOpenResult.opened) {
          throw new Error(
            `严格校验失败：未能在 PMS 列表中按以下任一键重新打开刚创建的记录：${reviewLookupNeedles.join(' | ') || '(空)'}。`
            + (reviewEntryCandidates.length
              ? ` 候选记录：${reviewEntryCandidates.map((x) => formatReviewEntryCandidate(x)).join(' || ')}`
              : ' 当前未提取到结构化候选记录。'),
          );
        }
        console.error(`[cdp] 严格校验：已按「${strictOpenResult.matchedNeedle}」重新打开 PMS 记录`);
        await new Promise((r) => setTimeout(r, 2500));

        const embedNetworkOk = await embedApiSniffer
          .waitForAnyNeedleInBodies([pkg, bran, branAlt], embedApiVerifyTimeoutMs)
          .then(() => true)
          .catch(() => false);
        let embedOk = embedNetworkOk;
        if (embedNetworkOk) {
          console.error('[cdp] 嵌入站点接口：已在某条 JSON 响应中发现编校审包名或测试 BRAN');
        } else {
          console.error('[cdp] 嵌入站点接口嗅探未命中，降级为 DOM 文案断言（iframe 内可能跨域，仅做 best-effort）…');
          const domOk = await waitForSubstringInPageOrChildFrames(page, pkg, embedApiVerifyTimeoutMs)
            .then(() => true)
            .catch(() => false);
          embedOk = domOk;
          if (domOk) {
            console.error('[cdp] DOM：已在页面/子 frame 中发现编校审包名（或 BRAN）');
          }
        }

        const pmsOk = embedOk ? false : await pmsOkPromise;
        if (pmsOk) {
          console.error('[cdp] PMS 数据接口：已在某条 JSON 响应中发现编校审包名或测试 BRAN');
        }

        if (!pmsOk && !embedOk) {
          throw new Error(
            `严格校验失败：未在 PMS JSON 响应体中发现包名（${pkg}）或测试 BRAN（${bran}），且也未在嵌入站点接口/DOM 中发现。` +
              '可设 PMS_EMBED_API_URL_SUBSTRING 缩小 URL，或 PMS_CDP_VERIFY_EMBED_API=0 / PMS_CDP_VERIFY_PMS_API=0 跳过对应校验。',
          );
        }
      }

      if (extendedFlow) {
        let pmsListFound = false;
        let matchedListNeedle: string | null = null;
        console.error(`[cdp] PMS_CDP_EXTENDED_FLOW：在 PMS 中等待已有单据出现（${pmsVerifyTimeoutMs}ms）…`);
        await page.bringToFront().catch(() => undefined);
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press('Escape').catch(() => undefined);
        }
        if (pmsWebCenterUrl.includes('WebCenter')) {
          console.error(`[cdp] 回到 PMS 壳: ${pmsWebCenterUrl}`);
          await page.goto(pmsWebCenterUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await new Promise((r) => setTimeout(r, 1200));
        }
        await openReviewFormList(page);

        const refreshDeadline = Date.now() + pmsVerifyTimeoutMs;
        let refreshCount = 0;
        while (Date.now() < refreshDeadline) {
          matchedListNeedle = await waitForAnySubstringInPageOrChildFrames(
            page,
            reviewLookupNeedles,
            Math.min(20_000, refreshDeadline - Date.now()),
          ).catch(() => null);
          if (matchedListNeedle) {
            pmsListFound = true;
            break;
          }
          refreshCount++;
          console.error(`[cdp] PMS 列表第 ${refreshCount} 次刷新…（匹配键：${reviewLookupNeedles.join(' | ') || '(空)'}）`);
          for (const frame of page.frames()) {
            if (frame === page.mainFrame() || frame.isDetached()) continue;
            try { await frame.evaluate(() => location.reload()); } catch { /* cross-origin */ }
          }
          await page.keyboard.press('F5').catch(() => undefined);
          await new Promise((r) => setTimeout(r, 3000));
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
        }

        if (pmsListFound) {
          console.error(`[cdp] PMS 列表/iframe 中已可见已有单据匹配键：${matchedListNeedle}`);
        } else {
          throw new Error(
            `PMS 列表刷新超时：在 ${pmsVerifyTimeoutMs}ms 内未发现以下任一已有单据匹配键：${reviewLookupNeedles.join(' | ') || '(空)'}。`
            + (reviewEntryCandidates.length
              ? ` 候选记录：${reviewEntryCandidates.map((x) => formatReviewEntryCandidate(x)).join(' || ')}`
              : ' 当前未提取到结构化候选记录。'),
          );
        }

        console.error(`[cdp] 清除会话并以校核用户 ${checkerUsername} 重新登录…`);
        await context.clearCookies();
        await page.evaluate(() => {
          try { localStorage.clear(); } catch { /* ignore */ }
          try { sessionStorage.clear(); } catch { /* ignore */ }
        }).catch(() => undefined);
        await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500));
        if (submitReview) {
          await registerPlant3dAutomationReviewInitScript(context);
        }
        await login(page, checkerUsername, password);

        console.error('[cdp] 设计交付 → 三维校审单…');
        let listOpened = false;
        let lastListErr: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await openReviewFormList(page);
            listOpened = true;
            break;
          } catch (listErr) {
            lastListErr = listErr;
            console.error(`[cdp] JH 打开三维校审单列表失败（第 ${attempt} 次）：${listErr instanceof Error ? listErr.message : String(listErr)}`);
            await page.waitForTimeout(2000).catch(() => undefined);
          }
        }
        if (!listOpened) {
          const shot = await capturePmsPageScreenshot(page, 'pms-jh-open-list-failed');
          if (shot) {
            console.error(`[cdp] JH 列表失败截图：${shot}`);
          }
          throw lastListErr instanceof Error ? lastListErr : new Error('JH 无法打开三维校审单列表');
        }

        console.error(`[cdp] 尝试按已有单据匹配键打开记录：${reviewLookupNeedles.join(' | ') || '(空)'}`);
        let openResult = await tryOpenReviewEntryByNeedles(page, reviewLookupNeedles);
        if (!openResult.opened) {
          console.error('[cdp] JH 列表首轮未命中，刷新后再按 form_id / 记录号重试一次…');
          await page.keyboard.press('F5').catch(() => undefined);
          await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
          await openReviewFormList(page);
          openResult = await tryOpenReviewEntryByNeedles(page, reviewLookupNeedles);
        }
        if (!openResult.opened) {
          throw new Error(
            `JH 未能在 PMS 列表中打开已有单据。匹配键：${reviewLookupNeedles.join(' | ') || '(空)'}。`
            + (reviewEntryCandidates.length
              ? ` 候选记录：${reviewEntryCandidates.map((x) => formatReviewEntryCandidate(x)).join(' || ')}`
              : ' 当前未提取到结构化候选记录。'),
          );
        }
        console.error(`[cdp] 已按「${openResult.matchedNeedle}」对 PMS 列表项执行点击/双击`);
        const viewerOpened = await promoteSelectedReviewEntryIntoViewer(page);
        if (!viewerOpened) {
          const diag = await describeContextRoots(context).catch(() => '');
          if (diag) {
            console.error(`[cdp] JH 打开 plant3d 失败诊断：\n${diag}`);
          }
          const shot = await capturePmsPageScreenshot(page, 'pms-jh-open-viewer-failed');
          if (shot) {
            console.error(`[cdp] JH 打开 plant3d 失败截图：${shot}`);
          }
          throw new Error(`JH 已选中单据 ${openResult.matchedNeedle}，但 PMS 未真正打开 plant3d 工作区`);
        }
        console.error('[cdp] JH 已从 PMS 记录进入 plant3d 工作区');

        console.error('[cdp] 扫描 iframe 内校审面板，自动添加批注…');
        try {
          const annotResult = await runReviewerAnnotationAcrossContext(context);
          console.error(`[cdp] 校核批注：已添加 annotationId=${annotResult.annotationId}，确认记录数=${annotResult.confirmedCount}`);
        } catch (annotErr) {
          console.error(`[cdp] 校核批注：${annotErr instanceof Error ? annotErr.message : String(annotErr)}（不影响后续流程）`);
          const diag = await describeContextRoots(context).catch(() => '');
          if (diag) {
            console.error(`[cdp] 校核批注诊断：\n${diag}`);
          }
          const shot = await capturePmsPageScreenshot(page, 'pms-jh-annotation-missing-hook');
          if (shot) {
            console.error(`[cdp] 校核批注诊断截图：${shot}`);
          }
        }

        const reviewerRefreshRestoreEnabled =
          process.env.PMS_CDP_CHECKER_REFRESH_RESTORE === '1'
          || process.env.PMS_CDP_CHECKER_REFRESH_RESTORE === 'true';
        if (reviewerRefreshRestoreEnabled) {
          console.error('[cdp] 校核流程：按配置先刷新当前 reviewer 页面，并等待 workbench 恢复…');
          try {
            await reloadReviewerWorkbenchAcrossContext(context);
          } catch (refreshErr) {
            const diag = await describeContextRoots(context).catch(() => '');
            if (diag) {
              console.error(`[cdp] 校核刷新恢复失败诊断：\n${diag}`);
            }
            const shot = await capturePmsPageScreenshot(page, 'pms-jh-refresh-restore-failed');
            if (shot) {
              console.error(`[cdp] 校核刷新恢复失败截图：${shot}`);
            }
            throw refreshErr;
          }
          console.error('[cdp] 校核流程：刷新恢复成功，继续执行提交动作');
        }

        console.error('[cdp] 扫描 iframe 内校核工作区并点击「提交到审核」类按钮…');
        await runCheckerWorkflowAcrossContext(context);
        console.error('[cdp] 校核流程：已在 plant3d 内点击流程区提交按钮');
      }
    }
  } finally {
    pmsApiSniffer?.stop();
    embedApiSniffer?.stop();
    // connectOverCDP 时 close() 仅断开 Playwright 与 CDP 的会话，不会退出用户已启动的 Chrome；否则 Node 会因挂着的连接无法退出。
    await browser.close().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

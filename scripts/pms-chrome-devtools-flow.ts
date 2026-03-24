/**
 * PowerPMS 完整入口：http://pms.powerpms.net:1801/sysin.html
 *
 * 流程：登录 → 设计交付 → 三维校审单 →「新增」→（可选）轮询填写 PMS 弹窗 →（可选）URL 断言
 * →（可选）plant3d 内注入构件 + 填数据包名 + 点击「创建提资数据」→ 等待成功提示
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

import { startPmsApiSniffer, startPmsApiSnifferV2 } from './pms-api-sniffer';
import {
  assertNoCaptchaBarrier,
  PMS_DEFAULT_TEST_BRAN_REFNO,
  pollTryFillPmsDialogsInContext,
  registerPlant3dAutomationReviewInitScript,
  runCheckerWorkflowAcrossContext,
  runReviewerAnnotationAcrossContext,
  runSubmitReviewAcrossContext,
  tryFillPmsNewDocumentDialog,
  tryOpenReviewEntryContainingPackage,
  waitForSubstringInPageOrChildFrames,
} from './pms-plant3d-initiate-flow';

const base = (process.env.PMS_E2E_BASE || 'http://pms.powerpms.net:1801').replace(/\/$/, '');
const username = (process.env.PMS_E2E_USERNAME || 'SJ').trim();
const checkerUsername = (process.env.PMS_CHECKER_USERNAME || 'JH').trim();
const password = process.env.PMS_E2E_PASSWORD?.trim();
/** SJ 提资 → PMS 可见性校验 → 清 Cookie → JH 登录 → 打开条目 → plant3d 校核提交 */
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

function pageUrlsInclude(context: import('playwright').BrowserContext, sub: string): boolean {
  return context.pages().some((p) => !p.isClosed() && p.url().includes(sub));
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
  const listHint = page.getByText('三维校审单', { exact: true }).first();
  const newBtn = page.getByText('新增', { exact: false }).first();
  const listVisible = await listHint.isVisible().catch(() => false);
  const iframeVisible = await page.locator('iframe').first().isVisible().catch(() => false);
  const newVisible = await newBtn.isVisible().catch(() => false);
  const alreadyThere = listVisible && (iframeVisible || newVisible);
  if (alreadyThere) {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    return;
  }

  const tryOpenViaDesignDeliver = async (): Promise<boolean> => {
    try {
      const designDeliver = page.getByText('设计交付', { exact: false }).first();
      await designDeliver.waitFor({ state: 'visible', timeout: 45_000 });
      await designDeliver.click({ timeout: 25_000 }).catch(async () => {
        await page.locator('[title="设计交付"]').first().click({ timeout: 25_000 });
      });
      const reviewLink = page.getByRole('link', { name: '三维校审单', exact: true });
      if (await reviewLink.count()) {
        await reviewLink.first().click({ timeout: 20_000 });
      } else {
        await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 20_000 });
      }
      await listHint.waitFor({ state: 'visible', timeout: 20_000 });
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
        if (await reviewLink.count()) {
          await reviewLink.first().click({ timeout: 12_000 });
        } else {
          await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 12_000 });
        }

        await listHint.waitFor({ state: 'visible', timeout: 20_000 });
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
      if (await reviewLink.count()) {
        await reviewLink.first().click({ timeout: 12_000 });
      } else {
        await page.getByText('三维校审单', { exact: true }).first().click({ timeout: 12_000 });
      }

      await listHint.waitFor({ state: 'visible', timeout: 20_000 });
      console.error('[cdp] openReviewFormList: 通过「业务中心 → 三维校审单」进入');
      return true;
    } catch {
      return false;
    }
  };

  const ok =
    (await tryOpenViaDesignDeliver()) ||
    (await tryOpenViaMenuSearch()) ||
    (await tryOpenViaBusinessCenter()) ||
    (await tryOpenViaMenuSearch());
  if (!ok) {
    throw new Error('openReviewFormList: 无法打开「三维校审单」列表');
  }

  await Promise.race([
    page.locator('iframe').first().waitFor({ state: 'attached', timeout: 45_000 }),
    newBtn.waitFor({ state: 'visible', timeout: 45_000 }),
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

  if (!process.env.PMS_CDP_SELECTION_MODE?.trim()) {
    console.error(
      '[cdp] 提示：可设 PMS_CDP_SELECTION_MODE=console，在控制台输入「= 24381/145018」式命令选中 CE，再自动点「添加构件」写入列表（可用 PMS_CDP_ADD_COMPONENT_READY_MS / PMS_CDP_ADD_COMPONENT_LIST_MS 调超时；失败则回退 mock）。',
    );
  }

  if (extendedFlow && !process.env.PMS_MOCK_PACKAGE_NAME?.trim()) {
    process.env.PMS_MOCK_PACKAGE_NAME = `E2E-PMS-JH-${Date.now()}`;
    console.error(`[cdp] PMS_CDP_EXTENDED_FLOW：未设 PMS_MOCK_PACKAGE_NAME，已生成 ${process.env.PMS_MOCK_PACKAGE_NAME}`);
  }
  if (extendedFlow && !process.env.PMS_INITIATE_CHECKER_SUBSTRING?.trim()) {
    process.env.PMS_INITIATE_CHECKER_SUBSTRING = checkerUsername;
    console.error(
      `[cdp] PMS_CDP_EXTENDED_FLOW：未设 PMS_INITIATE_CHECKER_SUBSTRING，发起提资时将优先选校核下拉中含「${checkerUsername}」的项`,
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
    console.error('[cdp] PMS_CDP_FULL_FLOW：已合并启用弹窗轮询 + plant3d 提资（可用 SKIP 环境变量关闭子步骤）');
  }
  if (submitReview) {
    await registerPlant3dAutomationReviewInitScript(context);
    console.error('[cdp] 已注册 initScript：localStorage plant3d_automation_review=1');
  }

  const apiUrlSub = process.env.PMS_API_URL_SUBSTRING?.trim() || null;
  const pmsApiSniffer =
    submitReview && verifyPmsApi
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
    /** 提资后 iframe 可能抢走焦点，extended 阶段先回到此 URL 再进菜单 */
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
            `[cdp] 警告：未在顶层 URL 或可读 iframe URL 中发现「${openSubstring}」；仍将扫描 DOM 尝试 plant3d 发起提资（跨域 iframe 可能无法操作）。`,
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
      console.error('[cdp] PMS_CDP_SUBMIT_REVIEW=1：扫描各页/iframe 发起提资并提交…');
      const pkg = await runSubmitReviewAcrossContext(context);
      console.error('[cdp] plant3d：已检测到「提资单创建成功」');
      console.error(`[cdp] 本次提资包名（用于 PMS 检索）: ${pkg}`);

      const strictEmbedEnabled = !!embedApiSniffer;
      if (pmsApiSniffer) {
        const bran = (process.env.PMS_TARGET_BRAN_REFNO || PMS_DEFAULT_TEST_BRAN_REFNO).trim();
        const branAlt = bran.includes('_') ? bran.replace(/_/g, '/') : bran.replace(/\//g, '_');
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
          console.error('[cdp] PMS 数据接口：已在某条 JSON 响应中发现提资包名或测试 BRAN');
        }
      }

      // Strict verification: re-enter the just-created record and confirm embed pulls component data from plant3d.
      if (embedApiSniffer) {
        const bran = (process.env.PMS_TARGET_BRAN_REFNO || PMS_DEFAULT_TEST_BRAN_REFNO).trim();
        const branAlt = bran.includes('_') ? bran.replace(/_/g, '/') : bran.replace(/\//g, '_');
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

        let opened = false;
        try {
          opened = await tryOpenReviewEntryContainingPackage(page, pkg);
        } catch {
          opened = false;
        }
        if (!opened) {
          await clickNewInAnyFrame(page);
        }
        await new Promise((r) => setTimeout(r, 2500));

        const embedNetworkOk = await embedApiSniffer
          .waitForAnyNeedleInBodies([pkg, bran, branAlt], embedApiVerifyTimeoutMs)
          .then(() => true)
          .catch(() => false);
        let embedOk = embedNetworkOk;
        if (embedNetworkOk) {
          console.error('[cdp] 嵌入站点接口：已在某条 JSON 响应中发现提资包名或测试 BRAN');
        } else {
          console.error('[cdp] 嵌入站点接口嗅探未命中，降级为 DOM 文案断言（iframe 内可能跨域，仅做 best-effort）…');
          const domOk = await waitForSubstringInPageOrChildFrames(page, pkg, embedApiVerifyTimeoutMs)
            .then(() => true)
            .catch(() => false);
          embedOk = domOk;
          if (domOk) {
            console.error('[cdp] DOM：已在页面/子 frame 中发现提资包名（或 BRAN）');
          }
        }

        const pmsOk = await pmsOkPromise;
        if (pmsOk) {
          console.error('[cdp] PMS 数据接口：已在某条 JSON 响应中发现提资包名或测试 BRAN');
        }

        if (!pmsOk && !embedOk) {
          throw new Error(
            `严格校验失败：未在 PMS JSON 响应体中发现包名（${pkg}）或测试 BRAN（${bran}），且也未在嵌入站点接口/DOM 中发现。` +
              `可设 PMS_EMBED_API_URL_SUBSTRING 缩小 URL，或 PMS_CDP_VERIFY_EMBED_API=0 / PMS_CDP_VERIFY_PMS_API=0 跳过对应校验。`,
          );
        }
      }

      if (extendedFlow) {
        let pmsListFound = false;
        try {
          console.error(`[cdp] PMS_CDP_EXTENDED_FLOW：在 PMS 中等待出现包名（${pmsVerifyTimeoutMs}ms）…`);
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
            const found = await waitForSubstringInPageOrChildFrames(page, pkg, Math.min(20_000, refreshDeadline - Date.now())).then(() => true).catch(() => false);
            if (found) { pmsListFound = true; break; }
            refreshCount++;
            console.error(`[cdp] PMS 列表第 ${refreshCount} 次刷新…`);
            for (const frame of page.frames()) {
              if (frame === page.mainFrame() || frame.isDetached()) continue;
              try { await frame.evaluate(() => location.reload()); } catch { /* cross-origin */ }
            }
            await page.keyboard.press('F5').catch(() => undefined);
            await new Promise((r) => setTimeout(r, 3000));
            await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
          }

          if (pmsListFound) {
            console.error('[cdp] PMS 列表/iframe 中已可见提资包名');
          } else {
            throw new Error('PMS 列表刷新超时');
          }
        } catch {
          console.error('[cdp] PMS 列表未刷新出包名，降级为 JH 直接从三维校审单「新增」进入 plant3d');
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
        await openReviewFormList(page);
        let opened = false;
        if (pmsListFound) {
          console.error('[cdp] 尝试打开含包名的记录…');
          opened = await tryOpenReviewEntryContainingPackage(page, pkg);
        }
        if (!opened) {
          console.error('[cdp] 点击「新增」打开 plant3d 嵌入页…');
          await clickNewInAnyFrame(page);
          await new Promise((r) => setTimeout(r, 3000));
        }
        console.error(opened ? '[cdp] 已对匹配行执行点击/双击' : '[cdp] 已通过「新增」打开 plant3d，将在嵌入页中操作批注');

        console.error('[cdp] 扫描 iframe 内校审面板，自动添加批注…');
        try {
          const annotResult = await runReviewerAnnotationAcrossContext(context);
          console.error(`[cdp] 校核批注：已添加 annotationId=${annotResult.annotationId}，确认记录数=${annotResult.confirmedCount}`);
        } catch (annotErr) {
          console.error(`[cdp] 校核批注：${annotErr instanceof Error ? annotErr.message : String(annotErr)}（不影响后续流程）`);
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

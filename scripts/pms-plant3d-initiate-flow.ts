/**
 * PMS → plant3d「发起提资单」自动化：供 CDP 脚本与 Playwright PMS E2E 共用。
 * 依赖前端 InitiateReviewPanel 在 localStorage plant3d_automation_review=1 或 ?automation_review=1 时暴露 window.__plant3dInitiateReviewE2E。
 *
 * 默认测试 BRAN 与 PMS 数据界面展示一致（下划线 RefNo），便于联调核对同步。
 */
import type { BrowserContext, Frame, Page } from 'playwright';

/** 与 PMS 列表/详情一致的联调用 BRAN RefNo；可通过 `PMS_TARGET_BRAN_REFNO` 覆盖 */
export const PMS_DEFAULT_TEST_BRAN_REFNO = '24381_145018';

function resolveAutomationWorkflowMode(): string | null {
  const normalized = (process.env.PMS_CDP_WORKFLOW_MODE || '').trim().toLowerCase();
  return normalized || null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- 与 Window 合并需 interface
  interface Window {
    __plant3dInitiateReviewE2E?: { addMockComponent: (refNo?: string, name?: string) => void };
  }
}

export async function registerPlant3dAutomationReviewInitScript(context: BrowserContext): Promise<void> {
  const workflowMode = resolveAutomationWorkflowMode();
  await context.addInitScript((automationWorkflowMode: string | null) => {
    try {
      localStorage.setItem('plant3d_automation_review', '1');
      if (automationWorkflowMode) {
        localStorage.setItem('plant3d_workflow_mode', automationWorkflowMode);
      }
    } catch {
      /* ignore */
    }
  }, workflowMode);
}

export function listPageAndFrames(page: Page): (Page | Frame)[] {
  const out: (Page | Frame)[] = [page];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    if (frame === page.mainFrame()) continue;
    out.push(frame);
  }
  return out;
}

export async function tryFillPmsNewDocumentDialog(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"], .el-dialog, .x-window, .modal-dialog, .ant-modal, .x-panel').first();
  const visible = await dialog.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false);
  if (!visible) return;

  const code = process.env.PMS_MOCK_PROJECT_CODE || 'AvevaMarineSample';
  const name = process.env.PMS_MOCK_PROJECT_NAME || `E2E-${Date.now()}`;
  const pairs: [RegExp, string][] = [
    [/项目代码/i, code],
    [/项目编号/i, code],
    [/项目名称/i, name],
    [/单据名称/i, name],
    [/工程名称/i, name],
  ];
  for (const [re, val] of pairs) {
    const byLabel = dialog.getByLabel(re);
    if (await byLabel.count()) {
      await byLabel.first().fill(val).catch(() => undefined);
      continue;
    }
    const row = dialog.locator('label, span, td, div').filter({ hasText: re }).first();
    if (await row.count()) {
      const input = row.locator('xpath=ancestor::*[self::div or self::tr][1]').locator('input, textarea').first();
      await input.fill(val).catch(() => undefined);
    }
  }
  const submit = dialog.getByRole('button', { name: /保存|确定|提交|发起提资|下一步|确认/ }).first();
  if (await submit.count()) {
    await submit.click({ timeout: 10_000 }).catch(() => undefined);
  }
}

/**
 * 「新增」后 PMS 可能先弹出建单表单，再跳转/打开 plant3d；在一段时间内轮询所有标签页尝试填写并提交。
 */
export async function pollTryFillPmsDialogsInContext(
  context: BrowserContext,
  durationMs: number,
  intervalMs: number,
): Promise<void> {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    for (const p of context.pages().filter((x) => !x.isClosed())) {
      await tryFillPmsNewDocumentDialog(p).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** 登录页若出现验证码输入框，自动化无法继续（需免验证码账号或人工介入）。 */
export async function assertNoCaptchaBarrier(page: Page): Promise<void> {
  const captchaInput = page
    .locator('input[placeholder*="验证码" i], input[name*="captcha" i], input[id*="captcha" i]')
    .first();
  const vis = await captchaInput.isVisible().catch(() => false);
  if (vis) {
    throw new Error(
      'PMS 登录需要验证码：请使用免验证码测试账号，或在可人工输入验证码的环境运行；勿将验证码自动化写入仓库。',
    );
  }
}

/** 与发起提资填写一致，便于 PMS 列表检索与跨角色联调 */
export function resolveMockPackageName(): string {
  return (process.env.PMS_MOCK_PACKAGE_NAME || `E2E-PKG-${Date.now()}`).trim();
}

function resolveConsoleCommandRefno(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return s.includes('_') ? s.replace(/_/g, '/') : s;
}

function parseAddComponentReadyMs(): number {
  const n = Number(process.env.PMS_CDP_ADD_COMPONENT_READY_MS?.trim());
  return Number.isFinite(n) && n >= 5000 ? n : 45_000;
}

function parseAddComponentListWaitMs(): number {
  const n = Number(process.env.PMS_CDP_ADD_COMPONENT_LIST_MS?.trim());
  return Number.isFinite(n) && n >= 5000 ? n : 90_000;
}

/** 用于 DOM 断言：RefNo 可能为 24381/145018 或 24381_145018 */
function refnoListNeedleRegex(rawRefno: string): RegExp {
  const slash = resolveConsoleCommandRefno(rawRefno);
  const under = slash.includes('/') ? slash.replace(/\//g, '_') : slash;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`RefNo:\\s*(?:${esc(slash)}|${esc(under)})`, 'i');
}

async function trySelectBranViaConsole(root: Page | Frame, rawRefno: string): Promise<boolean> {
  const refno = resolveConsoleCommandRefno(rawRefno);
  if (!refno) return false;

  const workspace = root.locator('[data-testid="designer-landing-workspace"]');
  await workspace.first().waitFor({ state: 'visible', timeout: 5000 });

  const consoleBtn = root
    .locator('[data-command="panel.console"]')
    .first()
    .or(root.getByText('控制台', { exact: true }).first());
  if (await consoleBtn.isVisible().catch(() => false)) {
    await consoleBtn.click({ timeout: 8000 }).catch(() => undefined);
  }

  const input = root.locator('div.font-mono input[type="text"]').first();
  await input.waitFor({ state: 'visible', timeout: 12_000 });
  await input.fill(`= ${refno}`);
  await input.press('Enter');

  const ceOk = await root
    .getByText('CE set to:', { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 12_000 })
    .then(() => true)
    .catch(() => false);

  const addComponent = root.locator('[data-guide="add-component-btn"]').first();
  const readyMs = parseAddComponentReadyMs();
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    const disabled = await addComponent.getAttribute('disabled').catch(() => '');
    const ariaDisabled = await addComponent.getAttribute('aria-disabled').catch(() => '');
    if (!disabled && ariaDisabled !== 'true') {
      console.error(`[cdp] plant3d：「添加构件」已可用（CE 提示=${ceOk ? '已出现' : '未出现'}，等待≤${readyMs}ms）`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  console.error(`[cdp] plant3d：控制台输入「= ${refno}」后 ${readyMs}ms 内「添加构件」仍不可用`);
  return false;
}

/**
 * 在控制台已选中 CE 的前提下：等待「添加构件」可点 → 点击 → 等待构件列表出现目标 RefNo。
 */
async function clickAddComponentAndWaitForRefno(root: Page | Frame, rawRefno: string): Promise<boolean> {
  const addComponent = root.locator('[data-guide="add-component-btn"]').first();
  const readyMs = parseAddComponentReadyMs();
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    const vis = await addComponent.isVisible().catch(() => false);
    const disabled = await addComponent.getAttribute('disabled').catch(() => '');
    const ariaDisabled = await addComponent.getAttribute('aria-disabled').catch(() => '');
    if (vis && !disabled && ariaDisabled !== 'true') break;
    await new Promise((r) => setTimeout(r, 350));
  }

  const canClick = await addComponent.isVisible().catch(() => false)
    && !(await addComponent.getAttribute('disabled').catch(() => ''))
    && (await addComponent.getAttribute('aria-disabled').catch(() => '')) !== 'true';
  if (!canClick) {
    console.error('[cdp] plant3d：无法点击「添加构件」（仍禁用或不可见）');
    return false;
  }

  console.error('[cdp] plant3d：点击「添加构件」，将当前选中 CE 写入提资构件列表…');
  await addComponent.click({ timeout: 15_000 });

  const listMs = parseAddComponentListWaitMs();
  const refRe = refnoListNeedleRegex(rawRefno);
  const ok = await root
    .locator('div')
    .filter({ hasText: refRe })
    .first()
    .waitFor({ state: 'visible', timeout: listMs })
    .then(() => true)
    .catch(() => false);

  if (ok) {
    console.error(`[cdp] plant3d：构件列表已出现 RefNo（与 ${rawRefno.trim()} 匹配）`);
  } else {
    console.error(`[cdp] plant3d：点击「添加构件」后 ${listMs}ms 内未在列表中看到匹配 RefNo`);
  }
  return ok;
}

type Plant3dSelectRefnoRequest = {
  type: 'plant3d.select_refno';
  requestId?: string;
  refno: string;
  options?: { flyTo?: boolean };
};

type Plant3dResponse = {
  type: 'plant3d.response';
  requestId?: string;
  ok: boolean;
  error?: string;
};

async function trySelectBranViaPostMessage(root: Page | Frame, rawRefno: string): Promise<boolean> {
  const refno = String(rawRefno || '').trim();
  if (!refno) return false;

  const workspace = root.locator('[data-testid="designer-landing-workspace"]');
  await workspace.first().waitFor({ state: 'visible', timeout: 5000 });

  const requestId = `cdp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ok = await root
    .evaluate(async ({ requestId, refno }) => {
      const req: Plant3dSelectRefnoRequest = {
        type: 'plant3d.select_refno',
        requestId,
        refno,
        options: { flyTo: true },
      };

      const resolveCandidateIframes = (): HTMLIFrameElement[] => {
        return Array.from(document.querySelectorAll('iframe')).filter((x) => !!x);
      };

      const iframeCandidates = resolveCandidateIframes();
      if (!iframeCandidates.length) {
        console.warn('[cdp] postMessage select: no iframes found');
        return false;
      }

      const envSub = (window as unknown as Record<string, unknown>).PMS_EMBEDDED_SITE_SUBSTRING;
      const pmsEmbeddedSiteSubstring = typeof envSub === 'string' ? envSub.trim() : '';

      const pickBySub = (sub: string): HTMLIFrameElement | null => {
        const needle = sub.trim();
        if (!needle) return null;
        for (const ifr of iframeCandidates) {
          const src = (ifr.getAttribute('src') || '').trim();
          if (src && src.includes(needle)) return ifr;
        }
        return null;
      };

      let chosen: HTMLIFrameElement | null = null;
      if (pmsEmbeddedSiteSubstring) {
        chosen = pickBySub(pmsEmbeddedSiteSubstring);
      }
      if (!chosen) {
        chosen = pickBySub('/review/3d-view');
      }
      if (!chosen) {
        // Fallback: pick the largest visible iframe.
        let best: { ifr: HTMLIFrameElement; area: number } | null = null;
        for (const ifr of iframeCandidates) {
          const rect = ifr.getBoundingClientRect();
          const area = Math.max(0, rect.width) * Math.max(0, rect.height);
          if (!best || area > best.area) best = { ifr, area };
        }
        chosen = best?.ifr ?? iframeCandidates[0];
      }

      const chosenSrc = (chosen.getAttribute('src') || '').trim();
      const target = chosen.contentWindow;
      if (!target) {
        console.warn('[cdp] postMessage select: chosen iframe has no contentWindow', { chosenSrc });
        return false;
      }

      let targetOrigin = '*';
      if (chosenSrc) {
        try {
          targetOrigin = new URL(chosenSrc, window.location.href).origin;
        } catch {
          targetOrigin = '*';
        }
      }
      console.warn('[cdp] postMessage select: chosen iframe', { chosenSrc, targetOrigin, candidates: iframeCandidates.length });

      const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

      const resp = await new Promise<Plant3dResponse | null>((resolve) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          resolve(null);
        }, 18_000);

        const onMessage = (ev: MessageEvent) => {
          const data = ev.data as unknown;
          if (!data || typeof data !== 'object') return;
          const r = data as Partial<Plant3dResponse>;
          if (r.type !== 'plant3d.response') return;
          if (r.requestId !== requestId) return;
          cleanup();
          resolve(r as Plant3dResponse);
        };

        const cleanup = () => {
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
        };

        window.addEventListener('message', onMessage);

        void (async () => {
          const delays = [0, 250, 750, 1500, 3000];
          for (let i = 0; i < delays.length; i++) {
            if (delays[i]) await sleep(delays[i]);
            console.warn(`[cdp] postMessage select: attempt ${i + 1}/${delays.length}`);
            target.postMessage(req, targetOrigin);
          }
        })();
      });

      if (!resp) {
        console.warn('[cdp] postMessage select: no response');
        return false;
      }
      if (!resp.ok) {
        console.warn('[cdp] postMessage select: response not ok', { error: resp.error || null });
      } else {
        console.warn('[cdp] postMessage select: response ok');
      }
      return !!resp.ok;
    }, { requestId, refno })
    .catch(() => false);

  return ok;
}

export async function runPlant3dInitiateOnRoot(root: Page | Frame): Promise<string> {
  const targetBranRefno = (process.env.PMS_TARGET_BRAN_REFNO || PMS_DEFAULT_TEST_BRAN_REFNO).trim();
  const workspace = root.locator('[data-testid="designer-landing-workspace"]');
  await workspace.first().waitFor({ state: 'visible', timeout: 5000 });

  await root
    .waitForFunction(
      () => typeof window.__plant3dInitiateReviewE2E?.addMockComponent === 'function',
      null,
      { timeout: 45_000 },
    )
    .catch(() => {
      throw new Error(
        'plant3d 发起提资面板已出现，但未挂载自动化钩子。请部署含 InitiateReviewPanel 改动的版本，并启用 localStorage plant3d_automation_review（Playwright/CDP 的 registerPlant3dAutomationReviewInitScript）。',
      );
    });

  const selectionModeRaw = (process.env.PMS_CDP_SELECTION_MODE || '').trim().toLowerCase();
  /** console / console_add：控制台 `= refno` → 等待「添加构件」→ 点击并等待列表出现 RefNo */
  const selectionMode = selectionModeRaw === 'console_add' ? 'console' : selectionModeRaw;
  let selected = false;
  if (selectionMode === 'console') {
    console.error(`[cdp] plant3d：PMS_CDP_SELECTION_MODE=console，控制台输入「= ${resolveConsoleCommandRefno(targetBranRefno)}」并等待「添加构件」可用…`);
    selected = await trySelectBranViaConsole(root, targetBranRefno).catch(() => false);
    console.error(`[cdp] plant3d：控制台 CE/选中 ${selected ? '就绪' : '失败'}，将${selected ? '点击「添加构件」' : '回退 mock 注入'}`);
  } else if (selectionMode === 'postmessage') {
    console.error(`[cdp] plant3d：PMS_CDP_SELECTION_MODE=postmessage，尝试 postMessage 选择 BRAN ${targetBranRefno}…`);
    selected = await trySelectBranViaPostMessage(root, targetBranRefno).catch(() => false);
    console.error(`[cdp] plant3d：postMessage 选择 ${selected ? '成功' : '失败'}，将${selected ? '点击「添加构件」' : '回退 mock 注入'}`);
  }

  if (!selected) {
    await root.evaluate((refNo) => {
      const displayName = refNo.includes('_') ? `BRAN ${refNo}` : `BRAN/${refNo}`;
      window.__plant3dInitiateReviewE2E?.addMockComponent?.(refNo, displayName);
    }, targetBranRefno);
    console.error(`[cdp] plant3d：已使用 __plant3dInitiateReviewE2E.addMockComponent 注入 BRAN ${targetBranRefno}`);
  } else {
    const added = await clickAddComponentAndWaitForRefno(root, targetBranRefno).catch(() => false);
    if (!added) {
      await root.evaluate((refNo) => {
        const displayName = refNo.includes('_') ? `BRAN ${refNo}` : `BRAN/${refNo}`;
        window.__plant3dInitiateReviewE2E?.addMockComponent?.(refNo, displayName);
      }, targetBranRefno);
      console.error('[cdp] plant3d：「添加构件」流程未确认到列表 RefNo，已回退 mock 注入');
    }
  }

  const pkg = resolveMockPackageName();
  await root.getByPlaceholder('输入提资数据包名称...').fill(pkg);

  const checkerSel = root.locator('[data-testid="initiate-checker-select"]');
  const approverSel = root.locator('[data-testid="initiate-approver-select"]');
  const hasManualSelectors = (await checkerSel.count()) > 0 && (await approverSel.count()) > 0;
  if (hasManualSelectors) {
    await checkerSel.waitFor({ state: 'visible', timeout: 30_000 });

    await root.waitForFunction(
      () => {
        const c = document.querySelector('[data-testid="initiate-checker-select"]');
        const a = document.querySelector('[data-testid="initiate-approver-select"]');
        if (!c || !a) return false;
        const co = [...c.querySelectorAll('option')].filter((o) => (o as HTMLOptionElement).value);
        const ao = [...a.querySelectorAll('option')].filter((o) => (o as HTMLOptionElement).value);
        return co.length >= 1 && ao.length >= 1;
      },
      null,
      { timeout: 90_000 },
    );

    const checkerVals = await checkerSel.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    const approverVals = await approverSel.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );

    const checkerHint = (process.env.PMS_INITIATE_CHECKER_SUBSTRING?.trim() || '').toLowerCase();
    const optLoc = checkerSel.locator('option');
    const optN = await optLoc.count();
    let checkerId: string | undefined;
    if (checkerHint) {
      for (let i = 0; i < optN; i++) {
        const opt = optLoc.nth(i);
        const val = await opt.getAttribute('value');
        const txt = ((await opt.textContent()) || '').toLowerCase();
        if (val && txt.includes(checkerHint)) {
          checkerId = val;
          break;
        }
      }
    }
    if (!checkerId) checkerId = checkerVals[0];

    const approverId = approverVals.find((id) => id !== checkerId) ?? approverVals[0];
    if (!checkerId || !approverId) {
      throw new Error('校核/批准下拉无可用选项，无法自动提资');
    }
    if (checkerId === approverId && approverVals.length < 2) {
      throw new Error('仅有一名可选审核人，无法满足「校核人与批准人不同」校验');
    }

    await checkerSel.selectOption(checkerId);
    await approverSel.selectOption(approverId);
  }

  const submitBtn = root.locator('[data-guide="submit-btn"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 20_000 });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const disabled = await submitBtn.getAttribute('disabled');
    const ariaDisabled = await submitBtn.getAttribute('aria-disabled');
    if (!disabled && ariaDisabled !== 'true') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await submitBtn.click({ timeout: 20_000 });

  await root
    .getByText(/提资单(创建|保存)成功/, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });
  return pkg;
}

/**
 * 在 PMS 列表/iframe 中点击包含包名的行或文本，尝试打开三维校审详情（实现因 ExtJS/表格结构而异，失败时不抛错）。
 */
function normalizeLookupNeedles(needles: string[]): string[] {
  return [...new Set(needles.map((s) => s.trim()).filter(Boolean))];
}

export async function tryOpenReviewEntryByNeedles(
  page: Page,
  needles: string[],
): Promise<{ opened: boolean; matchedNeedle: string | null }> {
  const normalized = normalizeLookupNeedles(needles);
  if (!normalized.length) return { opened: false, matchedNeedle: null };
  const frames = page.frames().filter((f) => !f.isDetached());
  const roots: (Page | Frame)[] = [page, ...frames.filter((f) => f !== page.mainFrame())];
  for (const root of roots) {
    for (const needle of normalized) {
      const hit = root.getByText(needle, { exact: false }).first();
      const vis = await hit.isVisible().catch(() => false);
      if (!vis) continue;
      await hit.scrollIntoViewIfNeeded().catch(() => undefined);
      const row = hit.locator('xpath=ancestor::tr[1]');
      if (await row.count()) {
        await row.dblclick({ timeout: 8000 }).catch(async () => {
          await hit.click({ timeout: 8000 }).catch(() => undefined);
        });
      } else {
        await hit.dblclick({ timeout: 8000 }).catch(async () => {
          await hit.click({ timeout: 8000 }).catch(() => undefined);
        });
      }
      await new Promise((r) => setTimeout(r, 2000));
      return { opened: true, matchedNeedle: needle };
    }
  }
  return { opened: false, matchedNeedle: null };
}

/**
 * 兼容旧调用：优先按包名打开现有记录。
 */
export async function tryOpenReviewEntryContainingPackage(page: Page, pkg: string): Promise<boolean> {
  const result = await tryOpenReviewEntryByNeedles(page, [pkg]);
  return result.opened;
}

export async function waitForSubstringInPageOrChildFrames(
  page: Page,
  substring: string,
  timeoutMs: number,
): Promise<void> {
  await waitForAnySubstringInPageOrChildFrames(page, [substring], timeoutMs);
}

export async function waitForAnySubstringInPageOrChildFrames(
  page: Page,
  substrings: string[],
  timeoutMs: number,
): Promise<string> {
  const normalized = normalizeLookupNeedles(substrings);
  if (!normalized.length) throw new Error('waitForAnySubstringInPageOrChildFrames: 空字符串');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = page.frames().filter((f) => !f.isDetached());
    const roots: (Page | Frame)[] = [page, ...frames.filter((f) => f !== page.mainFrame())];
    for (const root of roots) {
      for (const sub of normalized) {
        const vis = await root
          .getByText(sub, { exact: false })
          .first()
          .isVisible()
          .catch(() => false);
        if (vis) return sub;
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`超时：PMS 页面及 iframe 内均未发现以下任一文本：${normalized.join(' | ')}`);
}

/**
 * 校核员在 plant3d 内：待任务工作区出现后，点击流程区「提交…」主按钮（如「提交到审核」）。
 * 若弹出确认框，尝试点「确定/确认」。
 */
export async function runPlant3dCheckerWorkflowOnRoot(root: Page | Frame): Promise<void> {
  await root
    .locator('[data-testid="reviewer-landing-workspace"]')
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });

  await root
    .locator('[data-testid="review-workbench-workflow-zone"]')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });

  const submitBtn = root.locator('[data-guide="workflow-actions"] button').filter({ hasText: /提交/ }).first();
  await submitBtn.waitFor({ state: 'visible', timeout: 30_000 });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const disabled = await submitBtn.getAttribute('disabled');
    const ariaDisabled = await submitBtn.getAttribute('aria-disabled');
    if (!disabled && ariaDisabled !== 'true') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await submitBtn.click({ timeout: 20_000 });

  const inDialog = root.locator('[role="dialog"]').last();
  const confirmBtn = inDialog.getByRole('button', { name: /确定|确认/ }).last();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click({ timeout: 10_000 }).catch(() => undefined);
  }
}

export async function runReviewerAnnotationOnRoot(root: Page | Frame): Promise<{ annotationId: string; confirmedCount: number }> {
  await root
    .waitForFunction(
      () => typeof (window as unknown as Record<string, { addMockAnnotation: () => string }>).__plant3dReviewerE2E?.addMockAnnotation === 'function',
      null,
      { timeout: 60_000 },
    )
    .catch(() => {
      throw new Error('校审面板已出现，但未挂载自动化钩子 __plant3dReviewerE2E。请确保已部署含 ReviewPanel 改动的版本。');
    });

  const annotationId = await root.evaluate(() => {
    return (window as unknown as Record<string, { addMockAnnotation: (t?: string, d?: string) => string }>).__plant3dReviewerE2E.addMockAnnotation(
      `JH 校核批注 ${new Date().toLocaleTimeString('zh-CN')}`,
      '校核人员通过自动化测试创建的批注 — 验证跨角色批注持久化',
    );
  });

  await root.evaluate(async () => {
    await (window as unknown as Record<string, { confirmData: (n?: string) => Promise<void> }>).__plant3dReviewerE2E.confirmData('E2E 自动化校核批注');
  });

  const confirmedCount = await root.evaluate(() => {
    return (window as unknown as Record<string, { getConfirmedRecordCount: () => number }>).__plant3dReviewerE2E.getConfirmedRecordCount();
  });

  return { annotationId, confirmedCount };
}

export async function runReviewerAnnotationAcrossContext(context: BrowserContext): Promise<{ annotationId: string; confirmedCount: number }> {
  const rawPoll = process.env.PMS_PLANT3D_POLL_MS?.trim();
  const parsed = rawPoll ? Number(rawPoll) : NaN;
  const pollMs = Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 180_000;
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        const hook = await root.evaluate(() =>
          typeof (window as unknown as Record<string, unknown>).__plant3dReviewerE2E === 'object',
        ).catch(() => false);
        if (!hook) continue;
        return await runReviewerAnnotationOnRoot(root);
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error('超时：未在任何标签页/iframe 内找到校审面板自动化钩子 __plant3dReviewerE2E');
}

export async function waitForReviewerWorkbenchAcrossContext(context: BrowserContext): Promise<{ page: Page; root: Page | Frame }> {
  const rawPoll = process.env.PMS_PLANT3D_POLL_MS?.trim();
  const parsed = rawPoll ? Number(rawPoll) : NaN;
  const pollMs = Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 180_000;
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        const n = await root.locator('[data-testid="review-workbench-workflow-zone"]').count();
        if (!n) continue;
        const vis = await root
          .locator('[data-testid="review-workbench-workflow-zone"]')
          .first()
          .isVisible()
          .catch(() => false);
        if (!vis) continue;
        return { page: p, root };
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    '超时：未在任何标签页/iframe 内找到校核工作区 [data-testid=review-workbench-workflow-zone]（请确认 JH 已从 PMS 打开含该提资的三维/校审入口）',
  );
}

export async function reloadReviewerWorkbenchAcrossContext(context: BrowserContext): Promise<void> {
  const located = await waitForReviewerWorkbenchAcrossContext(context);
  const pageUrl = located.page.url();
  console.error(`[cdp] 校核刷新恢复：刷新当前 reviewer 页面 ${pageUrl || '(blank)'}`);
  await located.page.bringToFront().catch(() => undefined);
  await located.page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitForReviewerWorkbenchAcrossContext(context);
}

export async function runCheckerWorkflowAcrossContext(context: BrowserContext): Promise<void> {
  const located = await waitForReviewerWorkbenchAcrossContext(context);
  await runPlant3dCheckerWorkflowOnRoot(located.root);
}

export async function runSubmitReviewAcrossContext(context: BrowserContext): Promise<string> {
  const rawPoll = process.env.PMS_PLANT3D_POLL_MS?.trim();
  const parsed = rawPoll ? Number(rawPoll) : NaN;
  const pollMs = Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 180_000;
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        const n = await root.locator('[data-testid="designer-landing-workspace"]').count();
        if (!n) continue;
        const vis = await root
          .locator('[data-testid="designer-landing-workspace"]')
          .first()
          .isVisible()
          .catch(() => false);
        if (!vis) continue;
        return await runPlant3dInitiateOnRoot(root);
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    '超时：未在任何标签页/iframe 内找到发起提资面板 [data-testid=designer-landing-workspace]（跨域 iframe 无法用 Playwright 注入，请改为新开同源标签或调整嵌入方式）',
  );
}

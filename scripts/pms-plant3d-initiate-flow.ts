/**
 * PMS → plant3d「发起提资单」自动化：供 CDP 脚本与 Playwright PMS E2E 共用。
 * 依赖前端 InitiateReviewPanel 在 localStorage plant3d_automation_review=1 或 ?automation_review=1 时暴露 window.__plant3dInitiateReviewE2E。
 */
import type { BrowserContext, Frame, Page } from 'playwright';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- 与 Window 合并需 interface
  interface Window {
    __plant3dInitiateReviewE2E?: { addMockComponent: (refNo?: string, name?: string) => void };
  }
}

export async function registerPlant3dAutomationReviewInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('plant3d_automation_review', '1');
    } catch {
      /* ignore */
    }
  });
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

  const code = process.env.PMS_MOCK_PROJECT_CODE || 'AvevaMarineSample-E2E';
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

export async function runPlant3dInitiateOnRoot(root: Page | Frame): Promise<void> {
  const targetBranRefno = (process.env.PMS_TARGET_BRAN_REFNO || '24381/145018').trim();
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

  await root.evaluate((refNo) => {
    window.__plant3dInitiateReviewE2E?.addMockComponent?.(refNo, `BRAN/${refNo}`);
  }, targetBranRefno);

  const pkg = (process.env.PMS_MOCK_PACKAGE_NAME || `E2E-PKG-${Date.now()}`).trim();
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
    const checkerId = checkerVals[0];
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
    .getByText('提资单创建成功', { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });
}

export async function runSubmitReviewAcrossContext(context: BrowserContext): Promise<void> {
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
        await runPlant3dInitiateOnRoot(root);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    '超时：未在任何标签页/iframe 内找到发起提资面板 [data-testid=designer-landing-workspace]（跨域 iframe 无法用 Playwright 注入，请改为新开同源标签或调整嵌入方式）',
  );
}

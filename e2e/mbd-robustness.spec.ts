import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 健壮性回归（健壮性计划 E3 / 现行计划 W4-2）：mock 分支里混入「还不认识的图元 kind」
 * 与「契约认可但映射不出来的图元」，在真实页面上验证两级原子拒绝（ADR 0046）与
 * `?mbd_partial=1` 的降级口径。与 dimension-mbd-v2-fixture.spec.ts 一样用 page.route
 * 注入 JSON，不依赖 plant-mbd 或任何后端进程。
 *
 * | mock 分支                     | 默认（原子拒绝）                         | `?mbd_partial=1`                                  |
 * | ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
 * | 未知 kind + 退化弧（混合）     | 契约层整包拒绝：0 条 + 装载失败角标       | 两条进「跳过图元」，其余照画 + 常驻「已跳过 2 条」 |
 * | 仅退化弧（映射层）             | 映射层整包拒绝：0 条 + 装载失败角标       | 1 条跳过，其余照画 + 「已跳过 1 条」               |
 * | 字段非法的 linear_dim（缺 end） | 契约层整包拒绝                           | **仍**整包拒绝——partial 只放宽「未知 kind」一件事  |
 *
 * 「角标」有两张脸：装载失败角标（B2，`mbd-error-badge`）只在有 loadError 且一条 MBD 记录
 * 都没有时挂在 BRAN 行上；部分显示时视图不空，常驻提示是 B3 的横幅（`mbd-partial-banner`）。
 * partial 的两条入口都覆盖：URL 带 `mbd_partial=1` 进入（装载后再开面板），以及页内勾选
 * 「允许部分显示」（开关只改 URL + 派发 popstate，面板回读 URL 同步勾选框与横幅）。
 */

const MIXED_REFNO = 'robust-mixed-unknown-kind';
const DEGENERATE_REFNO = 'robust-degenerate-arc';
const INVALID_FIELD_REFNO = 'robust-invalid-field';

const VALID_DIMENSION_ID = 'linear-small-dimension:isoline:0:member:T-SMALL';
const UNKNOWN_KIND_ID = 'future-mark-1';
const DEGENERATE_ARC_ID = 'aid-arc-degenerate';
const INVALID_FIELD_ID = 'linear-missing-end';

type MockPayload = Readonly<{ primitives: readonly Record<string, unknown>[] }>
  & Record<string, unknown>;

/** rs-mbd CLI 真实生成物（M0.1 冻结值）：唯一一条合法 linear_dim，其余 mock 图元都围着它放。 */
const fixturePayload = JSON.parse(readFileSync(
  fileURLToPath(new URL('../src/fixtures/mbd-v2/rs-mbd-cli-linear.json', import.meta.url)),
  'utf8',
)) as MockPayload;
const validLinearDim = fixturePayload.primitives[0]!;

/** 后端先行演进出的 kind：契约默认整包拒绝，只有 partial 才降级成逐条诊断。 */
const unknownKindPrimitive = { kind: 'future_mark', id: UNKNOWN_KIND_ID, text: 'TBD' };

/**
 * 契约认可（结构与有限性都对）但映射不出来：x_axis 与 normal 平行，mapper 对 normal
 * 重新正交化后塌成零向量（`degenerate arc frame`）。这是「半对的数据」，默认必须整包拒绝。
 */
const degenerateArcPrimitive = {
  kind: 'aid_arc',
  id: DEGENERATE_ARC_ID,
  center: [40, -500, 0],
  x_axis: [0, 0, 1],
  normal: [0, 0, 1],
  radius: 20,
  start_angle_deg: 0,
  sweep_angle_deg: 90,
};

/** 认识的 kind 但字段非法（缺 end）：写错的数据不可信，任何模式下都整包拒绝。 */
const { end: _end, ...linearDimWithoutEnd } = validLinearDim;
const invalidFieldPrimitive = { ...linearDimWithoutEnd, id: INVALID_FIELD_ID };

function branchPayload(refno: string, primitives: readonly unknown[]): Record<string, unknown> {
  return {
    ...fixturePayload,
    branch_refno: refno,
    input_refno: `fixture:${refno}`,
    primitives,
  };
}

const payloadsByRefno: Readonly<Record<string, Record<string, unknown>>> = {
  [MIXED_REFNO]: branchPayload(MIXED_REFNO, [
    validLinearDim,
    unknownKindPrimitive,
    degenerateArcPrimitive,
  ]),
  [DEGENERATE_REFNO]: branchPayload(DEGENERATE_REFNO, [
    validLinearDim,
    degenerateArcPrimitive,
  ]),
  [INVALID_FIELD_REFNO]: branchPayload(INVALID_FIELD_REFNO, [
    validLinearDim,
    invalidFieldPrimitive,
  ]),
};

/**
 * 与模型数据源隔离的页面 URL（同 dimension-mbd-v2-fixture.spec.ts）：`dtx_demo=primitives`
 * 跳过 db_meta_info 预拉，`model_source=legacy` 钉住数据源，demo 模式下 designToWorld
 * 仍是 scale(1000)。
 */
function pageUrl(refno: string, options: Readonly<{ partial?: boolean }> = {}): string {
  const params = new URLSearchParams({
    dimension_demo: '1',
    dtx_demo: 'primitives',
    dtx_demo_count: '1',
    model_source: 'legacy',
    mbd_refno: refno,
  });
  if (options.partial) params.set('mbd_partial', '1');
  return `/?${params.toString()}`;
}

async function routeMbdPipeApi(page: Page): Promise<void> {
  await page.route('**/api/mbd/v2/pipe/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const refno = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    const body = payloadsByRefno[refno];
    // 没有对应 mock 的 refno 直接 404：让用例因「请求了意料之外的分支」而失败，而不是
    // 静默拿到别的负载。
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { error: `no mock branch for ${refno}` }),
    });
  });
}

async function waitForDimensionSystem(page: Page): Promise<void> {
  await page.getByText('三维查看器', { exact: true }).click();
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ), null, { timeout: 90_000 });
  expect(await page.evaluate(
    () => (window as any).__dimensionSystemError ?? null,
  )).toBeNull();
}

async function switchMbdBranch(page: Page, refno: string): Promise<void> {
  await page.evaluate((nextRefno) => {
    const url = new URL(window.location.href);
    url.searchParams.set('mbd_refno', nextRefno);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, refno);
}

async function mbdRecords(page: Page): Promise<readonly any[]> {
  return page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value
      .externalRegistry.snapshot.records
      .filter((record: any) => record.source === 'mbd')
  ));
}

/**
 * 「尺寸标注」默认不在 dock，经视图菜单按需打开（panel.dimension → togglePanel；菜单项
 * 文字被图标节点拆开，用 role+name 定位）。
 */
async function openDimensionPanel(page: Page): Promise<void> {
  await page.getByText('视图', { exact: true }).click();
  await page.getByRole('button', { name: '尺寸标注' }).click();
  await expect(page.getByTestId('mbd-refno')).toBeVisible();
}

async function expandDiagnostics(page: Page): Promise<Locator> {
  const diagnostics = page.getByTestId('mbd-diagnostics');
  await expect(diagnostics).toBeVisible();
  const open = await diagnostics.evaluate(element => (element as HTMLDetailsElement).open);
  if (!open) await diagnostics.locator('summary').click();
  return diagnostics;
}

/**
 * 原子拒绝的用户可见口径（B2）：一条 MBD 记录都没有，BRAN 行挂红色「! 装载失败」角标，
 * title 带原因；点开直接展开诊断，诊断区头一行就是「装载失败：…」。
 */
async function expectAtomicRejection(page: Page, reason: RegExp): Promise<void> {
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(0);
  const badge = page.getByTestId('mbd-error-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('title', reason);
  await badge.click();
  const loadError = page.getByTestId('mbd-load-error');
  await expect(loadError).toBeVisible();
  await expect(loadError).toContainText('装载失败');
  await expect(loadError).toContainText(reason);
}

/** 部分显示的用户可见口径（B3）：合法的那条照常进注册表，视图不空所以没有装载失败角标。 */
async function expectPartialDisplay(page: Page, skippedCount: number): Promise<void> {
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(1);
  const record = (await mbdRecords(page))[0];
  expect(record.id).toBe(VALID_DIMENSION_ID);
  expect(record.layout.formattedLabel).toBe('80');

  await expect(page.getByTestId('mbd-error-badge')).toHaveCount(0);
  await expect(page.getByTestId('mbd-load-error')).toHaveCount(0);
  await expect(page.getByTestId('mbd-kind-filter')).toContainText('显示 1 条');
  await expect(page.getByTestId('mbd-partial-toggle')).toBeChecked();
  const banner = page.getByTestId('mbd-partial-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`已跳过 ${skippedCount} 条`);
  await expect(banner).toContainText('不代表完整标注');
}

test('unknown kind: rejected atomically by default; the in-panel partial toggle round-trips to partial display and back', async ({ page }) => {
  test.setTimeout(120_000);
  await routeMbdPipeApi(page);
  const response = page.waitForResponse(candidate => (
    candidate.url().includes(`/api/mbd/v2/pipe/${MIXED_REFNO}`)
  ));
  await page.goto(pageUrl(MIXED_REFNO));
  expect((await response).status()).toBe(200);
  await waitForDimensionSystem(page);
  await openDimensionPanel(page);

  // 契约层先于映射层拒绝：原因点名未知 kind 与 id，退化弧根本没轮到映射。
  await expectAtomicRejection(page, /invalid primitive future_mark "future-mark-1"/);
  await expect(page.getByTestId('mbd-partial-toggle')).not.toBeChecked();
  await expect(page.locator(`[data-skipped-id="${DEGENERATE_ARC_ID}"]`)).toHaveCount(0);

  // 页内勾选「允许部分显示」：开关只改 URL + 派发 popstate，同步层按 partial 重拉，
  // 面板回读 URL —— 勾选框、横幅与视图里的记录三者一致（B3 补）。
  await page.getByTestId('mbd-partial-toggle').check();
  await expect.poll(() => page.evaluate(
    () => new URL(window.location.href).searchParams.get('mbd_partial'),
  )).toBe('1');
  await expectPartialDisplay(page, 2);

  // 取消勾选：回到原子拒绝，角标重新出现，横幅随开关一起消失。
  await page.getByTestId('mbd-partial-toggle').uncheck();
  await expectAtomicRejection(page, /invalid primitive future_mark "future-mark-1"/);
  await expect(page.getByTestId('mbd-partial-toggle')).not.toBeChecked();
  await expect(page.getByTestId('mbd-partial-banner')).toHaveCount(0);
});

test('unknown kind with ?mbd_partial=1: the rest still renders, both offenders are listed and the skipped banner stays', async ({ page }) => {
  test.setTimeout(120_000);
  await routeMbdPipeApi(page);
  await page.goto(pageUrl(MIXED_REFNO, { partial: true }));
  await waitForDimensionSystem(page);
  await openDimensionPanel(page);

  // 未知 kind 由契约层跳过、退化弧由映射层跳过，合计 2 条；合法的 linear_dim 照常显示。
  await expectPartialDisplay(page, 2);
  const diagnostics = await expandDiagnostics(page);
  await expect(diagnostics).toContainText('跳过图元（2）');
  await expect(diagnostics.locator(`[data-skipped-id="${UNKNOWN_KIND_ID}"]`))
    .toContainText('还不认识的图元 kind：future_mark');
  await expect(diagnostics.locator(`[data-skipped-id="${DEGENERATE_ARC_ID}"]`))
    .toContainText('degenerate arc frame');
  await expect(diagnostics).toContainText('mbd_partial=1：允许部分显示，已跳过 1 个图元');
  await expect(diagnostics).toContainText('契约层跳过 1 个图元');
});

test('a contract-valid primitive the mapper cannot place still rejects the whole payload by default', async ({ page }) => {
  test.setTimeout(120_000);
  await routeMbdPipeApi(page);
  await page.goto(pageUrl(DEGENERATE_REFNO));
  await waitForDimensionSystem(page);
  await openDimensionPanel(page);

  // 映射层原子拒绝：契约放行了退化弧，mapper 映射不出来 → 整包不提交，原因点名 id。
  await expectAtomicRejection(page, /整包拒绝：1 个图元无法映射/);
  await expect(page.getByTestId('mbd-load-error')).toContainText(DEGENERATE_ARC_ID);
  await expect(page.getByTestId('mbd-load-error')).toContainText('degenerate arc frame');
  // 整包拒绝时跳过明细仍随诊断一起交回，便于定位是哪一条。
  await expect(page.locator(`[data-skipped-id="${DEGENERATE_ARC_ID}"]`)).toBeVisible();

  // 认识的 kind 但字段非法：契约层拒绝，原因点名 kind 与 id。
  await switchMbdBranch(page, INVALID_FIELD_REFNO);
  await expectAtomicRejection(page, /invalid primitive linear_dim "linear-missing-end"/);
});

test('?mbd_partial=1 skips a degenerate primitive but never rescues invalid fields', async ({ page }) => {
  test.setTimeout(120_000);
  await routeMbdPipeApi(page);
  await page.goto(pageUrl(DEGENERATE_REFNO, { partial: true }));
  await waitForDimensionSystem(page);
  await openDimensionPanel(page);

  await expectPartialDisplay(page, 1);
  const diagnostics = await expandDiagnostics(page);
  await expect(diagnostics.locator(`[data-skipped-id="${DEGENERATE_ARC_ID}"]`))
    .toContainText('degenerate arc frame');

  // partial 只放宽「未知 kind」：字段非法的图元在 partial 下照样整包拒绝，角标重新出现。
  await switchMbdBranch(page, INVALID_FIELD_REFNO);
  await expectAtomicRejection(page, /invalid primitive linear_dim "linear-missing-end"/);
  await expect(page.getByTestId('mbd-partial-toggle')).toBeChecked();

  // 切回退化弧分支：替换语义，部分显示恢复。
  await switchMbdBranch(page, DEGENERATE_REFNO);
  await expectPartialDisplay(page, 1);
});

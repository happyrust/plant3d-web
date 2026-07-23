import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

/**
 * 默认 CI 门禁：用 rs-mbd CLI 真实生成物打通
 * `HTTP 装载 → V2 契约 → source_mm→design_m → externalRegistry → scene painter → SVG`
 * 纵向链路，不依赖 rs-mbd 或任何后端进程（page.route 注入 JSON）。
 * 错误负载走 ADR 0046 原子失败：整包拒绝、清空来源、诊断可见。
 */

const FIXTURE_REFNO = 'linear-small-dimension';
const INVALID_REFNO = 'invalid-angle-dim';
const DIMENSION_ID = 'linear-small-dimension:isoline:0:member:T-SMALL';

const fixturePayload = JSON.parse(readFileSync(
  fileURLToPath(new URL('../src/fixtures/mbd-v2/rs-mbd-cli-linear.json', import.meta.url)),
  'utf8',
)) as Record<string, unknown>;

/** 结构合法（HTTP 200）但契约无效：angle_dim 显式几何尚未进入 V2 契约。 */
const invalidAngleDimPayload = {
  version: 'v2',
  input_refno: `fixture:${INVALID_REFNO}`,
  branch_refno: INVALID_REFNO,
  primitives: [{ kind: 'angle_dim', id: 'angle-1', text: '45' }],
  meta: { geometry_space: 'design_m', notes: [] },
  issues: [],
};

async function routeMbdPipeApi(page: Page): Promise<void> {
  await page.route('**/api/mbd/v2/pipe/**', async (route) => {
    const url = route.request().url();
    const body = url.includes(`/api/mbd/v2/pipe/${INVALID_REFNO}`)
      ? invalidAngleDimPayload
      : fixturePayload;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
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

test('CLI linear fixture loads through contract, registry, scene painter, and SVG export', async ({ page }, testInfo) => {
  await routeMbdPipeApi(page);
  const response = page.waitForResponse(candidate => (
    candidate.url().includes(`/api/mbd/v2/pipe/${FIXTURE_REFNO}`)
  ));
  await page.goto(`/?dimension_demo=1&mbd_refno=${FIXTURE_REFNO}`);
  expect((await response).status()).toBe(200);
  await waitForDimensionSystem(page);

  // 恰好一条 mbd 记录，id / 文本 / 设计坐标与适配器单测（M0.1 冻结值）一致。
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(1);
  const record = (await mbdRecords(page))[0];
  expect(record.id).toBe(DIMENSION_ID);
  expect(record.role).toBe('external');
  expect(record.layout.formattedLabel).toBe('80');
  expect(record.layout.lines[0]).toMatchObject({
    from: [0, -0.5, 0],
    to: [0.08, -0.5, 0],
  });
  expect(record.layout.labelAnchor).toEqual([0.116, -0.5, 0]);
  expect(record.layout.arrowLines[0]).toEqual({
    from: [0, -0.5, 0],
    to: [-0.024, -0.507, 0],
  });

  // 只读（ADR 0019 / 0028）：不进用户文档，删除失败，注册表不变。
  const readonly = await page.evaluate((dimensionId) => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const before = system.externalRegistry.snapshot.records.length;
    const result = system.document.apply({
      type: 'delete',
      dimensionId,
      commandId: 'e2e-delete-external',
      actorId: 'e2e-admin',
      actorRole: 'admin',
      at: Date.now(),
    });
    return {
      resultOk: result.ok,
      documentContainsExternal: system.document.state.records
        .some((item: any) => item.id === dimensionId),
      registryCountUnchanged:
        system.externalRegistry.snapshot.records.length === before,
    };
  }, DIMENSION_ID);
  expect(readonly.resultOk).toBe(false);
  expect(readonly.documentContainsExternal).toBe(false);
  expect(readonly.registryCountUnchanged).toBe(true);

  // 相机对准 fixture 几何（demo 模式无模型：designToWorld = scale(1000)）。
  await page.evaluate(async () => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const records = system.externalRegistry.snapshot.records
      .filter((item: any) => item.source === 'mbd');
    const points: number[][] = [];
    for (const item of records) {
      points.push([...item.layout.labelAnchor]);
      for (const line of [...item.layout.lines, ...item.layout.arrowLines]) {
        points.push([...line.from], [...line.to]);
      }
    }
    const worldPoints = points.map(([x, y, z]) => [x * 1_000, y * 1_000, z * 1_000]);
    const xs = worldPoints.map(point => point[0]!);
    const ys = worldPoints.map(point => point[1]!);
    const zs = worldPoints.map(point => point[2]!);
    const center = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ] as const;
    const maxExtent = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
      1,
    );
    const viewer = (window as any).__dtxViewer;
    viewer.camera.up.set(0, 1, 0);
    viewer.camera.position.set(center[0], center[1], center[2] + maxExtent * 2.2);
    viewer.controls.target.set(...center);
    viewer.controls.update();
    viewer.camera.near = Math.max(maxExtent / 10_000, 0.001);
    viewer.camera.far = maxExtent * 20;
    viewer.camera.updateProjectionMatrix();
    system.notifyViewerChanged();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  // 可见布局：标签边界落在视口内，并由 Three 场景画家批处理绘制。
  await expect.poll(() => page.evaluate((dimensionId) => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const viewerCanvas = document.querySelector<HTMLCanvasElement>('canvas.viewer');
    if (!viewerCanvas) return false;
    const layout = system.viewport.getLayouts()
      .find((candidate: any) => candidate.dimensionId === dimensionId);
    if (!layout) return false;
    return layout.labelBounds.x >= 0
      && layout.labelBounds.y >= 0
      && layout.labelBounds.x + layout.labelBounds.width <= viewerCanvas.clientWidth
      && layout.labelBounds.y + layout.labelBounds.height <= viewerCanvas.clientHeight;
  }, DIMENSION_ID)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__dtxViewer?.scene;
    const group = scene?.getObjectByName?.('dimension-scene-overlay');
    const lineMesh = group?.getObjectByName?.('dimension-scene-lines');
    const arrowMesh = group?.getObjectByName?.('dimension-scene-arrows');
    return Boolean(group?.visible && lineMesh?.visible && arrowMesh?.visible);
  }), { timeout: 30_000 }).toBe(true);

  // 外部尺寸进入同一 SVG 导出布局（线段 + LFF path）。
  const svg = await page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.exportSvg()
  ));
  expect(svg).toContain(`data-dimension-id="${DIMENSION_ID}"`);
  expect(svg).toContain('data-part="dimension"');
  expect(svg).toContain('data-part="label"');

  // 截图仅作人工审阅附件，不做像素 golden（计划决策 4）。
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach('mbd-v2-cli-linear-fixture', {
    body: screenshot,
    contentType: 'image/png',
  });
});

test('an invalid injected payload atomically clears the mbd source and surfaces diagnostics', async ({ page }) => {
  await routeMbdPipeApi(page);
  await page.goto(`/?dimension_demo=1&mbd_refno=${FIXTURE_REFNO}`);
  await waitForDimensionSystem(page);
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(1);

  // 200 + 含 angle_dim 的负载：契约整包拒绝，不保留旧记录、不显示部分新记录。
  const invalidResponse = page.waitForResponse(candidate => (
    candidate.url().includes(`/api/mbd/v2/pipe/${INVALID_REFNO}`)
  ));
  await switchMbdBranch(page, INVALID_REFNO);
  expect((await invalidResponse).status()).toBe(200);
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(0);

  // 尺寸面板诊断区显示装载失败原因。
  await page.getByText('尺寸标注', { exact: true }).click();
  const diagnostics = page.getByTestId('mbd-diagnostics');
  await expect(diagnostics).toBeVisible();
  await diagnostics.locator('summary').click();
  const loadError = page.getByTestId('mbd-load-error');
  await expect(loadError).toBeVisible();
  await expect(loadError).toContainText('装载失败');
  await expect(loadError).toContainText('invalid primitive');

  // 恢复到有效 fixture：来源可重新装载（替换语义）。
  await switchMbdBranch(page, FIXTURE_REFNO);
  await expect.poll(async () => (await mbdRecords(page)).length).toBe(1);
});

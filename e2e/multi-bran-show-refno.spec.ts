import { expect, test, type Page } from '@playwright/test';

/**
 * 多 BRAN 几何侧（`show_refno`）回归：跨库同屏 + 面板移除后按增量撤下。
 *
 * 门：`MULTI_BRAN_E2E=1` 且后端 `/api/v1/health` 可达，否则整个文件 skip（与其它 live 型
 * e2e 同一态度：环境缺失不误报成回归）。复跑要点见
 * `docs/verification/multi-bran-e2e-2026-11-02/README.md`。
 */

const GATE = process.env.MULTI_BRAN_E2E === '1';
const BACKEND = (process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022').replace(/\/+$/, '');
const PROJECT = process.env.PLANT3D_REAL_PROJECT || 'AvevaMarineSample';

const BRAN_7997 = '24381_145018';
const BRAN_7999 = '24383_91813';

type ConsoleBucket = { environmentLimit: string[]; unexpected: string[] };

// headless Chrome 录 WebGL 画布时 `context.close()` 会挂在帧采集上（README 第 2 条）。
test.use({ video: 'off', trace: 'off', viewport: { width: 1600, height: 1000 } });

test.skip(!GATE, '设 MULTI_BRAN_E2E=1 才跑（需要真实 gen-model 后端）');

async function backendAlive(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND}/api/v1/health`, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function buildPath(refnos: readonly string[]): string {
  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    output_project: PROJECT,
    show_refno: refnos.join(','),
    show_refno_select: '0',
  });
  return `/?${params.toString()}`;
}

/** 控制台分类（README 第 4 条）：401 是样例库凭证限制，不作通过条件；其余 error 必须为空。 */
function watchConsole(page: Page, pageErrors: string[]): ConsoleBucket {
  const bucket: ConsoleBucket = { environmentLimit: [], unexpected: [] };
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/\b401\b/.test(text)) bucket.environmentLimit.push(text);
    else bucket.unexpected.push(text);
  });
  return bucket;
}

async function waitForMultiBranLoad(page: Page, expectedRefnos: readonly string[]): Promise<void> {
  await page.waitForFunction((refnos: readonly string[]) => {
    const applied = (window as any).__dtxShowRefnoApplied as { rootRefnos: string[] }[] | undefined;
    const stats = (window as any).__dtxLayer?.getStats?.();
    if (!applied || !stats?.compiled) return false;
    const roots = applied.flatMap(group => group.rootRefnos);
    return refnos.every(refno => roots.includes(refno));
  }, expectedRefnos, { timeout: 180_000 });
}

/** 按 refno 前缀数**可见**对象：evict 只隐藏对象，`totalObjects` 不会因撤下而减少。 */
async function visibleObjectsByRef0(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const layer = (window as any).__dtxLayer;
    const objects: Map<string, { visible: boolean }> | undefined = layer?._objects;
    const out: Record<string, number> = {};
    if (!objects) return out;
    for (const [objectId, object] of objects) {
      if (!object.visible) continue;
      const match = /:(\d+)_\d+/.exec(objectId);
      if (!match) continue;
      const ref0 = match[1] as string;
      out[ref0] = (out[ref0] ?? 0) + 1;
    }
    return out;
  });
}

/** 关页前主动收尾（README 第 3 条）：断 WebSocket → dispose 渲染器 → about:blank → close。 */
async function teardown(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    const w = window as any;
    for (const socket of (w.__openSockets ?? []) as WebSocket[]) {
      try { socket.close(); } catch { /* ignore */ }
    }
    try { w.__dtxViewer?.renderer?.dispose?.(); } catch { /* ignore */ }
  }).catch(() => undefined);
  await page.goto('about:blank').catch(() => undefined);
  await page.close().catch(() => undefined);
}

async function installSocketTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    const sockets: WebSocket[] = [];
    w.__openSockets = sockets;
    const Native = window.WebSocket;
    w.WebSocket = class extends Native {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        sockets.push(this);
      }
    };
  });
}

async function openDimensionPanel(page: Page): Promise<void> {
  await page.getByText('视图', { exact: true }).click();
  await page.getByRole('button', { name: '尺寸标注' }).click();
  await expect(page.getByTestId('show-refno')).toBeVisible();
}

test.describe('multi-BRAN show_refno', () => {
  test.beforeAll(async () => {
    test.skip(!(await backendAlive()), `gen-model 不在 ${BACKEND}（/api/v1/health 不通）`);
  });

  test('loads two BRANs across two databases', async ({ page }) => {
    test.setTimeout(240_000);
    const pageErrors: string[] = [];
    const consoleBucket = watchConsole(page, pageErrors);
    await installSocketTracker(page);
    try {
      await page.goto(buildPath([BRAN_7997, BRAN_7999]));
      await waitForMultiBranLoad(page, [BRAN_7997, BRAN_7999]);

      const snapshot = await page.evaluate(() => {
        const w = window as any;
        return {
          loadedDbnos: [...(w.__xeokitViewer?.__dtxLoadedDbnos ?? [])].sort((a: number, b: number) => a - b),
          multiLoad: w.__dtxLastMultiBranLoad ?? null,
        };
      });
      expect(snapshot.loadedDbnos).toEqual([7997, 7999]);
      expect(snapshot.multiLoad?.failures).toEqual([]);
      expect(snapshot.multiLoad?.sideEffectFailures).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(consoleBucket.unexpected).toEqual([]);
    } finally {
      await teardown(page);
    }
  });

  test('removing a chip evicts only that BRAN, and appending it back reloads it, without a page reload', async ({ page }) => {
    test.setTimeout(240_000);
    const pageErrors: string[] = [];
    const consoleBucket = watchConsole(page, pageErrors);
    await installSocketTracker(page);
    try {
      await page.goto(buildPath([BRAN_7997, BRAN_7999]));
      await waitForMultiBranLoad(page, [BRAN_7997, BRAN_7999]);
      // 打一个标记：整页刷新会把它清掉，用来证明撤下走的是 popstate 而不是重载。
      await page.evaluate(() => { (window as any).__noReloadMarker = true; });

      const before = await visibleObjectsByRef0(page);
      expect(before['24381'] ?? 0).toBeGreaterThan(0);
      expect(before['24383'] ?? 0).toBeGreaterThan(0);

      await openDimensionPanel(page);
      await page.locator(
        `[data-testid="show-refno-chip"][data-refno="${BRAN_7999}"] [data-testid="show-refno-chip-remove"]`,
      ).click();

      await page.waitForFunction(() => {
        const applied = (window as any).__dtxShowRefnoApplied as { dbno: number }[] | undefined;
        return !!applied && applied.length > 0 && applied.every(group => group.dbno === 7997);
      }, null, { timeout: 60_000 });

      const after = await visibleObjectsByRef0(page);
      expect(after['24383'] ?? 0).toBe(0);
      expect(after['24381']).toBe(before['24381']);
      expect(new URL(page.url()).searchParams.get('show_refno')).toBe(BRAN_7997);
      expect(await page.evaluate(() => (window as any).__noReloadMarker === true)).toBe(true);
      await expect(page.locator('[data-testid="show-refno-chip"]')).toHaveCount(1);

      // 再追加回来：撤下时运行时索引已清，装载器必须重新装这一包，而不是当它已加载而跳过。
      await page.getByTestId('show-refno-draft').fill(BRAN_7999);
      await page.getByTestId('show-refno-append').click();
      await waitForMultiBranLoad(page, [BRAN_7997, BRAN_7999]);
      const readded = await visibleObjectsByRef0(page);
      expect(readded['24383'] ?? 0).toBeGreaterThan(0);
      expect(readded['24381']).toBe(before['24381']);
      expect(new URL(page.url()).searchParams.get('show_refno')).toBe(`${BRAN_7997},${BRAN_7999}`);
      expect(await page.evaluate(() => (window as any).__noReloadMarker === true)).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(consoleBucket.unexpected).toEqual([]);
    } finally {
      await teardown(page);
    }
  });
});

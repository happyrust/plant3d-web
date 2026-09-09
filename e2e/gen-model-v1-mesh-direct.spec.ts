import { test, expect } from '@playwright/test';

/**
 * gen-model-v1 `.mesh` 直连整链（2026-09-09 拍板，决策 d-127）：
 * `?model_source=gen-model-v1&show_refno=…` 走 tree.visibleInsts → records →
 * `/api/v1/meshes/{hash}.mesh`（rkyv 原样字节，parseMeshGeometry 手解）→ DTX。
 *
 * 前置：gen-model 在 `.env.development` 的 `VITE_GEN_MODEL_V1_BASE_URL`（默认
 * `http://localhost:8022`）上运行，AvevaMarineSample 库可用。服务不在时本测试跳过
 * （与其它 live 型 e2e 同一态度：不把环境缺失误报成回归）。
 */
const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const REFNO = '24381_145018'; // BRAN，D6/P7 以来的对拍样本，dbnum=7997

test('show_refno 在 gen-model-v1 源下经 .mesh 直连绘出实例，不再请求 .glb', async ({ page }) => {
  // live 前置探测：gen-model 不在就跳过
  try {
    const health = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    if (!health.ok) test.skip(true, `gen-model health HTTP ${health.status}`);
  } catch {
    test.skip(true, `gen-model 不在 ${GEN_MODEL_BASE}`);
  }

  const pageErrors: string[] = [];
  const showRefnoErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('[show_refno]')) {
      showRefnoErrors.push(msg.text());
    }
  });

  const meshRequests: { url: string; status?: number }[] = [];
  const glbRequests: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('/api/v1/meshes/')) {
      if (u.endsWith('.mesh')) meshRequests.push({ url: u, status: resp.status() });
      if (u.endsWith('.glb')) glbRequests.push(u);
    }
  });

  await page.goto(
    `/?model_source=gen-model-v1&output_project=AvevaMarineSample&show_refno=${REFNO}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForSelector('canvas', { timeout: 60_000 });

  // show_refno 链路收尾的标记：__dtxAfterInstancesLoaded 写入 lastDbno（同 debug-show-dbnum 的探针）
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          // @ts-expect-error -- browser-side dynamic import is only available at runtime in Playwright.
          import('/src/composables/useViewerContext.ts').then((mod) => {
            const v = mod.useViewerContext().viewerRef.value as {
              __dtxLastLoadedDbno?: number
              __dtxLastLoadedRefnos?: string[]
            } | null;
            return v?.__dtxLastLoadedDbno ?? null;
          }),
        ),
      { timeout: 120_000, intervals: [1000, 2000, 5000] },
    )
    .toBe(7997);

  const okMesh = meshRequests.filter((r) => r.status === 200);
  console.log(
    `[mesh-direct] .mesh 请求 ${meshRequests.length}（200: ${okMesh.length}）, .glb 请求 ${glbRequests.length}`,
  );

  // 画面证据（拉近后的 BRAN；fitDtxViewerToFocusBox 在 show_refno 链路里已执行）
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: 'e2e/screenshots/gen-model-v1-mesh-direct.png' });

  // 直连口径生效：至少一发 .mesh 200；这条链路上一个 .glb 都不该出现
  expect(okMesh.length).toBeGreaterThan(0);
  expect(glbRequests, `gen-model-v1 源不该再请求 .glb: ${glbRequests.join(', ')}`).toEqual([]);

  // 链路自己没报错（页面其它面板对 legacy 后端的噪音不计）
  expect(showRefnoErrors, showRefnoErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

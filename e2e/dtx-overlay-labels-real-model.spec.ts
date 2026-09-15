/**
 * 同一套「浮层有没有晚一帧」的判据，跑在**真实项目模型**上：gen-model-v1 直读（`show_refno` 拉一条真
 * BRAN 的构件进视口），点集标签喂的是后端 `element/ptset` 的**真实点集**，不是合成数据。
 * demo 版（primitives + 合成点集）见 `dtx-overlay-labels-fast-orbit.spec.ts`。
 *
 * 依赖真实环境：gen-model 后端（默认 :8022，本机常开在 :8023）要活着、且有这个项目的 dbnum。
 * **后端没起就整条 skip**，不算失败——本地常态是只开 demo。可调：`PLANT3D_REAL_PROJECT`、
 * `PLANT3D_GM_PORT`、`PLANT3D_REAL_REFNO`。
 *
 * 点集这一环说清楚：应用自己的取数路径（`queryPtsetWithRuntimeFallback`）只认 parquet 与旧后端
 * `/api/pdms/ptset`，gen-model-v1 档下拿不到点集，所以这条用例**自己**打 `/api/v1/element/ptset` 取真实点，
 * 再交给应用的 `ptsetVis.renderPtset` 按正常路径渲染——数据是真的，渲染与定位走的是产品代码。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-overlay-labels-real-model.spec.ts`
 *   （本机 gen-model 在 8023 时：`$env:PLANT3D_GM_PORT=8023` 再跑）
 */
import { expect, test, type Page } from '@playwright/test';

import { fastOrbitSweeps, fastPan, flickOrbit } from './helpers/dtxFastOrbit';
import {
  createLeaderAnnotation,
  createTextAnnotation,
  describeMeasurements,
  expectNoLag,
  installLabelProbe,
  measureItems,
  readLabelFrames,
  setLabelPhase,
} from './helpers/overlayLagProbe';

const PROJECT = process.env.PLANT3D_REAL_PROJECT || 'AvevaMarineSample';
const GM_PORT = process.env.PLANT3D_GM_PORT || '8022';
const SHOW_REFNO = process.env.PLANT3D_REAL_REFNO || '24381_145018';
const REAL_URL = `/?output_project=${encodeURIComponent(PROJECT)}&model_source=gen-model-v1`
  + `&gm_backend_port=${encodeURIComponent(GM_PORT)}&show_refno=${encodeURIComponent(SHOW_REFNO)}`;

test.use({ viewport: { width: 1400, height: 900 } });
test.describe.configure({ timeout: 300_000 });

/** 真实模型编译完没有；没等到就是后端 / 数据不在，交给调用方 skip */
async function waitForRealModel(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(() => {
      const layer = (window as any).__xeokitViewer?.__dtxLayer;
      const stats = layer?.getStats?.();
      return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
    }, null, { timeout });
    await page.waitForFunction(() => (window as any).__viewerTools?.ready?.value === true, null, { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 真实点集：直接问 gen-model `/api/v1/element/ptset`（容器自己常常没点，`include_members` 把成员的点一起带回来），
 * 取第一个有点的构件，转成 `PtsetResponse` 交给应用渲染。点是 mm，全局矩阵负责 mm→m，所以换算因子给 1。
 */
async function loadRealPtset(page: Page, refno: string, gmPort: string): Promise<{ refno: string; count: number } | null> {
  return page.evaluate(async ({ refno: rf, gmPort: port }) => {
    const ptsetVis = (window as any).__viewerContext?.ptsetVis?.value;
    if (!ptsetVis) return null;
    let payload: any;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/element/ptset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refno: rf.replace('_', '/'), include_members: true }),
      });
      if (!res.ok) return null;
      payload = await res.json();
    } catch {
      return null;
    }
    const items = [payload, ...(payload?.members ?? [])].filter((item) => (item?.points?.length ?? 0) > 0);
    const item = items[0];
    if (!item) return null;
    ptsetVis.setPanelContext(String(item.refno));
    ptsetVis.renderPtset(String(item.refno).replace('/', '_'), {
      success: true,
      refno: String(item.refno).replace('/', '_'),
      noun: item.noun ?? null,
      ptset: item.points.map((p: any) => ({
        number: p.number,
        pt: p.pt,
        dir: p.dir ?? undefined,
        pbore: p.bore ?? 0,
        pconnect: '',
      })),
      world_transform: item.world_transform,
      unit_info: { source_unit: item.unit ?? 'mm', target_unit: item.unit ?? 'mm', conversion_factor: 1 },
    });
    const count = ptsetVis.visualObjects.value.size as number;
    return count > 0 ? { refno: String(item.refno), count } : null;
  }, { refno, gmPort });
}

test('DTX 浮层 · 真实模型上快拖，图钉 / 文字框 / 三维标签 / 真实点集标签都贴着本帧相机', async ({ page }) => {
  await page.goto(REAL_URL, { waitUntil: 'domcontentloaded' });
  const ready = await waitForRealModel(page, 120_000);
  test.skip(
    !ready,
    `真实模型没加载起来（${REAL_URL}）：gen-model 后端没起（本机常开在 :8023，用 PLANT3D_GM_PORT 指过去），`
    + '或这个项目 / refno 在后端没有数据。',
  );

  await page.evaluate(() => (window as any).__viewerToolStore.clearAll());
  const rect = await createTextAnnotation(page);
  await createLeaderAnnotation(page);
  const markerCount = await page.evaluate(() => document.querySelectorAll('.dtx-anno-marker').length);
  expect(markerCount, '画面上不止一枚图钉（项目里还有别的批注？探针只认第一枚）').toBe(1);

  const ptset = await loadRealPtset(page, SHOW_REFNO, GM_PORT);
  expect(ptset, `没从 gen-model 取到真实点集（refno ${SHOW_REFNO}）：换一个 PLANT3D_REAL_REFNO 再跑`).not.toBeNull();

  await installLabelProbe(page);
  await setLabelPhase(page, 'sweep');
  await fastOrbitSweeps(page, rect);
  await setLabelPhase(page, 'flick');
  await flickOrbit(page, rect);
  await setLabelPhase(page, 'pan');
  await fastPan(page, rect);
  await setLabelPhase(page, 'rest');
  await page.waitForTimeout(900);

  const frames = await readLabelFrames(page);
  const motion = frames.filter((f) => f.camStep > 1e-4 && f.phase !== 'rest');
  const panning = motion.filter((f) => f.phase === 'pan');
  expect(motion.length, '快拖没产生足够的运动帧，用例是空转的').toBeGreaterThan(30);
  expect(panning.length, '平移那一段没跑起来').toBeGreaterThan(8);

  const measured = measureItems(motion, panning, ['图钉', '文字框', '三维标签', '点集标签']);
  const summary = `${PROJECT} · ${SHOW_REFNO} · gen-model :${GM_PORT}｜运动帧 ${motion.length}（其中平移 ${panning.length}）｜`
    + `真实点集 ${ptset?.refno} ${ptset?.count} 个点｜${describeMeasurements(measured)}`;
  console.log(`[真实模型浮层快拖实测] ${summary}`);
  test.info().annotations.push({ type: '真实模型浮层快拖实测', description: summary });

  expectNoLag(measured, 30);
});

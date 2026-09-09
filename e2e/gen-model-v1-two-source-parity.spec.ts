import { test, expect } from '@playwright/test';

/**
 * P8-2 两源对拍（收口计划 2026-09-09 §2）：同一 refno 分别经
 * `?model_source=legacy&data_source=parquet` 与 `?model_source=gen-model-v1`
 * 走 show_refno 整链加载，比：
 * - DTX 实际登记的对象数（`__dtxLayer.getAllObjectsWithBounds().length`）
 * - sceneBoundingBox 逐轴差 ≤ 1 mm（场景单位 mm）
 * 四类节点：BRAN（D6 样本）+ ZONE（该 BRAN 的祖先，两侧必有）+ EQUI + SUPPO
 * （后两类从 gen-model /api/v1/search 现选，dbnum=7997 优先——legacy parquet 覆盖它）。
 *
 * 前置：gen-model（默认 :8022）与旧后端 legacy（默认 :3100）都在跑；少任何一个就 skip。
 *
 * legacy 侧的 show_refno 靠 `visible-insts`（DuckDB-WASM 读 `scene_tree_parquet/pdms_tree_{dbnum}.parquet`）
 * 把容器展开成有几何的叶子；旧后端输出目录里**没有这份树 parquet 时**，legacy 只能画根 refno 自己
 * 拥有的直管（BRAN）或什么都画不出（ZONE/EQUI），对拍结果是环境残缺、不是回归——这里先探一遍，
 * 缺就 skip 并把原因打出来（2026-09-09 plant-server 检出的形态，见母计划 §8.13）。
 * 差异 >1 mm 时先按 R2 归因数据水位再查代码。
 *
 * 第二条用例不依赖 legacy：v1 浏览器整链登记的对象数必须等于 `/api/v1/model/records`
 * 逐根取回的条数（前端一条不丢、一条不多）——legacy 参照不可用时这是能自动跑的最强口径。
 */
const GEN_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const LEGACY_BASE = process.env.LEGACY_BASE_URL || 'http://127.0.0.1:3100';
const OUTPUT_PROJECT = process.env.OUTPUT_PROJECT || 'AvevaMarineSample';
const DBNUM = 7997;
const TOLERANCE_MM = 1;

type LoadOutcome = {
  objects: number
  bbox: { min: [number, number, number]; max: [number, number, number] } | null
  /** `[show_refno] 加载完成` 那行里的 loadedObjects（与 DTX 登记数互证） */
  toastObjects: number | null
};

type Target = { kind: string; refno: string };

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true; // 任何 HTTP 应答都算「在」，只有连接拒绝才算「不在」
  } catch {
    return false;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}

async function pickSearchTarget(noun: string, query: string): Promise<string | null> {
  const resp = await fetch(`${GEN_BASE}/api/v1/search?query=${query}&limit=50`);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { items?: { refno: string; noun?: string; dbnum?: number }[] };
  const hits = (data.items ?? []).filter((item) => item.noun === noun);
  const preferred = hits.find((item) => item.dbnum === DBNUM) ?? hits[0];
  return preferred?.refno?.replace('/', '_') ?? null;
}

async function collectTargets(): Promise<Target[]> {
  const targets: Target[] = [
    { kind: 'BRAN', refno: '24381_145018' },
    { kind: 'ZONE', refno: '24381_144870' },
  ];
  for (const [noun, query] of [['EQUI', 'EQUI'], ['SUPPO', 'SUPP']] as const) {
    const refno = await pickSearchTarget(noun, query);
    if (refno) targets.push({ kind: noun, refno });
    else console.log(`[two-source] 搜不到 ${noun}，该类跳过`);
  }
  console.log('[two-source] targets:', JSON.stringify(targets));
  return targets;
}

/** 两边数据水位（R2）：legacy parquet 导出时间 vs gen-model 看到的库 sesno。 */
async function logDataWaterLevel(): Promise<void> {
  try {
    const manifest = (await (await fetch(`${LEGACY_BASE}/files/output/${encodeURIComponent(OUTPUT_PROJECT)}/parquet/manifest_${DBNUM}.json`)).json()) as { generated_at?: string };
    console.log(`[two-source] legacy parquet manifest_${DBNUM} generated_at=${manifest.generated_at ?? '?'}`);
  } catch {
    console.log(`[two-source] legacy parquet manifest_${DBNUM} 读不到`);
  }
  try {
    const dbnums = (await (await fetch(`${GEN_BASE}/api/v1/dbnums`)).json()) as { dbnums?: { dbnum: number; file_latest_sesno?: number }[] };
    const row = dbnums.dbnums?.find((d) => d.dbnum === DBNUM);
    console.log(`[two-source] gen-model dbnum ${DBNUM} file_latest_sesno=${row?.file_latest_sesno ?? '?'}`);
  } catch {
    console.log('[two-source] gen-model /dbnums 读不到');
  }
}

/** gen-model 侧的对象数 oracle：ensure → generation_roots → 逐根 records，条数按前端 modelRecords.ts 同一口径累加。 */
async function v1RecordsCount(refno: string): Promise<number> {
  const v1 = refno.replace('_', '/');
  const ensured = await fetch(`${GEN_BASE}/api/v1/model/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refno: v1 }),
  });
  if (!ensured.ok) throw new Error(`ensure ${v1} -> HTTP ${ensured.status}`);
  const ens = (await ensured.json()) as { generation_root?: string; generation_roots?: string[]; status?: string };
  if (ens.status === 'NoRenderableGeometry') return 0;
  const roots = ens.generation_roots?.length ? ens.generation_roots : [ens.generation_root ?? v1];
  let total = 0;
  for (const root of roots) {
    let cursor: number | null = null;
    for (let page = 0; page < 10_000; page++) {
      const body: Record<string, unknown> = { generation_root: root, limit: 5000 };
      if (cursor !== null) body.cursor = cursor;
      const resp = await fetch(`${GEN_BASE}/api/v1/model/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`records ${root} -> HTTP ${resp.status}`);
      const data = (await resp.json()) as { items: unknown[]; truncated: boolean; next_cursor: number | null };
      total += data.items.length;
      if (!data.truncated || data.next_cursor === null || data.next_cursor === undefined) break;
      cursor = data.next_cursor;
    }
  }
  return total;
}

const fmt = (b: LoadOutcome['bbox']) =>
  b ? `[${b.min.map((v) => v.toFixed(1)).join(',')}]..[${b.max.map((v) => v.toFixed(1)).join(',')}]` : 'null';

async function loadOnce(
  page: import('@playwright/test').Page,
  source: 'legacy' | 'gen-model-v1',
  refno: string,
  kind: string,
  screenshotPrefix: string,
): Promise<LoadOutcome> {
  const params = new URLSearchParams({
    model_source: source,
    output_project: OUTPUT_PROJECT,
    show_refno: refno,
  });
  if (source === 'legacy') params.set('data_source', 'parquet');

  let loadFinished = false;
  let toastObjects: number | null = null;
  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    const text = msg.text();
    if (text.includes('[show_refno]') && text.includes('加载完成')) {
      loadFinished = true;
      // `console.log('[show_refno] ✅ 加载完成', result)` 的 result 在 playwright 里序列化成 JSHandle，
      // 这里从 args 里把 loadedObjects 读出来（读不到就留 null，不影响主断言）
      const arg = msg.args()[1];
      if (arg) {
        void arg
          .jsonValue()
          .then((value: unknown) => {
            const objects = (value as { loadedObjects?: unknown } | null)?.loadedObjects;
            if (typeof objects === 'number') toastObjects = objects;
          })
          .catch(() => undefined);
      }
    }
  };
  page.on('console', onConsole);
  try {
    await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 60_000 });
    await expect
      .poll(async () => loadFinished, { timeout: 180_000, intervals: [1000, 2000, 5000] })
      .toBe(true);
    // 等最后一帧渲染与 bbox 合并收尾
    await page.waitForTimeout(1_500);
    const outcome = await page.evaluate((): Omit<LoadOutcome, 'toastObjects'> => {
      const layer = (window as unknown as { __dtxLayer?: {
        getAllObjectsWithBounds(): unknown[]
        getBoundingBox(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
      } }).__dtxLayer;
      if (!layer) return { objects: -1, bbox: null };
      const box = layer.getBoundingBox();
      return {
        objects: layer.getAllObjectsWithBounds().length,
        bbox: {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        },
      };
    });
    await page.screenshot({ path: `e2e/screenshots/${screenshotPrefix}-${kind}-${source}.png` });
    return { ...outcome, toastObjects };
  } finally {
    page.off('console', onConsole);
  }
}

test('P8-2 四类节点两源对拍：对象数相同、包围盒逐轴 ≤1mm', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  if (!(await reachable(`${GEN_BASE}/api/v1/health`))) test.skip(true, `gen-model 不在 ${GEN_BASE}`);
  if (!(await reachable(LEGACY_BASE))) test.skip(true, `legacy 不在 ${LEGACY_BASE}`);
  const treeParquet = `${LEGACY_BASE}/files/output/${encodeURIComponent(OUTPUT_PROJECT)}/scene_tree_parquet/pdms_tree_${DBNUM}.parquet`;
  if (!(await headOk(treeParquet))) {
    test.skip(
      true,
      `legacy 输出目录缺 scene_tree_parquet/pdms_tree_${DBNUM}.parquet（${treeParquet} 非 200）：` +
        'legacy 的 show_refno 无法把容器展开成有几何的叶子，对拍只会比出环境残缺，不是回归。' +
        '要跑两源对拍，先用旧导出链补齐 legacy 的树 parquet；此前以 v1 浏览器对象数 == records 条数（下一条用例）作替代口径。',
    );
  }
  await logDataWaterLevel();
  const targets = await collectTargets();

  const failures: string[] = [];
  for (const { kind, refno } of targets) {
    const legacy = await loadOnce(page, 'legacy', refno, kind, 'two-source');
    const v1 = await loadOnce(page, 'gen-model-v1', refno, kind, 'two-source');
    console.log(`[two-source] ${kind} ${refno}: legacy objects=${legacy.objects} bbox=${fmt(legacy.bbox)}`);
    console.log(`[two-source] ${kind} ${refno}: v1     objects=${v1.objects} bbox=${fmt(v1.bbox)}`);

    if (legacy.objects !== v1.objects) {
      failures.push(`${kind} ${refno}: 对象数 legacy=${legacy.objects} vs v1=${v1.objects}`);
    }
    if (!legacy.bbox || !v1.bbox) {
      failures.push(`${kind} ${refno}: bbox 缺失 legacy=${fmt(legacy.bbox)} v1=${fmt(v1.bbox)}`);
      continue;
    }
    for (const side of ['min', 'max'] as const) {
      for (let axis = 0; axis < 3; axis++) {
        const delta = Math.abs(legacy.bbox[side][axis] - v1.bbox[side][axis]);
        if (delta > TOLERANCE_MM) {
          failures.push(`${kind} ${refno}: bbox.${side}[${'xyz'[axis]}] Δ=${delta.toFixed(3)}mm`);
        }
      }
    }
  }

  expect(failures, failures.join('\n')).toEqual([]);
});

test('P8-2 替代口径：v1 浏览器整链登记的对象数 == /api/v1/model/records 逐根条数', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  if (!(await reachable(`${GEN_BASE}/api/v1/health`))) test.skip(true, `gen-model 不在 ${GEN_BASE}`);
  const targets = await collectTargets();

  const failures: string[] = [];
  for (const { kind, refno } of targets) {
    const expected = await v1RecordsCount(refno);
    const v1 = await loadOnce(page, 'gen-model-v1', refno, kind, 'v1-vs-records');
    console.log(
      `[v1-vs-records] ${kind} ${refno}: records=${expected} dtxObjects=${v1.objects} toastObjects=${v1.toastObjects ?? '?'} bbox=${fmt(v1.bbox)}`,
    );
    if (v1.objects !== expected) failures.push(`${kind} ${refno}: DTX 对象数 ${v1.objects} != records ${expected}`);
    if (v1.toastObjects !== null && v1.toastObjects !== expected) {
      failures.push(`${kind} ${refno}: 弹窗 loadedObjects ${v1.toastObjects} != records ${expected}`);
    }
    if (!v1.bbox || !Number.isFinite(v1.bbox.min[0])) failures.push(`${kind} ${refno}: bbox 无效 ${fmt(v1.bbox)}`);
  }

  expect(failures, failures.join('\n')).toEqual([]);
});

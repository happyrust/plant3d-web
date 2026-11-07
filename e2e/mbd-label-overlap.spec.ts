/**
 * MBD 标签重叠生成器：真实 BRAN × 呈现模式 × 三档相机，落截图与 `diag.json`。
 *
 * 用途：去重 / 分帧这类改动的前后对比都要回答同一组问题——有没有非有限值、屏上还剩
 * 多少对标签重叠、绕轨时 layout / paint 的 P95 多少。读数口径与
 * `docs/verification/mbd-polar-ab-2026-11-06-r2/` 一致：
 *
 * - 重叠：已绘制、未被 LOD 隐藏、带文字（`derived.formattedLabel` 非空）的布局两两比 `labelBounds`，交叠宽高都
 *   > 1 px 记一对；流向箭头这类没有文字的线不算（2026-11-07 起，之前的统计含它们）
 *   （AABB 口径，旋转文字会偏多，只作同口径横比）。
 * - 相机：far = 加载后的自动 fit，mid / near 沿视线缩到 0.4 / 0.2，同
 *   `dimension-camera-baseline.spec.ts`。
 * - 性能（可选）：far 档绕 target 竖直轴转一圈，每步 `flushProjection()` 强制全量布局，
 *   读 `window.__dimensionFrameStats.summary()`（dev 构建才有）。
 * - 模式：`polar` / `flat-polar` 只是多加 `mbd_polar=1`。前端极坐标放置层已退役（2026-11-07），
 *   这个开关只多一条诊断提示，两种模式的读数应分别与 `off` / `flat` 相同，留作对照。
 *
 * 门控：`MBD_LABEL_OVERLAP=1` 才跑。
 *
 * ```powershell
 * $env:MBD_LABEL_OVERLAP = '1'
 * $env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'      # 几何
 * $env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8022' # MBD（缺省同几何）
 * $env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/<dir>'
 * $env:MBD_LABEL_OVERLAP_MODES = 'off,polar,flat,flat-polar'
 * $env:MBD_LABEL_OVERLAP_PERF_RUNS = '3'                     # 0 = 不测性能
 * npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const GATE = process.env.MBD_LABEL_OVERLAP === '1';
const GM = (process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022').replace(/\/+$/, '');
const MBD = (process.env.MBD_LABEL_OVERLAP_MBD_BASE || GM).replace(/\/+$/, '');
const PROJECT = process.env.PLANT3D_REAL_PROJECT || 'AvevaMarineSample';
const OUT = resolve(
  process.env.MBD_LABEL_OVERLAP_OUT
    || `docs/verification/mbd-label-overlap-${new Date().toISOString().slice(0, 10)}`,
);
const REFNOS = (process.env.MBD_LABEL_OVERLAP_REFNOS || '24381_145018,24383_91813')
  .split(',').map(refno => refno.trim()).filter(Boolean);
/**
 * 标注对象之外一并装几何的构件：`<refno>=<a>+<b>;<refno>=…`。非管道对象的标注落在别的构件上（设备的定位墙与楼板、
 * 支架挂的墙），只装对象本身时这些标签像悬在空中。
 */
const SHOW_EXTRA = new Map(
  (process.env.MBD_LABEL_OVERLAP_SHOW_EXTRA || '')
    .split(';').map(entry => entry.trim()).filter(Boolean)
    .map((entry) => {
      const [refno = '', extras = ''] = entry.split('=');
      return [refno.trim(), extras.split('+').map(extra => extra.trim()).filter(Boolean)] as const;
    }),
);
const PERF_RUNS = Number(process.env.MBD_LABEL_OVERLAP_PERF_RUNS || '0');
const PERF_FRAMES = Number(process.env.MBD_LABEL_OVERLAP_PERF_FRAMES || '120');

const ALL_MODES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'off': {},
  'polar': { mbd_polar: '1' },
  'flat': { mbd_3d: '0' },
  'flat-polar': { mbd_3d: '0', mbd_polar: '1' },
};
const MODES = (process.env.MBD_LABEL_OVERLAP_MODES || 'off,polar,flat,flat-polar')
  .split(',').map(mode => mode.trim()).filter(Boolean);
for (const mode of MODES) {
  if (!(mode in ALL_MODES)) throw new Error(`MBD_LABEL_OVERLAP_MODES 不认识 ${mode}`);
}
const TIERS = [
  { name: 'far', scale: null as number | null },
  { name: 'mid', scale: 0.4 },
  { name: 'near', scale: 0.2 },
];

type Camera = Readonly<{ position: number[]; target: number[] }>;

function buildPath(refno: string, query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams({
    output_project: PROJECT,
    show_refno: [refno, ...(SHOW_EXTRA.get(refno) ?? [])].join(','),
    show_refno_select: '0',
    mbd_refno: refno,
    gm_backend: GM,
    mbdBackend: MBD,
    ...query,
  });
  return `/?${params.toString()}`;
}

async function backendAlive(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitReady(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(() => {
      const stats = (window as any).__dtxLayer?.getStats?.();
      return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
    }, null, { timeout: 180_000 });
    await page.waitForFunction(
      () => (window as any).__viewerContext?.dimensionSystem?.value,
      null,
      { timeout: 60_000 },
    );
    await expect.poll(
      () => page.evaluate(
        () => (window as any).__viewerContext.dimensionSystem.value.viewport.getLayouts().length,
      ),
      { timeout: 120_000, intervals: [500, 1_000, 2_000] },
    ).toBeGreaterThan(0);
    return true;
  } catch {
    return false;
  }
}

async function collectTier(page: Page, scale: number | null, base: Camera | null): Promise<any> {
  return page.evaluate(async (input: { scale: number | null; position: number[] | null; target: number[] | null }) => {
    const viewer = (window as any).__dtxViewer;
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const viewport = system.viewport;
    const next = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const twoFrames = async () => { await next(); await next(); };
    const settlePainted = async () => {
      for (let i = 0; i < 400 && viewport.painting; i += 1) await next();
    };

    if (input.scale !== null && input.position && input.target) {
      const [tx, ty, tz] = input.target as [number, number, number];
      const p = input.position;
      viewer.camera.position.set(
        tx + (p[0]! - tx) * input.scale,
        ty + (p[1]! - ty) * input.scale,
        tz + (p[2]! - tz) * input.scale,
      );
      viewer.controls.target.set(tx, ty, tz);
      const damping = viewer.controls.enableDamping;
      viewer.controls.enableDamping = false;
      viewer.controls.update();
      viewer.controls.enableDamping = damping;
      const placed = viewer.camera.position;
      const radius = Math.hypot(placed.x - tx, placed.y - ty, placed.z - tz);
      viewer.camera.near = Math.max(radius / 1000, 0.001);
      viewer.camera.far = radius * 40;
      viewer.camera.updateProjectionMatrix();
    } else {
      // The fit to `show_refno` may not have started yet: a camera that has
      // not moved only counts as settled after 40 frame pairs.
      const start = viewer.camera.position.clone();
      let last = start.clone();
      for (let attempt = 0; attempt < 160; attempt += 1) {
        await twoFrames();
        const current = viewer.camera.position;
        const moved = current.distanceTo(start) > 1e-6;
        const flying = viewer._flyRafId !== null && viewer._flyRafId !== undefined;
        if ((moved || attempt >= 40) && !flying && current.distanceTo(last) < 1e-6) break;
        last = current.clone();
      }
    }

    system.notifyViewerChanged();
    viewport.flushProjection?.();
    await settlePainted();
    let previous = -1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await twoFrames();
      const count = viewport.getLayouts().length;
      if (count === previous) break;
      previous = count;
    }
    await settlePainted();

    const records = system.externalRegistry.snapshot.visibleRecords as any[];
    const explicit = records.filter(record => record.layout && 'lines' in record.layout);
    const layouts = viewport.getLayouts() as any[];

    let nonFinite = 0;
    const nonFiniteIds = new Set<string>();
    const walk = (value: unknown, id: string, depth: number): void => {
      if (depth > 12) return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) { nonFinite += 1; nonFiniteIds.add(id); }
      } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        for (const entry of value as ArrayLike<unknown> as unknown[]) walk(entry, id, depth + 1);
      } else if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) walk(entry, id, depth + 1);
      }
    };
    for (const layout of layouts) {
      walk(layout.primitives, layout.dimensionId, 0);
      walk(layout.scenePrimitives, layout.dimensionId, 0);
      walk(layout.labelBounds, layout.dimensionId, 0);
      walk(layout.derived, layout.dimensionId, 0);
    }

    const canvas = document.querySelector<HTMLCanvasElement>('canvas.viewer');
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    const drawn = layouts.filter(
      layout => layout.primitives.length > 0 && layout.derived?.lodHidden === undefined,
    );
    const rects = drawn
      .filter(layout => String(layout.derived?.formattedLabel ?? '').trim().length > 0)
      .map(layout => ({ id: layout.dimensionId as string, r: layout.labelBounds }))
      .filter(entry => entry.r && entry.r.width > 0 && entry.r.height > 0);
    let overlaps = 0;
    const overlapPairs: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const b = rects[j]!;
        const w = Math.min(a.r.x + a.r.width, b.r.x + b.r.width) - Math.max(a.r.x, b.r.x);
        const h = Math.min(a.r.y + a.r.height, b.r.y + b.r.height) - Math.max(a.r.y, b.r.y);
        if (w > 1 && h > 1) {
          overlaps += 1;
          if (overlapPairs.length < 60) overlapPairs.push(`${a.id} x ${b.id}`);
        }
      }
    }
    const offscreen = rects
      .filter(({ r }) => r.x + r.width < 0 || r.y + r.height < 0 || r.x > width || r.y > height)
      .map(({ id }) => id);

    const labels: Record<string, unknown> = {};
    for (const layout of layouts) {
      const r = layout.labelBounds;
      labels[layout.dimensionId] = {
        cx: r ? r.x + r.width / 2 : null,
        cy: r ? r.y + r.height / 2 : null,
        w: r?.width ?? null,
        h: r?.height ?? null,
        drawn: layout.primitives.length > 0,
        lodHidden: layout.derived?.lodHidden ?? null,
      };
    }

    return {
      camera: {
        position: viewer.camera.position.toArray(),
        target: viewer.controls.target.toArray(),
      },
      canvas: { width, height },
      records: records.length,
      layouts: layouts.length,
      drawn: drawn.length,
      lodHidden: layouts.filter(layout => layout.derived?.lodHidden !== undefined).length,
      overlapHidden: layouts.filter(layout => layout.derived?.lodHidden === 'overlap').length,
      tagCount: explicit.filter(record => record.layout.tag).length,
      nonFinite,
      nonFiniteIds: [...nonFiniteIds],
      overlaps,
      overlapPairs,
      offscreen,
      labels,
    };
  }, { scale, position: base?.position ?? null, target: base?.target ?? null });
}

async function orbitPerf(page: Page, frames: number): Promise<any> {
  return page.evaluate(async (count: number) => {
    const viewer = (window as any).__dtxViewer;
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const viewport = system.viewport;
    const stats = (window as any).__dimensionFrameStats;
    if (!stats) return null;
    const target = viewer.controls.target.clone();
    const home = viewer.camera.position.clone();
    const offset = home.clone().sub(target);
    const radius = Math.hypot(offset.x, offset.z);
    const phi0 = Math.atan2(offset.z, offset.x);
    const next = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const settlePainted = async () => {
      for (let i = 0; i < 400 && viewport.painting; i += 1) await next();
    };
    stats.reset();
    for (let i = 1; i <= count; i += 1) {
      await next();
      const phi = phi0 + (i / count) * Math.PI * 2;
      viewer.flyTo(
        target.clone().set(
          target.x + radius * Math.cos(phi),
          target.y + offset.y,
          target.z + radius * Math.sin(phi),
        ),
        target,
        { duration: 0 },
      );
      system.notifyViewerChanged();
      viewport.flushProjection();
      await settlePainted();
    }
    await next();
    viewer.flyTo(home, target, { duration: 0 });
    system.notifyViewerChanged();
    viewport.flushProjection();
    await settlePainted();
    return stats.summary();
  }, frames);
}

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ timeout: 600_000 });
test.skip(!GATE, 'Set MBD_LABEL_OVERLAP=1 to run the MBD label overlap generator');

test.describe('mbd label overlap', () => {
  for (const refno of REFNOS) {
    for (const mode of MODES) {
      test(`${refno} / ${mode}`, async ({ page }) => {
        test.skip(!(await backendAlive(GM)), `几何后端 ${GM} 不通`);
        test.skip(!(await backendAlive(MBD)), `MBD 后端 ${MBD} 不通`);
        const pageErrors: string[] = [];
        page.on('pageerror', error => pageErrors.push(String(error)));
        await page.goto(buildPath(refno, ALL_MODES[mode]!), { waitUntil: 'domcontentloaded' });
        test.skip(!(await waitReady(page)), `${refno} 没加载出几何或 MBD 尺寸记录`);

        const outDir = resolve(OUT, mode, refno);
        mkdirSync(outDir, { recursive: true });
        const canvas = page.locator('canvas.viewer');
        const tiers: Record<string, any> = {};
        let base: Camera | null = null;
        for (const tier of TIERS) {
          const result = await collectTier(page, tier.scale, base);
          if (base === null) base = { position: result.camera.position, target: result.camera.target };
          tiers[tier.name] = result;
          writeFileSync(resolve(outDir, `${tier.name}.png`), await canvas.screenshot());
        }

        const perf: any[] = [];
        if (PERF_RUNS > 0) {
          await collectTier(page, null, null);
          await orbitPerf(page, 30);
          for (let run = 0; run < PERF_RUNS; run += 1) perf.push(await orbitPerf(page, PERF_FRAMES));
        }

        writeFileSync(
          resolve(outDir, 'diag.json'),
          `${JSON.stringify({ refno, mode, gm: GM, mbd: MBD, generatedAt: new Date().toISOString(), pageErrors, tiers, perf }, null, 2)}\n`,
          'utf8',
        );
        const brief = Object.fromEntries(Object.entries(tiers).map(([name, tier]) => [name, {
          drawn: tier.drawn,
          overlapHidden: tier.overlapHidden,
          nonFinite: tier.nonFinite,
          overlaps: tier.overlaps,
        }]));
        console.log(`[mbd-label-overlap] ${refno} ${mode} ${JSON.stringify(brief)} perf=${JSON.stringify(perf.map(entry => entry && ({
          layoutP95: entry.layoutMs?.p95,
          paintP95: entry.paintMs?.p95,
          frameP95: entry.frameMs?.p95,
        })))} errors=${pageErrors.length}`);

        for (const tier of Object.values(tiers)) {
          expect(tier.nonFinite, `${refno} / ${mode}：布局里出现非有限值`).toBe(0);
        }
        expect(pageErrors, `${refno} / ${mode}：页面报错`).toEqual([]);
      });
    }
  }
});

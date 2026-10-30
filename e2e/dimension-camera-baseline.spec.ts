import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

/**
 * 固定相机截图基线（W5-2 / T6.4）。
 *
 * 对**真实 BRAN**（gen-model 后端直读）在**同一个 target** 下出「远 / 中 / 近」三档 canvas
 * 截图，并把每档的相机参数落成 `cameras.json` 侧车。用途有两个：
 *
 * 1. W1-3 / W5-3 / W5-4 的 A/B 对照：读侧车的 `tiers.<tier>.position` / `target`，把相机
 *    `position.set(...)` + `controls.target.set(...)` 就能回到同一位，两次改动的截图可直接叠图。
 * 2. W0-2 的 T7.6 前后对比：在两个提交上各跑一组（`DIMENSION_CAMERA_BASELINE_BASE_URL` 指向
 *    另一个 worktree 的 dev server、`DIMENSION_CAMERA_BASELINE_OUT_DIR` 指到不同目录），
 *    人工并排看。
 *
 * 取景口径：**far 档不重算**，直接读加载后自动 fit 留下的相机（`fitDtxViewerToFocusBox`，
 * `distance = max(maxDim × 2.5, 5)`、`position = center + distance × (0.8, 0.6, 0.8)`）。理由：
 * A/B 要比的是用户真看到的默认视角，重算一套取景会把这个前提换掉。mid / near 只沿同一条
 * 方向向量缩模长：`target + (farPosition - target) × scale`，target 一个字节都不动。
 *
 * 环境变量全部可选；`DIMENSION_CAMERA_BASELINE` 不等于 `1` 时整个文件 skip（与其它 live 型
 * e2e 同一态度：环境缺失不误报成回归）。后端不在也 skip。
 */

type Vec3 = [number, number, number];

type TierConfig = Readonly<{ name: string; scale: number }>;

type CameraSnapshot = Readonly<{
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
  records: number;
  drawn: number;
  lodHidden: number;
}>;

const GATE = process.env.DIMENSION_CAMERA_BASELINE === '1';
const BACKEND = (process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:18084').replace(/\/+$/, '');
const PROJECT = process.env.PLANT3D_REAL_PROJECT || 'AvevaMarineSample';
const BASE_URL = process.env.DIMENSION_CAMERA_BASELINE_BASE_URL || '';
const LABEL = process.env.DIMENSION_CAMERA_BASELINE_LABEL || null;
/** 追加的查询参数（A/B 开关），缺省空串 = 基线原样 */
const EXTRA_QUERY = process.env.DIMENSION_CAMERA_BASELINE_EXTRA_QUERY || '';

const DEFAULT_TIERS: readonly TierConfig[] = [
  { name: 'far', scale: 1 },
  { name: 'mid', scale: 0.4 },
  { name: 'near', scale: 0.2 },
];

const OUT_ROOT = resolve(
  process.env.DIMENSION_CAMERA_BASELINE_OUT_DIR
  || fileURLToPath(
    new URL('../docs/verification/dimension-camera-baseline-2026-10-29', import.meta.url),
  ),
);

/** 逗号分隔列表；空 / 全空白回退缺省，避免一个空 env 把用例数变成 0 而静默「全绿」 */
function parseList(raw: string | undefined, fallback: readonly string[]): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : [...fallback];
}

/** `far:1,mid:0.4,near:0.2` → 档位表；非法项跳过，全非法则回退缺省 */
function parseTiers(raw: string | undefined): TierConfig[] {
  const parsed: TierConfig[] = [];
  for (const item of (raw ?? '').split(',')) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.lastIndexOf(':');
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const scale = Number(trimmed.slice(separator + 1).trim());
    if (name.length === 0 || !Number.isFinite(scale) || scale <= 0) continue;
    parsed.push({ name, scale });
  }
  return parsed.length > 0 ? parsed : DEFAULT_TIERS.map((tier) => ({ ...tier }));
}

const REFNOS = parseList(
  process.env.DIMENSION_CAMERA_BASELINE_REFNOS,
  ['24381_145018', '24383_91813'],
);
const TIERS: readonly TierConfig[] = (() => {
  const parsed = parseTiers(process.env.DIMENSION_CAMERA_BASELINE_TIERS);
  const first = parsed[0] as TierConfig;
  if (first.scale === 1) return parsed;
  console.warn(
    `[camera-baseline] 第一档 ${first.name} 的 scale=${first.scale} 被忽略：`
    + '基准档直接沿用加载后的自动 fit 相机，实际比例恒为 1',
  );
  return [{ name: first.name, scale: 1 }, ...parsed.slice(1)];
})();
/** 基准档：相机从页面原样读，不按比例重算 */
const BASE_TIER = TIERS[0] as TierConfig;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 真实 BRAN 直达链接：参数名 `gm_backend` / `mbdBackend` 大小写不同，别合并。
 *
 * `DIMENSION_CAMERA_BASELINE_EXTRA_QUERY` 追加原样参数（`a=1&b=2` 形式），
 * 用来出 A/B：W5-4 的 `mbd_label=above`、W5-3 的 `mbd_lod=0` 都靠它开关。
 * 追加项覆盖同名默认参数——这正是不带开关的基线能保持不变的原因。
 */
function buildPath(refno: string): string {
  const params = new URLSearchParams({
    output_project: PROJECT,
    show_refno: refno,
    show_refno_select: '0',
    mbd_refno: refno,
    gm_backend: BACKEND,
    mbdBackend: BACKEND,
  });
  for (const [key, value] of new URLSearchParams(EXTRA_QUERY)) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

async function backendAlive(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND}/api/v1/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** 几何编译完 + 尺寸系统挂上；任一没等到就交给调用方 skip */
async function waitForModel(page: Page): Promise<boolean> {
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
    return true;
  } catch {
    return false;
  }
}

/**
 * 设档（`scale === null` 表示基准档，只读不动）+ 等布局稳定 + 抄回真实相机与统计。
 *
 * 等布局：`getLayouts().length` 连续两次相同才算稳（最多 10 轮，每轮两帧 rAF）。布局没算完
 * 就截图会拿到上一相机下的标签角度，三档看起来一样。
 *
 * 抄回的是 `camera.position` 的实际值（不是公式算出来的理论值）：`controls.update()` 在
 * `enableDamping` 下会对位置做一次球坐标往返，读回值才是「回到同一位」的依据。
 */
async function snapshotCamera(
  page: Page,
  scale: number | null,
  base: Readonly<{ position: Vec3; target: Vec3 }> | null,
): Promise<CameraSnapshot> {
  return page.evaluate(async (input: {
    scale: number | null;
    position: Vec3 | null;
    target: Vec3 | null;
  }) => {
    const viewer = (window as any).__dtxViewer;
    const system = (window as any).__viewerContext.dimensionSystem.value;

    if (input.scale !== null && input.position && input.target) {
      const [tx, ty, tz] = input.target;
      const position = input.position;
      const px = tx + (position[0] - tx) * input.scale;
      const py = ty + (position[1] - ty) * input.scale;
      const pz = tz + (position[2] - tz) * input.scale;
      viewer.camera.position.set(px, py, pz);
      viewer.controls.target.set(tx, ty, tz);
      // `enableDamping` 下 `update()` 会把残余的 sphericalDelta 再衰减一半写回相机，
      // 读回来的 position 就不是刚设进去的那个点，距离比断言会无故漂移。设档这一下
      // 要的是「就位」而不是「滑过去」，所以临时关掉阻尼再 update。
      const damping = viewer.controls.enableDamping;
      viewer.controls.enableDamping = false;
      viewer.controls.update();
      viewer.controls.enableDamping = damping;
      // 裁剪面按**读回**的实际位置算：`update()` 会把 position 从球坐标重算一遍，
      // 与刚设进去的点有浮点级差异，用理论值算会让 near / far 与相机差一个 ulp 级的源。
      const placed = viewer.camera.position;
      const radius = Math.hypot(placed.x - tx, placed.y - ty, placed.z - tz);
      viewer.camera.near = Math.max(radius / 1000, 0.001);
      viewer.camera.far = radius * 40;
      viewer.camera.updateProjectionMatrix();
    }

    system.notifyViewerChanged();

    const twoFrames = () => new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    });

    // 基准档读的是「加载后自动 fit 留下的相机」。`__dtxAfterInstancesLoaded` 里那次
    // `fitDtxViewerToFocusBox(..., 0)` 与几何编译完成之间没有先后保证，直接读可能抄到
    // fit 之前的位姿，于是三档全部锚在一个不是默认视角的点上。读之前先等相机静止：
    // 连续两次采样的位置差小于 1e-6 才算稳（`duration: 0` 的 fit 是一次跳变，跳完就稳）。
    if (input.scale === null) {
      let last = viewer.camera.position.clone();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await twoFrames();
        const current = viewer.camera.position;
        if (current.distanceTo(last) < 1e-6) break;
        last = current.clone();
      }
    }

    await twoFrames();
    let previous = -1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await twoFrames();
      const count = system.viewport.getLayouts().length;
      if (count === previous) break;
      previous = count;
    }

    const layouts = system.viewport.getLayouts();
    return {
      position: viewer.camera.position.toArray() as [number, number, number],
      target: viewer.controls.target.toArray() as [number, number, number],
      up: viewer.camera.up.toArray() as [number, number, number],
      fov: viewer.camera.fov as number,
      near: viewer.camera.near as number,
      far: viewer.camera.far as number,
      records: layouts.length as number,
      // `drawn` 与 `docs/verification/mbd-perf-baseline-2026-10-29/README.md:108` 同口径
      // （`layout.primitives.length > 0`），W5-5 才能拿两份侧车直接对表。被 LOD 剔除时
      // `primitives` 与 `scenePrimitives` 都空，两种写法结果相同。
      drawn: layouts.filter((layout: any) => layout.primitives.length > 0).length as number,
      lodHidden: layouts.filter(
        (layout: any) => layout.derived?.lodHidden !== undefined,
      ).length as number,
    };
  }, { scale, position: base?.position ?? null, target: base?.target ?? null });
}

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ timeout: 420_000 });
// 文件级门控：与 `dimension-perf.spec.ts` 同一写法。不开门控就一条都不跑，也不去连后端。
test.skip(
  !GATE,
  'Set DIMENSION_CAMERA_BASELINE=1 to run the camera baseline generator',
);

test.describe('dimension camera baseline', () => {
  for (const refno of REFNOS) {
    test(`captures far / mid / near canvases for BRAN ${refno}`, async ({ page, baseURL }) => {
      test.skip(
        !(await backendAlive()),
        `gen-model 不在 ${BACKEND}（/api/v1/health 不通）`,
      );

      const path = buildPath(refno);
      const gotoUrl = BASE_URL ? new URL(path, BASE_URL).toString() : path;
      const absoluteUrl = new URL(path, BASE_URL || baseURL || 'http://127.0.0.1:3101').toString();
      const outDir = resolve(OUT_ROOT, refno);
      mkdirSync(outDir, { recursive: true });

      await page.goto(gotoUrl, { waitUntil: 'domcontentloaded' });
      test.skip(!(await waitForModel(page)), `refno ${refno} 在 ${BACKEND} 上没加载出几何`);

      // 尺寸记录来自 MBD 通道（`mbd_refno` → `/api/mbd/v2/pipe`），比几何晚一步到位。
      // 等不到就说明这个 refno 在后端没有 MBD 数据——那是数据问题，不是相机基线的回归。
      let ready = true;
      try {
        await expect
          .poll(
            () => page.evaluate(
              () => (window as any).__viewerContext.dimensionSystem.value.viewport.getLayouts().length,
            ),
            { timeout: 120_000, intervals: [500, 1_000, 2_000] },
          )
          .toBeGreaterThan(0);
      } catch {
        ready = false;
      }
      test.skip(!ready, `refno ${refno} 没有 MBD 尺寸记录，三档截图无意义`);

      const canvas = page.locator('canvas.viewer');
      await expect(canvas).toBeVisible();

      const canvasCss = await page.evaluate(() => {
        const element = document.querySelector<HTMLCanvasElement>('canvas.viewer');
        return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 };
      });
      const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };

      const snapshots: Record<string, CameraSnapshot> = {};
      const buffers: Record<string, Buffer> = {};

      let baseSnapshot: CameraSnapshot | null = null;
      for (const tier of TIERS) {
        const snapshot = baseSnapshot === null
          ? await snapshotCamera(page, null, null)
          : await snapshotCamera(page, tier.scale, {
            position: baseSnapshot.position,
            target: baseSnapshot.target,
          });
        if (baseSnapshot === null) baseSnapshot = snapshot;
        snapshots[tier.name] = snapshot;

        const buffer = await canvas.screenshot();
        buffers[tier.name] = buffer;
        writeFileSync(resolve(outDir, `${tier.name}.png`), buffer);

        expect(
          snapshot.drawn,
          `${refno} / ${tier.name}：一条图元都没画出来（records=${snapshot.records}，`
          + `lodHidden=${snapshot.lodHidden}）`,
        ).toBeGreaterThanOrEqual(1);
      }

      // 1. 三张 PNG 两两不等：相机没生效 / 页面没重绘时三张会一模一样
      for (let i = 0; i < TIERS.length; i += 1) {
        for (let j = i + 1; j < TIERS.length; j += 1) {
          const left = TIERS[i] as TierConfig;
          const right = TIERS[j] as TierConfig;
          expect(
            (buffers[left.name] as Buffer).equals(buffers[right.name] as Buffer),
            `${refno}：${left.name} 与 ${right.name} 的截图字节相同，相机可能没生效`,
          ).toBe(false);
        }
      }

      // 2. 三档 target 必须是同一个点（只改模长，不改看向）
      const base = snapshots[BASE_TIER.name] as CameraSnapshot;
      for (const tier of TIERS) {
        const snapshot = snapshots[tier.name] as CameraSnapshot;
        expect(snapshot.target[0], `${refno} / ${tier.name} target.x`).toBeCloseTo(base.target[0], 6);
        expect(snapshot.target[1], `${refno} / ${tier.name} target.y`).toBeCloseTo(base.target[1], 6);
        expect(snapshot.target[2], `${refno} / ${tier.name} target.z`).toBeCloseTo(base.target[2], 6);
      }

      // 3. 距离比 ≈ 配置的比例（基准档恒按 1）
      const baseDistance = distance(base.position, base.target);
      expect(baseDistance, `${refno}：基准档相机与 target 重合，距离比为 0 无法比较`).toBeGreaterThan(0);
      for (const tier of TIERS) {
        const snapshot = snapshots[tier.name] as CameraSnapshot;
        const ratio = distance(snapshot.position, snapshot.target) / baseDistance;
        expect(
          Math.abs(ratio - tier.scale),
          `${refno} / ${tier.name}：实测距离比 ${ratio.toFixed(6)}，配置 ${tier.scale}`,
        ).toBeLessThanOrEqual(1e-3);
      }

      const sidecar = {
        label: LABEL,
        generatedAt: new Date().toISOString(),
        url: absoluteUrl,
        viewport,
        devicePixelRatio,
        canvasCss,
        refno,
        tiers: Object.fromEntries(
          TIERS.map((tier) => [tier.name, {
            scale: tier.scale,
            ...(snapshots[tier.name] as CameraSnapshot),
          }]),
        ),
      };
      writeFileSync(
        resolve(outDir, 'cameras.json'),
        `${JSON.stringify(sidecar, null, 2)}\n`,
        'utf8',
      );

      console.log(
        `[camera-baseline] ${refno} `
        + TIERS.map((tier) => {
          const snapshot = snapshots[tier.name] as CameraSnapshot;
          return `${tier.name}=${distance(snapshot.position, snapshot.target).toFixed(3)}`
            + `(records=${snapshot.records},drawn=${snapshot.drawn},lodHidden=${snapshot.lodHidden})`;
        }).join(' ')
        + ` -> ${outDir}`,
      );
    });
  }
});

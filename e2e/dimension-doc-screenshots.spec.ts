import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

/**
 * Generates documentation figures of each SolveSpace-style dimension kind by
 * driving the always-on dimension system in demo mode, creating one user
 * dimension via the exposed `__viewerContext.dimensionSystem` hook, framing the
 * camera on it, and screenshotting the viewer canvas. Its product is the PNGs
 * under docs/verification/dimensions/screenshots — the committed baselines.
 *
 * `npm run verify:dimension-screenshots` regenerates into test-results/ and
 * compares byte-for-byte with HEAD; `DIMENSION_DOC_SCREENSHOT_OUT_DIR`
 * redirects the output directory.
 */

const OUT_DIR = process.env.DIMENSION_DOC_SCREENSHOT_OUT_DIR
  ? resolve(process.env.DIMENSION_DOC_SCREENSHOT_OUT_DIR)
  : resolve(
    fileURLToPath(new URL('../docs/verification/dimensions/screenshots', import.meta.url)),
  );

type Vec3 = [number, number, number];

function anchor(snapshot: Vec3) {
  return { snapshot, accuracy: 'exact' as const };
}

const ACTOR = { actorId: 'doc-author', actorRole: 'admin' };

function common(id: string) {
  return {
    id,
    labelPinned: false,
    authorId: ACTOR.actorId,
    authorRole: ACTOR.actorRole,
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid' as const,
  };
}

const CASES: readonly Readonly<{ name: string; label: string; record: unknown }>[] = [
  {
    name: 'linear',
    label: '线性尺寸 · 1000mm',
    record: {
      ...common('doc-linear'),
      kind: 'linear',
      a: anchor([0, 0, 0]),
      b: anchor([1, 0, 0]),
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    },
  },
  {
    name: 'projected',
    label: '投影尺寸 · 沿 X 轴',
    record: {
      ...common('doc-projected'),
      kind: 'projected',
      a: anchor([0, 0, 0]),
      b: anchor([1, 0.4, 0]),
      axis: { kind: 'design-axis', axis: 'x' },
      placement: { offsetM: 0.3, labelT: 0.5, side: 1 },
    },
  },
  {
    name: 'angular',
    label: '角度尺寸 · 90°',
    record: {
      ...common('doc-angular'),
      kind: 'angular',
      vertex: anchor([0, 0, 0]),
      rayA: anchor([1, 0, 0]),
      rayB: anchor([0, 1, 0]),
      placement: { radiusM: 0.4, labelT: 0.5, arcChoice: 'minor' },
    },
  },
  {
    name: 'radial',
    label: '半径尺寸 · R500',
    record: {
      ...common('doc-radial'),
      kind: 'radial',
      center: anchor([0, 0, 0]),
      rim: anchor([0.5, 0, 0]),
      normal: { kind: 'design-axis', axis: 'z' },
      display: 'radius',
      placement: { leaderDirection: [0.7071, 0.7071, 0], labelDistanceM: 0.3 },
    },
  },
];

async function openViewer(page: Page): Promise<void> {
  await page.goto('/?dimension_demo=1');
  await page.getByText('三维查看器', { exact: true }).click();
  await page.waitForFunction(
    () =>
      (window as any).__viewerContext?.dimensionSystem?.value
      || typeof (window as any).__dimensionSystemError === 'string',
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => (window as any).__dimensionSystemError ?? null)).toBeNull();
}

async function createAndFrame(page: Page, record: unknown): Promise<void> {
  const created = await page.evaluate((rec: any) => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const result = system.document.apply({
      type: 'create',
      record: rec,
      commandId: `doc-shot-${rec.id}`,
      actorId: rec.authorId,
      actorRole: rec.authorRole,
      at: Date.now(),
    });
    return { ok: result.ok, reason: result.reason ?? null };
  }, record);
  expect(created, JSON.stringify(created)).toMatchObject({ ok: true });

  // 创建后的布局要等 viewport 的下一帧才算出来。布局没就绪就收集锚点会拿到空集、
  // 镜头停在默认位姿，截出来就是「两条斜线、没有标签」的半成品帧（2026-10-28 的
  // 入库基线里 linear / projected 正是这样）。先等到这一条的布局就绪再取景。
  await page.evaluate(() => {
    (window as any).__viewerContext.dimensionSystem.value.notifyViewerChanged();
  });
  await page.waitForFunction((dimensionId: string) => {
    const system = (window as any).__viewerContext?.dimensionSystem?.value;
    const layout = system?.viewport?.getLayouts?.().find(
      (item: any) => item.dimensionId === dimensionId,
    );
    return Boolean(
      layout && layout.scenePrimitives?.length > 0 && layout.derived?.formattedLabel,
    );
  }, (record as { id: string }).id, { timeout: 30_000 });

  await page.evaluate(async () => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    system.notifyViewerChanged();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const anchors: number[][] = [];
    for (const layout of system.viewport.getLayouts()) {
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-line') anchors.push(primitive.from.anchor, primitive.to.anchor);
        else if (primitive.kind === 'scene-triangle') for (const p of primitive.points) anchors.push(p.anchor);
        else if (primitive.kind === 'scene-path') for (const p of primitive.points) anchors.push(p.anchor);
        else if (primitive.kind === 'scene-marker' || primitive.kind === 'scene-glyph-run') anchors.push(primitive.at.anchor);
      }
    }
    if (anchors.length === 0) return;
    const world = anchors.map(([x, y, z]) => [x * 1000, y * 1000, z * 1000]);
    const xs = world.map((p) => p[0]);
    const ys = world.map((p) => p[1]);
    const zs = world.map((p) => p[2]);
    const center = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ];
    const maxExtent = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
      1,
    );
    const viewer = (window as any).__dtxViewer;
    viewer.camera.up.set(0, 1, 0);
    viewer.camera.position.set(center[0], center[1], center[2] + maxExtent * 2.6);
    viewer.controls.target.set(center[0], center[1], center[2]);
    viewer.controls.update();
    viewer.camera.near = Math.max(maxExtent / 10_000, 0.001);
    viewer.camera.far = maxExtent * 40;
    viewer.camera.updateProjectionMatrix();
    system.notifyViewerChanged();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // 取景会触发重排：再等两帧，避免截到上一相机下的标签角度。
  await page.evaluate(() =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

test.describe('dimension documentation figures', () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const dimensionCase of CASES) {
    test(`renders ${dimensionCase.name} dimension figure`, async ({ page }) => {
      test.setTimeout(120_000);
      await openViewer(page);
      await createAndFrame(page, dimensionCase.record);

      const canvas = page.locator('canvas.viewer');
      await expect(canvas).toBeVisible();
      await canvas.screenshot({ path: resolve(OUT_DIR, `${dimensionCase.name}.png`) });
    });
  }
});

import { expect, test, type Page } from '@playwright/test';

import { DEMO_URL, waitForDemoReady } from './helpers/cloudOutlineScene';

test('dimension_demo mounts the dimension system and starts a typed creation session', async ({ page }) => {
  // `dimension_demo` 在 `src/` 下已无读取点（ViewerPanel 无条件建尺寸系统）；
  // `dtx_demo=primitives` 让 ViewerPanel 跳过启动时的 db_meta_info 预拉，无后端也能起来。
  await page.goto('/?dtx_demo=primitives&dtx_demo_count=1');
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ));
  expect(await page.evaluate(
    () => (window as any).__dimensionSystemError ?? null,
  )).toBeNull();

  await expect.poll(() => page.evaluate(() => {
    // ADR 0064：叠层在 viewport 自己的 scene 里（整帧后单独渲染），不在 __dtxViewer.scene 下。
    const overlay = (window as any).__viewerContext.dimensionSystem.value.viewport.overlayScene;
    const group = overlay?.getObjectByName?.('dimension-scene-overlay');
    const lines = group?.getObjectByName?.('dimension-scene-lines');
    const arrows = group?.getObjectByName?.('dimension-scene-arrows');
    return Boolean(
      overlay?.parent === null
      && group?.visible
      && lines?.visible
      && arrows?.visible,
    );
  }), { timeout: 30_000 }).toBe(true);
  // 「尺寸标注」既是 ribbon group 标签也是按钮文本，getByText 会 strict 违规；
  // 且默认菜单模式是 hierarchical，dropdown 未展开前该文本不存在。
  // 两套菜单都带 data-ribbon-tab / data-command，所以这条路径与菜单模式无关。
  await page.locator('[data-ribbon-tab="view"]').first().click();
  await page.locator('[data-command="panel.dimension"]').first().click();
  const linearButton = page.getByTestId('dimension.create.linear');
  await expect(linearButton).toBeVisible();
  await linearButton.click();

  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(true);

  await page.getByTestId('dimension.cancel').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(false);

  await page.getByTestId('dimension.create.angular').click();
  await expect(page.getByTestId('dimension.angular.orthogonal-snap')).toBeEnabled();
  await page.getByTestId('dimension.angular.orthogonal-snap').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.sessionStatus?.kind ?? ''
  ))).toBe('angular');
  await page.getByTestId('dimension.cancel').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(false);

  await page.getByTestId('dimension.create.chain').click();
  await expect.poll(() => page.evaluate(() => {
    const status = (window as any).__viewerContext.dimensionSystem.value.pointer.sessionStatus;
    return status ? `${status.kind}:${status.step}` : '';
  })).toBe('chain:pick');
  await expect(page.getByTestId('dimension.chain.finish')).toBeDisabled();
  await page.getByTestId('dimension.cancel').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(false);
});

/*
 * 下面三条在应用页面里把创建走完：真的在画布上拾点 → 放置 → 提交。
 * primitives demo 不依赖后端，没有 P 点和关键点，拾到的是模型表面点，所以锚点是近似的、读数带 `~`。
 * 投影尺寸要选轴、径向尺寸要圆的语义，表面点走不通，不在这里。
 */

type ClientPoint = { x: number; y: number };
type DesignPoint = [number, number, number];

/** 进行中的尺寸会话，写成「种类:阶段」；没有会话是空串。 */
function sessionPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const status = (window as any).__viewerContext.dimensionSystem.value.pointer.sessionStatus;
    return status ? `${status.kind}:${status.phase}` : '';
  });
}

function userDimensionCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.document.state.records.length
  ));
}

function firstUserDimension(page: Page): Promise<any> {
  return page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.document.state.records[0]
  ));
}

/** 这条尺寸当前排出来的读数；还没排出来是 null。 */
function layoutLabel(page: Page, dimensionId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const layouts = (window as any).__viewerContext.dimensionSystem.value.viewport.getLayouts();
    return layouts.find((layout: any) => layout.dimensionId === id)?.derived?.formattedLabel ?? null;
  }, dimensionId);
}

async function openDimensionPanelOnDemo(page: Page): Promise<void> {
  await page.goto(DEMO_URL);
  await waitForDemoReady(page);
  await page.waitForFunction(() => Boolean((window as any).__viewerContext?.dimensionSystem?.value));
  await page.locator('[data-ribbon-tab="view"]').first().click();
  await page.locator('[data-command="panel.dimension"]').first().click();
  await expect(page.getByTestId('dimension.create.linear')).toBeVisible();
}

/**
 * 画布上 `count` 个能拾到模型表面的点，外加一个放置用的落点，都没被浮层盖住。
 * 点与点在屏幕上隔开；三个时还要不共线，角度尺寸才有平面。
 * 要在尺寸面板打开之后找：面板一开画布会缩。
 */
async function findSurfacePicks(
  page: Page,
  count: 2 | 3,
): Promise<{ points: ClientPoint[]; place: ClientPoint }> {
  const picks = await page.evaluate((wanted) => {
    type P = { x: number; y: number };
    const selection = (window as any).__xeokitViewer?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!selection || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const uncovered = (point: P) =>
      document.elementFromPoint(rect.left + point.x, rect.top + point.y) === canvas;
    const surface: P[] = [];
    const steps = 16;
    for (let j = 3; j <= steps - 3; j += 1) {
      for (let i = 3; i <= steps - 3; i += 1) {
        const point = { x: (rect.width * i) / steps, y: (rect.height * j) / steps };
        if (uncovered(point) && selection.pickPoint(point)) surface.push(point);
      }
    }
    const apart = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y) >= 110;
    const spread = (a: P, b: P, c: P) =>
      Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) >= 110 * 60;
    const toClient = (point: P) => ({ x: rect.left + point.x, y: rect.top + point.y });
    for (const a of surface) {
      for (const b of surface) {
        if (!apart(a, b)) continue;
        const chosen = [a, b];
        if (wanted === 3) {
          const c = surface.find(point => apart(point, a) && apart(point, b) && spread(a, b, point));
          if (!c) continue;
          chosen.push(c);
        }
        // 放置点：这几个点的重心，沿首末连线的法向偏 60 px，哪一侧没被盖住用哪一侧。
        const first = chosen[0]!;
        const last = chosen[chosen.length - 1]!;
        const length = Math.hypot(last.x - first.x, last.y - first.y);
        const normal = { x: -(last.y - first.y) / length, y: (last.x - first.x) / length };
        const centre = {
          x: chosen.reduce((sum, point) => sum + point.x, 0) / chosen.length,
          y: chosen.reduce((sum, point) => sum + point.y, 0) / chosen.length,
        };
        for (const side of [1, -1]) {
          const place = { x: centre.x + normal.x * 60 * side, y: centre.y + normal.y * 60 * side };
          const inside = place.x > 0 && place.y > 0 && place.x < rect.width && place.y < rect.height;
          if (inside && uncovered(place)) {
            return { points: chosen.map(toClient), place: toClient(place) };
          }
        }
      }
    }
    return null;
  }, count);
  expect(picks, `演示场景里找不到 ${count} 个可拾取的表面点`).not.toBeNull();
  return picks!;
}

function subtract(a: DesignPoint, b: DesignPoint): DesignPoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: DesignPoint, b: DesignPoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const APPROXIMATE_SURFACE_ANCHOR = { accuracy: 'approximate', semanticRef: { source: 'model-surface' } };

test('a linear dimension goes from two surface picks through place to one committed, undoable record', async ({ page }) => {
  await openDimensionPanelOnDemo(page);
  await page.getByTestId('dimension.create.linear').click();
  await expect.poll(() => sessionPhase(page)).toBe('linear:pick-first');

  const picks = await findSurfacePicks(page, 2);
  await page.mouse.click(picks.points[0]!.x, picks.points[0]!.y);
  await expect.poll(() => sessionPhase(page)).toBe('linear:pick-second');
  await page.mouse.click(picks.points[1]!.x, picks.points[1]!.y);
  await expect.poll(() => sessionPhase(page)).toBe('linear:place');
  await expect(page.getByTestId('dimension.step.place')).toHaveAttribute('aria-current', 'step');
  expect(await userDimensionCount(page)).toBe(0);

  // 放置：按下进入就绪，抬起提交。
  await page.mouse.click(picks.place.x, picks.place.y);
  await expect.poll(() => sessionPhase(page)).toBe('');
  await expect.poll(() => userDimensionCount(page)).toBe(1);

  const record = await firstUserDimension(page);
  expect(record).toMatchObject({
    kind: 'linear',
    validity: 'valid',
    a: APPROXIMATE_SURFACE_ANCHOR,
    b: APPROXIMATE_SURFACE_ANCHOR,
    directions: { schema: 1, source: 'explicit' },
  });
  const span = subtract(record.b.snapshot, record.a.snapshot);
  const lengthMm = Math.sqrt(dot(span, span)) * 1000;
  expect(lengthMm).toBeGreaterThan(0);

  // 读数是两点的设计距离，毫米、两位小数。
  await expect.poll(() => layoutLabel(page, record.id)).toMatch(/^~\d+\.\d{2}$/);
  const label = (await layoutLabel(page, record.id))!;
  expect(Number(label.slice(1))).toBeCloseTo(lengthMm, 1);

  // 整次创建是一条 create：撤销一次就没了，重做一次回来。
  await page.getByTestId('dimension.undo').click();
  await expect.poll(() => userDimensionCount(page)).toBe(0);
  await page.getByTestId('dimension.redo').click();
  await expect.poll(() => userDimensionCount(page)).toBe(1);
});

test('a chain dimension takes three surface picks, finishes into place and commits one record with an overall', async ({ page }) => {
  await openDimensionPanelOnDemo(page);
  await page.getByTestId('dimension.create.chain').click();
  await expect.poll(() => sessionPhase(page)).toBe('chain:pick-first');
  await expect(page.getByTestId('dimension.chain.finish')).toBeDisabled();

  const picks = await findSurfacePicks(page, 3);
  for (const point of picks.points) {
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.getByTestId('dimension.chain.finish')).toBeEnabled();
  await page.getByTestId('dimension.chain.finish').click();
  await expect.poll(() => sessionPhase(page)).toBe('chain:place');

  await page.mouse.click(picks.place.x, picks.place.y);
  await expect.poll(() => sessionPhase(page)).toBe('');
  await expect.poll(() => userDimensionCount(page)).toBe(1);

  const record = await firstUserDimension(page);
  expect(record).toMatchObject({
    kind: 'chain',
    validity: 'valid',
    showOverall: true,
    anchors: [APPROXIMATE_SURFACE_ANCHOR, APPROXIMATE_SURFACE_ANCHOR, APPROXIMATE_SURFACE_ANCHOR],
    directions: { schema: 1, source: 'explicit' },
  });

  // 各段沿首末连线这一个方向量：两段相邻长度，再加首末总长。
  const [p0, p1, p2] = record.anchors.map((anchor: any) => anchor.snapshot as DesignPoint);
  const axis = subtract(p2, p0);
  const axisLength = Math.sqrt(dot(axis, axis));
  const along = (point: DesignPoint) => dot(subtract(point, p0), axis) / axisLength;
  const expectedMm = [
    Math.abs(along(p1)),
    Math.abs(along(p2) - along(p1)),
    axisLength,
  ].map(metres => metres * 1000);

  await expect.poll(() => layoutLabel(page, record.id)).toMatch(/^~\d+\.\d{2} · ~\d+\.\d{2} · ~\d+\.\d{2}$/);
  const values = (await layoutLabel(page, record.id))!.split(' · ').map(part => Number(part.slice(1)));
  values.forEach((value, index) => {
    expect(value).toBeCloseTo(expectedMm[index]!, 1);
  });

  await page.getByTestId('dimension.undo').click();
  await expect.poll(() => userDimensionCount(page)).toBe(0);
});

test('an angular dimension takes vertex and two ray picks, keeps its angle plane and commits', async ({ page }) => {
  await openDimensionPanelOnDemo(page);
  await page.getByTestId('dimension.create.angular').click();
  await expect.poll(() => sessionPhase(page)).toBe('angular:pick-first');

  const picks = await findSurfacePicks(page, 3);
  await page.mouse.click(picks.points[0]!.x, picks.points[0]!.y);
  await expect.poll(() => sessionPhase(page)).toBe('angular:pick-second');
  await page.mouse.click(picks.points[1]!.x, picks.points[1]!.y);
  await expect.poll(() => sessionPhase(page)).toBe('angular:pick-third');
  await page.mouse.click(picks.points[2]!.x, picks.points[2]!.y);
  await expect.poll(() => sessionPhase(page)).toBe('angular:place');

  await page.mouse.click(picks.place.x, picks.place.y);
  await expect.poll(() => sessionPhase(page)).toBe('');
  await expect.poll(() => userDimensionCount(page)).toBe(1);

  const record = await firstUserDimension(page);
  expect(record).toMatchObject({
    kind: 'angular',
    validity: 'valid',
    vertex: APPROXIMATE_SURFACE_ANCHOR,
    rayA: APPROXIMATE_SURFACE_ANCHOR,
    rayB: APPROXIMATE_SURFACE_ANCHOR,
    anglePlane: { schema: 1, source: 'explicit' },
    placement: { arcChoice: 'minor', orthogonalSnap: false },
  });
  expect(record.placement.radiusM).toBeGreaterThan(0);

  // 读数是两条射线在设计空间里的夹角，与相机无关。
  const toA = subtract(record.rayA.snapshot, record.vertex.snapshot);
  const toB = subtract(record.rayB.snapshot, record.vertex.snapshot);
  const expectedDeg = (Math.acos(
    dot(toA, toB) / Math.sqrt(dot(toA, toA) * dot(toB, toB)),
  ) * 180) / Math.PI;

  await expect.poll(() => layoutLabel(page, record.id)).toMatch(/^~\d+\.\d{2}°$/);
  const label = (await layoutLabel(page, record.id))!;
  expect(Number(label.slice(1, -1))).toBeCloseTo(expectedDeg, 1);

  await page.getByTestId('dimension.undo').click();
  await expect.poll(() => userDimensionCount(page)).toBe(0);
});

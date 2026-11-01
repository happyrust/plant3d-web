import { describe, expect, it, vi } from 'vitest';

import { Group, PerspectiveCamera } from 'three';

import { normalizeExternalDimension } from '../adapters/normalizeExternalDimensions';
import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import {
  emptyDimensionDocument,
  exactAnchor,
  linearRecord,
  projectedRecord,
} from '../domain/testFixtures';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';
import { createTestFont, createTestProjector } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';
import { layoutViewport } from '../kernel/viewport/layoutViewport';

import { DimensionViewport } from './dimensionViewport';
import { ThreeSceneDimensionPainter } from './scenePainter';

import type { DimensionFrameBreakdown } from './dimensionViewport';
import type { SceneDimensionPaintJob } from './scenePainter';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

import { present } from '@/testing/present';

vi.mock('../kernel/viewport/layoutViewport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kernel/viewport/layoutViewport')>();
  return {
    ...actual,
    layoutViewport: vi.fn(actual.layoutViewport),
  };
});
function createViewport(
  onFrame?: (durationMs: number, breakdown: DimensionFrameBreakdown) => void,
  /** 覆盖每帧段预算（§11.17）。测试文档只有十几条记录，按真实预算一批就写完。 */
  segmentBudgetPerFrame?: number,
  /** 覆盖相机运动重排间隔下限（W4-1）。 */
  cameraMotionLayoutIntervalMs?: number,
) {
  const callbacks: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  const requestRender = vi.fn();
  const viewport = new DimensionViewport({
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    requestFrame: callback => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame: id => cancelled.push(id),
    requestRender,
    ...(onFrame ? { onFrame } : {}),
    ...(segmentBudgetPerFrame === undefined ? {} : { segmentBudgetPerFrame }),
    ...(cameraMotionLayoutIntervalMs === undefined
      ? {}
      : { cameraMotionLayoutIntervalMs }),
  });
  /**
   * Runs queued frames. W5-5 之后一次全量绘制要跨若干帧（分帧写线顶点），
   * 所以默认把队列排空——每次 `requestFrame` 追加的回调也一并跑掉，直到
   * 队列为空。传 `1` 只跑一帧，用来观察分帧中间态。
   */
  const flush = (maxFrames = Number.POSITIVE_INFINITY) => {
    let frames = 0;
    while (callbacks.length > 0 && frames < maxFrames) {
      callbacks.shift()?.(performance.now());
      frames += 1;
    }
    return frames;
  };
  return {
    callbacks,
    cancelled,
    flush,
    requestRender,
    scene: viewport.overlayScene,
    viewport,
  };
}

describe('dimension input normalization', () => {
  it('derives invalid and approximate semantic roles without leaking metadata', () => {
    const approximate = normalizeUserDimension(linearRecord({
      authorId: 'private-author',
      a: {
        snapshot: [0, 0, 0],
        accuracy: 'approximate',
        semanticRef: { source: 'model-surface', refno: 'secret-refno' },
      },
    }));
    const invalid = normalizeUserDimension(linearRecord({
      validity: 'invalid',
      a: { snapshot: [0, 0, 0], accuracy: 'approximate' },
    }));

    expect(approximate).toMatchObject({
      id: 'linear-1',
      kind: 'linear',
      role: 'approximate',
      labelPinned: false,
    });
    expect(approximate).not.toHaveProperty('authorId');
    expect(approximate).not.toHaveProperty('semanticRef');
    expect(invalid).toMatchObject({ role: 'invalid' });
  });

  it('keeps records with unresolved anchors list-only', () => {
    expect(normalizeUserDimension(linearRecord({
      a: { snapshot: null, accuracy: 'exact' },
    }))).toBeNull();
  });

  it('resolves design and semantic projection axes from snapshots', () => {
    expect(normalizeUserDimension(projectedRecord())).toMatchObject({
      axis: [1, 0, 0],
    });
    expect(normalizeUserDimension(projectedRecord({
      axis: {
        kind: 'semantic-direction',
        snapshot: [0, 1, 0],
        semanticRef: { source: 'direction', candidateId: 'direction-1' },
      },
    }))).toMatchObject({ axis: [0, 1, 0] });
  });

  it('forces external identity and role while dropping source metadata', () => {
    const record: ExternalDimensionRecord = {
      id: 'external-1',
      source: 'mbd',
      sourceLabel: 'MBD private source',
      role: 'external-reference',
      layout: {
        id: 'untrusted-id',
        kind: 'linear',
        role: 'normal',
        labelPinned: false,
        a: [0, 0, 0],
        b: [1, 0, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };

    const normalized = normalizeExternalDimension(record);

    expect(normalized).toMatchObject({
      id: 'external-1',
      role: 'external-reference',
    });
    expect(normalized).not.toHaveProperty('source');
    expect(normalized).not.toHaveProperty('sourceLabel');
  });
});

describe('DimensionViewport', () => {
  it('coalesces document and camera changes into one layout and paint', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));

    expect(harness.callbacks).toHaveLength(1);
    harness.flush();

    expect(harness.viewport.getLayouts().map(layout => layout.dimensionId))
      .toEqual(['linear-1']);
    expect(harness.scene.children).toHaveLength(1);
    expect(harness.requestRender).toHaveBeenCalled();
    expect(harness.callbacks).toHaveLength(0);
  });

  it('keeps hover and temporary external hiding local to the viewport', () => {
    const harness = createViewport();
    const external: ExternalDimensionRecord = {
      id: 'external-1',
      source: 'bran-clearance',
      sourceLabel: 'Clearance',
      role: 'external',
      layout: {
        id: 'external-1',
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        a: [0, 1, 0],
        b: [1, 1, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.viewport.setExternalDimensions([external]);
    harness.viewport.setHover('linear-1');
    harness.viewport.setExternalHidden('external-1', true);
    harness.flush();

    expect(harness.viewport.getLayouts().map(layout => layout.dimensionId))
      .toEqual(['linear-1']);
    expect(harness.viewport.isExternalHidden('external-1')).toBe(true);
  });

  it('uses the current layouts for hit testing and clears on disposal', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();
    const layout = present(harness.viewport.getLayouts()[0], 'first layout');
    const region = present(layout.hitRegions[0], 'first hit region');
    const point = region.kind === 'segment'
      ? region.from
      : ([region.rect.x, region.rect.y] as const);

    expect(harness.viewport.hitTest(point, 3)?.dimensionId).toBe('linear-1');

    harness.viewport.invalidate('camera');
    harness.viewport.dispose();
    expect(harness.cancelled).toEqual([1]);
    expect(harness.scene.children).toHaveLength(0);
  });

  it('draws its own overlay scene over the host frame with the depth buffer cleared', () => {
    const harness = createViewport();
    const camera = new PerspectiveCamera();
    const calls: string[] = [];
    const renderer = {
      autoClear: true,
      clearDepth: vi.fn(() => { calls.push(`clearDepth autoClear=${renderer.autoClear}`); }),
      render: vi.fn((scene: unknown, cam: unknown) => {
        calls.push(`render ${scene === harness.viewport.overlayScene ? 'overlay' : 'other'} ${cam === camera ? 'camera' : 'other'} autoClear=${renderer.autoClear}`);
      }),
    };

    harness.viewport.renderOverlay(renderer as never, camera);
    // Nothing of the frame is cleared; only depth, so stroke passes dedupe
    // against each other and never meet model depth (ADR 0064 / 0062).
    expect(calls).toEqual([
      'clearDepth autoClear=false',
      'render overlay camera autoClear=false',
    ]);
    expect(renderer.autoClear).toBe(true);

    // The painter lives in that scene, not in any host scene graph.
    expect(harness.viewport.overlayScene.parent).toBeNull();
    expect(harness.viewport.overlayScene.getObjectByName('dimension-scene-overlay')).toBeDefined();

    harness.viewport.dispose();
    harness.viewport.renderOverlay(renderer as never, camera);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  /**
   * W5-5 分帧的第五个问题：宿主在分帧窗口内要求渲染时，几何只写了一半。
   *
   * `paintAsync` 起手就把 `drawRange` 归零，容量增长时还会换一块未初始化的
   * `BufferGeometry`；而 `ViewerPanel.vue:3301/3304` 与 `:3394/3397` 四处
   * `renderDimensionOverlay` 都在宿主帧之后**无条件**执行。分帧中途相机一动，
   * 那帧要么画出写了一半的顶点，要么（若直接跳过）整层消失。
   *
   * 判定：分帧窗口内调 `renderOverlay` 必须把剩余批次一次写完再画，且不留下
   * 待跑的绘制帧。用「剩余帧数」而不是「画了什么」来判，是因为 jsdom 里没有
   * 真 GPU，`render()` 只是个桩——真正能观察到的是作业是否被同步收尾。
   */
  it('finishes the batched paint before drawing when the host renders mid-batch', () => {
    const records = Array.from({ length: 12 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, index * 0.5, 0]),
    }));
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(records));

    // One frame only: the first batch is written, the paint is still in flight.
    harness.flush(1);
    expect(harness.callbacks.length).toBeGreaterThan(0);

    const camera = new PerspectiveCamera();
    const renderer = {
      autoClear: true,
      clearDepth: vi.fn(),
      render: vi.fn(),
    };
    harness.viewport.renderOverlay(renderer as never, camera);

    // The overlay pass ran, and the queued paint frame was cancelled before it
    // — the remaining batches were written synchronously instead.
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(harness.cancelled).toHaveLength(1);
    expect(harness.cancelled[0]).toBe(1);

    // And the geometry is now complete: a hit test answers against the frame
    // that was just drawn, not against a half-written one.
    const region = harness.viewport.getLayouts()[0]!.hitRegions[0]!;
    const probe: [number, number] = region.kind === 'segment'
      ? [region.from[0], region.from[1]]
      : [region.rect.x, region.rect.y];
    expect(harness.viewport.hitTest(probe, 3)?.dimensionId).toBe('linear-1');
  });

  it('skips the relayout on camera flushes while the projector instance is unchanged', () => {
    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();

    expect(layoutViewport).toHaveBeenCalledTimes(1);

    harness.viewport.flushProjection();
    harness.viewport.flushProjection();

    expect(layoutViewport).toHaveBeenCalledTimes(1);
    expect(harness.viewport.getLayouts().map(layout => layout.dimensionId))
      .toEqual(['linear-1']);
    expect(harness.requestRender).toHaveBeenCalled();
  });

  /**
   * W5-5 分帧的硬约束：写一半的缓冲绝不能被渲染。这里只跑第一帧，然后
   * 在分帧进行中触发一次相机失效，确认 `render()` 早退、不调 `requestRender`
   * ——否则那一帧会画出只画了一部分的尺寸线。
   */
  it('does not render while a batched paint is only partly written', () => {
    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();

    const rendersAfterFirstPaint = harness.requestRender.mock.calls.length;
    expect(rendersAfterFirstPaint).toBeGreaterThan(0);

    // Start a fresh paint and stop after its first batch.
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush(1);

    // Mid-paint: a camera invalidation must not reach the renderer.
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.flushProjection();

    expect(harness.requestRender.mock.calls.length).toBe(rendersAfterFirstPaint);

    // Draining the remaining batches publishes and renders again.
    harness.flush();
    expect(harness.requestRender.mock.calls.length).toBeGreaterThan(
      rendersAfterFirstPaint,
    );
  });

  /**
   * W5-5 分帧的第二个硬约束：`render()` 在分帧期间早退，而 scheduler 已经把
   * 失效原因 `consume()` 掉了。若早退时直接丢，那次失效就永久消失。
   *
   * 必须用**足够多的记录**让 paint 真的跨帧：批大小是 `ceil(n / 3)`，只有一
   * 条记录时一批就写完，早退分支根本走不到。这里 12 条 → 每批 4 条 → 3 帧。
   */
  it('keeps invalidations that arrive while a batched paint is in flight', () => {
    const records = Array.from({ length: 12 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, index * 0.5, 0]),
    }));

    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(records));
    harness.flush();
    const layoutsAfterFirstPaint = vi.mocked(layoutViewport).mock.calls.length;
    expect(layoutsAfterFirstPaint).toBe(1);

    // Start a fresh paint and stop after its first batch: painting === true.
    harness.viewport.setDocument(emptyDimensionDocument(records));
    harness.flush(1);
    const layoutsMidPaint = vi.mocked(layoutViewport).mock.calls.length;

    // This invalidation is consumed by the scheduler and delivered to render()
    // while the batch is still being written, so render() must early-return.
    const themed = {
      ...SOLVESPACE_DIMENSION_THEME,
      textHeightPx: SOLVESPACE_DIMENSION_THEME.textHeightPx + 4,
    };
    harness.viewport.setTheme(themed);
    harness.flush(1);
    // The early-returned frame did not lay out — proof the guard was hit.
    expect(vi.mocked(layoutViewport).mock.calls.length).toBe(layoutsMidPaint);

    // Draining replays the kept reason: one more full layout with the new theme.
    harness.flush();
    expect(vi.mocked(layoutViewport).mock.calls.length).toBeGreaterThan(
      layoutsMidPaint,
    );
    const lastCall = vi.mocked(layoutViewport).mock.calls.at(-1)!;
    expect((lastCall[1] as { theme: { textHeightPx: number } }).theme.textHeightPx)
      .toBe(themed.textHeightPx);
  });

  /**
   * W5-5 分帧后，一次全量绘制的成本散在若干帧里。`onFrame` 若只报第一批，
   * W4-1 的 recorder 会把 paint 低估数倍，基线直接失真。这里用可控时钟钉住
   * 「报的是全部批次」：每跑一帧时间前进 10 ms，3 批就应当报出 ≈30 ms，
   * 而不是第一批的 10 ms。
   */
  it('reports the whole batched paint cost, not just the first batch', () => {
    const records = Array.from({ length: 12 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, index * 0.5, 0]),
    }));
    const frames: DimensionFrameBreakdown[] = [];
    // 预算压到 1 段/帧：12 条记录必然跨多帧，否则这条用例测不到「报全部批次」。
    const harness = createViewport((_durationMs, breakdown) => {
      frames.push(breakdown);
    }, 1);
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(records));

    // Controllable clock: every frame costs exactly 10 ms.
    let clock = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const tick = (): void => { clock += 10; };
    try {
      // Drive the frames by hand so each one advances the clock.
      let guard = 0;
      while (harness.callbacks.length > 0 && guard < 20) {
        tick();
        harness.flush(1);
        guard += 1;
      }
    } finally {
      nowSpy.mockRestore();
    }

    const layoutFrames = frames.filter(frame => frame.kind === 'layout');
    expect(layoutFrames).toHaveLength(1);
    // 12 records split into ceil(12/3) = 4 per batch → 3 batches → ~30 ms.
    // Reporting only the first batch would give ~10 ms.
    expect(layoutFrames[0]!.paintMs).toBeGreaterThan(20);
  });

  /**
   * W5-5 分帧的第四个问题：`hitIndex` 与 `layouts` 在 layout 完成时就换新，
   * 但画面要等分帧写完才更新。中间这 1～2 帧里用户点到的是**新布局的命中
   * 区域、旧画面的像素**——命中一个屏幕上根本还没出现的东西。
   *
   * 判定：分帧中途 `hitTest` 必须仍按**上一帧已画出的**内容回答。
   *
   * 两份文档的几何完全一样、只有 id 前缀不同，这样同一个探针点必然命中，
   * 命中结果的前缀就直接说明用的是哪一份索引。探针点取自已画那一帧的
   * 命中区域（`hitRegions[0].from`），不能手写屏幕坐标——测试投影器只有
   * 400×400，写死 1920×1080 的点会被索引裁剪掉、返回 null，测试就空过了。
   */
  it('answers hit tests from the painted frame while a batched paint is in flight', () => {
    const makeRecords = (prefix: string) => Array.from(
      { length: 12 },
      (_, index) => linearRecord({
        id: `${prefix}-${index + 1}`,
        b: exactAnchor([1, index * 0.5, 0]),
      }),
    );

    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(makeRecords('before')));
    harness.flush();

    const painted = harness.viewport.getLayouts()[0]!;
    expect(painted.dimensionId).toBe('before-1');
    const region = painted.hitRegions[0]!;
    const probe: [number, number] = region.kind === 'segment'
      ? [region.from[0], region.from[1]]
      : [region.rect.x, region.rect.y];

    // 探针点必须先证明能命中，否则下面的断言会退化成「两次都是 null」。
    expect(harness.viewport.hitTest(probe, 3)?.dimensionId).toBe('before-1');

    // 新文档：布局完成，绘制跨三帧。
    harness.viewport.setDocument(emptyDimensionDocument(makeRecords('after')));
    harness.flush(1);

    // 分帧中途，屏幕像素仍属于 before，命中必须仍按 before 回答。
    expect(harness.viewport.hitTest(probe, 3)?.dimensionId).toBe('before-1');

    harness.flush();
    // 排空后命中跟着已画出的帧走。
    expect(harness.viewport.hitTest(probe, 3)?.dimensionId).toBe('after-1');
    expect(harness.viewport.getLayouts()[0]!.dimensionId).toBe('after-1');
  });

  it('relayouts on a camera flush when the projector instance changed', () => {
    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();

    expect(layoutViewport).toHaveBeenCalledTimes(1);

    harness.viewport.setProjector(createTestProjector());
    harness.viewport.flushProjection();

    expect(layoutViewport).toHaveBeenCalledTimes(2);
  });

  /**
   * W4-1 节流契约之一：相机连续变化、但距上次全量布局还不到间隔时，只按新
   * 投影重画旧布局，不再跑 `layoutViewport`。
   *
   * 旧实现在这条路径上从不重排（要等静止 80 ms 才排），绕轨脚本每帧都调
   * `notifyViewerChanged()`，600 帧一次重排都没有——标签全程按旧投影摆放，
   * 帧耗时也完全不可观测。判据必须「到点就排」，而不是「只等静止」。
   */
  it('only redraws while the camera moves faster than the layout interval', () => {
    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport(undefined, undefined, 100);

    let clock = 1_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(1);

      // 相机每帧都变，但每帧只前进 10 ms：远不到 100 ms 的间隔。
      for (let frame = 0; frame < 5; frame += 1) {
        clock += 10;
        harness.viewport.setProjector(createTestProjector());
        harness.flush();
      }

      expect(layoutViewport).toHaveBeenCalledTimes(1);
      // 没有排新帧，但重绘请求发了——画面跟着新投影走。
      expect(harness.callbacks).toHaveLength(0);
      expect(harness.requestRender).toHaveBeenCalled();

      // 收尾：把 80 ms 静止兜底定时器一并清掉，别漏到别的用例里。
      harness.viewport.dispose();
    } finally {
      nowSpy.mockRestore();
    }
  });

  /**
   * 节流契约之二：累计等待到间隔就必须真排一次。这条与上一条配对——只有
   * 上一条会退化成「永不重排」，只有这一条会退化成「每帧都重排」。
   */
  it('relayouts once the layout interval has elapsed during camera motion', () => {
    vi.mocked(layoutViewport).mockClear();
    const harness = createViewport(undefined, undefined, 100);

    let clock = 5_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(1);

      clock += 100;
      harness.viewport.setProjector(createTestProjector());

      // `setProjector` 自己就排了一帧全量布局，不必等静止兜底。
      expect(harness.callbacks).toHaveLength(1);
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(2);

      harness.viewport.dispose();
    } finally {
      nowSpy.mockRestore();
    }
  });

  /**
   * 节流契约之三：静止 80 ms 的兜底不能被节流破坏。相机停下后必须补一次
   * 全量布局，否则停在「旧投影 + 只重绘」的状态上，标签永远差最后一次。
   */
  it('still relayouts after the camera settles, even when throttled', () => {
    vi.mocked(layoutViewport).mockClear();
    // 间隔拉到极长，确保这条用例只测静止兜底，不测间隔到点。
    const harness = createViewport(undefined, undefined, 10_000_000);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(1);

      harness.viewport.setProjector(createTestProjector());
      expect(harness.callbacks).toHaveLength(0);

      vi.advanceTimersByTime(80);
      expect(harness.callbacks).toHaveLength(1);
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * 节流契约之四：间隔不是固定 100 ms，而是 `max(100, 上次全量布局成本 × 2)`。
   *
   * 为什么必须自适应：`24381_1443` 那种 19 206 条记录的场景，一次全量布局
   * 88.6 ms + 绘制 450 ms ≈ 540 ms。固定 100 ms 会让每次重排都被下一次相机
   * 变化顶掉，分帧永远写不完、画面停在旧内容上。这里用「每帧 60 ms、多批」
   * 造出远超 100 ms 的布局成本，再按实测成本算出间隔：差一点不排，越过就排。
   */
  it('scales the layout interval by the last full layout cost', () => {
    const records = Array.from({ length: 12 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, index * 0.5, 0]),
    }));
    vi.mocked(layoutViewport).mockClear();
    // 段预算压到 1 段/帧，让绘制真的跨帧，成本才测得出来。
    const harness = createViewport(undefined, 1, 100);

    let clock = 10_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument(records));

      // 每跑一帧时间前进 60 ms，直到这次全量绘制收尾。
      let guard = 0;
      while (harness.callbacks.length > 0 && guard < 4_096) {
        clock += 60;
        harness.flush(1);
        guard += 1;
      }
      const costMs = (harness.viewport as any).lastFullLayoutCostMs as number;
      // 间隔必须真的被放大到 `成本 × 2`，否则这条用例退化成「固定 100 ms」。
      expect(costMs).toBeGreaterThan(100);
      const intervalMs = costMs * 2;

      // 差一点到放大后的间隔：只重绘，不重排。
      clock += intervalMs - 20;
      harness.viewport.setProjector(createTestProjector());
      expect(harness.callbacks).toHaveLength(0);
      expect(layoutViewport).toHaveBeenCalledTimes(1);

      // 越过放大后的间隔：必须真排一次。
      clock += 40;
      harness.viewport.setProjector(createTestProjector());
      expect(harness.callbacks).toHaveLength(1);
      harness.flush();
      expect(layoutViewport).toHaveBeenCalledTimes(2);

      harness.viewport.dispose();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('converts a screen drag into a semantic linear placement', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());

    expect(harness.viewport.placementAtScreen(
      linearRecord(),
      { x: 275, y: 150 },
    )).toEqual({
      offsetM: 0.5,
      labelT: 0.75,
      side: -1,
    });
  });

  /**
   * W5-5 分帧的行为契约，而不是实现细节。
   *
   * 为什么这四条是契约：批大小（现在是 `ceil(layouts / 3)`）和批数（现在
   * 由批大小推出）都可以随性能预算调整，改它们不该动这条测试；但下面两件事
   * 一变就是回归——(1) 分帧中途绝不把完整几何发布出去，否则宿主那一帧会
   * 画出写了一半的尺寸线；(2) 末帧的顶点必须与同步 `paint()` 逐位相同，
   * 否则「分帧」就变成了「画错」。所以这里钉的是「跨帧」「中间帧未发布」
   * 「末帧等价」，不钉帧数、不钉每批条数。
   *
   * 40 条记录，预算压到 1 段/帧：必然跨多个 paint 帧，前面还有 1 个 layout
   * 帧。记录数与预算只保证「paint 一定跨帧」，具体批数不参与断言。
   */
  it('keeps every batch unpublished until the last one lands', () => {
    const records = Array.from({ length: 40 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, (index % 8) * 0.25, 0]),
    }));

    const harness = createViewport(undefined, 1);
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(records));

    /** 尺寸层线 mesh 的当前几何：`drawRange` 是发布面，`position` 是写入面。 */
    const dimensionLines = () => {
      const mesh = harness.scene.getObjectByName('dimension-scene-lines') as any;
      const geometry = mesh.geometry as {
        drawRange: { count: number };
        getAttribute: (name: string) => { array: Float32Array };
      };
      return geometry;
    };
    /**
     * 已发布的索引数——线缓冲是四顶点一个 quad 的索引几何，`drawRange.count`
     * 记的是索引数而不是顶点数，只有 `finish()` 会把它从 0 写成真实值。
     */
    const publishedIndexCount = () => dimensionLines().drawRange.count;

    // 第一帧是 layout：布局算完，几何一个顶点都还没写，更没有发布。
    harness.flush(1);
    expect(
      publishedIndexCount(),
      '布局完成的那一帧不得发布几何',
    ).toBe(0);

    // 之后的帧才是 paint。逐帧推进，并在每一帧之后（只要还有下一帧）
    // 检查几何尚未发布。实测中间态 `drawRange.count === 0`：`paintAsync`
    // 起手 `ensureCapacity` 换新 `BufferGeometry` 时 `ReusableGeometry`
    // 会 `setDrawRange(0, 0)`，只有 `finish()` 才写入真正的索引数。
    let paintFrames = 0;
    let midPaintSamples = 0;
    while (harness.callbacks.length > 0 && paintFrames < 512) {
      harness.flush(1);
      paintFrames += 1;
      if (harness.callbacks.length > 0) {
        midPaintSamples += 1;
        expect(
          publishedIndexCount(),
          '分帧中途不得发布几何：那一帧会画出写了一半的尺寸线',
        ).toBe(0);
      }
    }

    // **只数 paint 帧，不数 layout 帧**。这一点是这条测试的关键：若把 layout
    // 帧也算进来，那么「一批写完」的实现照样会有 2 帧（layout + paint），
    // 断言会静默通过 —— 实测过：把批大小改成 `layouts.length` 后总帧数仍是 2，
    // 这条契约一次都没被验证。分帧的语义是 **paint 本身跨帧**，所以下界是 2 个
    // paint 帧，不是 2 个总帧。
    expect(
      paintFrames,
      '分帧必须让 paint 本身跨帧：paint 只有一帧说明一批就写完了，契约没被走到',
    ).toBeGreaterThanOrEqual(2);
    expect(
      midPaintSamples,
      '必须真的观察到 paint 的中间帧，否则上面的「未发布」断言一次都没跑',
    ).toBeGreaterThanOrEqual(1);

    const published = publishedIndexCount();
    expect(
      published,
      '末帧必须发布几何，否则尺寸层永远不显示',
    ).toBeGreaterThan(0);

    // 末帧与同步 `paint()` 逐位相同：这是分帧唯一可以接受的正确性标准。
    // 参照画家用同一份 layouts（分帧结束后 `getLayouts()` 就是这批布局）、
    // 同一主题、同一 displayMode，与视口内部画家的 resize 参数一致
    // （`createTestProjector()` 是 400×400 @ dpr 2）。
    const reference = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    reference.resize(400, 400, 2);
    reference.paint(
      harness.viewport.getLayouts(),
      SOLVESPACE_DIMENSION_THEME,
    );
    const referenceLines = reference.group.getObjectByName(
      'dimension-scene-lines',
    ) as any;
    const vertexCount = reference.getStats().lineVertexCount;
    expect(
      vertexCount,
      '参照画家必须真的写了顶点，否则下面的逐位比较是空比较',
    ).toBeGreaterThan(0);

    const expected = Array.from(
      referenceLines.geometry.getAttribute('position').array.slice(
        0,
        vertexCount * 3,
      ),
    );
    const actual = Array.from(
      dimensionLines().getAttribute('position').array.slice(
        0,
        vertexCount * 3,
      ),
    );
    expect(
      actual,
      '分帧写出的顶点必须与同步 paint() 逐位相同',
    ).toEqual(expected);
    // 发布面也必须等价：两边同一个 `drawRange`，不在这里写死「顶点 → 索引」
    // 的换算公式（那是实现细节，随几何索引化方式变）。
    expect(
      published,
      '末帧发布的 drawRange 必须与同步 paint() 的一致',
    ).toBe(referenceLines.geometry.drawRange.count);

    harness.viewport.dispose();
  });

  /**
   * 计划 §11.5 风险 4：`step()` 里 `job.advance()` 抛异常时，旧的实现会让
   * `paintFrameId` 停在 null 而 `painting` 停在 true——此后 `render()` 永远
   * 早退、`renderOverlay` 每帧重抛，尺寸层冻结在抛出前的画面且没有任何
   * 自愈路径。
   *
   * 契约：异常不穿出帧回调（宿主 rAF 每帧抛会让整个 viewer 停摆），状态机
   * 复位到「没有作业」并请求重绘；之后任何一次失效都能正常产出新几何。
   */
  it('recovers the paint state machine when a paint batch throws', () => {
    const records = Array.from({ length: 12 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, index * 0.5, 0]),
    }));

    const harness = createViewport();
    const painter = (harness.viewport as any)
      .scenePainter as ThreeSceneDimensionPainter;
    const boom = new Error('advance boom');
    const job: SceneDimensionPaintJob = {
      remaining: () => 1,
      advance: vi.fn(() => { throw boom; }),
      finish: vi.fn(),
      cancel: vi.fn(),
    };
    const paintSpy = vi.spyOn(painter, 'paintAsync').mockReturnValue(job);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument(records));
      // Layout frame: startBatchedPaint picks up the throwing job and queues step.
      harness.flush(1);
      expect(harness.callbacks.length).toBeGreaterThan(0);

      // The step's advance() throws: the exception must not escape the frame
      // callback, and the state machine must unwind instead of wedging.
      expect(() => harness.flush(1)).not.toThrow();

      expect(job.advance).toHaveBeenCalledTimes(1);
      expect(job.cancel).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls.flat()).toContain(boom);
      expect(harness.requestRender).toHaveBeenCalled();
      // The dead job registered no further paint frame and holds no state.
      expect((harness.viewport as any).paintFrameId).toBeNull();
      expect((harness.viewport as any).pendingPaint).toBeNull();

      // With the real painter back, a fresh invalidation must produce
      // geometry again — proof painting fell back to false.
      paintSpy.mockRestore();
      harness.viewport.setDocument(emptyDimensionDocument(records));
      harness.flush();

      const geometry = (
        harness.scene.getObjectByName('dimension-scene-lines') as any
      ).geometry as { drawRange: { count: number } };
      expect(geometry.drawRange.count).toBeGreaterThan(0);
    } finally {
      errorSpy.mockRestore();
      paintSpy.mockRestore();
    }
  });

  /**
   * 计划 §11.5 风险 6：旧作业的 `step` 回调被 `cancelFrame` 取消后仍可能
   * 真的跑到（宿主可能是 rAF + 已入队，harness 的 `cancelFrame` 本来也只
   * 记录不出队）。它若不校验作业身份，会抹掉新作业刚登记的帧 id，并继续
   * 推进旧作业的写入——两个 job 交错写同一块顶点缓冲，乱序直接上屏。
   *
   * 契约：旧回调跑进来必须是 no-op；末态顶点与「只跑第二次布局」逐位
   * 相同，发布面（`drawRange`）也必须一致。钉的是「新旧作业不交错」，
   * 不钉批大小或帧数。
   */
  it('does not let a superseded paint job callback touch the new job', () => {
    // 两份文档记录数不同（9 vs 12），两个作业的批次切点错开：交错写入时
    // 旧作业的顶点会落在新作业发布区间内部，末态逐位比较才看得到污染。
    const makeRecords = (x: number, count: number) => Array.from(
      { length: count },
      (_, index) => linearRecord({
        id: `linear-${index + 1}`,
        b: exactAnchor([x, index * 0.5, 0]),
      }),
    );
    const frames: DimensionFrameBreakdown[] = [];
    // 同上报用例：预算压到 1 段/帧，保证旧作业与新作业都跨帧。
    const harness = createViewport((_durationMs, breakdown) => {
      frames.push(breakdown);
    }, 1);
    const painter = (harness.viewport as any)
      .scenePainter as ThreeSceneDimensionPainter;
    const paintSpy = vi.spyOn(painter, 'paintAsync');

    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument(makeRecords(1, 9)));
    harness.flush(1); // layout A done; step_A queued, paint still in flight.

    const jobA = paintSpy.mock.results[0]!.value as SceneDimensionPaintJob;
    const cancelA = vi.spyOn(jobA, 'cancel');
    expect(harness.callbacks).toHaveLength(1);

    // 构造风险 6 的现场：新布局的 render() 走到 startBatchedPaint 时旧作业
    // 还在飞。分帧期间 render() 会早退，所以这里先把 painting 拨回 false，
    // 等价于「旧帧还没取消干净、新布局已经开始」的窗口。
    (harness.viewport as any).painting = false;
    harness.viewport.setDocument(emptyDimensionDocument(makeRecords(2, 12)));

    // step_A 此时仍是当前作业的合法回调：正常推进一批并重新登记自己。
    harness.flush(1);
    // scheduler-B: layout B → startBatchedPaint 顶替旧作业 → step_B 入队。
    harness.flush(1);

    const jobB = paintSpy.mock.results[1]!.value as SceneDimensionPaintJob;
    // 顶替旧作业时必须把它本身作废，而不只是取消它的帧回调。
    expect(cancelA).toHaveBeenCalled();

    // Queue: [step_A(stale), step_B]. 让已作废的回调在新作业开写之后才跑
    // ——交换两者顺序，等价于宿主把旧回调排到了新帧之后；此时它若还能写，
    // 顶点就会叠进新作业已写过的区间。
    harness.callbacks.unshift(harness.callbacks.pop()!);
    harness.flush(1); // step_B: writes job B's first batch, re-queues.
    harness.flush(1); // step_A(stale): must be a no-op.
    expect((harness.viewport as any).pendingPaint?.job).toBe(jobB);
    expect((harness.viewport as any).painting).toBe(true);

    // Drain: only step_B may write and publish, and only once.
    harness.flush();
    expect(frames.filter(frame => frame.kind === 'layout')).toHaveLength(1);

    // Final vertices must be bitwise identical to a fresh synchronous paint
    // of the second document — any interleaving with job A corrupts this.
    const reference = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    reference.resize(400, 400, 2);
    reference.paint(
      harness.viewport.getLayouts(),
      SOLVESPACE_DIMENSION_THEME,
    );
    const referenceLines = reference.group.getObjectByName(
      'dimension-scene-lines',
    ) as any;
    const vertexCount = reference.getStats().lineVertexCount;
    expect(vertexCount).toBeGreaterThan(0);

    const geometry = (
      harness.scene.getObjectByName('dimension-scene-lines') as any
    ).geometry as {
      drawRange: { count: number };
      getAttribute: (name: string) => { array: Float32Array };
    };
    expect(
      Array.from(geometry.getAttribute('position').array.slice(0, vertexCount * 3)),
    ).toEqual(
      Array.from(
        referenceLines.geometry.getAttribute('position').array.slice(
          0,
          vertexCount * 3,
        ),
      ),
    );
    expect(geometry.drawRange.count).toBe(
      referenceLines.geometry.drawRange.count,
    );
  });

  /**
   * 计划 §11.5 风险 4 的另一半：`painting === true` 但 `pendingPaint ===
   * null`（作业刚被新布局取消）时，`renderOverlay` → `finishBatchedPaintNow`
   * 不能只复位 `painting` 就 return——攒下的 `deferredReasons` 会永久丢失，
   * 也没人替这一帧请求重绘。
   *
   * 契约：即使没有作业要补完，也要重放失效原因并发出一次重绘请求。
   */
  it('still requests a render when the overlay draws in a painting state without a job', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();

    const rendersSoFar = harness.requestRender.mock.calls.length;
    const framesSoFar = harness.callbacks.length;

    // 直接构造半状态：painting 仍 true，作业已经清掉，还攒了一条失效原因。
    (harness.viewport as any).painting = true;
    (harness.viewport as any).pendingPaint = null;
    (harness.viewport as any).deferredReasons.add('theme');

    const camera = new PerspectiveCamera();
    const renderer = { autoClear: true, clearDepth: vi.fn(), render: vi.fn() };
    harness.viewport.renderOverlay(renderer as never, camera);

    expect(renderer.render).toHaveBeenCalledTimes(1);
    // 没有作业要补完也要请求一次重绘，并把攒下的原因重新排进 scheduler。
    expect(harness.requestRender.mock.calls.length).toBeGreaterThan(rendersSoFar);
    expect(harness.callbacks.length).toBeGreaterThan(framesSoFar);

    // 回放的原因排到一个真实帧：跑完不再卡住，且再次请求重绘。
    harness.flush();
    expect(harness.requestRender.mock.calls.length).toBeGreaterThan(
      rendersSoFar + 1,
    );
  });

  /**
   * §11.17：批大小必须按**段数**预算算，不能按记录数。
   *
   * 真实数据里 19 206 条记录的段数从 0 到 371 不等（98 % 来自字形 run），所以
   * 「一批 N 条记录」的成本能相差三个数量级。这里用同一份 20 条记录的文档，
   * 只改预算，验证批数随预算变——若实现偷偷回到 `ceil(n/3)`，两条断言会同时
   * 落到「批数固定为 3」，第二条必红。
   */
  it('sizes batches by the segment budget, not by the record count', () => {
    const records = Array.from({ length: 20 }, (_, index) => linearRecord({
      id: `linear-${index + 1}`,
      b: exactAnchor([1, (index % 4) * 0.5, 0]),
    }));

    /** 跑完一次全量布局，数它用了几个 paint 帧。 */
    const paintFramesFor = (segmentBudgetPerFrame: number): number => {
      const harness = createViewport(undefined, segmentBudgetPerFrame);
      harness.viewport.setProjector(createTestProjector());
      harness.viewport.setDocument(emptyDimensionDocument(records));
      // 第一帧是 layout，之后才是 paint。
      harness.flush(1);
      let paintFrames = 0;
      while (harness.callbacks.length > 0 && paintFrames < 1024) {
        harness.flush(1);
        paintFrames += 1;
      }
      return paintFrames;
    };

    const tight = paintFramesFor(1);
    const loose = paintFramesFor(1_000_000);

    // 预算够大：一次写完，只有一个 paint 帧。
    expect(loose).toBe(1);
    // 预算压到 1 段/帧：必然要很多帧。下界取 10 而不是 20——字形段数取决于
    // 每条记录实际画了几个字符，不该把那个数字抄进断言。
    expect(tight).toBeGreaterThanOrEqual(10);
    // 两条一起看：批数确实随预算变，不是固定切三份。
    expect(tight).toBeGreaterThan(loose);
  });
});

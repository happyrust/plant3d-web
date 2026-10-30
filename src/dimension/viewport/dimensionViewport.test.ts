import { describe, expect, it, vi } from 'vitest';

import { PerspectiveCamera } from 'three';

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

import type { DimensionFrameBreakdown } from './dimensionViewport';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

vi.mock('../kernel/viewport/layoutViewport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kernel/viewport/layoutViewport')>();
  return {
    ...actual,
    layoutViewport: vi.fn(actual.layoutViewport),
  };
});
function createViewport(
  onFrame?: (durationMs: number, breakdown: DimensionFrameBreakdown) => void,
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
    const layout = harness.viewport.getLayouts()[0];
    const region = layout.hitRegions[0];
    const point = region.kind === 'segment'
      ? region.from
      : [region.rect.x, region.rect.y] as const;

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
    const harness = createViewport((_durationMs, breakdown) => {
      frames.push(breakdown);
    });
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
});

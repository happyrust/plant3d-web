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

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

vi.mock('../kernel/viewport/layoutViewport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kernel/viewport/layoutViewport')>();
  return {
    ...actual,
    layoutViewport: vi.fn(actual.layoutViewport),
  };
});
function createViewport() {
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

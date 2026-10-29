import {
  Matrix4,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';

import type {
  ExplicitLayoutInput,
  LayoutResult,
  NormalizedDimensionInput,
} from '@/dimension/kernel/types';
import type { SceneDimensionPaintProfile } from '@/dimension/viewport/scenePainter';

import { DEFAULT_DIMENSION_FORMAT } from '@/dimension/kernel/format';
import { buildHitIndex, type HitIndex } from '@/dimension/kernel/hit/hitIndex';
import { SOLVESPACE_DIMENSION_THEME } from '@/dimension/kernel/theme';
import { layoutViewport } from '@/dimension/kernel/viewport/layoutViewport';
import { loadDimensionFont } from '@/dimension/viewport/loadDimensionFont';
import { ThreeSceneDimensionPainter } from '@/dimension/viewport/scenePainter';
import { ThreeViewportProjector } from '@/dimension/viewport/threeViewportProjector';

type PerfResult = {
  loaded: number;
  visible: number;
  external: number;
  samples: number;
  updateP50Ms: number;
  updateP95Ms: number;
  layoutP95Ms: number;
  paintP95Ms: number;
  hitP95Ms: number;
  observedFps: number;
  sceneObjectCount: number;
};

/** `settle(passes)` 的读数：连续几次全量布局 + 绘制，各自的分位（W4-1 基线）。 */
type SettleResult = {
  passes: number;
  layoutP50Ms: number;
  layoutP95Ms: number;
  paintP50Ms: number;
  paintP95Ms: number;
};

/** `paintProfile(passes)` 的读数：paint 内部四段的分位（W5-5 诊断）。 */
type PaintProfileResult = {
  passes: number;
  segmentCount: number;
  segmentsByKind: Readonly<Record<string, number>>;
  countMs: { p50: number; p95: number };
  writeMs: { p50: number; p95: number };
  trianglesMs: { p50: number; p95: number };
  fillsMs: { p50: number; p95: number };
};

declare global {
  interface Window {
    __dimensionPerf?: {
      ready: boolean;
      run(): Promise<PerfResult>;
      settle(passes?: number): SettleResult;
      /**
       * W5-5 诊断：连续 settle 若干次，收集每次 paint 内部的四段分解，返回
       * 各段的分位。用来决定分帧该切哪一刀，不改渲染行为。
       */
      paintProfile(passes?: number): PaintProfileResult;
    };
    __dimensionPerfError?: string;
  }
}

const LOADED = 10_000;
/** 用户尺寸 + 外部图元合计 2000 条同屏可见（ADR 0040 预算口径）。 */
const VISIBLE_USER = 1_500;
const VISIBLE_EXTERNAL = 500;
const VISIBLE = VISIBLE_USER + VISIBLE_EXTERNAL;

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function userInputs(): readonly NormalizedDimensionInput[] {
  return Array.from({ length: VISIBLE_USER }, (_, index) => {
    const column = index % 50;
    const row = Math.floor(index / 50);
    const x = column * 0.18 - 4.5;
    const y = 2.6 - row * 0.13;
    return {
      id: `perf-${index}`,
      kind: 'linear',
      role: 'normal',
      labelPinned: false,
      a: [x, y, 0],
      b: [x + 0.12, y, 0],
      placement: { offsetM: 0.025, labelT: 0.5, side: 1 },
    };
  });
}

/**
 * External MBD-style annotation primitives: weld markers, full-circle arcs
 * and multi-line labels take the scene path/marker/vector-glyph code paths.
 */
function externalInputs(): readonly ExplicitLayoutInput[] {
  return Array.from({ length: VISIBLE_EXTERNAL }, (_, index) => {
    const column = index % 50;
    const row = Math.floor(index / 50);
    const x = column * 0.18 - 4.5;
    const y = -0.4 - row * 0.13;
    const id = `perf-external-${index}`;
    const variant = index % 3;
    return {
      id,
      role: 'external',
      labelPinned: true,
      formattedLabel: variant === 2 ? `W${index}` : '',
      lines: [],
      labelAnchor: [x, y, 0],
      arrowLines: [],
      ...(variant === 0
        ? {
          arcs: [{
            center: [x, y, 0] as const,
            normal: [0, 0, 1] as const,
            radiusM: 0.04,
          }],
        }
        : {}),
      ...(variant === 1
        ? {
          markers: [
            {
              at: [x, y, 0] as const,
              shape: 'circle' as const,
              radiusPx: 5,
            },
            {
              at: [x, y, 0] as const,
              shape: 'cross' as const,
              radiusPx: 5,
            },
          ],
        }
        : {}),
      ...(variant === 2
        ? {
          texts: [{
            text: `L${index}`,
            anchor: [x, y, 0] as const,
            stackIndex: 1,
          }],
        }
        : {}),
    };
  });
}

async function nextFrame(): Promise<void> {
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>(
    '#dimension-perf-canvas',
  );
  if (!canvas) throw new Error('Dimension performance canvas is missing');

  const font = await loadDimensionFont();
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(rect.width, rect.height, false);
  renderer.setClearColor(0xf3f4f6, 1);

  const scene = new Scene();
  const halfWidth = 6.4;
  const halfHeight = halfWidth * (rect.height / rect.width);
  const camera = new OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const designToWorld = new Matrix4();
  const painter = new ThreeSceneDimensionPainter(scene, font);
  painter.resize(rect.width, rect.height);
  painter.setDesignToWorld(designToWorld);
  const inputs = [...userInputs(), ...externalInputs()];
  let layouts: readonly LayoutResult[] = [];
  let hitIndex: HitIndex = buildHitIndex([]);
  /**
   * W5-5 诊断：paint 内部四段的最近一次分解。这个页面本身就是性能探针页，
   * 所以无条件挂上——`scenePainter.paint()` 只在挂了回调时才取时间戳，
   * 生产构建里这个页面不存在（`dimension-perf.html` 只在探针入口引入）。
   *
   * 放在一个持有对象里而不是裸 `let`：赋值发生在回调中，TS 的控制流分析
   * 看不到，裸 `let` 会被窄化成 `null` 再收窄成 `never`。
   */
  const paintProfileSink: {
    current: SceneDimensionPaintProfile | null;
    generation: number;
  } = { current: null, generation: 0 };
  painter.onPaintProfile = (profile) => {
    paintProfileSink.current = profile;
    paintProfileSink.generation += 1;
  };

  const settleLayout = (): Readonly<{
    layoutMs: number;
    paintMs: number;
  }> => {
    const projector = new ThreeViewportProjector({
      camera,
      designToWorld,
      widthCssPx: rect.width,
      heightCssPx: rect.height,
      dpr,
    });
    const layoutStartedAt = performance.now();
    const batch = layoutViewport(inputs, {
      projector,
      font,
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
    }, new Map());
    const layoutCompletedAt = performance.now();
    layouts = batch.layouts;
    hitIndex = batch.hitIndex;
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    const paintCompletedAt = performance.now();
    return {
      layoutMs: layoutCompletedAt - layoutStartedAt,
      paintMs: paintCompletedAt - layoutCompletedAt,
    };
  };

  settleLayout();
  renderer.render(scene, camera);

  window.__dimensionPerf = {
    ready: true,
    async run() {
      const frameDurations: number[] = [];
      const startedAt = performance.now();
      for (let index = 0; index < 60; index += 1) {
        await nextFrame();
        const offset = (index % 10) * 0.001;
        camera.position.set(offset, 0, 10);
        camera.lookAt(offset, 0, 0);
        camera.updateMatrixWorld(true);
        const frameStartedAt = performance.now();
        renderer.render(scene, camera);
        frameDurations.push(performance.now() - frameStartedAt);
      }
      const elapsed = performance.now() - startedAt;

      // Camera motion keeps the last stable hit snapshot and never uploads
      // buffers. One settle pass refreshes projection/collision afterwards.
      const settled = settleLayout();
      renderer.render(scene, camera);

      const hitSamples: number[] = [];
      for (let index = 0; index < 1_000; index += 1) {
        const hitStartedAt = performance.now();
        hitIndex.hitTest(
          [index % Math.max(1, rect.width), index % Math.max(1, rect.height)],
          2,
        );
        hitSamples.push(performance.now() - hitStartedAt);
      }
      return {
        loaded: LOADED,
        visible: VISIBLE,
        external: VISIBLE_EXTERNAL,
        samples: frameDurations.length,
        updateP50Ms: percentile(frameDurations, 0.5),
        updateP95Ms: percentile(frameDurations, 0.95),
        layoutP95Ms: settled.layoutMs,
        paintP95Ms: settled.paintMs,
        hitP95Ms: percentile(hitSamples, 0.95),
        observedFps: (60 * 1_000) / elapsed,
        sceneObjectCount: painter.getStats().sceneObjectCount,
      };
    },
    // `run()` 只落一次布局，给不出 layout / paint 的分位；基线要分位时连续落几次。
    settle(passes = 20) {
      if (!Number.isInteger(passes) || passes <= 0) {
        throw new RangeError(`passes must be a positive integer, got ${passes}`);
      }
      const layoutSamples: number[] = [];
      const paintSamples: number[] = [];
      for (let index = 0; index < passes; index += 1) {
        const settled = settleLayout();
        layoutSamples.push(settled.layoutMs);
        paintSamples.push(settled.paintMs);
      }
      renderer.render(scene, camera);
      return {
        passes,
        layoutP50Ms: percentile(layoutSamples, 0.5),
        layoutP95Ms: percentile(layoutSamples, 0.95),
        paintP50Ms: percentile(paintSamples, 0.5),
        paintP95Ms: percentile(paintSamples, 0.95),
      };
    },
    // W5-5 诊断：只读，不改渲染。四段之和应当接近 `settle` 的 `paintMs`。
    paintProfile(passes = 20) {
      if (!Number.isInteger(passes) || passes <= 0) {
        throw new RangeError(`passes must be a positive integer, got ${passes}`);
      }
      const countSamples: number[] = [];
      const writeSamples: number[] = [];
      const triangleSamples: number[] = [];
      const fillSamples: number[] = [];
      let segmentCount = 0;
      let segmentsByKind: Readonly<Record<string, number>> = {};
      for (let index = 0; index < passes; index += 1) {
        // 计数而不是先置 `current = null`：对 `current` 赋 null 会让 TS 把
        // 它窄化成 `null`，之后 `if (!profile) throw` 再窄化成 `never`。
        const generation = paintProfileSink.generation;
        settleLayout();
        if (paintProfileSink.generation === generation) {
          throw new Error('paint profile was not reported: onPaintProfile is not wired');
        }
        const profile = paintProfileSink.current;
        if (!profile) {
          throw new Error('paint profile was not reported: onPaintProfile is not wired');
        }
        countSamples.push(profile.countMs);
        writeSamples.push(profile.writeMs);
        triangleSamples.push(profile.trianglesMs);
        fillSamples.push(profile.fillsMs);
        segmentCount = profile.segmentCount;
        segmentsByKind = profile.segmentsByKind;
      }
      renderer.render(scene, camera);
      const span = (samples: readonly number[]) => ({
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
      });
      return {
        passes,
        segmentCount,
        segmentsByKind,
        countMs: span(countSamples),
        writeMs: span(writeSamples),
        trianglesMs: span(triangleSamples),
        fillsMs: span(fillSamples),
      };
    },
  };

  window.addEventListener('beforeunload', () => {
    painter.dispose();
    renderer.dispose();
  }, { once: true });
}

void main().catch((error) => {
  window.__dimensionPerfError = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
});

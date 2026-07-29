import {
  Matrix4,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';

import { DEFAULT_DIMENSION_FORMAT } from '@/dimension/kernel/format';
import { buildHitIndex, type HitIndex } from '@/dimension/kernel/hit/hitIndex';
import { SOLVESPACE_DIMENSION_THEME } from '@/dimension/kernel/theme';
import { layoutViewport } from '@/dimension/kernel/viewport/layoutViewport';
import { loadDimensionFont } from '@/dimension/viewport/loadDimensionFont';
import { ThreeSceneDimensionPainter } from '@/dimension/viewport/scenePainter';
import { ThreeViewportProjector } from '@/dimension/viewport/threeViewportProjector';

import type {
  ExplicitLayoutInput,
  LayoutResult,
  NormalizedDimensionInput,
} from '@/dimension/kernel/types';

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

declare global {
  interface Window {
    __dimensionPerf?: {
      ready: boolean;
      run(): Promise<PerfResult>;
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

import type { UserDimensionRecord } from '@/dimension/domain/types';
import type { ViewportProjector } from '@/dimension/kernel/projector';

import { createEmptyDimensionDocument } from '@/dimension/domain/document';
import { DEFAULT_DIMENSION_FORMAT } from '@/dimension/kernel/format';
import { SOLVESPACE_DIMENSION_THEME } from '@/dimension/kernel/theme';
import { DimensionViewport } from '@/dimension/viewport/dimensionViewport';
import { loadDimensionFont } from '@/dimension/viewport/loadDimensionFont';

type PerfResult = {
  loaded: number;
  visible: number;
  samples: number;
  updateP50Ms: number;
  updateP95Ms: number;
  layoutP95Ms: number;
  paintP95Ms: number;
  hitP95Ms: number;
  observedFps: number;
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
const VISIBLE = 2_000;

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function records(): readonly UserDimensionRecord[] {
  return Array.from({ length: VISIBLE }, (_, index) => {
    const column = index % 50;
    const row = Math.floor(index / 50);
    const x = column * 0.18 - 4.5;
    const y = 2.6 - row * 0.13;
    return {
      id: `perf-${index}`,
      kind: 'linear',
      a: { snapshot: [x, y, 0], accuracy: 'exact' },
      b: { snapshot: [x + 0.12, y, 0], accuracy: 'exact' },
      placement: { offsetM: 0.025, labelT: 0.5, side: 1 },
      authorId: 'perf',
      authorRole: 'designer',
      createdAt: 1,
      updatedAt: 1,
      validity: 'valid',
    };
  });
}

function projector(
  widthCssPx: number,
  heightCssPx: number,
  dpr: number,
  cameraOffset: number,
): ViewportProjector {
  const scale = 150;
  return {
    widthCssPx,
    heightCssPx,
    dpr,
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
    project(point) {
      return {
        x: widthCssPx / 2 + (point[0] + cameraOffset) * scale,
        y: heightCssPx / 2 - point[1] * scale,
        depth: point[2],
      };
    },
    unproject(point) {
      return [
        (point.x - widthCssPx / 2) / scale - cameraOffset,
        (heightCssPx / 2 - point.y) / scale,
        point.depth,
      ];
    },
    worldPerPixelAt() {
      return 1 / scale;
    },
  };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#dimension-perf-canvas');
  if (!canvas) throw new Error('Dimension performance canvas is missing');
  const font = await loadDimensionFont();
  const frameDurations: number[] = [];
  const layoutDurations: number[] = [];
  const paintDurations: number[] = [];
  let frameResolved: (() => void) | null = null;
  const viewport = new DimensionViewport({
    canvas,
    font,
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    onFrame(durationMs, breakdown) {
      frameDurations.push(durationMs);
      layoutDurations.push(breakdown.layoutMs);
      paintDurations.push(breakdown.paintMs);
      frameResolved?.();
      frameResolved = null;
    },
  });
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viewport.setDocument({
    ...createEmptyDimensionDocument({ documentId: 'dimension-perf' }),
    records: records(),
  });

  const renderAt = (offset: number) => new Promise<void>((resolve) => {
    frameResolved = resolve;
    viewport.setProjector(projector(rect.width, rect.height, dpr, offset));
  });
  await renderAt(0);
  frameDurations.length = 0;
  layoutDurations.length = 0;
  paintDurations.length = 0;

  window.__dimensionPerf = {
    ready: true,
    async run() {
      const startedAt = performance.now();
      for (let index = 0; index < 60; index += 1) {
        await renderAt((index % 10) * 0.001);
      }
      const elapsed = performance.now() - startedAt;
      const hitSamples: number[] = [];
      for (let index = 0; index < 1_000; index += 1) {
        const hitStartedAt = performance.now();
        viewport.hitTest(
          [index % Math.max(1, rect.width), index % Math.max(1, rect.height)],
          2,
        );
        hitSamples.push(performance.now() - hitStartedAt);
      }
      return {
        loaded: LOADED,
        visible: VISIBLE,
        samples: frameDurations.length,
        updateP50Ms: percentile(frameDurations, 0.5),
        updateP95Ms: percentile(frameDurations, 0.95),
        layoutP95Ms: percentile(layoutDurations, 0.95),
        paintP95Ms: percentile(paintDurations, 0.95),
        hitP95Ms: percentile(hitSamples, 0.95),
        observedFps: (60 * 1_000) / elapsed,
      };
    },
  };
}

void main().catch((error) => {
  window.__dimensionPerfError = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
});

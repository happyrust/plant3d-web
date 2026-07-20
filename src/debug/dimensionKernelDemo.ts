import type { UserDimensionRecord, Vec3 } from '@/dimension/domain/types';
import type { ViewportProjector } from '@/dimension/kernel/projector';
import type { InteractionState, LayoutResult } from '@/dimension/kernel/types';

import { createEmptyDimensionDocument } from '@/dimension/domain/document';
import { layoutResultsToSvg } from '@/dimension/export/svgOverlay';
import { DEFAULT_DIMENSION_FORMAT } from '@/dimension/kernel/format';
import { SOLVESPACE_DIMENSION_THEME } from '@/dimension/kernel/theme';
import { DimensionViewport } from '@/dimension/viewport/dimensionViewport';
import { loadDimensionFont } from '@/dimension/viewport/loadDimensionFont';

declare global {
  interface Window {
    __dimensionDemoError?: string;
    __dimensionDemo?: {
      ready: boolean;
      getLayouts(): readonly LayoutResult[];
      setState(id: string, state: InteractionState): void;
      exportSvg(): string;
      capturePngSize(): Promise<number>;
      getCanvasSize(): { cssWidth: number; cssHeight: number; width: number; height: number; dpr: number };
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#dimension-demo-canvas');
if (!canvas) throw new Error('Dimension demo canvas is missing');

function exact(snapshot: Vec3) {
  return { snapshot, accuracy: 'exact' as const };
}

const records: readonly UserDimensionRecord[] = [
  {
    id: 'demo-linear',
    kind: 'linear',
    a: exact([-2.5, 1.4, 0]),
    b: exact([-0.5, 1.4, 0]),
    placement: { offsetM: 0.35, labelT: 0.5, side: 1 },
    authorId: 'demo',
    authorRole: 'designer',
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid',
  },
  {
    id: 'demo-projected',
    kind: 'projected',
    a: { snapshot: [0.2, 1.5, 0], accuracy: 'approximate' },
    b: exact([2.4, 0.8, 0]),
    axis: { kind: 'design-axis', axis: 'x' },
    placement: { offsetM: 0.4, labelT: 0.5, side: 1 },
    authorId: 'demo',
    authorRole: 'designer',
    createdAt: 2,
    updatedAt: 2,
    validity: 'valid',
  },
  {
    id: 'demo-angular',
    kind: 'angular',
    vertex: exact([-1.8, -1.1, 0]),
    rayA: exact([-0.7, -1.1, 0]),
    rayB: exact([-1.8, 0, 0]),
    placement: { radiusM: 0.65, labelT: 0.5, arcChoice: 'minor' },
    authorId: 'demo',
    authorRole: 'designer',
    createdAt: 3,
    updatedAt: 3,
    validity: 'valid',
  },
  {
    id: 'demo-radial',
    kind: 'radial',
    center: exact([1.1, -1.1, 0]),
    rim: exact([1.8, -1.1, 0]),
    normal: { kind: 'design-axis', axis: 'z' },
    display: 'diameter',
    placement: { leaderDirection: [1, 0.7, 0], labelDistanceM: 0.55 },
    authorId: 'demo',
    authorRole: 'designer',
    createdAt: 4,
    updatedAt: 4,
    validity: 'invalid',
  },
];

function createProjector(widthCssPx: number, heightCssPx: number, dpr: number): ViewportProjector {
  const scale = Math.min(widthCssPx / 7, heightCssPx / 5);
  return {
    widthCssPx,
    heightCssPx,
    dpr,
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
    project(point) {
      return {
        x: widthCssPx / 2 + point[0] * scale,
        y: heightCssPx / 2 - point[1] * scale,
        depth: point[2],
      };
    },
    unproject(point) {
      return [
        (point.x - widthCssPx / 2) / scale,
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
  const font = await loadDimensionFont();
  const viewport = new DimensionViewport({
    canvas,
    font,
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
  });
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viewport.setProjector(createProjector(rect.width, rect.height, dpr));
  viewport.setDocument({
    ...createEmptyDimensionDocument({ documentId: 'dimension-kernel-demo' }),
    records,
  });

  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

  window.__dimensionDemo = {
    ready: true,
    getLayouts: () => viewport.getLayouts(),
    setState(id, state) {
      viewport.setHover(state === 'hovered' ? id : null);
      viewport.setSelection(state === 'selected' ? id : null);
    },
    exportSvg: () => layoutResultsToSvg(
      viewport.getLayouts(),
      font,
      SOLVESPACE_DIMENSION_THEME,
      {
        formatPolicy: DEFAULT_DIMENSION_FORMAT,
        viewport: { widthCssPx: rect.width, heightCssPx: rect.height, dpr },
        exportedAt: 0,
      },
    ),
    capturePngSize: () => new Promise((resolve) => {
      canvas.toBlob(blob => resolve(blob?.size ?? 0), 'image/png');
    }),
    getCanvasSize: () => ({
      cssWidth: rect.width,
      cssHeight: rect.height,
      width: canvas.width,
      height: canvas.height,
      dpr,
    }),
  };

}

void main().catch((error) => {
  window.__dimensionDemoError = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  console.error('[dimension-demo] initialization failed', error);
});

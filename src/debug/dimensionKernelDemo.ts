import {
  Matrix4,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';

import type {
  ExplicitLayoutInput,
  InteractionState,
  LayoutResult,
  NormalizedDimensionInput,
} from '@/dimension/kernel/types';

import { layoutGridAnnotations } from '@/dimension/adapters/gridAnnotations';
import { layoutResultsToSvg } from '@/dimension/export/svgOverlay';
import { DEFAULT_DIMENSION_FORMAT } from '@/dimension/kernel/format';
import { SOLVESPACE_DIMENSION_THEME } from '@/dimension/kernel/theme';
import { layoutViewport } from '@/dimension/kernel/viewport/layoutViewport';
import { loadDimensionFont } from '@/dimension/viewport/loadDimensionFont';
import { ThreeSceneDimensionPainter } from '@/dimension/viewport/scenePainter';
import { ThreeViewportProjector } from '@/dimension/viewport/threeViewportProjector';

declare global {
  interface Window {
    __dimensionDemoError?: string;
    __dimensionDemo?: {
      ready: boolean;
      getLayouts(): readonly LayoutResult[];
      setState(id: string, state: InteractionState): void;
      exportSvg(): string;
      capturePngSize(): Promise<number>;
      getCanvasSize(): {
        cssWidth: number;
        cssHeight: number;
        width: number;
        height: number;
        dpr: number;
      };
      getSceneObjectCount(): number;
      setLengthUnit(unit: 'mm' | 'in' | 'ft'): string | null;
    };
  }
}

// 抽成函数返回非空类型：模块级 const 的窄化不会带入 main() 的函数体，
// 而 main() 里对 canvas 的读写原本就依赖「模块加载时已抛过不存在」这一事实。
function requireDemoCanvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(
    '#dimension-demo-canvas',
  );
  if (!element) throw new Error('Dimension demo canvas is missing');
  return element;
}

const canvas = requireDemoCanvas();

const inputs: readonly (
  | NormalizedDimensionInput
  | ExplicitLayoutInput
)[] = [
  {
    id: 'demo-linear',
    kind: 'linear',
    role: 'normal',
    labelPinned: false,
    a: [-2.5, 1.4, 0],
    b: [-0.5, 1.4, 0],
    placement: { offsetM: 0.35, labelT: 0.5, side: 1 },
  },
  {
    id: 'demo-projected',
    kind: 'projected',
    role: 'approximate',
    labelPinned: false,
    a: [0.2, 1.5, 0],
    b: [2.4, 0.8, 0],
    axis: [1, 0, 0],
    placement: { offsetM: 0.4, labelT: 0.5, side: 1 },
  },
  {
    id: 'demo-angular',
    kind: 'angular',
    role: 'normal',
    labelPinned: false,
    vertex: [-1.8, -1.1, 0],
    rayA: [-0.7, -1.1, 0],
    rayB: [-1.8, 0, 0],
    placement: { radiusM: 0.65, labelT: 0.5, arcChoice: 'minor' },
  },
  {
    id: 'demo-radial',
    kind: 'radial',
    role: 'invalid',
    labelPinned: false,
    center: [1.1, -1.1, 0],
    rim: [1.8, -1.1, 0],
    normal: [0, 0, 1],
    display: 'diameter',
    placement: {
      leaderDirection: [1, 0.7, 0],
      labelDistanceM: 0.55,
    },
  },
  {
    id: 'demo-radial-zero',
    kind: 'radial',
    role: 'normal',
    labelPinned: false,
    center: [2.6, -1.1, 0],
    rim: [2.6, -1.1, 0],
    normal: [0, 0, 1],
    display: 'radius',
    placement: { leaderDirection: [1, 0, 0], labelDistanceM: 0.2 },
  },
  {
    id: 'demo-mbd-explicit',
    role: 'external',
    labelPinned: true,
    formattedLabel: 'BRAN 24381_145018',
    lines: [
      {
        from: [-2.5, -2, 0],
        to: [2.4, -2, 0],
        part: 'dimension',
      },
      {
        from: [-2.5, -1.8, 0],
        to: [-2.5, -2.15, 0],
        part: 'extension',
      },
      {
        from: [2.4, -1.8, 0],
        to: [2.4, -2.15, 0],
        part: 'extension',
      },
    ],
    labelAnchor: [0, -2.25, 0],
    arrowLines: [],
    markers: [
      { at: [-2.5, -2, 0], shape: 'cross', radiusPx: 5 },
      { at: [2.4, -2, 0], shape: 'circle', radiusPx: 5 },
    ],
    arcs: [
      {
        center: [0, -2, 0],
        normal: [0, 0, 1],
        radiusM: 0.2,
        startAngle: 0,
        endAngle: Math.PI,
      },
    ],
    texts: [
      {
        text: 'MBD V2 · scene geometry',
        anchor: [0, -2.5, 0],
        stackIndex: 1,
      },
      {
        text: '中文标注 · 近似值 ±0.5',
        anchor: [0, -1.0, 0],
        stackIndex: 0,
      },
    ],
  },
  // #78：正对相机的 GRIDPL / GRIDCY，经同一套布局和画家画出来。
  ...layoutGridAnnotations([
    {
      id: 'plane',
      noun: 'GRIDPL',
      origin: [0, 2.6, 0],
      axisU: [1.5, 0, 0],
      axisV: [0, 0.4, 0],
    },
    {
      id: 'cyl',
      noun: 'GRIDCY',
      origin: [2.2, 2.4, 0],
      axis: [0, 0, 1],
      radiusM: 0.3,
    },
  ], { forward: [0, 0, -1] }).map(record => record.layout),
  {
    id: 'demo-angular-snap',
    kind: 'angular',
    role: 'normal',
    labelPinned: false,
    vertex: [1.2, 2.3, 0],
    rayA: [2.2, 2.3, 0],
    rayB: [
      1.2 + Math.cos((89.2 * Math.PI) / 180),
      2.3 + Math.sin((89.2 * Math.PI) / 180),
      0,
    ],
    placement: { radiusM: 0.45, labelT: 0.5, arcChoice: 'minor', orthogonalSnap: true },
  },
];

async function main(): Promise<void> {
  const font = await loadDimensionFont();
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(rect.width, rect.height, false);
  renderer.setClearColor(0xf3f4f6, 1);

  const scene = new Scene();
  const halfWidth = 3.6;
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
  const projector = new ThreeViewportProjector({
    camera,
    designToWorld,
    widthCssPx: rect.width,
    heightCssPx: rect.height,
    dpr,
  });
  const painter = new ThreeSceneDimensionPainter(scene, font);
  painter.resize(rect.width, rect.height);
  painter.setDesignToWorld(designToWorld);
  const interactions = new Map<string, InteractionState>();
  let layouts: readonly LayoutResult[] = [];
  let format = DEFAULT_DIMENSION_FORMAT;

  const render = (): void => {
    layouts = layoutViewport(inputs, {
      projector,
      font,
      theme: SOLVESPACE_DIMENSION_THEME,
      format,
    }, interactions).layouts;
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    renderer.render(scene, camera);
  };
  render();

  window.__dimensionDemo = {
    ready: true,
    getLayouts: () => layouts,
    setState(id, state) {
      interactions.clear();
      if (state !== 'normal') interactions.set(id, state);
      render();
    },
    exportSvg: () => layoutResultsToSvg(
      layouts,
      font,
      SOLVESPACE_DIMENSION_THEME,
      {
        formatPolicy: DEFAULT_DIMENSION_FORMAT,
        viewport: { widthCssPx: rect.width, heightCssPx: rect.height, dpr },
        exportedAt: 0,
      },
    ),
    capturePngSize: () => new Promise((resolve) => {
      renderer.render(scene, camera);
      canvas.toBlob(blob => resolve(blob?.size ?? 0), 'image/png');
    }),
    getCanvasSize: () => ({
      cssWidth: rect.width,
      cssHeight: rect.height,
      width: canvas.width,
      height: canvas.height,
      dpr,
    }),
    getSceneObjectCount: () => painter.getStats().sceneObjectCount,
    setLengthUnit(unit) {
      format = { ...DEFAULT_DIMENSION_FORMAT, lengthUnit: unit };
      render();
      return layouts.find(layout => layout.dimensionId === 'demo-linear')?.derived.formattedLabel ?? null;
    },
  };

  window.addEventListener('beforeunload', () => {
    painter.dispose();
    renderer.dispose();
  }, { once: true });
}

void main().catch((error) => {
  window.__dimensionDemoError = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  console.error('[dimension-demo] initialization failed', error);
});

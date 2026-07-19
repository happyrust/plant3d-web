import { readFileSync } from 'node:fs';
import { cpus, arch, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';

import {
  buildHitIndex,
  DEFAULT_DIMENSION_FORMAT,
  layoutDimension,
  LffFont,
  resolveLabelCollisions,
  SOLVESPACE_DIMENSION_THEME,
  type LayoutContext,
  type LayoutResult,
  type NormalizedDimensionInput,
  type Vec3,
  type ViewportProjector,
} from '../../../src/dimension/kernel/index';

const LOADED_DIMENSIONS = 10_000;
const VISIBLE_DIMENSIONS = 2_000;
const WARMUP_RUNS = 50;
const MEASURED_RUNS = 200;
const LAYOUT_P95_LIMIT_MS = 16;
const HIT_P95_LIMIT_MS = 2;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const projector: ViewportProjector = {
  widthCssPx: 1920,
  heightCssPx: 1080,
  dpr: 2,
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
  project(point) {
    return { x: 960 + point[0] * 100, y: 540 - point[1] * 100, depth: point[2] };
  },
  unproject(point) {
    return [(point.x - 960) / 100, (540 - point.y) / 100, point.depth];
  },
  worldPerPixelAt() {
    return 0.01;
  },
};

function worldAtScreen(x: number, y: number): Vec3 {
  return projector.unproject({ x, y, depth: 0 });
}

function generateInputs(): readonly NormalizedDimensionInput[] {
  const random = seededRandom(42);
  return Array.from({ length: VISIBLE_DIMENSIONS }, (_, index) => {
    const column = index % 50;
    const row = Math.floor(index / 50);
    const x = 24 + column * 38 + (random() - 0.5) * 2;
    const y = 22 + row * 26 + (random() - 0.5) * 2;
    const center = worldAtScreen(x, y);
    const id = `dimension-${index.toString().padStart(4, '0')}`;
    const common = {
      id,
      role: index % 97 === 0 ? ('approximate' as const) : ('normal' as const),
      labelPinned: index % 41 === 0,
    };
    const kind = index % 20;

    if (kind === 0) {
      return {
        ...common,
        kind: 'angular' as const,
        vertex: center,
        rayA: [center[0] + 0.2, center[1], 0] as Vec3,
        rayB: [center[0], center[1] + 0.2, 0] as Vec3,
        placement: {
          radiusM: 0.15,
          labelT: 0.5,
          arcChoice: index % 40 === 0 ? ('major' as const) : ('minor' as const),
        },
      };
    }
    if (kind <= 3) {
      const radiusM = 0.05;
      const labelDistanceM = 0.05;
      const radialCenter: Vec3 = [center[0] - radiusM - labelDistanceM, center[1], 0];
      return {
        ...common,
        kind: 'radial' as const,
        center: radialCenter,
        rim: [radialCenter[0] + radiusM, radialCenter[1], 0] as Vec3,
        normal: [0, 0, 1] as Vec3,
        display: kind % 2 === 0 ? ('diameter' as const) : ('radius' as const),
        placement: { leaderDirection: [1, 0, 0] as Vec3, labelDistanceM },
      };
    }
    if (kind <= 7) {
      return {
        ...common,
        kind: 'projected' as const,
        a: [center[0] - 0.05, center[1] - 0.03, 0] as Vec3,
        b: [center[0] + 0.05, center[1] + 0.03, 0] as Vec3,
        axis: [1, 0, 0] as Vec3,
        placement: { offsetM: 0, labelT: 0.5, side: 1 as const },
      };
    }
    return {
      ...common,
      kind: 'linear' as const,
      a: [center[0] - 0.05, center[1], 0] as Vec3,
      b: [center[0] + 0.05, center[1], 0] as Vec3,
      placement: { offsetM: 0, labelT: 0.5, side: 1 as const },
    };
  });
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentileValue) - 1];
}

const compressedFont = readFileSync(
  new URL('../../../public/fonts/unicode.lff.gz', import.meta.url),
);
const font = LffFont.fromText(gunzipSync(compressedFont).toString('utf8'));
const inputs = generateInputs();
const context: LayoutContext = {
  projector,
  font,
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
  interaction: 'normal',
};

function layoutAndResolve(): readonly LayoutResult[] {
  return resolveLabelCollisions(inputs.map((input) => layoutDimension(input, context)));
}

let lastLayouts: readonly LayoutResult[] = [];
for (let index = 0; index < WARMUP_RUNS; index += 1) {
  lastLayouts = layoutAndResolve();
}

if (process.env.DIMENSION_BENCH_DIAGNOSTICS === '1') {
  const layoutDiagnostics: number[] = [];
  const collisionDiagnostics: number[] = [];
  let sampleRaw: readonly LayoutResult[] = [];
  let sampleResolved: readonly LayoutResult[] = [];
  for (let index = 0; index < 20; index += 1) {
    const layoutStartedAt = performance.now();
    const raw = inputs.map((input) => layoutDimension(input, context));
    layoutDiagnostics.push(performance.now() - layoutStartedAt);
    const collisionStartedAt = performance.now();
    const resolved = resolveLabelCollisions(raw);
    collisionDiagnostics.push(performance.now() - collisionStartedAt);
    sampleRaw = raw;
    sampleResolved = resolved;
  }
  const movement = sampleResolved.map((result, index) => ({
    dx: result.labelBounds.x - sampleRaw[index].labelBounds.x,
    dy: result.labelBounds.y - sampleRaw[index].labelBounds.y,
  }));
  const moved = movement.filter(({ dx, dy }) => dx !== 0 || dy !== 0);
  console.log(
    `diagnostics layout-p50=${percentile(layoutDiagnostics, 0.5).toFixed(3)}ms ` +
      `collision-p50=${percentile(collisionDiagnostics, 0.5).toFixed(3)}ms ` +
      `moved=${moved.length} max-offset=${Math.max(
        0,
        ...moved.map(({ dx, dy }) => Math.max(Math.abs(dx), Math.abs(dy))),
      )}px`,
  );
}

const layoutSamples: number[] = [];
let checksum = 0;
for (let index = 0; index < MEASURED_RUNS; index += 1) {
  const startedAt = performance.now();
  lastLayouts = layoutAndResolve();
  layoutSamples.push(performance.now() - startedAt);
  checksum += lastLayouts[index % lastLayouts.length].primitives.length;
}

const hitIndex = buildHitIndex(lastLayouts);
const hitSamples: number[] = [];
for (let index = 0; index < MEASURED_RUNS; index += 1) {
  const layout = lastLayouts[(index * 17) % lastLayouts.length];
  const point = [
    layout.labelBounds.x + layout.labelBounds.width / 2,
    layout.labelBounds.y + layout.labelBounds.height / 2,
  ] as const;
  const startedAt = performance.now();
  const target = hitIndex.hitTest(point, 2);
  hitSamples.push(performance.now() - startedAt);
  checksum += target ? target.dimensionId.length : 0;
}

const layoutP50 = percentile(layoutSamples, 0.5);
const layoutP95 = percentile(layoutSamples, 0.95);
const hitP50 = percentile(hitSamples, 0.5);
const hitP95 = percentile(hitSamples, 0.95);
const cpu = cpus()[0]?.model ?? 'unknown CPU';

console.log(
  [
    'Dimension kernel benchmark',
    `machine=${platform()} ${arch()} cpu="${cpu}" node=${process.version}`,
    `budget loaded=${LOADED_DIMENSIONS} visible=${VISIBLE_DIMENSIONS} viewport=1920x1080 dpr=2 seed=42`,
    `runs warmup=${WARMUP_RUNS} measured=${MEASURED_RUNS} checksum=${checksum}`,
    `layout+collision p50=${layoutP50.toFixed(3)}ms p95=${layoutP95.toFixed(3)}ms limit=${LAYOUT_P95_LIMIT_MS}ms`,
    `hit-test p50=${hitP50.toFixed(3)}ms p95=${hitP95.toFixed(3)}ms limit=${HIT_P95_LIMIT_MS}ms`,
  ].join('\n'),
);

if (layoutP95 > LAYOUT_P95_LIMIT_MS || hitP95 > HIT_P95_LIMIT_MS) {
  console.error('Dimension kernel benchmark exceeded its ADR 0040 performance budget.');
  process.exitCode = 1;
}

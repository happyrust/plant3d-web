import { describe, expect, it, vi } from 'vitest';

import { Color, Group, LessDepth, Matrix4, ShaderMaterial, SRGBColorSpace } from 'three';

import {
  sceneFill,
  sceneGlyph,
  sceneGlyphInFrame,
  sceneMarker,
} from '../kernel/geometry/sceneGeometry';
import { createTestFont } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import {
  fitsWithin,
  hintedLineStrokeWidthPx,
  hintedTextStrokeWidthPx,
  srgbComponents,
  ThreeSceneDimensionPainter,
} from './scenePainter';

/** The on-screen (sRGB-encoded) components the painter writes for a theme colour. */
function srgb(hex: string): Color {
  return new Color(hex).getRGB(new Color(), SRGBColorSpace) as Color;
}

import type { LayoutResult, ScenePrimitive, SceneVertex } from '../kernel/types';

function layout(
  id: string,
  scenePrimitives: readonly ScenePrimitive[],
): LayoutResult {
  return {
    dimensionId: id,
    scenePrimitives,
    primitives: [],
    hitRegions: [],
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned: false,
    derived: {
      formattedLabel: id,
      valueM: 1,
    },
  };
}

/**
 * A `LayoutResult` whose `scenePrimitives` disagree between the count pass
 * and every later pass: the count sees a two-point path (1 segment), the
 * rest see 17 points (16 segments). `LayoutResult` is plain data, so a
 * getter is the only way to reproduce an under-budgeted
 * `countPrimitiveSegments` inside one synchronous `paint()` — exactly the
 * hazard `writeLineVertices`'s bounds check exists for. The count pass runs
 * first in both `paint()` and `paintAsync()`, so `accesses === 1` is it.
 */
function miscountedLayout(id: string): LayoutResult {
  const vertex = (x: number): SceneVertex => ({
    anchor: [x, 0, 0],
    offsetPx: [0, 0],
  });
  const path = (pointCount: number): ScenePrimitive => ({
    kind: 'scene-path',
    points: Array.from({ length: pointCount }, (_, index) => vertex(index)),
    closed: false,
    part: 'dimension',
    styleRole: 'normal',
  });
  let accesses = 0;
  return {
    ...layout(id, []),
    get scenePrimitives() {
      accesses += 1;
      return [path(accesses === 1 ? 2 : 17)];
    },
  };
}

/**
 * Every vertex attribute of one of the painter's meshes, as plain arrays, so
 * two painters can be compared bit for bit (W5-5 分帧等价性).
 */
function snapshotAttributes(
  painter: ThreeSceneDimensionPainter,
  meshName: string,
): Record<string, number[]> {
  const mesh = painter.group.getObjectByName(meshName) as any;
  const geometry = mesh.geometry;
  const snapshot: Record<string, number[]> = {};
  for (const name of Object.keys(geometry.attributes)) {
    snapshot[name] = Array.from(geometry.getAttribute(name).array as Float32Array);
  }
  return snapshot;
}

/**
 * How many vertices a mesh actually draws, i.e. what `finish()` publishes.
 * Reading `position.length` would only give the buffer's capacity, which
 * `ensureCapacity` sizes ahead of the write (W5-5 分帧).
 */
function publishedVertexCount(
  painter: ThreeSceneDimensionPainter,
  meshName: string,
): number {
  const mesh = painter.group.getObjectByName(meshName) as any;
  const { count, start } = mesh.geometry.drawRange;
  return count === Infinity ? 0 : count + start;
}

const primitives: readonly ScenePrimitive[] = [
  {
    kind: 'scene-line',
    from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
    to: { anchor: [1, 0, 0], offsetPx: [0, -20] },
    part: 'dimension',
    styleRole: 'normal',
  },
  {
    kind: 'scene-path',
    points: [
      { anchor: [0, 0, 0], offsetPx: [0, 0] },
      { anchor: [0, 1, 0], offsetPx: [5, 0] },
      { anchor: [1, 1, 0], offsetPx: [5, 5] },
    ],
    closed: false,
    part: 'leader',
    styleRole: 'external-reference',
  },
  {
    kind: 'scene-triangle',
    points: [
      { anchor: [1, 0, 0], offsetPx: [0, -20] },
      { anchor: [1, 0, 0], offsetPx: [-10, -17] },
      { anchor: [1, 0, 0], offsetPx: [-10, -23] },
    ],
    part: 'arrow',
    styleRole: 'normal',
  },
  sceneGlyph(
    'A',
    { anchor: [0.5, 0, 0], offsetPx: [0, -28] },
    12,
    'normal',
    Math.PI / 4,
  ),
  sceneMarker(
    { anchor: [0, 1, 0], offsetPx: [0, 0] },
    'cross',
    4,
    'normal',
  ),
];

describe('ThreeSceneDimensionPainter', () => {
  it('keeps a constant four draw objects for 100 and 2000 dimensions', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);

    painter.paint(
      Array.from({ length: 100 }, (_, index) =>
        layout(`dimension-${index}`, primitives)),
      SOLVESPACE_DIMENSION_THEME,
    );
    const small = painter.getStats();

    painter.paint(
      Array.from({ length: 2_000 }, (_, index) =>
        layout(`dimension-${index}`, primitives)),
      SOLVESPACE_DIMENSION_THEME,
    );
    const large = painter.getStats();

    // Stroke cores, stroke edges, filled arrowheads, filled tag bodies.
    expect(small.sceneObjectCount).toBe(4);
    expect(large.sceneObjectCount).toBe(small.sceneObjectCount);
    expect(large.lineVertexCount).toBe(small.lineVertexCount * 20);
    expect(large.triangleVertexCount).toBe(
      small.triangleVertexCount * 20,
    );
    expect(large.fillVertexCount).toBe(small.fillVertexCount * 20);
  });

  /**
   * W5-5 诊断：`onPaintProfile` 只在宿主挂上去时才取时间戳，且它报的四段
   * 之和覆盖整次 paint（`layout` 侧已单独计时，这里只看 paint 内部）。
   * 这里钉的是「挂上去能拿到数、不挂就一次都不回调、各段非负、段数与几何
   * 一致」，不是性能数字——数字随机器变，不能进单测。
   */
  it('reports a per-phase paint profile only when a host asks for one', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    const layouts = Array.from({ length: 50 }, (_, index) =>
      layout(`dimension-${index}`, primitives));

    const profiles: unknown[] = [];
    const observe = vi.fn((profile: unknown) => profiles.push(profile));
    painter.onPaintProfile = observe;
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    expect(observe).toHaveBeenCalledTimes(1);

    // Unsubscribed again: the timestamps are no longer taken, so no report.
    painter.onPaintProfile = undefined;
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    expect(observe).toHaveBeenCalledTimes(1);

    const profile = profiles[0] as Record<string, number>;
    // The count pass and the write pass visit the same primitives, so the
    // reported segment total is what the geometry actually has.
    expect(profile.segmentCount).toBeGreaterThan(0);
    for (const key of ['countMs', 'writeMs', 'trianglesMs', 'fillsMs']) {
      expect(profile[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(profile[key])).toBe(true);
    }
  });

  /**
   * W5-5 分帧：`paintAsync` 只是把线写入拆成多批，几何必须与同步 `paint()`
   * 逐位相同——这是分帧唯一可以接受的正确性标准。同时钉住「`finish()` 之前
   * 不发布」与「`cancel()` 不破坏已发布几何」。
   */
  it('batches the same vertices as the synchronous paint, publishing only on finish', () => {
    const layouts = Array.from({ length: 40 }, (_, index) =>
      layout(`dimension-${index}`, primitives));

    const synchronous = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    synchronous.resize(800, 600);
    synchronous.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    const expectedLines = snapshotAttributes(synchronous, 'dimension-scene-lines');
    const expectedTriangles = snapshotAttributes(synchronous, 'dimension-scene-arrows');
    const expectedFills = snapshotAttributes(synchronous, 'dimension-scene-fills');
    const expectedStats = synchronous.getStats();

    const batched = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    batched.resize(800, 600);
    const job = batched.paintAsync(layouts, SOLVESPACE_DIMENSION_THEME);
    expect(job.remaining()).toBe(40);

    // Before any batch: the buffer exists but draws nothing.
    expect(publishedVertexCount(batched, 'dimension-scene-lines')).toBe(0);

    // Advance in awkward batch sizes, including a size that does not divide 40.
    let done = false;
    let advances = 0;
    while (!done) {
      done = job.advance(7);
      advances += 1;
      if (!done) {
        // Mid-job the buffer must still draw nothing.
        expect(publishedVertexCount(batched, 'dimension-scene-lines')).toBe(0);
      }
    }
    expect(advances).toBe(6); // ceil(40 / 7)
    // Still nothing drawn until finish().
    expect(publishedVertexCount(batched, 'dimension-scene-lines')).toBe(0);

    job.finish();

    expect(batched.getStats()).toEqual(expectedStats);
    expect(snapshotAttributes(batched, 'dimension-scene-lines')).toEqual(expectedLines);
    expect(snapshotAttributes(batched, 'dimension-scene-arrows')).toEqual(expectedTriangles);
    expect(snapshotAttributes(batched, 'dimension-scene-fills')).toEqual(expectedFills);
  });

  it('leaves the published geometry untouched when a batched paint is cancelled', () => {
    const layouts = Array.from({ length: 20 }, (_, index) =>
      layout(`dimension-${index}`, primitives));

    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    const publishedLines = snapshotAttributes(painter, 'dimension-scene-lines');
    const publishedStats = painter.getStats();

    const job = painter.paintAsync(layouts, SOLVESPACE_DIMENSION_THEME);
    job.advance(5);
    job.cancel();
    job.finish();

    // The cancelled job never published: stats and vertex bytes keep the
    // last good frame, while `paintAsync`'s opening `clear()` already
    // blanked the line `drawRange` — cancel leaves the layer invisible,
    // not corrupt.
    expect(publishedVertexCount(painter, 'dimension-scene-lines')).toBe(0);
    expect(painter.getStats()).toEqual(publishedStats);
    expect(snapshotAttributes(painter, 'dimension-scene-lines')).toEqual(publishedLines);
  });

  it('fans a scene fill into the fills mesh under the strokes, in the tag tone colour', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    // A five-vertex tag body: three triangles.
    const body = sceneFill(
      [[0, 0], [10, 0], [12, 5], [10, 10], [0, 10]].map(
        ([x, y]) => ({ anchor: [1, 2, 3] as const, offsetPx: [x!, y!] as const }),
      ),
      'tag',
      'external',
      'tag-fill',
    );
    painter.paint([layout('tag', [body, ...primitives])], SOLVESPACE_DIMENSION_THEME);

    const fills = painter.group.getObjectByName('dimension-scene-fills') as any;
    const lines = painter.group.getObjectByName('dimension-scene-lines') as any;
    expect(fills.renderOrder).toBeLessThan(lines.renderOrder);
    expect(painter.getStats().fillVertexCount).toBe(3 * 3);
    // Fan: every triangle starts at the first outline vertex.
    const offsets = Array.from(fills.geometry.getAttribute('offsetPx').array.slice(0, 18)) as number[];
    expect(offsets.slice(0, 2)).toEqual([0, 0]);
    expect(offsets.slice(6, 8)).toEqual([0, 0]);
    expect(offsets.slice(12, 14)).toEqual([0, 0]);
    expect(offsets.slice(14, 18)).toEqual([10, 10, 0, 10]);
    expect(Array.from(fills.geometry.getAttribute('position').array.slice(0, 3))).toEqual([1, 2, 3]);
    const color = Array.from(fills.geometry.getAttribute('batchColor').array.slice(0, 3)) as number[];
    const expected = srgb(SOLVESPACE_DIMENSION_THEME.tag.fillColor);
    expect(color[0]).toBeCloseTo(expected.r, 5);
    expect(color[1]).toBeCloseTo(expected.g, 5);
    expect(color[2]).toBeCloseTo(expected.b, 5);
    // The fill adds no stroke quads.
    const reference = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    reference.resize(800, 600);
    reference.paint([layout('plain', primitives)], SOLVESPACE_DIMENSION_THEME);
    expect(painter.getStats().lineVertexCount).toBe(reference.getStats().lineVertexCount);
  });

  it('stores design anchors separately from CSS-pixel offsets', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    painter.paint([layout('one', primitives)], SOLVESPACE_DIMENSION_THEME);

    const lines = painter.group.children[0]!;
    const geometry = (lines as any).geometry;
    // First segment expands to a 4-vertex quad: two vertices per endpoint.
    expect(Array.from(geometry.getAttribute('position').array.slice(0, 12)))
      .toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect(Array.from(geometry.getAttribute('offsetPx').array.slice(0, 8)))
      .toEqual([0, 0, 0, 0, 0, -20, 0, -20]);
    expect(Array.from(geometry.getAttribute('side').array.slice(0, 4)))
      .toEqual([-1, 1, 1, -1]);
    // The dimension line is hinted to whole device pixels, at least two: 1.2 px is 2 on a 1× display.
    expect(Array.from(
      geometry.getAttribute('strokeWidthPx').array.slice(0, 4),
    )).toEqual(Array(4).fill(2));
    expect(geometry.index).not.toBeNull();

    const material = (lines as any).material as ShaderMaterial;
    expect(material.vertexShader).toContain('clip.xy += clipOffset * clip.w');
  });

  it('shades strokes as feathered capsules in a core pass and an edge pass over one geometry', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600, 2);
    painter.paint([layout('one', primitives)], SOLVESPACE_DIMENSION_THEME);

    const cores = painter.group.getObjectByName('dimension-scene-lines') as any;
    const edges = painter.group.getObjectByName('dimension-scene-line-edges') as any;
    const arrows = painter.group.getObjectByName('dimension-scene-arrows') as any;
    expect(edges.geometry).toBe(cores.geometry);
    // Cores first, then every edge (tested against all cores), arrowheads on top.
    expect(edges.renderOrder).toBe(cores.renderOrder + 1);
    expect(arrows.renderOrder).toBeGreaterThan(edges.renderOrder);

    // Both passes write the overlay's constant near-plane depth and test
    // with LESS: a stroke always passes against the model, cores dedupe
    // against each other, edges never paint over a core and dedupe too.
    const core = cores.material as ShaderMaterial;
    const edge = edges.material as ShaderMaterial;
    for (const material of [core, edge]) {
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(true);
      expect(material.depthFunc).toBe(LessDepth);
      expect(material.fragmentShader).toContain('gl_FragDepthEXT = vStrokeLayer > 0.5 ? 0.00002 : 0.00001');
      expect(material.fragmentShader).toContain('float overshootPx = max(max(-capsule.x, capsule.x - segmentLengthPx), 0.0)');
    }
    expect(core.uniforms.uPass!.value).toBe(0);
    expect(core.transparent).toBe(false);
    expect(edge.uniforms.uPass!.value).toBe(1);
    expect(edge.transparent).toBe(true);
    // The edge ramp is one device pixel: half a CSS px on a 2× display, shared by both passes.
    expect(core.uniforms.uFeatherPx!.value).toBe(0.5);
    expect(edge.uniforms.uFeatherPx).toBe(core.uniforms.uFeatherPx);
    painter.resize(800, 600);
    expect(core.uniforms.uFeatherPx!.value).toBe(1);

    // Ordinary strokes sit on layer 0; only the 3D-text halo goes to layer 1.
    const layers = Array.from(cores.geometry.getAttribute('strokeLayer').array.slice(0, painter.getStats().lineVertexCount)) as number[];
    expect(layers.every(layer => layer === 0)).toBe(true);
    const frame = { origin: [1, 2, 3] as const, xAxis: [0.2, 0, 0] as const, yAxis: [0, 0, 0.2] as const };
    painter.paint([layout('framed', [sceneGlyphInFrame('A', frame, 13, 0, 'external')])], SOLVESPACE_DIMENSION_THEME);
    const framedLayers = Array.from(cores.geometry.getAttribute('strokeLayer').array.slice(0, 16)) as number[];
    expect(framedLayers.slice(0, 8)).toEqual(Array(8).fill(1));
    expect(framedLayers.slice(8)).toEqual(Array(8).fill(0));
  });

  it('draws framed (3D) text as design-space strokes under a halo pass', () => {
    const parent = new Group();
    const font = createTestFont();
    const painter = new ThreeSceneDimensionPainter(parent, font);
    painter.resize(800, 600);
    // Test-font 'A': two strokes (0,0)→(1,10)→(2,0) over cap height 10, centred on the baseline.
    const frame = { origin: [1, 2, 3] as const, xAxis: [0.2, 0, 0] as const, yAxis: [0, 0, 0.2] as const };
    painter.paint(
      [layout('framed', [sceneGlyphInFrame('A', frame, 13, 0, 'external')])],
      SOLVESPACE_DIMENSION_THEME,
    );

    const lines = painter.group.children[0] as any;
    const vertexCount = painter.getStats().lineVertexCount;
    // Two strokes × two passes (halo, text) × 4 quad vertices.
    expect(vertexCount).toBe(2 * 2 * 4);
    const widths = Array.from(lines.geometry.getAttribute('strokeWidthPx').array.slice(0, vertexCount)) as number[];
    const rules = SOLVESPACE_DIMENSION_THEME.dimension3d;
    expect(widths.slice(0, 8).every(width => width === Math.fround(rules.textStrokeWidthPx + 2 * rules.textHaloWidthPx))).toBe(true);
    expect(widths.slice(8).every(width => width === Math.fround(rules.textStrokeWidthPx))).toBe(true);
    // Halo in the halo color, glyphs in the external text color.
    const colors = Array.from(lines.geometry.getAttribute('batchColor').array.slice(0, vertexCount * 3)) as number[];
    const halo = srgb(rules.textHaloColor);
    const text = srgb(SOLVESPACE_DIMENSION_THEME.textColors.external!);
    expect(colors[0]).toBeCloseTo(halo.r, 5);
    expect(colors[8 * 3]).toBeCloseTo(text.r, 5);
    expect(colors[8 * 3 + 1]).toBeCloseTo(text.g, 5);
    // Framed text is not hinted: its stems are not axis-aligned on screen.
    const snaps = Array.from(lines.geometry.getAttribute('pixelSnap').array.slice(0, vertexCount)) as number[];
    expect(snaps.every(snap => snap === 0)).toBe(true);
    // Every vertex anchors in Design Space with no pixel offset: the run's
    // first stroke starts at origin − w/2·xAxis (glyph x = 0, y = 0).
    const offsets = Array.from(lines.geometry.getAttribute('offsetPx').array.slice(0, vertexCount * 2)) as number[];
    expect(offsets.every(value => value === 0)).toBe(true);
    const position = Array.from(lines.geometry.getAttribute('position').array.slice(0, 3)) as number[];
    const halfWidth = font.getWidth(1, 'A') / 2;
    expect(position[0]).toBeCloseTo(1 - halfWidth * 0.2, 5);
    expect(position[1]).toBeCloseTo(2, 5);
    expect(position[2]).toBeCloseTo(3, 5);
    // The stroke's far end (quad vertices 2–3 of the text pass) is one cap
    // height up the frame's yAxis (glyph y = 10 = cap height).
    const tip = Array.from(lines.geometry.getAttribute('position').array.slice(10 * 3, 10 * 3 + 3)) as number[];
    expect(tip[2]).toBeCloseTo(3 + 0.2, 5);
  });

  it('gives glyph strokes the hinted text stroke width and label text color', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    const glyph = sceneGlyph(
      'A',
      { anchor: [0.5, 0, 0], offsetPx: [0, -28] },
      12,
      'normal',
      0,
    );
    painter.paint([layout('text-only', [glyph])], SOLVESPACE_DIMENSION_THEME);

    const lines = painter.group.children[0] as any;
    const vertexCount = painter.getStats().lineVertexCount;
    const widths = () => Array.from(
      lines.geometry.getAttribute('strokeWidthPx').array.slice(0, vertexCount),
    ) as number[];
    expect(vertexCount).toBeGreaterThan(0);
    // Screen-space text is hinted to whole device pixels (ADR 0064): the
    // theme's 1.8 px is 2 device px on a 1× display …
    expect(widths().every(width => width === Math.fround(2))).toBe(true);
    const snaps = Array.from(lines.geometry.getAttribute('pixelSnap').array.slice(0, vertexCount)) as number[];
    expect(snaps.every(snap => snap === 1)).toBe(true);
    // … and 4 device px = 2 CSS px on a 2× one; the shader gets the ratio.
    painter.resize(800, 600, 2);
    painter.paint([layout('text-only', [glyph])], SOLVESPACE_DIMENSION_THEME);
    expect(widths().every(width => width === Math.fround(2))).toBe(true);
    expect(((lines as any).material as ShaderMaterial).uniforms.uPixelRatio!.value).toBe(2);
    expect(((lines as any).material as ShaderMaterial).vertexShader).toContain('float snapStem(float devicePx, float widthDevicePx)');

    // 普通角色标签文字使用 textColors.normal (#111827)，而非尺寸品红；写进
    // 缓冲的是 sRGB 编码分量（叠层直接画进 sRGB 画布，ADR 0064）。
    const color = Array.from(
      lines.geometry.getAttribute('batchColor').array.slice(0, 3),
    ) as number[];
    const expected = srgb(SOLVESPACE_DIMENSION_THEME.textColors.normal!);
    expect(color[0]).toBeCloseTo(expected.r, 5);
    expect(color[1]).toBeCloseTo(expected.g, 5);
    expect(color[2]).toBeCloseTo(expected.b, 5);
    expect(expected.r).toBeCloseTo(0x11 / 255, 5);
    expect(new Color(SOLVESPACE_DIMENSION_THEME.textColors.normal!).r).toBeLessThan(expected.r / 5);
    expect(srgbComponents('#0f172a')).toEqual([15 / 255, 23 / 255, 42 / 255].map(v => expect.closeTo(v, 4)));
  });

  it('hints text stroke widths to whole device pixels, never below two', () => {
    expect(hintedTextStrokeWidthPx(1.8, 1)).toBe(2);
    expect(hintedTextStrokeWidthPx(1.8, 2)).toBe(2);
    expect(hintedTextStrokeWidthPx(1.8, 1.5)).toBe(2);
    expect(hintedTextStrokeWidthPx(1.8, 1.25)).toBe(1.6);
    expect(hintedTextStrokeWidthPx(1.8, 3)).toBeCloseTo(5 / 3, 10);
    expect(hintedTextStrokeWidthPx(0.5, 1)).toBe(2);
    expect(hintedTextStrokeWidthPx(0.5, 2)).toBe(1);
  });

  it('hints dimension stroke widths to whole device pixels, never below two', () => {
    // 1.2 px: two device pixels on a 1× display (the floor — one would have
    // no solid core), two on a 2× one (= 1 CSS px), two at 1.25× (1.6 CSS
    // px) and 1.5× (1.33 CSS px), four at 3×.
    expect(hintedLineStrokeWidthPx(1.2, 1)).toBe(2);
    expect(hintedLineStrokeWidthPx(1.2, 2)).toBe(1);
    expect(hintedLineStrokeWidthPx(1.2, 1.25)).toBe(1.6);
    expect(hintedLineStrokeWidthPx(1.2, 1.5)).toBeCloseTo(4 / 3, 10);
    expect(hintedLineStrokeWidthPx(1.2, 3)).toBeCloseTo(4 / 3, 10);
    // Heavier lines round to the nearest whole pixel like text does.
    expect(hintedLineStrokeWidthPx(2.6, 1)).toBe(3);
    expect(hintedLineStrokeWidthPx(0.3, 2)).toBe(1);
  });

  it('hints dimension lines, leaders, markers and tag strokes like text', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600, 1.5);
    painter.paint([layout('one', primitives)], SOLVESPACE_DIMENSION_THEME);
    const lines = painter.group.children[0] as any;
    const vertexCount = painter.getStats().lineVertexCount;
    const snaps = Array.from(lines.geometry.getAttribute('pixelSnap').array.slice(0, vertexCount)) as number[];
    const widths = Array.from(lines.geometry.getAttribute('strokeWidthPx').array.slice(0, vertexCount)) as number[];
    // Every stroke of the fixture — dimension line, leader path, glyph run
    // 'A', cross marker — is hinted: 1 dimension + 2 leader + 2 glyph + 2
    // marker segments.
    expect(vertexCount).toBe(7 * 4);
    expect(snaps.every(snap => snap === 1)).toBe(true);
    // The first quad is the dimension line: 1.2 px is 2 device px at 1.5×,
    // 1.33 CSS px; the leader path and the marker share that width …
    expect(widths.slice(0, 4).every(width => width === Math.fround(4 / 3))).toBe(true);
    expect(widths.filter(width => width === Math.fround(4 / 3))).toHaveLength(5 * 4);
    // … the glyph run 'A' (two strokes) keeps the text hint: 1.8 px → 3 device px = 2 CSS px.
    expect(widths.filter(width => width === Math.fround(2))).toHaveLength(2 * 4);

    // A tag card border (tone `tag-border`, 1 px) and its leader (0.9 px)
    // are hinted from their own theme widths: both round to 2 device px at
    // 1.5× = 1.33 CSS px, and their axis-aligned edges snap (ADR 0064 补).
    expect(SOLVESPACE_DIMENSION_THEME.tag.borderWidthPx).toBe(1);
    expect(SOLVESPACE_DIMENSION_THEME.tag.leaderWidthPx).toBe(0.9);
    painter.paint([layout('tag', [{
      kind: 'scene-path',
      points: [
        { anchor: [0, 0, 0], offsetPx: [0, 0] },
        { anchor: [0, 0, 0], offsetPx: [40, 0] },
        { anchor: [0, 0, 0], offsetPx: [40, 12] },
      ],
      closed: true,
      part: 'tag',
      styleRole: 'normal',
      tone: 'tag-border',
    }, {
      kind: 'scene-line',
      from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
      to: { anchor: [0, 0, 0], offsetPx: [-30, 25] },
      part: 'leader',
      styleRole: 'normal',
      tone: 'tag-leader',
    }])], SOLVESPACE_DIMENSION_THEME);
    const tagCount = painter.getStats().lineVertexCount;
    expect(tagCount).toBe(4 * 4);
    const tagSnaps = Array.from(lines.geometry.getAttribute('pixelSnap').array.slice(0, tagCount)) as number[];
    const tagWidths = Array.from(lines.geometry.getAttribute('strokeWidthPx').array.slice(0, tagCount)) as number[];
    expect(tagSnaps.every(snap => snap === 1)).toBe(true);
    expect(tagWidths.every(width => width === Math.fround(4 / 3))).toBe(true);
    // At 1× both are the two-device-pixel floor; at 2× the border stays 2
    // device px (1 CSS px) and the leader's 1.8 rounds up to 2 (1 CSS px).
    painter.resize(800, 600, 1);
    painter.paint([layout('tag', [{
      kind: 'scene-line',
      from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
      to: { anchor: [0, 0, 0], offsetPx: [-30, 25] },
      part: 'leader',
      styleRole: 'normal',
      tone: 'tag-leader',
    }])], SOLVESPACE_DIMENSION_THEME);
    expect(Array.from(lines.geometry.getAttribute('strokeWidthPx').array.slice(0, 4))).toEqual([2, 2, 2, 2]);
    expect(hintedLineStrokeWidthPx(1, 2)).toBe(1);
    expect(hintedLineStrokeWidthPx(0.9, 2)).toBe(1);
    expect(hintedLineStrokeWidthPx(0.9, 1.25)).toBe(1.6);
  });

  it('updates only interaction style attributes when topology is unchanged', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    const first = layout('first', primitives);
    const second = layout('second', primitives);
    painter.paint([first, second], SOLVESPACE_DIMENSION_THEME);

    const lines = painter.group.children[0] as any;
    const position = lines.geometry.getAttribute('position');
    const color = lines.geometry.getAttribute('batchColor');
    const positionVersion = position.version;
    const verticesPerLayout = painter.getStats().lineVertexCount / 2;
    const secondColorBefore = Array.from(
      color.array.slice(verticesPerLayout * 3, verticesPerLayout * 3 + 3),
    );
    const selectedFirst = layout(
      'first',
      primitives.map(primitive => ({
        ...primitive,
        styleRole: 'selected',
      })),
    );

    expect(painter.updateStyles(
      [selectedFirst, second],
      SOLVESPACE_DIMENSION_THEME,
      new Set(['first']),
    )).toBe(true);
    expect(position.version).toBe(positionVersion);
    const selectedColor = srgb(SOLVESPACE_DIMENSION_THEME.colors.selected);
    const firstColor = Array.from(color.array.slice(0, 3)) as number[];
    expect(firstColor[0]).toBeCloseTo(selectedColor.r, 5);
    expect(firstColor[1]).toBeCloseTo(selectedColor.g, 5);
    expect(firstColor[2]).toBeCloseTo(selectedColor.b, 5);
    expect(Array.from(
      color.array.slice(verticesPerLayout * 3, verticesPerLayout * 3 + 3),
    )).toEqual(secondColorBefore);
  });

  it('fades occluded records in inspection mode and stays opaque in engineering mode', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    const body = sceneFill(
      [[0, 0], [10, 0], [10, 10]].map(([x, y]) => ({ anchor: [0, 0, 0] as const, offsetPx: [x!, y!] as const })),
      'tag',
      'external',
      'tag-fill',
    );
    const behind: LayoutResult = {
      ...layout('behind', [body, ...primitives]),
      derived: { formattedLabel: 'behind', occluded: true },
    };
    const front: LayoutResult = {
      ...layout('front', [body, ...primitives]),
      derived: { formattedLabel: 'front', occluded: false },
    };
    const { inspection } = SOLVESPACE_DIMENSION_THEME;
    const meshes = () => ({
      lines: painter.group.getObjectByName('dimension-scene-lines') as any,
      arrows: painter.group.getObjectByName('dimension-scene-arrows') as any,
      fills: painter.group.getObjectByName('dimension-scene-fills') as any,
    });
    const alphas = (mesh: any, count: number): number[] =>
      Array.from(mesh.geometry.getAttribute('batchAlpha').array.slice(0, count));
    const distinct = (values: number[]) => [...new Set(values.map(v => Number(v.toFixed(6))))];

    // Engineering (default argument): every vertex alpha 1, materials opaque
    // as before — except the stroke edge pass, whose fragments are partial
    // coverage by definition and always blend.
    painter.paint([behind, front], SOLVESPACE_DIMENSION_THEME);
    const stats = painter.getStats();
    const perLayoutLines = stats.lineVertexCount / 2;
    const perLayoutArrows = stats.triangleVertexCount / 2;
    const perLayoutFills = stats.fillVertexCount / 2;
    expect(distinct(alphas(meshes().lines, stats.lineVertexCount))).toEqual([1]);
    expect(distinct(alphas(meshes().arrows, stats.triangleVertexCount))).toEqual([1]);
    expect(distinct(alphas(meshes().fills, stats.fillVertexCount))).toEqual([1]);
    for (const mesh of Object.values(meshes())) {
      expect((mesh.material as ShaderMaterial).transparent).toBe(false);
    }
    const edges = painter.group.getObjectByName('dimension-scene-line-edges') as any;
    expect((edges.material as ShaderMaterial).transparent).toBe(true);

    // Inspection: the occluded record at the theme's occluded alpha, the
    // visible one at its visible alpha, on every buffer (strokes,
    // arrowheads, tag fills); materials blend.
    painter.paint([behind, front], SOLVESPACE_DIMENSION_THEME, 'inspection');
    const lineAlphas = alphas(meshes().lines, stats.lineVertexCount);
    expect(distinct(lineAlphas.slice(0, perLayoutLines))).toEqual([inspection.occludedAlpha]);
    expect(distinct(lineAlphas.slice(perLayoutLines))).toEqual([inspection.visibleAlpha]);
    const arrowAlphas = alphas(meshes().arrows, stats.triangleVertexCount);
    expect(distinct(arrowAlphas.slice(0, perLayoutArrows))).toEqual([inspection.occludedAlpha]);
    expect(distinct(arrowAlphas.slice(perLayoutArrows))).toEqual([inspection.visibleAlpha]);
    const fillAlphas = alphas(meshes().fills, stats.fillVertexCount);
    expect(distinct(fillAlphas.slice(0, perLayoutFills))).toEqual([inspection.occludedAlpha]);
    expect(distinct(fillAlphas.slice(perLayoutFills))).toEqual([inspection.visibleAlpha]);
    for (const mesh of Object.values(meshes())) {
      expect((mesh.material as ShaderMaterial).transparent).toBe(true);
    }

    // A style-only update rewrites alpha with the colours, so a hover on a
    // faded record keeps its fade.
    const hovered: LayoutResult = {
      ...behind,
      scenePrimitives: behind.scenePrimitives.map(p => ({ ...p, styleRole: 'hovered' })),
    };
    expect(painter.updateStyles([hovered, front], SOLVESPACE_DIMENSION_THEME, new Set(['behind']), 'inspection')).toBe(true);
    expect(distinct(alphas(meshes().lines, perLayoutLines))).toEqual([inspection.occludedAlpha]);

    // Back to engineering: opaque again (the edge pass keeps blending).
    painter.paint([behind, front], SOLVESPACE_DIMENSION_THEME, 'engineering');
    expect(distinct(alphas(meshes().lines, stats.lineVertexCount))).toEqual([1]);
    expect((meshes().lines.material as ShaderMaterial).transparent).toBe(false);
    expect((edges.material as ShaderMaterial).transparent).toBe(true);
  });

  it('keeps glyph strokes solid for roles with dashed line styles', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    painter.paint(
      [layout('reference', [
        sceneGlyph(
          'A',
          { anchor: [0.5, 0, 0], offsetPx: [0, -28] },
          12,
          'external-reference',
          0,
        ),
      ])],
      SOLVESPACE_DIMENSION_THEME,
    );

    const lines = painter.group.children[0] as any;
    const dashCodes = Array.from(
      lines.geometry.getAttribute('dashCode').array.slice(
        0,
        painter.getStats().lineVertexCount,
      ),
    );
    expect(dashCodes.length).toBeGreaterThan(0);
    expect(dashCodes.every(code => code === 0)).toBe(true);
  });

  it('updates the design-to-world matrix, clears, and disposes resources', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    const designToWorld = new Matrix4().makeScale(1000, 1000, 1000);
    painter.resize(640, 480);
    painter.setDesignToWorld(designToWorld);
    painter.paint([layout('one', primitives)], SOLVESPACE_DIMENSION_THEME);

    expect(painter.group.matrix.equals(designToWorld)).toBe(true);
    painter.clear();
    expect(painter.getStats()).toMatchObject({
      lineVertexCount: 0,
      triangleVertexCount: 0,
    });

    const children = [...painter.group.children];
    const disposals = children.flatMap((child) => {
      const geometry = (child as any).geometry;
      const material = (child as any).material;
      const geometryDispose = vi.spyOn(geometry, 'dispose');
      const materialDispose = vi.spyOn(material, 'dispose');
      return [geometryDispose, materialDispose];
    });

    painter.dispose();
    expect(parent.children).not.toContain(painter.group);
    disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
  });

  it('quantizes the screen-glyph cache key so near-identical runs share one entry', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    painter.paint(
      [
        layout('a', [
          sceneGlyph('A', { anchor: [0.5, 0, 0], offsetPx: [0, -28] }, 13, 'normal', 0.5),
        ]),
        layout('b', [
          sceneGlyph('A', { anchor: [0.5, 0, 0], offsetPx: [0, -28] }, 13.004, 'normal', 0.50004),
        ]),
      ],
      SOLVESPACE_DIMENSION_THEME,
    );
    // 13 vs 13.004 share a 0.01 px bucket, 0.5 vs 0.50004 a 1e-4 rad
    // bucket — sub-visible jitter merges into a single entry.
    expect(painter.getGlyphCacheStats().screen).toBe(1);
  });

  it('draws sub-bucket jitter from the shared trace, within half a device pixel', () => {
    // 量化只改变「命中谁的 trace」，不改变可见结果：同桶内共用一个 trace 时
    // 的几何与各自独占时相比必须小于半设备像素；跨桶时必须明显不同。
    // 探针取 offsetPx 属性（屏幕空间顶点偏移），position 恒为 anchor，量不出差异。
    const draw = (runs: readonly { heightPx: number; rotationRad: number }[]) => {
      const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
      painter.resize(800, 600);
      painter.paint(
        runs.map((run, index) =>
          layout(`run-${index}`, [
            sceneGlyph(
              '2640.89',
              { anchor: [0.5, 0, 0], offsetPx: [0, -28] },
              run.heightPx,
              'normal',
              run.rotationRad,
            ),
          ])),
        SOLVESPACE_DIMENSION_THEME,
      );
      const lines = painter.group.getObjectByName('dimension-scene-lines') as any;
      // offsetPx 是每顶点 2 分量；按实际写入顶点数切片，不能用数组长度
      // （缓冲区按容量分配，尾部未写入的零会污染比较）。
      const offsets = lines.geometry.getAttribute('offsetPx').array as Float32Array;
      return {
        offsets,
        used: painter.getStats().lineVertexCount * 2,
        cacheEntries: painter.getGlyphCacheStats().screen,
      };
    };
    const sliceDelta = (a: Float32Array, aStart: number, b: Float32Array, bStart: number, count: number) => {
      let max = 0;
      for (let i = 0; i < count; i += 1) {
        max = Math.max(max, Math.abs((a[aStart + i] ?? 0) - (b[bStart + i] ?? 0)));
      }
      return max;
    };

    const reference = draw([{ heightPx: 13, rotationRad: 0.5 }]);
    const perRun = reference.used;
    // 独占绘制：每条只用自己算出的 trace。
    const alone = (heightPx: number, rotationRad: number) => draw([{ heightPx, rotationRad }]);

    // 探针有效性：0.4 px 的 cap height 差必须被量出来，否则下面的
    // 「小于半设备像素」无从判断。
    const coarseRun = alone(13.4, 0.5);
    expect(sliceDelta(reference.offsets, 0, coarseRun.offsets, 0, perRun)).toBeGreaterThan(0.1);

    // 同桶共享：13 与 13.004 / 0.5 与 0.50004 落在同一量化格，第二条命中
    // 第一条的 trace；与它独占时的差异必须远小于半设备像素（0.5）。
    const shared = draw([
      { heightPx: 13, rotationRad: 0.5 },
      { heightPx: 13.004, rotationRad: 0.50004 },
    ]);
    expect(shared.cacheEntries).toBe(1);
    expect(shared.used).toBe(perRun * 2);
    const ownSecond = alone(13.004, 0.50004);
    expect(ownSecond.used).toBe(perRun);
    expect(
      sliceDelta(shared.offsets, perRun, ownSecond.offsets, 0, perRun),
    ).toBeLessThan(0.01);
  });

  it('keeps screen-glyph cache entries apart across quantization buckets', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    painter.paint(
      [
        layout('a', [
          sceneGlyph('A', { anchor: [0.5, 0, 0], offsetPx: [0, -28] }, 13, 'normal', 0.5),
        ]),
        layout('b', [
          sceneGlyph('A', { anchor: [0.5, 0, 0], offsetPx: [0, -28] }, 13.05, 'normal', 0.5),
        ]),
      ],
      SOLVESPACE_DIMENSION_THEME,
    );
    // 0.05 px apart spans two 0.01 px buckets: real differences still split.
    expect(painter.getGlyphCacheStats().screen).toBe(2);
  });

  it('evicts the oldest screen-glyph cache entries once the cap is reached', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    // 生产默认 SCREEN_GLYPH_CACHE_MAX_ENTRIES = 8 192（~2 000 条记录 × ≤3
    // 个字形 run 的估算取 2 的幂）；测试用小的可配置上限验证机制。
    painter.screenGlyphCacheMaxEntries = 8;
    const layouts = Array.from({ length: 12 }, (_, index) =>
      layout(`glyph-${index}`, [
        sceneGlyph(
          'A',
          { anchor: [0, 0, 0], offsetPx: [0, -28] },
          12 + index * 0.1,
          'normal',
          0,
        ),
      ]));
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    // 12 distinct cap-height buckets inserted into a cap of 8 — the
    // oldest four were evicted, exactly the cap remains.
    expect(painter.getGlyphCacheStats().screen).toBe(8);
  });

  /**
   * 防线 3a：`paintAsync` 起手无条件把线缓冲的 `drawRange` 归零。
   * `ensureCapacity` 只在容量增长时才换上一块 `drawRange` 为零的新几何；
   * 容量不变的常见路径上归零全靠这行 `clear()`。若回退，分帧窗口里
   * `drawRange` 仍指着上一帧发布的索引数，而顶点缓冲正被从头部覆写——
   * 画出来是「新前缀 + 旧尾巴」的混合顶点。
   */
  it('clears the line drawRange when a batched paint starts without capacity growth', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    const layouts = Array.from({ length: 30 }, (_, index) =>
      layout(`dimension-${index}`, primitives));
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    const lines = painter.group.getObjectByName('dimension-scene-lines') as any;
    const expectedCount = (painter.getStats().lineVertexCount / 4) * 6;
    expect(lines.geometry.drawRange.count).toBe(expectedCount);

    // Same layouts → same vertex count → `ensureCapacity` keeps both the
    // geometry object and its `drawRange`, so this exercises the
    // no-growth path the clear exists for.
    const job = painter.paintAsync(layouts, SOLVESPACE_DIMENSION_THEME);
    expect(lines.geometry.drawRange.count).toBe(0);
    job.advance(1);
    expect(lines.geometry.drawRange.count).toBe(0);
    while (!job.advance(4)) { /* drain the rest of the batches */ }
    expect(lines.geometry.drawRange.count).toBe(0);
    job.finish();
    expect(lines.geometry.drawRange.count).toBe(expectedCount);
  });

  /**
   * 防线 5a：空 `scene-path`（`points: []`）在 count 与 visit 两遍里必须
   * 一致——都是 0 段。修复前 count 返回 −1。
   *
   * **探针必须取 count 自己的输出**：只断言 `lineVertexCount` / `drawRange`
   * 是测不出来的——5c 让发布数改用「实际写入数」，于是 count 算成 −1 之后
   * 写入仍是 0 个顶点、发布仍是 0，症状被下游掩盖。唯一直接看得到 count
   * 的地方是 `onPaintProfile` 的 `segmentCount` 与 `segmentsByKind`。
   */
  it('counts an empty scene-path as zero segments, matching the visit pass', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    const profiles: { segmentCount: number; segmentsByKind: Record<string, number> }[] = [];
    painter.onPaintProfile = profile => {
      profiles.push({
        segmentCount: profile.segmentCount,
        segmentsByKind: { ...profile.segmentsByKind },
      });
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      painter.paint(
        [layout('empty', [{
          kind: 'scene-path',
          points: [],
          closed: false,
          part: 'dimension',
          styleRole: 'normal',
        }])],
        SOLVESPACE_DIMENSION_THEME,
      );
      expect(profiles).toHaveLength(1);
      // The count pass itself: 0, never −1.
      expect(profiles[0]!.segmentCount).toBe(0);
      expect(profiles[0]!.segmentsByKind['scene-path']).toBe(0);
      expect(painter.getStats().lineVertexCount).toBe(0);
      expect(publishedVertexCount(painter, 'dimension-scene-lines')).toBe(0);
      // Zero is not a truncation: the bounds guard must stay quiet.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * 防线 5b + 5c（同步路径）：段数算少时 `writeLineVertices` 在容量边界
   * 截断、告警、并且只发布实际写入数。缓冲的 16 顶点下限容纳 16 段里的
   * 前 4 段；`drawRange` 必须盖住且只盖住这 16 个顶点——按预算 4 发布会
   * 把上一帧的旧顶点画出来，按需写 64 则是越界。
   */
  it('truncates a line write at buffer capacity instead of writing past it', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      painter.paint([miscountedLayout('miscounted')], SOLVESPACE_DIMENSION_THEME);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('truncated'),
        expect.objectContaining({ expected: 4, written: 16, layouts: 1 }),
      );
      expect(painter.getStats().lineVertexCount).toBe(16);
      // `quadIndexed`: drawRange 是索引数 = (vertexCount / 4) * 6。
      expect(publishedVertexCount(painter, 'dimension-scene-lines')).toBe(24);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * 防线 5b + 5c（分帧路径）：与上一条同一场景，但走 `paintAsync()`，
   * 确认截断同样只发布实际写入数、统计与 `drawRange` 一致且告警一次。
   */
  it('publishes only the written vertices when a batched paint truncates', () => {
    const painter = new ThreeSceneDimensionPainter(new Group(), createTestFont());
    painter.resize(800, 600);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const job = painter.paintAsync(
        [miscountedLayout('miscounted')],
        SOLVESPACE_DIMENSION_THEME,
      );
      expect(job.advance(1)).toBe(true);
      job.finish();
      const stats = painter.getStats();
      expect(stats.lineVertexCount).toBe(16);
      const lines = painter.group.getObjectByName('dimension-scene-lines') as any;
      // `quadIndexed`: drawRange 是索引数 = (vertexCount / 4) * 6。
      expect(lines.geometry.drawRange.count).toBe((stats.lineVertexCount / 4) * 6);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * 防线 5b 的边界函数：一段的 4 个顶点连续写，段级一次比较足够；
   * 恰好写满是允许的最后位置。
   */
  it('bounds a segment quad write against the line buffer capacity', () => {
    expect(fitsWithin(0, 4, 16)).toBe(true);
    expect(fitsWithin(12, 4, 16)).toBe(true);
    expect(fitsWithin(13, 4, 16)).toBe(false);
    expect(fitsWithin(16, 4, 16)).toBe(false);
  });
});

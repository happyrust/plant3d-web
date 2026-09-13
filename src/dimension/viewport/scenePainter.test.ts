import { describe, expect, it, vi } from 'vitest';

import { Color, Group, LessDepth, Matrix4, ShaderMaterial } from 'three';

import {
  sceneFill,
  sceneGlyph,
  sceneGlyphInFrame,
  sceneMarker,
} from '../kernel/geometry/sceneGeometry';
import { createTestFont } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import { ThreeSceneDimensionPainter } from './scenePainter';

import type { LayoutResult, ScenePrimitive } from '../kernel/types';

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
    const expected = new Color(SOLVESPACE_DIMENSION_THEME.tag.fillColor);
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
    expect(Array.from(
      geometry.getAttribute('strokeWidthPx').array.slice(0, 4),
    )).toEqual(Array(4).fill(Math.fround(1.2)));
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
    const halo = new Color(rules.textHaloColor);
    const text = new Color(SOLVESPACE_DIMENSION_THEME.textColors.external!);
    expect(colors[0]).toBeCloseTo(halo.r, 5);
    expect(colors[8 * 3]).toBeCloseTo(text.r, 5);
    expect(colors[8 * 3 + 1]).toBeCloseTo(text.g, 5);
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

  it('gives glyph strokes the text stroke width and label text color', () => {
    const parent = new Group();
    const painter = new ThreeSceneDimensionPainter(parent, createTestFont());
    painter.resize(800, 600);
    painter.paint(
      [layout('text-only', [
        sceneGlyph(
          'A',
          { anchor: [0.5, 0, 0], offsetPx: [0, -28] },
          12,
          'normal',
          0,
        ),
      ])],
      SOLVESPACE_DIMENSION_THEME,
    );

    const lines = painter.group.children[0] as any;
    const widths = Array.from(
      lines.geometry.getAttribute('strokeWidthPx').array.slice(
        0,
        painter.getStats().lineVertexCount,
      ),
    );
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every(width => width === Math.fround(SOLVESPACE_DIMENSION_THEME.textStrokeWidthPx))).toBe(true);

    // 普通角色标签文字使用 textColors.normal (#111827)，而非尺寸品红。
    const color = Array.from(
      lines.geometry.getAttribute('batchColor').array.slice(0, 3),
    ) as number[];
    const expected = new Color(SOLVESPACE_DIMENSION_THEME.textColors.normal!);
    expect(color[0]).toBeCloseTo(expected.r, 5);
    expect(color[1]).toBeCloseTo(expected.g, 5);
    expect(color[2]).toBeCloseTo(expected.b, 5);
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
    const selectedColor = new Color(SOLVESPACE_DIMENSION_THEME.colors.selected);
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

    // Inspection: the occluded record at 0.35, the visible one at 0.65, on
    // every buffer (strokes, arrowheads, tag fills); materials blend.
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
});

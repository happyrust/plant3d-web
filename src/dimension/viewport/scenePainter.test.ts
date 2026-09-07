import { describe, expect, it, vi } from 'vitest';

import { Color, Group, Matrix4, ShaderMaterial } from 'three';

import { sceneGlyph, sceneMarker } from '../kernel/geometry/sceneGeometry';
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
  it('keeps a constant two draw objects for 100 and 2000 dimensions', () => {
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

    expect(small.sceneObjectCount).toBe(2);
    expect(large.sceneObjectCount).toBe(small.sceneObjectCount);
    expect(large.lineVertexCount).toBe(small.lineVertexCount * 20);
    expect(large.triangleVertexCount).toBe(
      small.triangleVertexCount * 20,
    );
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
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
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
    expect(widths.every(width => width === 1.5)).toBe(true);

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
    expect(Array.from(color.array.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(
      color.array.slice(verticesPerLayout * 3, verticesPerLayout * 3 + 3),
    )).toEqual(secondColorBefore);
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

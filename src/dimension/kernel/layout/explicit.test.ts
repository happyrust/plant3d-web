import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { buildHitIndex } from '../hit/hitIndex';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutExplicit } from './explicit';

import type {
  ExplicitLayoutInput,
  SceneTriangle,
  ScreenGlyphRun,
  ScreenLine,
  ScreenMarker,
  ScreenPath,
} from '../types';
import type { LayoutContext } from './context';

const input: ExplicitLayoutInput = {
  id: 'explicit',
  role: 'external-reference',
  labelPinned: true,
  formattedLabel: '25 REF',
  lines: [{ from: [0, 0, 0], to: [1, 0, 0], part: 'dimension' }],
  labelAnchor: [0.5, 0.2, 0],
  arrowLines: [{ from: [0, 0, 0], to: [0.1, 0.05, 0] }],
};

describe('layoutExplicit', () => {
  it('keeps a clear dimension line whole and adds LFF bounds and hits', () => {
    const projector = createTestProjector();
    const project = vi.spyOn(projector, 'project');
    const context: LayoutContext = {
      projector,
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = roundNumbers(layoutExplicit(input, context));

    // Supplied geometry plus the label box probe that decides whether the
    // dimension line has to be broken.
    expect(project).toHaveBeenCalledTimes(8);
    expect(result.labelPinned).toBe(true);
    expect(result.derived).toEqual({ formattedLabel: '25 REF' });
    expect(result.primitives).toEqual([
      {
        kind: 'line',
        from: [200, 200],
        to: [300, 200],
        part: 'dimension',
        styleRole: 'external-reference',
      },
      {
        kind: 'line',
        from: [200, 200],
        to: [210, 195],
        part: 'arrow',
        styleRole: 'external-reference',
      },
      {
        kind: 'glyph-run',
        text: '25 REF',
        origin: [241.55, 185.85],
        capHeightPx: 13,
        bounds: { x: 241.55, y: 170.25, width: 16.9, height: 19.5 },
        styleRole: 'external-reference',
      },
    ]);
    expect(result.scenePrimitives).toMatchObject([
      {
        kind: 'scene-line',
        from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
        to: { anchor: [1, 0, 0], offsetPx: [0, 0] },
      },
      {
        kind: 'scene-line',
        from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
        to: { anchor: [0.1, 0.05, 0], offsetPx: [0, 0] },
      },
      {
        kind: 'scene-glyph-run',
        at: { anchor: [0.5, 0.2, 0], offsetPx: [0, 0] },
      },
    ]);
    expect(result.hitRegions).toHaveLength(3);
  });

  it('breaks the dimension line around a label anchored on it', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = layoutExplicit(
      { ...input, labelAnchor: [0.5, 0, 0] },
      context,
    );
    const dimensionLines = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'dimension',
    );
    const glyph = result.primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!;

    expect(dimensionLines).toHaveLength(2);
    expect(dimensionLines[0]!.from).toEqual([200, 200]);
    expect(dimensionLines[1]!.to).toEqual([300, 200]);
    expect(dimensionLines[0]!.to[0]).toBeLessThan(glyph.bounds.x);
    expect(dimensionLines[1]!.from[0])
      .toBeGreaterThan(glyph.bounds.x + glyph.bounds.width);
  });

  it('runs text along a design-space direction and trims the rotated box', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const diagonal = layoutExplicit({
      ...input,
      lines: [{ from: [0, 0, 0], to: [1, 1, 0], part: 'dimension' }],
      labelAnchor: [0.5, 0.5, 0],
      labelAlong: [1, 1, 0],
    }, context);
    const horizontal = layoutExplicit({
      ...input,
      lines: [{ from: [0, 0, 0], to: [1, 1, 0], part: 'dimension' }],
      labelAnchor: [0.5, 0.5, 0],
    }, context);

    const rotated = diagonal.primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!;
    expect(rotated.rotationRad).toBeCloseTo(-Math.PI / 4, 6);
    // Both break the line, but the rotated box hugs the run so it cuts less.
    const spanOf = (result: typeof diagonal): number => {
      const parts = result.primitives.filter(
        (primitive): primitive is ScreenLine =>
          primitive.kind === 'line' && primitive.part === 'dimension',
      );
      expect(parts).toHaveLength(2);
      return Math.hypot(
        parts[1]!.from[0] - parts[0]!.to[0],
        parts[1]!.from[1] - parts[0]!.to[1],
      );
    };
    expect(spanOf(diagonal)).toBeLessThan(spanOf(horizontal));
  });

  it('leaves text viewport-horizontal when no direction is declared', () => {
    const result = layoutExplicit(input, {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });
    const glyph = result.primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!;

    expect(glyph.rotationRad).toBeUndefined();
  });

  it('builds screen-scaled filled arrowheads from explicit arrows', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = layoutExplicit({
      ...input,
      arrowLines: [],
      arrows: [
        { tip: [0, 0, 0], towards: [1, 0, 0] },
        { tip: [1, 0, 0], towards: [0, 0, 0], outside: true },
      ],
    }, context);
    const triangles = roundNumbers(
      result.scenePrimitives.filter(
        (primitive) => primitive.kind === 'scene-triangle',
      ),
      3,
    ) as readonly SceneTriangle[];

    expect(triangles).toHaveLength(2);
    expect(triangles[0]!.points[0]!.anchor).toEqual([0, 0, 0]);
    expect(triangles[1]!.points[0]!.anchor).toEqual([1, 0, 0]);
    // `outside` flips the head so both bodies extend the same way on screen.
    for (const triangle of triangles) {
      expect(triangle.points[0]!.offsetPx).toEqual([0, 0]);
      expect(triangle.points[1]!.offsetPx).toEqual([13, 4.224]);
      expect(triangle.points[2]!.offsetPx).toEqual([13, -4.224]);
    }
  });

  it('routes explicit geometry through interaction colors', () => {
    const result = layoutExplicit(input, {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'hovered',
    });

    expect(result.primitives.every((primitive) => primitive.styleRole === 'hovered')).toBe(true);
  });

  it('lays out arcs, markers, and extra texts with bounded hit regions', () => {
    const annotated: ExplicitLayoutInput = {
      id: 'explicit-annotation',
      role: 'external',
      labelPinned: true,
      formattedLabel: 'A',
      lines: [{
        from: [0, 0, 0],
        to: [1, 0, 0],
        part: 'leader',
        style: 'dash-dot',
      }],
      labelAnchor: [0.5, 0.2, 0],
      arrowLines: [],
      arcs: [{ center: [0, 0, 0], normal: [0, 0, 1], radiusM: 0.5 }],
      markers: [
        { at: [0.1, 0, 0], shape: 'cross' },
        { at: [0, 0, 0], shape: 'circle', radiusPx: 6, style: 'dashed' },
      ],
      texts: [{ text: 'h', anchor: [0.5, 0.1, 0] }],
    };
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = layoutExplicit(annotated, context);

    const path = result.primitives.find(
      (primitive): primitive is ScreenPath => primitive.kind === 'path',
    );
    expect(path).toBeDefined();
    expect(path!.part).toBe('arc');
    expect(path!.closed).toBe(true);
    expect(path!.points.length).toBeGreaterThanOrEqual(16);

    const markers = result.primitives.filter(
      (primitive): primitive is ScreenMarker => primitive.kind === 'marker',
    );
    expect(markers).toEqual([
      {
        kind: 'marker',
        at: [210, 200],
        shape: 'cross',
        radiusPx: 4,
        part: 'marker',
        styleRole: 'external',
      },
      {
        kind: 'marker',
        at: [200, 200],
        shape: 'circle',
        radiusPx: 6,
        part: 'marker',
        styleRole: 'external',
        lineStyle: 'dashed',
      },
    ]);

    const line = result.primitives.find(
      (primitive) => primitive.kind === 'line' && primitive.part === 'leader',
    );
    expect(line).toMatchObject({ lineStyle: 'dash-dot' });

    const glyphs = result.primitives.filter(
      (primitive) => primitive.kind === 'glyph-run',
    );
    expect(glyphs.map(glyph => glyph.kind === 'glyph-run' && glyph.text))
      .toEqual(['A', 'h']);

    const pathRegions = result.hitRegions.filter(
      (region) => region.part === 'arc',
    );
    expect(pathRegions.length).toBeGreaterThan(0);
    expect(pathRegions.length).toBeLessThanOrEqual(32);
    expect(result.hitRegions.filter(region => region.part === 'marker'))
      .toHaveLength(2);
    expect(result.hitRegions.filter(region => region.part === 'label'))
      .toHaveLength(2);
    expect(result.scenePrimitives.some(
      primitive => primitive.kind === 'scene-path'
        && primitive.points.every(point => point.offsetPx[0] === 0
          && point.offsetPx[1] === 0),
    )).toBe(true);

    const hitIndex = buildHitIndex([result]);
    expect(hitIndex.hitTest([150, 200], 2)).toMatchObject({
      dimensionId: 'explicit-annotation',
      part: 'arc',
    });
    expect(hitIndex.hitTest([210, 200], 2)).toMatchObject({
      dimensionId: 'explicit-annotation',
      part: 'marker',
    });
  });
});

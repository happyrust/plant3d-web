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
  Vec3,
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

// The fixture wing projects to (10, -5) px = 11.18 px at 100 px/m, which is
// under the 13 px legibility floor, so the layout stretches it about the tip
// by this factor (ADR 0056). Direction is unchanged.
const WING_STRETCH = SOLVESPACE_DIMENSION_THEME.arrowLineMinLengthPx
  / Math.hypot(10, 5);

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
    // dimension line has to be broken, plus both ends of the arrow wing for
    // the legibility-floor check.
    expect(project).toHaveBeenCalledTimes(10);
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
        to: roundNumbers([200 + 10 * WING_STRETCH, 200 - 5 * WING_STRETCH]),
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
        // Stretched wing: the base stays anchored on the tip and carries the
        // floor length as a pixel offset, so it follows the tip at any zoom.
        kind: 'scene-line',
        from: { anchor: [0, 0, 0], offsetPx: [0, 0] },
        to: {
          anchor: [0, 0, 0],
          offsetPx: roundNumbers([10 * WING_STRETCH, -5 * WING_STRETCH]),
        },
      },
      {
        kind: 'scene-glyph-run',
        at: { anchor: [0.5, 0.2, 0], offsetPx: [0, 0] },
      },
    ]);
    expect(result.hitRegions).toHaveLength(3);
  });

  it('draws arrow strokes 1:1 once they project at or above the floor', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = layoutExplicit({
      ...input,
      arrowLines: [
        { from: [0, 0, 0], to: [0.2, 0, 0] },
        { from: [0, 0, 0], to: [0.13, 0, 0] },
      ],
    }, context);
    const arrows = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'arrow',
    );
    const sceneArrows = result.scenePrimitives.filter(
      (primitive) => primitive.kind === 'scene-line' && primitive.part === 'arrow',
    );

    // 20 px and exactly 13 px: both are source geometry, untouched.
    expect(roundNumbers(arrows.map(arrow => arrow.to))).toEqual([[220, 200], [213, 200]]);
    expect(sceneArrows).toMatchObject([
      { to: { anchor: [0.2, 0, 0], offsetPx: [0, 0] } },
      { to: { anchor: [0.13, 0, 0], offsetPx: [0, 0] } },
    ]);
  });

  it('holds short arrow strokes at the floor as the camera pulls away', () => {
    const wingLengthPx = (pixelsPerMetre: number): number => {
      const result = layoutExplicit(input, {
        projector: createTestProjector(pixelsPerMetre),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
        interaction: 'normal',
      });
      const arrow = result.primitives.find(
        (primitive): primitive is ScreenLine =>
          primitive.kind === 'line' && primitive.part === 'arrow',
      )!;
      // The stretched wing keeps the projected direction of the source wing.
      expect((arrow.to[1] - arrow.from[1]) / (arrow.to[0] - arrow.from[0]))
        .toBeCloseTo(-0.5, 9);
      return Math.hypot(arrow.to[0] - arrow.from[0], arrow.to[1] - arrow.from[1]);
    };

    // 11.18 px, 1.12 px and 0.11 px of source geometry all read as 13 px.
    expect(wingLengthPx(100)).toBeCloseTo(13, 9);
    expect(wingLengthPx(10)).toBeCloseTo(13, 9);
    expect(wingLengthPx(1)).toBeCloseTo(13, 9);
  });

  it('scales a source-declared text height with depth and clamps it to the theme range', () => {
    // MBD group cheight 27 mm → 0.027 m in Design Space (S2, 2026-09-12).
    const sourceInput: ExplicitLayoutInput = { ...input, textHeightM: 0.027 };
    const capHeightAt = (pixelsPerMetre: number): number => {
      const result = layoutExplicit(sourceInput, {
        projector: createTestProjector(pixelsPerMetre),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
        interaction: 'normal',
      });
      const glyph = result.primitives.find(
        (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
      )!;
      return glyph.capHeightPx;
    };

    // 2.7 px projected → lifted to the 11 px floor; 13.5 px → as projected;
    // 27 px → capped at 18 px.
    expect(capHeightAt(100)).toBe(SOLVESPACE_DIMENSION_THEME.sourceTextHeightMinPx);
    expect(capHeightAt(500)).toBeCloseTo(13.5, 9);
    expect(capHeightAt(1000)).toBe(SOLVESPACE_DIMENSION_THEME.sourceTextHeightMaxPx);
    // No declared height: the fixed theme height, unchanged by zoom.
    expect(layoutExplicit(input, {
      projector: createTestProjector(1000),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    }).primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!.capHeightPx).toBe(SOLVESPACE_DIMENSION_THEME.textHeightPx);
  });

  it('lets the arrow floor follow a source-declared text height', () => {
    const wingLengthPx = (pixelsPerMetre: number, wing: Vec3): number => {
      const result = layoutExplicit({
        ...input,
        textHeightM: 0.027,
        arrowLines: [{ from: [0, 0, 0], to: wing }],
      }, {
        projector: createTestProjector(pixelsPerMetre),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
        interaction: 'normal',
      });
      const arrow = result.primitives.find(
        (primitive): primitive is ScreenLine =>
          primitive.kind === 'line' && primitive.part === 'arrow',
      )!;
      return Math.hypot(arrow.to[0] - arrow.from[0], arrow.to[1] - arrow.from[1]);
    };

    // Solver wing 0.96·cheight = 25.9 mm: 2.6 px at 100 px/m is lifted to the
    // 11 px label height (not the fixed 13 px floor); 13 px at 500 px/m is
    // under the 13.5 px label height and lifted to it; 25.9 px at 1000 px/m
    // exceeds the 18 px cap and draws 1:1.
    expect(wingLengthPx(100, [0.0259, 0, 0])).toBeCloseTo(11, 9);
    expect(wingLengthPx(500, [0.026, 0, 0])).toBeCloseTo(13.5, 9);
    expect(wingLengthPx(1000, [0.0259, 0, 0])).toBeCloseTo(25.9, 9);
  });

  it('elides secondary inputs while the source text height projects below the floor', () => {
    const secondary: ExplicitLayoutInput = {
      ...input,
      textHeightM: 0.027,
      lod: { tier: 'secondary' },
    };
    const layoutAt = (pixelsPerMetre: number) => layoutExplicit(secondary, {
      projector: createTestProjector(pixelsPerMetre),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });

    // 2.7 px projected (< 11 px floor): plant-wide view, sub-dimension elided.
    const far = layoutAt(100);
    expect(far.primitives).toEqual([]);
    expect(far.scenePrimitives).toEqual([]);
    expect(far.hitRegions).toEqual([]);
    expect(far.labelPinned).toBe(true);
    expect(far.derived).toEqual({ formattedLabel: '25 REF', lodHidden: 'secondary-far' });
    // 13.5 px projected: drawn like any other input.
    const near = layoutAt(500);
    expect(near.derived.lodHidden).toBeUndefined();
    expect(near.primitives.some(primitive => primitive.kind === 'glyph-run')).toBe(true);
    // A primary input never takes this exit, however far the view.
    expect(layoutExplicit({ ...secondary, lod: { tier: 'primary' } }, {
      projector: createTestProjector(100),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    }).derived.lodHidden).toBeUndefined();
  });

  it('elides a dimension whose line projects shorter than its label when asked to', () => {
    const font = createTestFont();
    const labelWidthPx = font.getWidth(SOLVESPACE_DIMENSION_THEME.textHeightPx, input.formattedLabel);
    const shortInput: ExplicitLayoutInput = {
      ...input,
      lod: { hideShort: true },
      // Just under one label width at 100 px/m.
      lines: [{ from: [0, 0, 0], to: [(labelWidthPx - 1) / 100, 0, 0], part: 'dimension' }],
    };
    const context = (pixelsPerMetre: number): LayoutContext => ({
      projector: createTestProjector(pixelsPerMetre),
      font,
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });

    const hidden = layoutExplicit(shortInput, context(100));
    expect(hidden.derived).toEqual({ formattedLabel: '25 REF', lodHidden: 'short-line' });
    expect(hidden.primitives).toEqual([]);
    // Zoom in 10×: the same line now spans ten label widths and draws again.
    expect(layoutExplicit(shortInput, context(1000)).derived.lodHidden).toBeUndefined();
    // Without opting in, the short line still draws (measurements, plain sources).
    expect(layoutExplicit({ ...shortInput, lod: undefined }, context(100)).derived.lodHidden)
      .toBeUndefined();
  });

  it('drops an arrow stroke that projects to a point', () => {
    const result = layoutExplicit({
      ...input,
      // Along the view ray of the test projector: no screen direction to keep.
      arrowLines: [{ from: [0, 0, 0], to: [0, 0, 0.1] }],
    }, {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });

    expect(result.primitives.some(
      (primitive) => primitive.kind === 'line' && primitive.part === 'arrow',
    )).toBe(false);
    expect(result.hitRegions).toHaveLength(2);
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

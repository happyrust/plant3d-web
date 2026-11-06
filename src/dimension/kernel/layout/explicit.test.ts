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
  Vec2,
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
  it('hands an opted-in record to the pairwise declutter with every text row in its quad', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };
    const stacked: ExplicitLayoutInput = {
      ...input,
      texts: [{ text: '25 REF', anchor: [0.5, 0.2, 0], stackIndex: 1 }],
    };
    expect(layoutExplicit(stacked, context).derived.declutter).toBeUndefined();

    const result = layoutExplicit({ ...stacked, declutter: { rank: 500, group: 'angle' } }, context);
    const declutter = result.derived.declutter!;
    expect(declutter.rank).toBe(500);
    expect(declutter.group).toBe('angle');
    const glyphs = result.primitives.filter(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    );
    expect(glyphs).toHaveLength(2);
    const xs = declutter.quad.map(point => point[0]);
    const ys = declutter.quad.map(point => point[1]);
    for (const { bounds } of glyphs) {
      expect(Math.min(...xs)).toBeLessThanOrEqual(bounds.x);
      expect(Math.min(...ys)).toBeLessThanOrEqual(bounds.y);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(bounds.x + bounds.width);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    }

    // No text, nothing to compete with.
    const blank = layoutExplicit({ ...input, formattedLabel: '', declutter: { rank: 500 } }, context);
    expect(blank.derived.declutter).toBeUndefined();
  });

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

  /**
   * Q6 `labelPresentation`. `interrupted` is the engineering default and must
   * stay byte-identical; `above` lifts the value text off its line and leaves
   * the line whole. The third case is the one that matters in practice: `above`
   * pushes the label into the row above unless the caller spaces rows wide
   * enough, so the constraint is pinned here rather than left to screenshots.
   */
  it('presents the value text above an unbroken line only when asked', () => {
    const context = (): LayoutContext => ({
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });
    // Label centred on its own line, so the interrupted default has to break it.
    const onLine: ExplicitLayoutInput = { ...input, labelAnchor: [0.5, 0, 0] };
    const dimensionLines = (layout: ReturnType<typeof layoutExplicit>): ScreenLine[] =>
      layout.primitives.filter(
        (primitive): primitive is ScreenLine =>
          primitive.kind === 'line' && primitive.part === 'dimension',
      );

    // Default: two stubs around the label box (237.55..262.45 at 100 px/m).
    const interrupted = layoutExplicit(onLine, context());
    expect(dimensionLines(interrupted).map(line => roundNumbers([line.from, line.to])))
      .toEqual([[[200, 200], [237.55, 200]], [[262.45, 200], [300, 200]]]);

    // `above`: one untouched segment, and the text rises along the line normal
    // by half a cap height + half the label padding + half a pixel = 11 px.
    const above = layoutExplicit({ ...onLine, labelPresentation: 'above' }, context());
    expect(dimensionLines(above).map(line => roundNumbers([line.from, line.to])))
      .toEqual([[[200, 200], [300, 200]]]);
    expect(roundNumbers(above.labelBounds)).toEqual(
      roundNumbers({ x: 237.55, y: 175.25, width: 24.9, height: 27.5 }),
    );
    // Same box as the default, only lifted: 200 - 11 = 189 centre, 27.5 tall.
    expect(interrupted.labelBounds).toMatchObject({ y: 186.25, height: 27.5 });

    // A stacked label keeps the interrupted presentation: lifting the stack
    // would put its lower rows back onto the line.
    const stacked: ExplicitLayoutInput = {
      ...onLine,
      labelPresentation: 'above',
      texts: [{ text: '25 REF', anchor: [0.5, 0, 0], stackIndex: 1 }],
    };
    expect(layoutExplicit(stacked, context()).labelBounds)
      .toEqual(layoutExplicit({ ...stacked, labelPresentation: 'interrupted' }, context()).labelBounds);

    // Row spacing: the lifted box reaches 24.75 px above its line (11 px lift
    // + 13.75 px half box). A row 40 px above is clear …
    const row = (id: string, lineY: number): ExplicitLayoutInput => ({
      id,
      role: 'external-reference',
      labelPinned: true,
      formattedLabel: '25 REF',
      lines: [{ from: [0, lineY, 0], to: [1, lineY, 0], part: 'dimension' }],
      labelAnchor: [0.5, lineY, 0],
      arrowLines: [],
      labelPresentation: 'above',
    });
    const overlaps = (a: typeof above.labelBounds, b: typeof above.labelBounds): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height;
    const lower = layoutExplicit(row('lower', 0), context()).labelBounds;
    const clearRow = layoutExplicit(row('upper', 0.4), context()).labelBounds;
    expect(overlaps(lower, clearRow)).toBe(false);

    // … while a row one `labelLineAdvance` (1.5 × 13 = 19.5 px) above is not.
    // `above` therefore requires the caller to space rows ≥ 2.96 cap heights;
    // at the stacked-line advance it intrudes on the neighbouring row.
    const tightRow = layoutExplicit(row('upper', 0.195), context()).labelBounds;
    expect(overlaps(lower, tightRow)).toBe(true);
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

  it('keeps a secondary input while the source text projects below the legibility floor', () => {
    const secondary: ExplicitLayoutInput = {
      ...input,
      textHeightM: 0.027,
      lod: { tier: 'secondary' },
    };
    const layoutAt = (pixelsPerMetre: number, theme = SOLVESPACE_DIMENSION_THEME) => layoutExplicit(secondary, {
      projector: createTestProjector(pixelsPerMetre),
      font: createTestFont(),
      theme,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    });

    // 2026-10-29：显示门槛与字号钳制分离。默认主题里 lodSecondaryMinPx 为 0，
    // 所以 2.7 px 的投影（远低于 11 px 字号下限）仍然出图，字号被钳到 11 px。
    const far = layoutAt(100);
    expect(far.derived.lodHidden).toBeUndefined();
    const farGlyph = far.primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!;
    expect(farGlyph.capHeightPx).toBe(SOLVESPACE_DIMENSION_THEME.sourceTextHeightMinPx);

    // 门槛仍可生效：给主题一个正数 lodSecondaryMinPx，同一视角就恢复消隐。
    const gated = layoutAt(100, { ...SOLVESPACE_DIMENSION_THEME, lodSecondaryMinPx: 11 });
    expect(gated.primitives).toEqual([]);
    expect(gated.scenePrimitives).toEqual([]);
    expect(gated.hitRegions).toEqual([]);
    expect(gated.labelPinned).toBe(true);
    expect(gated.derived).toEqual({ formattedLabel: '25 REF', lodHidden: 'secondary-far' });
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
    // 2026-10-30 (Q5): the threshold is per tier. `primary` keeps a line down to
    // 0.8 label widths, so the fixture has to sit just under that — a 0.9-width
    // line used to be elided by the old flat ratio and now draws.
    const primaryRatio = SOLVESPACE_DIMENSION_THEME.lodMinLineToLabelRatio.primary;
    const shortInput: ExplicitLayoutInput = {
      ...input,
      lod: { tier: 'primary', hideShort: true },
      // Just under the primary threshold at 100 px/m.
      lines: [{ from: [0, 0, 0], to: [(labelWidthPx * primaryRatio - 1) / 100, 0, 0], part: 'dimension' }],
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
    // Zoom in 10×: the same line now spans eight label widths and draws again.
    expect(layoutExplicit(shortInput, context(1000)).derived.lodHidden).toBeUndefined();
    // Without opting in, the short line still draws (measurements, plain sources).
    expect(layoutExplicit({ ...shortInput, lod: undefined }, context(100)).derived.lodHidden)
      .toBeUndefined();

    // Same line, tighter tier: `detail`'s 1.5 ratio elides it at the far zoom too.
    expect(layoutExplicit({ ...shortInput, lod: { tier: 'detail', hideShort: true } }, context(100))
      .derived.lodHidden).toBe('short-line');
    // …while `secondary`'s 0.5 keeps a line that primary would drop.
    const betweenSecondaryAndPrimary = (labelWidthPx * 0.6) / 100;
    const midLength: ExplicitLayoutInput = {
      ...shortInput,
      lines: [{ from: [0, 0, 0], to: [betweenSecondaryAndPrimary, 0, 0], part: 'dimension' }],
    };
    expect(layoutExplicit({ ...midLength, lod: { tier: 'primary', hideShort: true } }, context(100))
      .derived.lodHidden).toBe('short-line');
    expect(layoutExplicit({ ...midLength, lod: { tier: 'secondary', hideShort: true } }, context(100))
      .derived.lodHidden).toBeUndefined();
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

  it('carries the object a record sits on into derived, for the inspection pass', () => {
    const context: LayoutContext = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };
    const weldMark: ExplicitLayoutInput = {
      id: 'weld',
      role: 'external',
      labelPinned: true,
      formattedLabel: '',
      lines: [],
      labelAnchor: [0.3, 0, 0],
      arrowLines: [],
      markers: [{ at: [0.3, 0, 0], shape: 'circle', radiusPx: 5 }],
      subject: '24381_146980',
    };

    expect(layoutExplicit(weldMark, context).derived).toEqual({ formattedLabel: '', subject: '24381_146980' });
    expect(layoutExplicit(input, context).derived).toEqual({ formattedLabel: '25 REF' });
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

// 求解器下发的角弧半径是 `aod × 0.7`（25 mm 管 → 17.5 mm），整机视图下不到
// 2 px，弧退化成污点。只有 `part: 'dimension'`（`mapAngleDim` 的标注弧）按
// `theme.minArcRadiusPx` 抬到屏幕下限；`part: 'arc'` 是模型上的真实圆/弧
// （`mapAidArc` / `mapAidCircle`），必须 1:1 画。100 px/m 时下限 = 0.15 m = 15 px。
describe('explicit arc pixel floor', () => {
  const arcInput = (
    arc: NonNullable<ExplicitLayoutInput['arcs']>[number],
  ): ExplicitLayoutInput => ({
    id: 'explicit-arc',
    role: 'external',
    labelPinned: true,
    formattedLabel: '',
    lines: [],
    labelAnchor: [0, 0, 0],
    arrowLines: [],
    arcs: [arc],
  });

  // 弧心 [0, 0, 0] 投影到 (200, 200)。
  const context: LayoutContext = {
    projector: createTestProjector(100),
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  };

  const screenRadii = (result: ReturnType<typeof layoutExplicit>): number[] => {
    const path = result.primitives.find(
      (primitive): primitive is ScreenPath => primitive.kind === 'path',
    );
    expect(path).toBeDefined();
    return path!.points.map(point => Math.hypot(point[0] - 200, point[1] - 200));
  };

  it('lifts a solver angle arc to the theme pixel floor before sampling', () => {
    const result = layoutExplicit(
      arcInput({
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.01,
        part: 'dimension',
      }),
      context,
    );

    const radii = screenRadii(result);
    // 先放大再采样：15 px 的弧按 0.25 px 弦误差细分，点数远多于退化的 4 点。
    expect(radii.length).toBeGreaterThan(8);
    for (const radius of radii) expect(radius).toBeCloseTo(15, 0);
  });

  it('draws a real model arc 1:1 even below the floor', () => {
    const result = layoutExplicit(
      arcInput({
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.01,
        part: 'arc',
      }),
      context,
    );

    const radii = screenRadii(result);
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) expect(radius).toBeLessThan(2);
  });

  it('leaves an angle arc at or above the floor untouched', () => {
    const atFloor = screenRadii(layoutExplicit(
      arcInput({
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.15,
        part: 'dimension',
      }),
      context,
    ));
    for (const radius of atFloor) expect(radius).toBeCloseTo(15, 0);

    const aboveFloor = screenRadii(layoutExplicit(
      arcInput({
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.2,
        part: 'dimension',
      }),
      context,
    ));
    for (const radius of aboveFloor) expect(radius).toBeCloseTo(20, 0);
  });
});

// Q6 `above` 回落守卫：标签沿尺寸线法线抬起后，其屏幕像素包围盒若与本次布局
// 会画出的其它图元距离小于 `aboveRowClearancePx`（默认 2 px，主题可覆盖），
// 该条退回 interrupted —— 逐条判定，屏幕空间实测。
describe('above row guard', () => {
  const context = (): LayoutContext => ({
    projector: createTestProjector(),
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  });
  const dimensionLines = (layout: ReturnType<typeof layoutExplicit>): ScreenLine[] =>
    layout.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'dimension',
    );
  // `blockerY`：一条与尺寸线平行的相邻行延伸线，距尺寸线 blockerY 米
  // （100 px/m 测试相机下 = blockerY×100 px）。锚点在尺寸线上，抬起后的标签
  // 补钉盒屏幕 y 跨 175.25..202.75；尺寸线自身 y=200 但被排除在障碍外
  // （标签本来就要悬在它上方 labelLiftPx 处）。
  const row = (id: string, blockerY: number | null): ExplicitLayoutInput => ({
    id,
    role: 'external-reference',
    labelPinned: true,
    formattedLabel: '25 REF',
    lines: blockerY === null
      ? [{ from: [0, 0, 0], to: [1, 0, 0], part: 'dimension' }]
      : [
        { from: [0, 0, 0], to: [1, 0, 0], part: 'dimension' },
        { from: [0, blockerY, 0], to: [1, blockerY, 0], part: 'extension' },
      ],
    labelAnchor: [0.5, 0, 0],
    arrowLines: [],
    labelPresentation: 'above',
  });

  it('keeps `above` while the lifted label clears the neighbouring strokes', () => {
    const result = layoutExplicit(row('clear', 0.4), context());

    // Blocker at screen y=160: 15.25 px off the lifted box's top edge, well
    // clear of the 2 px guard band. The line stays whole and the label keeps
    // its lift (same numbers as the plain `above` fixture).
    expect(dimensionLines(result).map(line => roundNumbers([line.from, line.to])))
      .toEqual([[[200, 200], [300, 200]]]);
    expect(roundNumbers(result.labelBounds)).toEqual(
      roundNumbers({ x: 237.55, y: 175.25, width: 24.9, height: 27.5 }),
    );
  });

  it('falls back to `interrupted` and re-breaks the line when the lift lands on a neighbour', () => {
    const blocked = row('blocked', 0.15);
    const result = layoutExplicit(blocked, context());

    // Blocker at screen y=185: inside the lifted box, distance 0. The record
    // falls back — and the clearance path really ran, so the dimension line
    // is broken around the label again instead of drawing whole underneath.
    expect(dimensionLines(result).map(line => roundNumbers([line.from, line.to])))
      .toEqual([[[200, 200], [237.55, 200]], [[262.45, 200], [300, 200]]]);
    expect(roundNumbers(result.labelBounds)).toEqual(
      roundNumbers({ x: 237.55, y: 186.25, width: 24.9, height: 27.5 }),
    );
    // Fallback output equals an explicit `interrupted` request, byte for byte.
    expect(roundNumbers(result)).toEqual(roundNumbers(
      layoutExplicit({ ...blocked, labelPresentation: 'interrupted' }, context()),
    ));

    // The guard band is 2 px, not contact: a stroke 1.25 px off the padded
    // box still falls back, one 3.25 px off keeps `above`.
    expect(dimensionLines(layoutExplicit(row('edge-blocked', 0.26), context())))
      .toHaveLength(2);
    expect(dimensionLines(layoutExplicit(row('edge-clear', 0.28), context())))
      .toHaveLength(1);
  });

  it('decides per record inside one batch', () => {
    const ctx = context();
    const clear = layoutExplicit(row('clear', 0.4), ctx);
    const blocked = layoutExplicit(row('blocked', 0.15), ctx);
    const interrupted = layoutExplicit(
      { ...row('plain', null), labelPresentation: 'interrupted' },
      ctx,
    );

    // Same batch, both rows asked for `above`: the roomy one keeps it, the
    // crowded one falls back — and its trimmed stubs match the explicit
    // `interrupted` record's.
    expect(dimensionLines(clear)).toHaveLength(1);
    expect(dimensionLines(blocked)).toHaveLength(2);
    expect(dimensionLines(blocked).map(line => roundNumbers([line.from, line.to])))
      .toEqual(dimensionLines(interrupted).map(line => roundNumbers([line.from, line.to])));
  });

  it('takes the clearance threshold from the theme when it carries one', () => {
    const wideTheme = {
      ...SOLVESPACE_DIMENSION_THEME,
      aboveRowClearancePx: 30,
    } as LayoutContext['theme'];
    const result = layoutExplicit(row('clear', 0.4), {
      ...context(),
      theme: wideTheme,
    });

    // 15.25 px of clearance passes the 2 px default but fails a 30 px
    // requirement, so the same row now falls back.
    expect(dimensionLines(result)).toHaveLength(2);
  });
});

// 多行文字整块居中（plant-mbd 字段字典裁定 8）：`labelBlock` 的各行以 `labelAnchor` 为块中心，
// 第 k 行（共 n 行）在 `up · ((n − 1)/2 − k) · lineAdvance · 字高` 处。测试相机 100 px/m、
// 正对 XY 平面：锚点 [0.5, 0.5, 0] 投到 (250, 150)，屏幕 y 向下。
describe('label block', () => {
  const context = (): LayoutContext => ({
    projector: createTestProjector(),
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  });
  const block = (
    rows: readonly string[],
    overrides: Partial<ExplicitLayoutInput> = {},
    up?: Vec3,
  ): ExplicitLayoutInput => ({
    id: 'block',
    role: 'external',
    labelPinned: true,
    formattedLabel: 'A',
    lines: [],
    labelAnchor: [0.5, 0.5, 0],
    arrowLines: [],
    labelBlock: { rows, lineAdvance: 1.2, ...(up ? { up } : {}) },
    ...overrides,
  });
  const glyphRuns = (result: ReturnType<typeof layoutExplicit>): ScreenGlyphRun[] =>
    result.primitives.filter(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    );
  // Centre of every drawn row on screen, first row first.
  const rowCentres = (result: ReturnType<typeof layoutExplicit>): Vec2[] =>
    glyphRuns(result).map(({ bounds }): Vec2 => [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]);
  const expectCentres = (actual: readonly Vec2[], expected: readonly Vec2[]): void => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((centre, index) => {
      expect(centre[0]).toBeCloseTo(expected[index]![0], 6);
      expect(centre[1]).toBeCloseTo(expected[index]![1], 6);
    });
  };
  const screen = (point: Vec3): Vec2 => [200 + point[0] * 100, 200 - point[1] * 100];
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  it('leaves a one-line label exactly as it was', () => {
    const { labelBlock: _labelBlock, ...plain } = block([]);
    expect(layoutExplicit(block([]), context())).toEqual(layoutExplicit(plain, context()));
    expect(layoutExplicit(block([], {}, [0, 1, 0]), context())).toEqual(layoutExplicit(plain, context()));
  });

  it('centres two and three rows on the anchor, stacked on screen without a text plane', () => {
    // 13 px theme height, 1.2 pitch = 15.6 px.
    expectCentres(rowCentres(layoutExplicit(block(['h']), context())), [[250, 142.2], [250, 157.8]]);
    expectCentres(
      rowCentres(layoutExplicit(block(['h', 'p']), context())),
      [[250, 134.4], [250, 150], [250, 165.6]],
    );
    // Every row hangs off the anchor itself, so a moved anchor takes the block along.
    const atAnchor = layoutExplicit(block(['h']), context()).scenePrimitives
      .filter(primitive => primitive.kind === 'scene-glyph-run');
    expect(atAnchor.map(primitive => primitive.kind === 'scene-glyph-run' && primitive.at.anchor))
      .toEqual([[0.5, 0.5, 0], [0.5, 0.5, 0]]);
  });

  it('stacks across a turned baseline when there is no text plane', () => {
    // Baseline 30° up from +X runs at −30° on screen; its "down" is (0.5, 0.866).
    const result = layoutExplicit(block(['h'], { labelAlong: [cos30, sin30, 0] }), context());
    expectCentres(rowCentres(result), [
      [250 - 7.8 * 0.5, 150 - 7.8 * cos30],
      [250 + 7.8 * 0.5, 150 + 7.8 * cos30],
    ]);
    expect(glyphRuns(result).every(glyph => Math.abs(glyph.rotationRad! + Math.PI / 6) < 1e-9)).toBe(true);
  });

  it('puts the rows on the text plane at position + up · ((n − 1)/2 − k) · 1.2 · textHeightM', () => {
    // 0.15 m projects to 15 px, inside the 11–18 px clamp: pitch 0.18 m = 18 px.
    const rowsOn = (up: Vec3, count: number): Vec2[] => Array.from({ length: count }, (_, k) => {
      const along = ((count - 1) / 2 - k) * 1.2 * 0.15;
      return screen([0.5 + up[0] * along, 0.5 + up[1] * along, up[2] * along]);
    });
    const upright: Partial<ExplicitLayoutInput> = { textHeightM: 0.15, labelAlong: [1, 0, 0] };
    expectCentres(rowCentres(layoutExplicit(block(['h'], upright, [0, 1, 0]), context())), rowsOn([0, 1, 0], 2));
    expectCentres(rowCentres(layoutExplicit(block(['h', 'p'], upright, [0, 1, 0]), context())), rowsOn([0, 1, 0], 3));

    // A planar label turned 30° (a wall name seen face-on): text_up is not
    // screen-up, and the rows still step along it, symmetric about the anchor.
    const up: Vec3 = [-sin30, cos30, 0];
    const turned: Partial<ExplicitLayoutInput> = { textHeightM: 0.15, labelAlong: [cos30, sin30, 0] };
    expectCentres(rowCentres(layoutExplicit(block(['h'], turned, up), context())), rowsOn(up, 2));
    expectCentres(rowCentres(layoutExplicit(block(['h', 'p'], turned, up), context())), rowsOn(up, 3));
  });

  it('keeps the first row on top when text_up points down the screen', () => {
    const result = layoutExplicit(
      block(['h', 'p'], { textHeightM: 0.15, labelAlong: [1, 0, 0] }, [0, -1, 0]),
      context(),
    );
    expectCentres(rowCentres(result), [[250, 132], [250, 150], [250, 168]]);
  });

  it('keeps the pitch at the drawn cap height while the source height is clamped', () => {
    // 0.02 m projects to 2 px and draws at the 11 px floor: rows 13.2 px apart,
    // not the 2.4 px the source height alone would give.
    const result = layoutExplicit(
      block(['h'], { textHeightM: 0.02, labelAlong: [1, 0, 0] }, [0, 1, 0]),
      context(),
    );
    expect(glyphRuns(result)[0]!.capHeightPx).toBe(SOLVESPACE_DIMENSION_THEME.sourceTextHeightMinPx);
    expectCentres(rowCentres(result), [[250, 143.4], [250, 156.6]]);
  });

  it('follows an oblique text plane at the drawn pitch across the baseline', () => {
    // Tilted 60° away from the camera: up projects at half length, the rows
    // still keep a full 15.6 px pitch.
    expectCentres(
      rowCentres(layoutExplicit(block(['h', 'p'], { labelAlong: [1, 0, 0] }, [0, 0.5, Math.sqrt(0.75)]), context())),
      [[250, 134.4], [250, 150], [250, 165.6]],
    );
    // A wall seen at an angle: its baseline runs into the screen, its up leans
    // left on screen, so the block shears with the plane. The rows sit on the
    // anchor's line along the projected up (−0.5, 1), 15.6 px apart across
    // the baseline.
    expectCentres(
      rowCentres(layoutExplicit(block(['h', 'p'], { labelAlong: [1, 0, 1] }, [-0.5, 1, 0.5]), context())),
      [[242.2, 134.4], [250, 150], [257.8, 165.6]],
    );
  });

  it('stacks across the baseline when the text plane is seen edge-on', () => {
    const flat = rowCentres(layoutExplicit(block(['h', 'p'], { labelAlong: [1, 0, 0] }), context()));
    // Up along the view ray, and up all but along the baseline (0.29 < 0.35).
    for (const up of [[0, 0, 1], [0.9578, 0.2873, 0]] as const) {
      expectCentres(rowCentres(layoutExplicit(block(['h', 'p'], { labelAlong: [1, 0, 0] }, up), context())), flat);
    }
  });

  it('claims the whole block as its label bounds', () => {
    const font = createTestFont();
    const result = layoutExplicit(block(['hh', 'AAA']), context());
    const single = layoutExplicit({ ...block([]), formattedLabel: 'AAA' }, context());
    for (const { bounds } of glyphRuns(result)) {
      expect(result.labelBounds.x).toBeLessThanOrEqual(bounds.x);
      expect(result.labelBounds.y).toBeLessThanOrEqual(bounds.y);
      expect(result.labelBounds.x + result.labelBounds.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
      expect(result.labelBounds.y + result.labelBounds.height).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    }
    // As wide as the widest row plus the padding, as tall as one row plus two pitches.
    expect(result.labelBounds.width)
      .toBeCloseTo(font.getWidth(13, 'AAA') + SOLVESPACE_DIMENSION_THEME.labelPaddingPx, 9);
    expect(result.labelBounds.width).toBeCloseTo(single.labelBounds.width, 9);
    expect(result.labelBounds.height).toBeCloseTo(single.labelBounds.height + 2 * 15.6, 9);
    expect(result.labelBounds.y + result.labelBounds.height / 2).toBeCloseTo(150, 9);
    // Every row is hit-testable.
    expect(result.hitRegions.filter(region => region.part === 'label')).toHaveLength(3);
  });

  it('breaks a dimension line around every row of the block, not just the first', () => {
    const dimensionLines = (result: ReturnType<typeof layoutExplicit>): ScreenLine[] =>
      result.primitives.filter(
        (primitive): primitive is ScreenLine => primitive.kind === 'line' && primitive.part === 'dimension',
      );
    // A line through the last row (y = 165.6 px), clear of the first row's
    // box (136.25..163.75 px when the label stood alone at the anchor).
    const throughLastRow = block(['hp', 'A'], {
      lines: [{ from: [0, 0.344, 0], to: [1, 0.344, 0], part: 'dimension' }],
    });
    expect(dimensionLines(layoutExplicit({ ...throughLastRow, labelBlock: undefined }, context())))
      .toHaveLength(1);
    const broken = dimensionLines(layoutExplicit(throughLastRow, context()));
    expect(broken).toHaveLength(2);
    expect((broken[0]!.to[0] + broken[1]!.from[0]) / 2).toBeCloseTo(250, 6);
    // A stack never goes `above`; it stays interrupted.
    expect(layoutExplicit({ ...throughLastRow, labelPresentation: 'above' }, context()))
      .toEqual(layoutExplicit(throughLastRow, context()));

    // Turned 30°: the trim box turns with the block, so a line along the
    // baseline through the last row is cut around that row's centre.
    const lastRow: Vec2 = [250 + 15.6 * 0.5, 150 + 15.6 * cos30];
    const centre: Vec3 = [(lastRow[0] - 200) / 100, (200 - lastRow[1]) / 100, 0];
    const turned = block(['hp', 'A'], {
      labelAlong: [cos30, sin30, 0],
      lines: [{
        from: [centre[0] - 0.5 * cos30, centre[1] - 0.5 * sin30, 0],
        to: [centre[0] + 0.5 * cos30, centre[1] + 0.5 * sin30, 0],
        part: 'dimension',
      }],
    });
    expect(dimensionLines(layoutExplicit({ ...turned, labelBlock: undefined }, context()))).toHaveLength(1);
    const turnedBroken = dimensionLines(layoutExplicit(turned, context()));
    expect(turnedBroken).toHaveLength(2);
    expect((turnedBroken[0]!.to[0] + turnedBroken[1]!.from[0]) / 2).toBeCloseTo(lastRow[0], 6);
    expect((turnedBroken[0]!.to[1] + turnedBroken[1]!.from[1]) / 2).toBeCloseTo(lastRow[1], 6);
  });
});

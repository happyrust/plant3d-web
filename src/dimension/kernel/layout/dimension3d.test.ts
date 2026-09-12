import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutDimension3d } from './dimension3d';
import { layoutExplicit } from './explicit';

import type {
  ExplicitDimension3dInput,
  ExplicitLayoutInput,
  SceneGlyphRun,
  SceneLine,
  SceneTriangle,
  ScreenGlyphRun,
  Vec3,
} from '../types';
import type { LayoutContext } from './context';

// Pipe centre line along +X, solver `dim_dir` +Y (screen up in the test
// projector), surface 50 mm from the centre line, innermost row.
const spec: ExplicitDimension3dInput = {
  from: [0, 0, 0],
  to: [1, 0, 0],
  direction: [0, 1, 0],
  surfaceM: 0.05,
  row: 0,
};

// The solver's flat geometry rides along untouched (kept for `mbd_3d=0`).
const input: ExplicitLayoutInput = {
  id: 'run',
  role: 'external',
  labelPinned: true,
  formattedLabel: '1000',
  lines: [
    { from: [0, 0.1, 0], to: [1, 0.1, 0], part: 'dimension' },
    { from: [0, 0, 0], to: [0, 0.1, 0], part: 'extension' },
    { from: [1, 0, 0], to: [1, 0.1, 0], part: 'extension' },
  ],
  labelAnchor: [0.5, 0.1, 0],
  labelAlong: [1, 0, 0],
  arrowLines: [],
  textHeightM: 0.027,
  lod: { tier: 'primary', hideShort: true },
  dimension3d: spec,
};

function context(pixelsPerMetre = 100): LayoutContext {
  return {
    projector: createTestProjector(pixelsPerMetre),
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  };
}

const rules = SOLVESPACE_DIMENSION_THEME.dimension3d;

/** Rounded and with negative zeros folded away, for `toEqual`. */
function plain(vector: Vec3): Vec3 {
  return roundNumbers(vector).map(component => component + 0) as unknown as Vec3;
}

function sceneLines(result: ReturnType<typeof layoutDimension3d>, part: string): SceneLine[] {
  return result.scenePrimitives.filter(
    (primitive): primitive is SceneLine => primitive.kind === 'scene-line' && primitive.part === part,
  );
}

function sceneGlyph(result: ReturnType<typeof layoutDimension3d>): SceneGlyphRun {
  return result.scenePrimitives.find(
    (primitive): primitive is SceneGlyphRun => primitive.kind === 'scene-glyph-run',
  )!;
}

describe('layoutDimension3d', () => {
  it('stands the dimension off the pipe in units of the text height and draws it in Design Space', () => {
    // 100 px/m: cheight 27 mm projects to 2.7 px, so h is the 13 px floor = 0.13 m.
    const result = roundNumbers(layoutDimension3d(input, spec, context()), 6);
    const h = rules.textFloorPx / 100;
    const standoff = roundNumbers(0.05 + rules.standoffH * h);

    const [dimension] = sceneLines(result, 'dimension');
    expect(dimension).toMatchObject({
      from: { anchor: [0, standoff, 0], offsetPx: [0, 0] },
      to: { anchor: [1, standoff, 0], offsetPx: [0, 0] },
      styleRole: 'external',
    });
    // Extension lines start just outside the surface and overshoot the line.
    expect(sceneLines(result, 'extension').map(line => [line.from.anchor, line.to.anchor])).toEqual(roundNumbers([
      [[0, 0.05 + rules.extensionStartH * h, 0], [0, standoff + rules.extensionOvershootH * h, 0]],
      [[1, 0.05 + rules.extensionStartH * h, 0], [1, standoff + rules.extensionOvershootH * h, 0]],
    ]));
    // Filled heads are 3D triangles: tips on the line ends, bodies pointing
    // inwards along the line, no pixel offsets anywhere.
    const heads = result.scenePrimitives.filter(
      (primitive): primitive is SceneTriangle => primitive.kind === 'scene-triangle',
    );
    expect(heads).toHaveLength(2);
    const arrowLength = rules.arrowLengthH * h;
    expect(heads[0]!.points[0]!.anchor).toEqual([0, standoff, 0]);
    expect(heads[0]!.points[1]!.anchor[0]).toBeCloseTo(arrowLength, 6);
    expect(heads[1]!.points[0]!.anchor).toEqual([1, standoff, 0]);
    expect(heads[1]!.points[1]!.anchor[0]).toBeCloseTo(1 - arrowLength, 6);
    expect(heads.every(head => head.points.every(point => point.offsetPx[0] === 0 && point.offsetPx[1] === 0))).toBe(true);
    // The solver's own arrow strokes are not drawn (the line has moved).
    expect(sceneLines(result, 'arrow')).toEqual([]);

    // Value text lies in the plane of the line, baseline centred above the
    // midpoint by the text gap, reading along +X with +Y up.
    const glyph = sceneGlyph(result);
    expect(glyph.frame).toEqual(roundNumbers({
      origin: [0.5, standoff + rules.textGapH * h, 0],
      xAxis: [h, 0, 0],
      yAxis: [0, h, 0],
    }));
    expect(glyph.capHeightPx).toBe(rules.textFloorPx);
    expect(glyph.rotationRad).toBe(0);

    // Projected label box: 13 px cap height, glyph box 1.5 cap heights tall
    // (test font ascender 12 / descender -3 over cap 10), centred on x = 250.
    const projected = result.primitives.find(
      (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
    )!;
    const baselineY = 200 - (standoff + rules.textGapH * h) * 100;
    expect(projected.bounds.y).toBeCloseTo(baselineY - 1.2 * 13, 6);
    expect(projected.bounds.height).toBeCloseTo(1.5 * 13, 6);
    expect(projected.bounds.x + projected.bounds.width / 2).toBeCloseTo(250, 6);
    expect(projected.capHeightPx).toBeCloseTo(13, 6);
    expect(result.labelBounds.height).toBeCloseTo(1.5 * 13 + SOLVESPACE_DIMENSION_THEME.labelPaddingPx, 6);
    expect(result.hitRegions.filter(region => region.part === 'label')).toHaveLength(1);
    expect(result.derived.formattedLabel).toBe('1000');
    // Declutter data: main row rank ≥ 1000 plus line length per label width; a 4-corner quad.
    expect(result.derived.declutter!.rank).toBeGreaterThan(1000);
    expect(result.derived.declutter!.quad).toHaveLength(4);
    expect(result.derived.lodHidden).toBeUndefined();
  });

  it('follows the source text height once it projects above the floor and spaces rows by it', () => {
    // 1000 px/m: cheight 27 mm = 27 px > 13 px floor, so h = cheight.
    const near = layoutDimension3d(input, spec, context(1000));
    expect(sceneGlyph(near).capHeightPx).toBeCloseTo(27, 6);
    const [line] = sceneLines(near, 'dimension');
    expect(line!.from.anchor[1]).toBeCloseTo(0.05 + rules.standoffH * 0.027, 9);

    // Row 1 sits one row spacing further out along the same direction.
    const outer = layoutDimension3d(input, { ...spec, row: 1 }, context(1000));
    expect(sceneLines(outer, 'dimension')[0]!.from.anchor[1])
      .toBeCloseTo(0.05 + (rules.standoffH + rules.rowSpacingH) * 0.027, 9);
  });

  it('reads left to right and upwards on screen whatever the line direction', () => {
    const reversed = layoutDimension3d(
      { ...input, dimension3d: { ...spec, from: [1, 0, 0], to: [0, 0, 0] } },
      { ...spec, from: [1, 0, 0], to: [0, 0, 0] },
      context(),
    );
    // Same text frame as the forward run: the reading direction flips back to +X.
    expect(plain(sceneGlyph(reversed).frame!.xAxis)).toEqual([0.13, 0, 0]);
    expect(plain(sceneGlyph(reversed).frame!.yAxis)).toEqual([0, 0.13, 0]);

    // Vertical run (pipe along -Y, dimension standing off towards -X): reads
    // upwards (+Y) with "above" on the screen-left side (-X), ISO 129-1 §4.1.1.
    const vertical: ExplicitDimension3dInput = {
      from: [0, 1, 0],
      to: [0, 0, 0],
      direction: [-1, 0, 0],
      surfaceM: 0.05,
      row: 0,
    };
    const glyph = sceneGlyph(layoutDimension3d({ ...input, dimension3d: vertical }, vertical, context()));
    expect(plain(glyph.frame!.xAxis)).toEqual([0, 0.13, 0]);
    expect(plain(glyph.frame!.yAxis)).toEqual([-0.13, 0, 0]);
    expect(glyph.rotationRad).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('moves the value and the heads outside when the line is too short for them', () => {
    // 0.1 m line = 10 px at 100 px/m: the 13 px text does not fit between two heads.
    const short: ExplicitDimension3dInput = { ...spec, to: [0.1, 0, 0] };
    const result = layoutDimension3d(
      { ...input, lod: { tier: 'primary', hideShort: false }, dimension3d: short },
      short,
      context(),
    );
    const h = 0.13;
    const standoff = 0.05 + rules.standoffH * h;
    const heads = result.scenePrimitives.filter(
      (primitive): primitive is SceneTriangle => primitive.kind === 'scene-triangle',
    );
    // Heads flip: the start head's body lies before the start, the end head's after the end.
    expect(heads[0]!.points[1]!.anchor[0]).toBeCloseTo(-rules.arrowLengthH * h, 9);
    expect(heads[1]!.points[1]!.anchor[0]).toBeCloseTo(0.1 + rules.arrowLengthH * h, 9);
    // Tails carry the outside heads; the text sits past the end, centred on its own width.
    const dimensionLines = sceneLines(result, 'dimension');
    expect(dimensionLines).toHaveLength(3);
    const tail = (rules.arrowLengthH + rules.outsideTailH) * h;
    expect(dimensionLines[1]!.to.anchor[0]).toBeCloseTo(-tail, 9);
    expect(dimensionLines[2]!.to.anchor[0]).toBeCloseTo(0.1 + tail, 9);
    const textWidthM = createTestFont().getWidth(h, '1000');
    expect(sceneGlyph(result).frame!.origin[0]).toBeCloseTo(0.1 + tail + textWidthM / 2, 9);
    expect(sceneGlyph(result).frame!.origin[1]).toBeCloseTo(standoff + rules.textGapH * h, 9);

    // The solver's own `small` placement wins over the projected-size rule.
    const solverStart = layoutDimension3d(
      { ...input, dimension3d: { ...spec, outside: 'start' } },
      { ...spec, outside: 'start' },
      context(),
    );
    expect(sceneGlyph(solverStart).frame!.origin[0]).toBeLessThan(0);
    expect(sceneLines(solverStart, 'dimension')).toHaveLength(3);
  });

  it('applies the level-of-detail rules of the flat presentation', () => {
    // atta row on a plant-wide view: cheight projects to 2.7 px < 11 px floor.
    const secondary = layoutDimension3d(
      { ...input, lod: { tier: 'secondary', hideShort: true } },
      spec,
      context(),
    );
    expect(secondary.derived).toEqual({ formattedLabel: '1000', lodHidden: 'secondary-far' });
    expect(secondary.scenePrimitives).toEqual([]);
    // … but drawn once the view is close enough (27 px).
    expect(layoutDimension3d(
      { ...input, lod: { tier: 'secondary', hideShort: true } },
      spec,
      context(1000),
    ).derived.lodHidden).toBeUndefined();

    // A line shorter than its own value text (5 px vs 9.1 px) disappears when asked to.
    const short: ExplicitDimension3dInput = { ...spec, to: [0.05, 0, 0] };
    expect(layoutDimension3d({ ...input, dimension3d: short }, short, context()).derived)
      .toEqual({ formattedLabel: '1000', lodHidden: 'short-line' });
  });

  it('falls back to view-plane text when the text plane is edge-on', () => {
    // Pipe along the view ray: the baseline projects to a point.
    const edgeOn: ExplicitDimension3dInput = {
      from: [0, 0, 0],
      to: [0, 0, 1],
      direction: [0, 1, 0],
      surfaceM: 0.05,
      row: 0,
    };
    const result = layoutDimension3d(
      { ...input, lod: undefined, dimension3d: edgeOn },
      edgeOn,
      context(),
    );
    const glyph = sceneGlyph(result);
    expect(glyph.frame).toBeUndefined();
    expect(glyph.rotationRad).toBe(0);
    expect(glyph.capHeightPx).toBe(rules.textFloorPx);
    expect(result.derived.declutter!.quad).toHaveLength(4);
  });

  it('is reached through layoutExplicit and honours interaction roles', () => {
    const hovered = layoutExplicit(input, { ...context(), interaction: 'hovered' });
    expect(hovered.scenePrimitives.length).toBeGreaterThan(0);
    expect(hovered.scenePrimitives.every(primitive => primitive.styleRole === 'hovered')).toBe(true);
    // Without the 3D input the same record takes the flat path (solver line at y = 0.1).
    const { dimension3d: _spec, ...flat } = input;
    const flatLine = layoutExplicit(flat, context()).scenePrimitives.find(
      (primitive): primitive is SceneLine => primitive.kind === 'scene-line' && primitive.part === 'dimension',
    )!;
    expect(flatLine.from.anchor).toEqual([0, 0.1, 0] as Vec3);
  });
});

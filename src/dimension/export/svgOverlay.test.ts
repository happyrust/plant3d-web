import { describe, expect, it } from 'vitest';

import { LffFont } from '../kernel/glyph/lffParser';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import { layoutResultsToSvg } from './svgOverlay';

import type { DimensionExportMetadata } from './svgOverlay';
import type { LayoutResult, SceneVertex, Vec3 } from '../kernel/types';

const METADATA: DimensionExportMetadata = {
  formatPolicy: {
    lengthUnit: 'mm',
    lengthDecimals: 2,
    angleDecimals: 2,
    approximatePrefix: '~',
    stalePrefix: 'STALE ',
  },
  viewport: { widthCssPx: 800, heightCssPx: 600, dpr: 2 },
  exportedAt: 123,
};

const ANCHOR: Vec3 = [0, 0, 0];
const vertex = (offsetPx: readonly [number, number]): SceneVertex => ({
  anchor: ANCHOR,
  offsetPx,
});

const FONT = LffFont.fromText([
  '# LetterSpacing: 1',
  '# WordSpacing: 4',
  '[0041] A',
  '0,0;1,10;2,0',
  '',
  '[0068] h',
  '0,0;0,12;2,12',
  '',
  '[0070] p',
  '0,-3;0,7;2,7',
  '',
  '[fffd] replacement',
  '0,0;1,10',
  '',
].join('\n'));

describe('layoutResultsToSvg', () => {
  it('serializes lines and LFF glyph paths without platform text', () => {
    const svg = layoutResultsToSvg(
      [{
        dimensionId: 'dimension<&1',
        primitives: [
          {
            kind: 'line',
            from: [1, 2],
            to: [3, 4],
            part: 'dimension',
            styleRole: 'normal',
          },
          {
            kind: 'glyph-run',
            text: 'A',
            origin: [10, 20],
            capHeightPx: 12,
            bounds: { x: 10, y: 8, width: 3, height: 12 },
            styleRole: 'selected',
          },
        ],
        hitRegions: [],
        labelBounds: { x: 10, y: 8, width: 3, height: 12 },
        labelPinned: false,
        derived: { formattedLabel: 'A' },
      }],
      FONT,
      SOLVESPACE_DIMENSION_THEME,
      {
        formatPolicy: {
          lengthUnit: 'mm',
          lengthDecimals: 2,
          angleDecimals: 2,
          approximatePrefix: '~',
          stalePrefix: 'STALE ',
        },
        viewport: { widthCssPx: 800, heightCssPx: 600, dpr: 2 },
        exportedAt: 123,
      },
    );

    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('<path');
    expect(svg).toContain('dimension&lt;&amp;1');
    expect(svg).toContain('&quot;exportedAt&quot;:123');
    expect(svg).not.toContain('<text');
  });

  it('serializes paths, markers, and per-primitive dash styles', () => {
    const svg = layoutResultsToSvg(
      [{
        dimensionId: 'annotation-1',
        primitives: [
          {
            kind: 'path',
            points: [[10, 10], [20, 10], [20, 20]],
            closed: true,
            part: 'arc',
            styleRole: 'external',
          },
          {
            kind: 'marker',
            at: [30, 30],
            shape: 'circle',
            radiusPx: 4,
            part: 'marker',
            styleRole: 'external',
          },
          {
            kind: 'marker',
            at: [40, 40],
            shape: 'cross',
            radiusPx: 3,
            part: 'marker',
            styleRole: 'external',
          },
          {
            kind: 'line',
            from: [1, 1],
            to: [9, 1],
            part: 'leader',
            styleRole: 'external',
            lineStyle: 'dash-dot',
          },
        ],
        hitRegions: [],
        labelBounds: { x: 0, y: 0, width: 0, height: 0 },
        labelPinned: true,
        derived: { formattedLabel: '' },
      }],
      FONT,
      SOLVESPACE_DIMENSION_THEME,
      {
        formatPolicy: {
          lengthUnit: 'mm',
          lengthDecimals: 2,
          angleDecimals: 2,
          approximatePrefix: '~',
          stalePrefix: 'STALE ',
        },
        viewport: { widthCssPx: 800, heightCssPx: 600, dpr: 2 },
        exportedAt: 123,
      },
    );

    expect(svg).toContain('<path d="M 10 10 L 20 10 L 20 20 Z" data-part="arc"');
    expect(svg).toContain('<circle cx="30" cy="30" r="4" data-part="marker"');
    expect(svg).toContain('M 37 40 L 43 40 M 40 37 L 40 43');
    expect(svg).toContain('stroke-dasharray="8 3 2 3"');
    expect(svg.match(/<path[^>]*data-part="arc"/g)).toHaveLength(1);
  });

  it('paints a filled arrowhead as one filled triangle, not three edges', () => {
    // A `scene-triangle` projects to its three edges; walked in step with the
    // scene primitives, the export fills the triangle like the painter does.
    const layout: LayoutResult = {
      dimensionId: 'dim-3d',
      scenePrimitives: [
        {
          kind: 'scene-line',
          from: vertex([10, 10]),
          to: vertex([60, 10]),
          part: 'dimension',
          styleRole: 'external',
        },
        {
          kind: 'scene-triangle',
          points: [vertex([10, 10]), vertex([20, 15]), vertex([20, 5])],
          part: 'arrow',
          styleRole: 'external',
        },
      ],
      primitives: [
        { kind: 'line', from: [10, 10], to: [60, 10], part: 'dimension', styleRole: 'external' },
        { kind: 'line', from: [10, 10], to: [20, 15], part: 'arrow', styleRole: 'external' },
        { kind: 'line', from: [20, 15], to: [20, 5], part: 'arrow', styleRole: 'external' },
        { kind: 'line', from: [20, 5], to: [10, 10], part: 'arrow', styleRole: 'external' },
      ],
      hitRegions: [],
      labelBounds: { x: 0, y: 0, width: 0, height: 0 },
      labelPinned: true,
      derived: { formattedLabel: '' },
    };
    const svg = layoutResultsToSvg([layout], FONT, SOLVESPACE_DIMENSION_THEME, METADATA);

    const external = SOLVESPACE_DIMENSION_THEME.colors.external;
    expect(svg).toContain(
      `<path d="M 10 10 L 20 15 L 20 5 Z" data-part="arrow" stroke="none" stroke-width="0" fill="${external}"`,
    );
    expect(svg).not.toContain('data-part="arrow" stroke="#');
    expect(svg.match(/<line /g)).toHaveLength(1);
  });

  it('keeps source arrow strokes (open wings) as strokes', () => {
    const layout: LayoutResult = {
      dimensionId: 'dim-flat',
      scenePrimitives: [
        { kind: 'scene-line', from: vertex([10, 10]), to: vertex([18, 13]), part: 'arrow', styleRole: 'external' },
        { kind: 'scene-line', from: vertex([10, 10]), to: vertex([18, 7]), part: 'arrow', styleRole: 'external' },
      ],
      primitives: [
        { kind: 'line', from: [10, 10], to: [18, 13], part: 'arrow', styleRole: 'external' },
        { kind: 'line', from: [10, 10], to: [18, 7], part: 'arrow', styleRole: 'external' },
      ],
      hitRegions: [],
      labelBounds: { x: 0, y: 0, width: 0, height: 0 },
      labelPinned: true,
      derived: { formattedLabel: '' },
    };
    const svg = layoutResultsToSvg([layout], FONT, SOLVESPACE_DIMENSION_THEME, METADATA);

    expect(svg.match(/<line [^>]*data-part="arrow"/g)).toHaveLength(2);
    expect(svg).not.toContain('fill="#');
  });

  it('exports 3D text through its frame homography with a halo underneath', () => {
    // Frame: 10 px cap height, baseline centred at (100, 100), y up.
    // 'A' traces (−0.1, 0) → (0, −1) → (0.1, 0) in cap heights.
    const layout: LayoutResult = {
      dimensionId: 'dim-3d-text',
      scenePrimitives: [],
      primitives: [{
        kind: 'glyph-run',
        text: 'A',
        origin: [99, 100],
        capHeightPx: 10,
        bounds: { x: 99, y: 88, width: 2, height: 15 },
        styleRole: 'external',
        rotationRad: 0.3,
        rotationCenter: [100, 95],
        perspective: [[100, 100], [110, 100], [110, 90], [100, 90]],
      }],
      hitRegions: [],
      labelBounds: { x: 99, y: 88, width: 2, height: 15 },
      labelPinned: true,
      derived: { formattedLabel: 'A' },
    };
    const svg = layoutResultsToSvg([layout], FONT, SOLVESPACE_DIMENSION_THEME, METADATA);

    const { dimension3d } = SOLVESPACE_DIMENSION_THEME;
    const d = 'd="M 99 100 L 100 90 M 100 90 L 101 100"';
    expect(svg).toContain(
      `<path ${d} data-part="label-halo" data-text-plane="3d" stroke="${dimension3d.textHaloColor}" stroke-width="${dimension3d.textStrokeWidthPx + 2 * dimension3d.textHaloWidthPx}"`,
    );
    expect(svg).toContain(
      `<path ${d} data-part="label" data-text-plane="3d" stroke="${SOLVESPACE_DIMENSION_THEME.textColors.external}" stroke-width="${dimension3d.textStrokeWidthPx}"`,
    );
    // The halo is painted first, the glyph strokes on top; the view-plane
    // approximation (rotation) is not used.
    expect(svg.indexOf('data-part="label-halo"')).toBeLessThan(svg.indexOf('data-part="label" '));
    expect(svg).not.toContain('transform="rotate');
    expect(svg).not.toContain('<text');
  });

  it('foreshortens 3D text like the viewport when the frame is in perspective', () => {
    // Trapezoid frame: the top edge (v = 1) is narrower than the baseline.
    const layout: LayoutResult = {
      dimensionId: 'dim-3d-text-perspective',
      scenePrimitives: [],
      primitives: [{
        kind: 'glyph-run',
        text: 'A',
        origin: [99, 100],
        capHeightPx: 10,
        bounds: { x: 99, y: 88, width: 2, height: 15 },
        styleRole: 'external',
        perspective: [[100, 100], [120, 100], [115, 90], [105, 90]],
      }],
      hitRegions: [],
      labelBounds: { x: 99, y: 88, width: 2, height: 15 },
      labelPinned: true,
      derived: { formattedLabel: 'A' },
    };
    const svg = layoutResultsToSvg([layout], FONT, SOLVESPACE_DIMENSION_THEME, METADATA);

    // The apex (u = 0, v = 1) is the frame's (0, 1) corner exactly; the feet
    // stay on the 20 px baseline (v = 0 ⇒ y = 100) ±2 px from its centre —
    // the glyph is 20 px wide at its feet and converges to the narrower top.
    const label = /<path d="([^"]+)" data-part="label" data-text-plane="3d"/.exec(svg);
    expect(label).not.toBeNull();
    expect(label![1]).toBe('M 98 100 L 105 90 M 105 90 L 102 100');
  });

  it('rejects invalid viewport dimensions', () => {
    expect(() => layoutResultsToSvg([], FONT, SOLVESPACE_DIMENSION_THEME, {
      formatPolicy: {
        lengthUnit: 'mm',
        lengthDecimals: 2,
        angleDecimals: 2,
        approximatePrefix: '~',
        stalePrefix: 'STALE ',
      },
      viewport: { widthCssPx: 0, heightCssPx: 600, dpr: 1 },
      exportedAt: 123,
    })).toThrow('SVG viewport dimensions must be positive');
  });
});

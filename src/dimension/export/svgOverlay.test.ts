import { describe, expect, it } from 'vitest';

import { LffFont } from '../kernel/glyph/lffParser';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import { layoutResultsToSvg } from './svgOverlay';

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

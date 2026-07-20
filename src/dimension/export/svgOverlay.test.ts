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

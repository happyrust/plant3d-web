import { describe, expect, it } from 'vitest';

import { LffFont } from './lffParser';

const INLINE_LFF = [
  '# LetterSpacing: 1',
  '# WordSpacing: 4',
  '[0030] 0',
  '0,0;2,0,A1',
  '',
  '[0031] 1',
  '0,0;0,10',
  '',
  '[0041] A',
  '0,0;1,10;2,0',
  '',
  '[0042] deliberately malformed but lazily ignored',
  'not-a-point',
  '',
  '[0045] E',
  '0,0;0,10;2,10',
  '',
  '[0046] F',
  '0,0;0,10;2,10',
  '',
  '[0052] R',
  '0,0;0,10;2,10',
  '',
  '[0068] h',
  '0,0;0,12;2,12',
  '',
  '[0070] p',
  '0,-3;0,7;2,7',
  '',
  '[00b0] degree',
  '0,8;1,9;2,8',
  '',
  '[2300] diameter',
  '0,0;2,10',
  '',
  '[fffd] replacement',
  '0,0;1,10',
  '',
].join('\r\n');

describe('LffFont', () => {
  it('normalizes CRLF and derives metrics from A, h, and p', () => {
    const font = LffFont.fromText(INLINE_LFF);

    expect(font.letterSpacing).toBe(1);
    expect(font.wordSpacing).toBe(4);
    expect(font.capHeight).toBe(10);
    expect(font.ascender).toBe(12);
    expect(font.descender).toBe(-3);
    expect(font.getWidth(20, 'A A')).toBe(18);
    expect(font.getHeight(20)).toBe(30);
  });

  it('parses codepoints lazily and falls back to the replacement glyph', () => {
    const font = LffFont.fromText(INLINE_LFF);

    expect(font.getGlyph('R'.codePointAt(0)!)).toMatchObject({
      leftSideBearing: 0,
      boundingWidth: 2,
      advanceWidth: 3,
    });
    expect(font.getGlyph('x'.codePointAt(0)!)).toBe(font.getGlyph(0xfffd));
  });

  it('expands each bulge into eight deterministic line subdivisions', () => {
    const points = LffFont.fromText(INLINE_LFF).getGlyph(0x30).contours[0].points;

    expect(points).toHaveLength(10);
    expect(points[0]).toEqual([0, 0]);
    expect(points[5][0]).toBeCloseTo(1, 12);
    expect(points[5][1]).toBeCloseTo(-1, 12);
    expect(points[9][0]).toBeCloseTo(2, 12);
    expect(points[9][1]).toBeCloseTo(0, 12);
  });

  it('traces deterministic screen-space segments', () => {
    const segments = LffFont.fromText(INLINE_LFF).trace(10, 'A', [5, 20]);

    expect(segments).toEqual([
      { from: [5, 20], to: [6, 10] },
      { from: [6, 10], to: [7, 20] },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { traceFramedGlyphRun } from './glyphTrace';
import { LffFont } from './lffParser';

const FONT = LffFont.fromText([
  '# LetterSpacing: 1',
  '# WordSpacing: 4',
  '[0041] A',
  '0,0;1,10;2,0',
  '',
  '[002e] period',
  '1,0;1,0.5',
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

describe('traceFramedGlyphRun', () => {
  it('traces in cap-height units, centred on the baseline, y down', () => {
    // 'A' advances 2 + letter spacing 1; the run width drops the trailing
    // spacing, so the glyph is centred at −0.1 … +0.1.
    const segments = traceFramedGlyphRun(FONT, 'A');
    expect(segments).toHaveLength(2);
    expect(segments[0]!.from[0]).toBeCloseTo(-0.1, 9);
    expect(segments[0]!.from[1]).toBeCloseTo(0, 9);
    expect(segments[0]!.to[0]).toBeCloseTo(0, 9);
    expect(segments[0]!.to[1]).toBeCloseTo(-1, 9);
    expect(segments[1]!.to[0]).toBeCloseTo(0.1, 9);
    expect(segments[1]!.to[1]).toBeCloseTo(0, 9);
  });

  it('lengthens an isolated hairline stroke (the period) to the legibility floor', () => {
    const segments = traceFramedGlyphRun(FONT, '.');
    expect(segments).toHaveLength(1);
    const [segment] = segments;
    const length = Math.hypot(
      segment!.to[0] - segment!.from[0],
      segment!.to[1] - segment!.from[1],
    );
    expect(length).toBeCloseTo(0.12, 9);
    // Grown symmetrically about the original 0.05-high stroke.
    expect((segment!.from[1] + segment!.to[1]) / 2).toBeCloseTo(-0.025, 9);
  });

  it('leaves connected short strokes alone', () => {
    // Two strokes of 'A' share the apex, so neither counts as isolated.
    const segments = traceFramedGlyphRun(FONT, 'A');
    const raw = FONT.trace(1, 'A', [-FONT.getWidth(1, 'A') / 2, 0]);
    expect(segments).toEqual(raw);
  });
});

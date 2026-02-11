import { describe, it, expect } from 'vitest'
import { SolveSpaceVectorFont } from './SolveSpaceVectorFont'

/**
 * Minimal LFF snippet for unit tests.
 *
 * Notes:
 * - SolveSpaceVectorFont computes metrics using glyphs: 'A', 'h', 'p'.
 * - Glyph blocks should be sorted by codepoint for binary-search lookup.
 */
const TEST_LFF = [
  '# letterspacing: 0.2',
  '# wordspacing: 0.6',
  '',
  // '0' (0030): includes a bulge arc on the 2nd point
  '[0030]',
  '0,0;1,0,A1;2,0',
  '',
  // 'A' (0041): cap height = 1
  '[0041]',
  '0,0;1,0;1,1;0,1;0,0',
  '',
  // 'h' (0068): ascender = 1
  '[0068]',
  '0,0;0,1',
  '',
  // 'p' (0070): descender = -0.5
  '[0070]',
  '0,-0.5;0,1',
  '',
].join('\n')

describe('SolveSpaceVectorFont', () => {
  it('parses header directives and computes metrics', () => {
    const font = new SolveSpaceVectorFont()
    font.loadFromLffText(TEST_LFF)

    // GetCapHeight returns the input cap height in SolveSpace semantics
    expect(font.getCapHeight(10)).toBe(10)

    // Height = (ascender - descender) * scale
    expect(font.getHeight(10)).toBeCloseTo(15, 6)

    // Word spacing from header is respected ("0.6"), with letterspacing stripped at end ("0.2")
    expect(font.getWidth(10, ' ')).toBeCloseTo(4, 6)

    // 'A' advanceWidth is (maxx + letterspacing) in our simple glyph; then strip one letterspacing at end
    expect(font.getWidth(10, 'A')).toBeCloseTo(10, 6)
    expect(font.getWidth(10, 'AA')).toBeCloseTo(22, 6)
  })

  it('supports bulge arcs (MakePwlBulge) and traces to line segments', () => {
    const font = new SolveSpaceVectorFont()
    font.loadFromLffText(TEST_LFF)

    const cp0 = '0'.codePointAt(0)!
    const g0 = font.getGlyph(cp0)
    expect(g0.contours.length).toBeGreaterThan(0)
    expect(g0.contours[0]!.points.length).toBeGreaterThan(8) // ARC_POINTS=8 => many points

    // bulge arc should introduce some non-zero y
    const maxY = Math.max(...g0.contours[0]!.points.map((p) => p.y))
    expect(maxY).toBeGreaterThan(0)

    const edges: Array<[number, number, number, number]> = []
    font.trace2D(10, 0, 0, '0', (ax, ay, bx, by) => edges.push([ax, ay, bx, by]))
    expect(edges.length).toBeGreaterThan(8)

    // caching
    expect(font.getGlyph(cp0)).toBe(font.getGlyph(cp0))
  })
})


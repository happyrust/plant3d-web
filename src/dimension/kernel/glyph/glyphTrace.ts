import type { Vec2 } from '../types';
import type { GlyphSegment, LffFont } from './lffParser';

export function traceGlyphRun(
  font: LffFont,
  input: Readonly<{ text: string; capHeightPx: number; origin: Vec2 }>,
): readonly GlyphSegment[] {
  return font.trace(input.capHeightPx, input.text, input.origin);
}

/**
 * Shortest glyph stroke of a framed run, in cap heights. The LFF period is a
 * 0.5/9 cap-height hairline that all but vanishes under the heavier 3D text
 * stroke and its halo; point-like strokes are lengthened symmetrically to
 * this so decimal marks stay legible (≈ 1.6 px at the 13 px floor).
 */
const MIN_FRAMED_GLYPH_SEGMENT = 0.12;

/**
 * Glyph strokes of a framed (3D) run in cap-height units, baseline-centred:
 * x runs along the baseline from its centre, y grows downwards as in
 * `LffFont.trace`. The painter maps them into the run's design-space frame;
 * the SVG export sends them through the frame's screen homography — both
 * draw the same strokes, so the export matches the viewport.
 */
export function traceFramedGlyphRun(
  font: LffFont,
  text: string,
): readonly GlyphSegment[] {
  const segments = font.trace(1, text, [-font.getWidth(1, text) / 2, 0]);
  // Only isolated strokes (neither end shared with another stroke) are
  // lengthened: the short chords of a subdivided arc stay as they are.
  const key = (point: Vec2): string => `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
  const endpointUses = new Map<string, number>();
  for (const segment of segments) {
    for (const point of [segment.from, segment.to]) {
      endpointUses.set(key(point), (endpointUses.get(key(point)) ?? 0) + 1);
    }
  }
  return segments.map((segment) => {
    const dx = segment.to[0] - segment.from[0];
    const dy = segment.to[1] - segment.from[1];
    const length = Math.hypot(dx, dy);
    const isolated = endpointUses.get(key(segment.from)) === 1
      && endpointUses.get(key(segment.to)) === 1;
    if (length >= MIN_FRAMED_GLYPH_SEGMENT || !isolated) return segment;
    const [ux, uy] = length > 0 ? [dx / length, dy / length] : [0, -1];
    const grow = (MIN_FRAMED_GLYPH_SEGMENT - length) / 2;
    return {
      from: [segment.from[0] - ux * grow, segment.from[1] - uy * grow],
      to: [segment.to[0] + ux * grow, segment.to[1] + uy * grow],
    };
  });
}

import type { Vec2 } from '../types';
import type { GlyphSegment, LffFont } from './lffParser';

export function traceGlyphRun(
  font: LffFont,
  input: Readonly<{ text: string; capHeightPx: number; origin: Vec2 }>,
): readonly GlyphSegment[] {
  return font.trace(input.capHeightPx, input.text, input.origin);
}

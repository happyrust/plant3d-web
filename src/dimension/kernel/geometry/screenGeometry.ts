import type { LffFont } from '../glyph/lffParser';
import type {
  HitRegion,
  ScreenGlyphRun,
  ScreenLine,
  ScreenLinePart,
  ScreenRect,
  Vec2,
} from '../types';

export function makeScreenLine(
  from: Vec2,
  to: Vec2,
  part: ScreenLinePart,
  styleRole: string,
): ScreenLine {
  return { kind: 'line', from, to, part, styleRole };
}

export function makeLineHitRegion(line: ScreenLine, widthPx: number): HitRegion {
  return {
    kind: 'segment',
    from: line.from,
    to: line.to,
    widthPx,
    part: line.part,
  };
}

export function makeGlyphHitRegion(glyph: ScreenGlyphRun): HitRegion {
  return { kind: 'rect', rect: glyph.bounds, part: 'label' };
}

export function expandRect(rect: ScreenRect, amountPx: number): ScreenRect {
  return {
    x: rect.x - amountPx,
    y: rect.y - amountPx,
    width: rect.width + amountPx * 2,
    height: rect.height + amountPx * 2,
  };
}

export function translateRect(rect: ScreenRect, offset: Vec2): ScreenRect {
  return {
    x: rect.x + offset[0],
    y: rect.y + offset[1],
    width: rect.width,
    height: rect.height,
  };
}

export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function makeCenteredGlyphRun(
  font: LffFont,
  text: string,
  center: Vec2,
  capHeightPx: number,
  styleRole: string,
): ScreenGlyphRun {
  const width = font.getWidth(capHeightPx, text);
  const height = font.getHeight(capHeightPx);
  const scale = capHeightPx / font.capHeight;
  const bounds: ScreenRect = {
    x: center[0] - width / 2,
    y: center[1] - height / 2,
    width,
    height,
  };
  return {
    kind: 'glyph-run',
    text,
    origin: [
      bounds.x,
      center[1] + ((font.ascender + font.descender) * scale) / 2,
    ],
    capHeightPx,
    bounds,
    styleRole,
  };
}

import type { Vec2 } from '../types';

const ARC_SUBDIVISIONS = 8;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

export type GlyphContour = Readonly<{ points: readonly Vec2[] }>;
export type Glyph = Readonly<{
  contours: readonly GlyphContour[];
  leftSideBearing: number;
  boundingWidth: number;
  advanceWidth: number;
}>;
export type GlyphSegment = Readonly<{ from: Vec2; to: Vec2 }>;

type GlyphSource = Readonly<{
  bodyStart: number;
  bodyEnd: number;
}>;

class LineReader {
  private offset = 0;

  constructor(private readonly input: string) {}

  atEnd(): boolean {
    this.skipWhitespace();
    return this.offset >= this.input.length;
  }

  tryChar(expected: string): boolean {
    this.skipWhitespace();
    if (this.input[this.offset] !== expected) return false;
    this.offset += 1;
    return true;
  }

  expectChar(expected: string): void {
    if (!this.tryChar(expected)) {
      throw new SyntaxError(`Expected "${expected}" in LFF contour "${this.input}"`);
    }
  }

  readNumber(): number {
    this.skipWhitespace();
    const match = this.input.slice(this.offset).match(NUMBER_PATTERN);
    if (!match) {
      throw new SyntaxError(`Expected a number in LFF contour "${this.input}"`);
    }
    this.offset += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace(): void {
    while (this.offset < this.input.length && /\s/.test(this.input[this.offset])) {
      this.offset += 1;
    }
  }
}

function polar(radius: number, angle: number): Vec2 {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function appendBulge(points: Vec2[], endpoint: Vec2, bulge: number): void {
  if (points.length === 0) {
    throw new SyntaxError('An LFF bulge requires a preceding point');
  }
  if (bulge === 0) {
    throw new SyntaxError('An LFF bulge cannot be zero');
  }

  const reversed = bulge < 0;
  const alpha = Math.atan(bulge) * 4;
  const start = points[points.length - 1];
  const middle: Vec2 = [(start[0] + endpoint[0]) / 2, (start[1] + endpoint[1]) / 2];
  const halfChord = Math.hypot(endpoint[0] - start[0], endpoint[1] - start[1]) / 2;
  let chordAngle = Math.atan2(endpoint[1] - start[1], endpoint[0] - start[0]);
  const radius = Math.abs(halfChord / Math.sin(alpha / 2));
  let centerDistance = Math.sqrt(Math.abs(radius * radius - halfChord * halfChord));

  chordAngle += bulge > 0 ? Math.PI / 2 : -Math.PI / 2;
  if (Math.abs(alpha) > Math.PI) centerDistance = -centerDistance;

  const centerOffset = polar(centerDistance, chordAngle);
  const center: Vec2 = [middle[0] + centerOffset[0], middle[1] + centerOffset[1]];
  let startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let endAngle = Math.atan2(endpoint[1] - center[1], endpoint[0] - center[0]);
  const sign = reversed ? -1 : 1;

  if (reversed) {
    if (startAngle <= endAngle + Number.EPSILON) startAngle += 2 * Math.PI;
  } else if (endAngle <= startAngle + Number.EPSILON) {
    endAngle += 2 * Math.PI;
  }

  const step = (sign * Math.abs(endAngle - startAngle)) / ARC_SUBDIVISIONS;
  for (let index = 0; index <= ARC_SUBDIVISIONS; index += 1) {
    const point = polar(radius, startAngle + step * index);
    points.push([center[0] + point[0], center[1] + point[1]]);
  }
}

function parseContour(line: string): GlyphContour {
  const reader = new LineReader(line);
  const points: Vec2[] = [];

  while (!reader.atEnd()) {
    const x = reader.readNumber();
    reader.expectChar(',');
    const point: Vec2 = [x, reader.readNumber()];

    if (reader.tryChar(',')) {
      reader.expectChar('A');
      appendBulge(points, point, reader.readNumber());
    } else {
      points.push(point);
    }

    if (!reader.tryChar(';')) break;
  }

  if (!reader.atEnd()) {
    throw new SyntaxError(`Unexpected content in LFF contour "${line}"`);
  }
  return { points };
}

function getGlyphBounds(glyph: Glyph): Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}> {
  const points = glyph.contours.flatMap((contour) => contour.points);
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  let minX = points[0][0];
  let maxX = points[0][0];
  let minY = points[0][1];
  let maxY = points[0][1];
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  return { minX, maxX, minY, maxY };
}

export class LffFont {
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly capHeight: number;
  readonly ascender: number;
  readonly descender: number;

  private readonly glyphSources = new Map<number, GlyphSource>();
  private readonly glyphCache = new Map<number, Glyph>();
  private readonly widthCache = new Map<string, number>();
  private readonly parsing = new Set<number>();

  private constructor(private readonly lffData: string, letterSpacing: number, wordSpacing: number) {
    this.letterSpacing = letterSpacing;
    this.wordSpacing = wordSpacing;
    this.indexGlyphSources();
    this.glyphCache.set(0x20, {
      contours: [],
      leftSideBearing: 0,
      boundingWidth: 0,
      advanceWidth: wordSpacing,
    });

    this.capHeight = getGlyphBounds(this.getGlyph(0x41)).maxY;
    this.ascender = getGlyphBounds(this.getGlyph(0x68)).maxY;
    this.descender = getGlyphBounds(this.getGlyph(0x70)).minY;
    if (this.capHeight <= 0) {
      throw new RangeError('LFF font cap height must be positive');
    }
  }

  static fromText(text: string): LffFont {
    const normalized = `${text.replace(/\r\n?/g, '\n').replace(/\n*$/, '')}\n`;
    let letterSpacing: number | undefined;
    let wordSpacing: number | undefined;
    const headerPattern = /^#\s*(\w+)\s*:\s*(.*?)\s*$/gim;

    for (const match of normalized.matchAll(headerPattern)) {
      const name = match[1].toLowerCase();
      if (name === 'letterspacing') letterSpacing = Number(match[2]);
      if (name === 'wordspacing') wordSpacing = Number(match[2]);
    }
    if (!Number.isFinite(letterSpacing) || !Number.isFinite(wordSpacing)) {
      throw new SyntaxError('LFF font requires finite LetterSpacing and WordSpacing headers');
    }
    return new LffFont(normalized, letterSpacing!, wordSpacing!);
  }

  getGlyph(codePoint: number): Glyph {
    const cached = this.glyphCache.get(codePoint);
    if (cached) return cached;

    const source = this.glyphSources.get(codePoint);
    if (!source) {
      if (codePoint === 0xfffd) throw new RangeError('LFF font has no replacement glyph');
      return this.getGlyph(0xfffd);
    }
    if (this.parsing.has(codePoint)) {
      throw new SyntaxError(`Recursive LFF glyph reference U+${codePoint.toString(16)}`);
    }

    this.parsing.add(codePoint);
    try {
      const contours: GlyphContour[] = [];
      const body = this.lffData.slice(source.bodyStart, source.bodyEnd);
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;
        if (line.startsWith('C')) {
          const referencedCodePoint = Number.parseInt(line.slice(1).trim(), 16);
          if (!Number.isFinite(referencedCodePoint)) {
            throw new SyntaxError(`Invalid LFF glyph reference "${line}"`);
          }
          for (const contour of this.getGlyph(referencedCodePoint).contours) {
            contours.push({ points: [...contour.points] });
          }
          continue;
        }
        contours.push(parseContour(line));
      }

      const provisional: Glyph = {
        contours,
        leftSideBearing: 0,
        boundingWidth: 0,
        advanceWidth: 0,
      };
      const bounds = getGlyphBounds(provisional);
      const glyph: Glyph = {
        contours,
        leftSideBearing: bounds.minX,
        boundingWidth: bounds.maxX,
        advanceWidth: bounds.minX + bounds.maxX + this.letterSpacing,
      };
      this.glyphCache.set(codePoint, glyph);
      return glyph;
    } finally {
      this.parsing.delete(codePoint);
    }
  }

  getWidth(capHeightPx: number, text: string): number {
    if (text.length === 0) return 0;
    let unscaledWidth = this.widthCache.get(text);
    if (unscaledWidth === undefined) {
      unscaledWidth = 0;
      for (const character of text) {
        unscaledWidth += this.getGlyph(character.codePointAt(0)!).advanceWidth;
      }
      unscaledWidth -= this.letterSpacing;
      this.widthCache.set(text, unscaledWidth);
    }
    return unscaledWidth * (capHeightPx / this.capHeight);
  }

  getHeight(capHeightPx: number): number {
    return (this.ascender - this.descender) * (capHeightPx / this.capHeight);
  }

  trace(capHeightPx: number, text: string, origin: Vec2): readonly GlyphSegment[] {
    const scale = capHeightPx / this.capHeight;
    const segments: GlyphSegment[] = [];
    let cursorX = origin[0];

    for (const character of text) {
      const glyph = this.getGlyph(character.codePointAt(0)!);
      for (const contour of glyph.contours) {
        for (let index = 1; index < contour.points.length; index += 1) {
          const from = contour.points[index - 1];
          const to = contour.points[index];
          segments.push({
            from: [cursorX + from[0] * scale, origin[1] - from[1] * scale],
            to: [cursorX + to[0] * scale, origin[1] - to[1] * scale],
          });
        }
      }
      cursorX += glyph.advanceWidth * scale;
    }
    return segments;
  }

  private indexGlyphSources(): void {
    const pattern = /^\[([0-9a-f]{4,6})\][^\n]*\n/gim;
    const headers = [...this.lffData.matchAll(pattern)];
    for (let index = 0; index < headers.length; index += 1) {
      const match = headers[index];
      const codePoint = Number.parseInt(match[1], 16);
      this.glyphSources.set(codePoint, {
        bodyStart: match.index + match[0].length,
        bodyEnd: headers[index + 1]?.index ?? this.lffData.length,
      });
    }
    if (headers.length === 0) throw new SyntaxError('Vector font contains no glyphs');
  }
}

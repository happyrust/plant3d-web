/**
 * SolveSpace vector font loader + tracer (LFF format).
 *
 * This is a TypeScript port of SolveSpace's `VectorFont` implementation:
 * - Parses `unicode.lff.gz` (LFF) data (including bulge arcs).
 * - Provides metrics (`getWidth/getHeight/getCapHeight`) and edge tracing (`trace2D`).
 *
 * Reference (SolveSpace):
 * - `VectorFont::From/GetWidth/GetHeight/Trace` in `solvespace/src/resource.cpp`
 */
export type Vec2 = { x: number; y: number };

export type GlyphContour = { points: Vec2[] };

export type Glyph = {
  contours: GlyphContour[];
  leftSideBearing: number;
  /** Note: SolveSpace stores `maxx` here (not maxx-minx). */
  boundingWidth: number;
  advanceWidth: number;
};

const PI = Math.PI;
const PI_2 = Math.PI / 2;
const ARC_POINTS = 8;
const LENGTH_EPS = 1e-9;

function isDigit(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function fromPolar(r: number, a: number): Vec2 {
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

function plus(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scaledBy(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

function distanceTo(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleTo(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function makePwlArc(
  contour: GlyphContour,
  isReversed: boolean,
  cp: Vec2,
  radius: number,
  a1: number,
  a2: number,
): void {
  if (radius < LENGTH_EPS) return;

  let aSign = 1.0;
  if (isReversed) {
    if (a1 <= a2 + LENGTH_EPS) a1 += 2.0 * PI;
    aSign = -1.0;
  } else {
    if (a2 <= a1 + LENGTH_EPS) a2 += 2.0 * PI;
  }

  const aStep = (aSign * Math.abs(a2 - a1)) / ARC_POINTS;
  for (let i = 0; i <= ARC_POINTS; i++) {
    contour.points.push(plus(cp, fromPolar(radius, a1 + aStep * i)));
  }
}

function makePwlBulge(contour: GlyphContour, v: Vec2, bulge: number): void {
  const reversed = bulge < 0.0;
  const alpha = Math.atan(bulge) * 4.0;
  const point = contour.points[contour.points.length - 1];
  if (!point) return;

  const middle = scaledBy(plus(point, v), 0.5);
  const dist = distanceTo(point, v) / 2.0;
  let angle = angleTo(point, v);

  const radius = Math.abs(dist / Math.sin(alpha / 2.0));
  const wu = Math.abs(radius * radius - dist * dist);
  let h = Math.sqrt(wu);

  if (bulge > 0.0) angle += PI_2;
  else angle -= PI_2;

  if (Math.abs(alpha) > PI) h = -h;

  const center = plus(fromPolar(h, angle), middle);
  const a1 = angleTo(center, point);
  const a2 = angleTo(center, v);
  makePwlArc(contour, reversed, center, radius, a1, a2);
}

function getGlyphBBox(glyph: Glyph): {
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
} {
  let minx = 0.0,
    maxx = 0.0,
    miny = 0.0,
    maxy = 0.0;
  const first = glyph.contours[0]?.points[0];
  if (first) {
    minx = maxx = first.x;
    miny = maxy = first.y;
    for (const c of glyph.contours) {
      for (const p of c.points) {
        maxx = Math.max(maxx, p.x);
        minx = Math.min(minx, p.x);
        maxy = Math.max(maxy, p.y);
        miny = Math.min(miny, p.y);
      }
    }
  }
  return { minx, maxx, miny, maxy };
}

function readFloatDecimal(
  s: string,
  i0: number,
): { value: number; next: number } {
  let i = i0;
  const start = i;
  const sign = s[i];
  if (sign === '+' || sign === '-') i++;

  let hasDigit = false;
  while (isDigit(s[i])) {
    i++;
    hasDigit = true;
  }
  if (s[i] === '.') {
    i++;
    while (isDigit(s[i])) {
      i++;
      hasDigit = true;
    }
  }

  // optional exponent
  if (s[i] === 'e' || s[i] === 'E') {
    let j = i + 1;
    const es = s[j];
    if (es === '+' || es === '-') j++;
    let hasExp = false;
    while (isDigit(s[j])) {
      j++;
      hasExp = true;
    }
    if (hasExp) i = j;
  }

  if (!hasDigit) throw new Error(`Invalid float at ${i0}`);
  const value = Number(s.slice(start, i));
  return { value, next: i };
}

function readHex16(s: string, i0: number): { value: number; next: number } {
  const hex = s.slice(i0, i0 + 4);
  if (hex.length !== 4) throw new Error(`Invalid hex16 at ${i0}`);
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value))
    throw new Error(`Invalid hex16 '${hex}' at ${i0}`);
  return { value, next: i0 + 4 };
}

function skipUntilEol(s: string, i0: number): number {
  let i = i0;
  while (i < s.length && s[i] !== '\n') i++;
  return i;
}

function isGlyphLineStart(s: string, i: number): boolean {
  if (s[i] !== '[') return false;
  return i === 0 || s[i - 1] === '\n';
}

export class SolveSpaceVectorFont {
  private lffData = '';
  private rightSideBearing = 0.0;
  private glyphs = new Map<number, Glyph>();
  private firstGlyphIndex = -1;

  private capHeight = 1.0;
  private ascender = 1.0;
  private descender = 0.0;

  static async loadFromGzipUrl(
    url = '/fonts/unicode.lff.gz',
  ): Promise<SolveSpaceVectorFont> {
    const resp = await fetch(url);
    if (!resp.ok)
      throw new Error(
        `Failed to load SolveSpace font: ${url} (${resp.status})`,
      );
    const ab = await resp.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const text = await decodeLffPayload(bytes);
    const font = new SolveSpaceVectorFont();
    font.loadFromLffText(text);
    return font;
  }

  loadFromLffText(lffText: string): void {
    // normalize CRLF
    this.lffData = lffText.replace(/\r\n/g, '\n');
    this.firstGlyphIndex = this.lffData.indexOf('[');
    if (this.firstGlyphIndex < 0)
      throw new Error('Vector font contains no glyphs');

    // Parse header directives like SolveSpace: "# wordspacing: ..." etc
    const re = /#\s*(\w+)\s*:\s*(.+?)\n/g;
    for (const m of this.lffData.matchAll(re)) {
      const name = String(m[1] ?? '').toLowerCase();
      const value = String(m[2] ?? '').trim();
      if (name === 'letterspacing') {
        this.rightSideBearing = Number(value);
      } else if (name === 'wordspacing') {
        const space: Glyph = {
          contours: [],
          leftSideBearing: 0,
          boundingWidth: 0,
          advanceWidth: Number(value),
        };
        this.glyphs.set(' '.codePointAt(0)!, space);
      }
    }

    // Compute font metrics (capHeight/ascender/descender) using A/h/p like SolveSpace
    const glyphA = this.getGlyph('A'.codePointAt(0)!);
    this.capHeight = getGlyphBBox(glyphA).maxy;
    const glyphH = this.getGlyph('h'.codePointAt(0)!);
    this.ascender = getGlyphBBox(glyphH).maxy;
    const glyphp = this.getGlyph('p'.codePointAt(0)!);
    this.descender = getGlyphBBox(glyphp).miny;

    if (!Number.isFinite(this.capHeight) || Math.abs(this.capHeight) < 1e-9) {
      throw new Error('SolveSpaceVectorFont: invalid capHeight');
    }
  }

  /** SolveSpace: GetCapHeight() returns input cap height */
  getCapHeight(forCapHeight: number): number {
    return forCapHeight;
  }

  /** SolveSpace: (ascender-descender) * (forCapHeight / capHeight) */
  getHeight(forCapHeight: number): number {
    return (this.ascender - this.descender) * (forCapHeight / this.capHeight);
  }

  /** SolveSpace: sum(advanceWidth) - rightSideBearing */
  getWidth(forCapHeight: number, str: string): number {
    let width = 0;
    for (const ch of str) {
      const cp = ch.codePointAt(0) ?? 0;
      width += this.getGlyph(cp).advanceWidth;
    }
    width -= this.rightSideBearing;
    return width * (forCapHeight / this.capHeight);
  }

  getExtents(forCapHeight: number, str: string): { x: number; y: number } {
    return {
      x: this.getWidth(forCapHeight, str),
      y: this.getHeight(forCapHeight),
    };
  }

  /**
   * Trace edges for `str` in 2D space.
   *
   * Equivalent to SolveSpace `VectorFont::Trace()` with basis u=(1,0) v=(0,1).
   */
  trace2D(
    forCapHeight: number,
    ox: number,
    oy: number,
    str: string,
    traceEdge: (ax: number, ay: number, bx: number, by: number) => void,
  ): void {
    const scale = forCapHeight / this.capHeight;
    let oX = ox;
    const oY = oy;

    for (const ch of str) {
      const cp = ch.codePointAt(0) ?? 0;
      const glyph = this.getGlyph(cp);
      for (const contour of glyph.contours) {
        let prev: Vec2 | null = null;
        for (const pt of contour.points) {
          const p = { x: oX + pt.x * scale, y: oY + pt.y * scale };
          if (prev) traceEdge(prev.x, prev.y, p.x, p.y);
          prev = p;
        }
      }
      oX += glyph.advanceWidth * scale;
    }
  }

  getGlyph(codepoint: number): Glyph {
    const cached = this.glyphs.get(codepoint);
    if (cached) return cached;

    const off = this.findGlyphOffset(codepoint);
    if (off === null) {
      if (codepoint === 0xfffd) {
        const q = this.glyphs.get('?'.codePointAt(0)!);
        if (q) return q;
        return {
          contours: [],
          leftSideBearing: 0,
          boundingWidth: 0,
          advanceWidth: 0,
        };
      }
      return this.getGlyph(0xfffd);
    }

    const glyph = this.parseGlyphAt(off);
    this.glyphs.set(codepoint, glyph);
    return glyph;
  }

  private findGlyphOffset(codepoint: number): number | null {
    const s = this.lffData;
    if (!s || this.firstGlyphIndex < 0) return null;

    let first = this.firstGlyphIndex;
    let last = s.length - 1;

    while (first <= last) {
      let mid = first + Math.floor((last - first) / 2);

      while (mid > first) {
        if (isGlyphLineStart(s, mid)) break;
        mid--;
      }
      if (!isGlyphLineStart(s, mid)) {
        while (mid < s.length && !isGlyphLineStart(s, mid)) mid++;
        if (mid >= s.length) return null;
      }

      const h = readHex16(s, mid + 1);
      const found = h.value;
      const close = s[h.next];
      if (close !== ']') return null;

      if (found > codepoint) {
        last = mid - 1;
        continue;
      }
      if (found < codepoint) {
        first = mid + 1;
        while (first < s.length && !isGlyphLineStart(s, first)) first++;
        continue;
      }
      return mid;
    }

    return null;
  }

  private parseGlyphAt(offset: number): Glyph {
    const s = this.lffData;
    let i = offset;
    if (s[i] !== '[') throw new Error(`Expected '[' at ${offset}`);
    i++;
    const h = readHex16(s, i);
    void h.value;
    i = h.next;
    if (s[i] !== ']') throw new Error(`Expected ']' at ${i}`);
    i++;
    i = skipUntilEol(s, i);
    if (s[i] === '\n') i++;

    const glyph: Glyph = {
      contours: [],
      leftSideBearing: 0,
      boundingWidth: 0,
      advanceWidth: 0,
    };

    while (i < s.length) {
      const ch = s[i];
      if (ch === '\n') {
        i++;
        continue;
      }
      if (ch === '[' && isGlyphLineStart(s, i)) break;

      if (ch === 'C') {
        i++;
        const base = readHex16(s, i);
        i = base.next;
        i = skipUntilEol(s, i);
        if (s[i] === '\n') i++;
        const baseGlyph = this.getGlyph(base.value);
        for (const c0 of baseGlyph.contours) {
          glyph.contours.push({
            points: c0.points.map((p) => ({ x: p.x, y: p.y })),
          });
        }
        continue;
      }

      const contour: GlyphContour = { points: [] };
      while (i < s.length) {
        const fx = readFloatDecimal(s, i);
        i = fx.next;
        if (s[i] !== ',') throw new Error(`Expected ',' at ${i}`);
        i++;
        const fy = readFloatDecimal(s, i);
        i = fy.next;

        const p: Vec2 = { x: fx.value, y: fy.value };
        if (s[i] === ',') {
          i++;
          if (s[i] !== 'A') throw new Error(`Expected 'A' at ${i}`);
          i++;
          const fb = readFloatDecimal(s, i);
          i = fb.next;
          makePwlBulge(contour, p, fb.value);
        } else {
          contour.points.push(p);
        }

        if (s[i] === ';') {
          i++;
          continue;
        }
        if (s[i] === '\n') {
          i++;
          break;
        }
        if (s[i] === '\r' && s[i + 1] === '\n') {
          i += 2;
          break;
        }

        i = skipUntilEol(s, i);
        if (s[i] === '\n') i++;
        break;
      }
      glyph.contours.push(contour);
    }

    const bbox = getGlyphBBox(glyph);
    glyph.leftSideBearing = bbox.minx;
    glyph.boundingWidth = bbox.maxx;
    glyph.advanceWidth =
      glyph.leftSideBearing + glyph.boundingWidth + this.rightSideBearing;
    return glyph;
  }
}

let _builtinFontPromise: Promise<SolveSpaceVectorFont> | null = null;
let _builtinFontUrl: string | null = null;

/** Load (and cache) SolveSpace `unicode.lff.gz` from `public/fonts/`. */
export function getSolveSpaceBuiltinVectorFont(
  url = '/fonts/unicode.lff.gz',
): Promise<SolveSpaceVectorFont> {
  if (!_builtinFontPromise || _builtinFontUrl !== url) {
    _builtinFontUrl = url;
    _builtinFontPromise = SolveSpaceVectorFont.loadFromGzipUrl(url).catch(
      (err) => {
        // 避免“首次失败后永久缓存 rejected Promise”，后续可重试恢复
        _builtinFontPromise = null;
        _builtinFontUrl = null;
        throw err;
      },
    );
  }
  return _builtinFontPromise;
}

function isGzipBytes(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

async function decodeLffPayload(data: Uint8Array): Promise<string> {
  // 某些服务器会对 .gz 文件自动解压（响应头仍可能含 content-encoding:gzip），
  // 浏览器拿到的可能已经是纯文本；此时不能再 gunzip。
  if (!isGzipBytes(data)) {
    return new TextDecoder('utf-8').decode(data);
  }
  return await gunzipToText(data);
}

async function gunzipToText(data: Uint8Array): Promise<string> {
  const DS: any = (globalThis as any).DecompressionStream;
  if (!DS) {
    throw new Error(
      'DecompressionStream is not available; please run in a modern Chromium-based browser',
    );
  }
  const ds = new DS('gzip');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

import { resolveDimensionLineDash } from '../kernel/theme';

import type { LffFont } from '../kernel/glyph/lffParser';
import type { DimensionStyleRole, DimensionTheme } from '../kernel/theme';
import type {
  DimensionLineStyle,
  LayoutPrimitive,
  LayoutResult,
  Vec2,
} from '../kernel/types';

function alignedCoordinate(value: number, lineWidthPx: number): number {
  const roundedWidth = Math.round(lineWidthPx);
  return roundedWidth % 2 === 1
    ? Math.round(value) + 0.5
    : Math.round(value);
}

/** Both CanvasRenderingContext2D and Path2D satisfy this surface. */
type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  closePath(): void;
};

/**
 * Single dispatch for geometric stroke primitives, shared by the batched
 * Path2D path and the direct-context fallback so the two rendering paths
 * cannot drift: lines stay pixel-aligned, paths and markers stay unaligned
 * (arc smoothness beats crispness).
 */
function appendStrokePrimitive(
  sink: PathSink,
  primitive: Exclude<LayoutPrimitive, { kind: 'glyph-run' }>,
  offset: Vec2,
  lineWidthPx: number,
): void {
  if (primitive.kind === 'line') {
    sink.moveTo(
      alignedCoordinate(primitive.from[0] + offset[0], lineWidthPx),
      alignedCoordinate(primitive.from[1] + offset[1], lineWidthPx),
    );
    sink.lineTo(
      alignedCoordinate(primitive.to[0] + offset[0], lineWidthPx),
      alignedCoordinate(primitive.to[1] + offset[1], lineWidthPx),
    );
    return;
  }
  if (primitive.kind === 'path') {
    const first = primitive.points[0];
    if (!first || primitive.points.length < 2) return;
    sink.moveTo(first[0] + offset[0], first[1] + offset[1]);
    for (let index = 1; index < primitive.points.length; index += 1) {
      const point = primitive.points[index]!;
      sink.lineTo(point[0] + offset[0], point[1] + offset[1]);
    }
    if (primitive.closed) sink.closePath();
    return;
  }
  const x = primitive.at[0] + offset[0];
  const y = primitive.at[1] + offset[1];
  const radius = primitive.radiusPx;
  if (primitive.shape === 'circle') {
    sink.moveTo(x + radius, y);
    sink.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }
  sink.moveTo(x - radius, y);
  sink.lineTo(x + radius, y);
  sink.moveTo(x, y - radius);
  sink.lineTo(x, y + radius);
}

type StrokeBatchKey = string;

type StrokeBatchStyle = Readonly<{
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

function strokeBatchKey(primitive: LayoutPrimitive): StrokeBatchKey {
  const lineStyle = primitive.kind === 'glyph-run'
    ? undefined
    : primitive.lineStyle;
  return `${primitive.styleRole}\u0000${lineStyle ?? ''}`;
}

function strokeBatchStyle(primitive: LayoutPrimitive): StrokeBatchStyle {
  return {
    styleRole: primitive.styleRole,
    ...(primitive.kind !== 'glyph-run' && primitive.lineStyle
      ? { lineStyle: primitive.lineStyle }
      : {}),
  };
}

export class Canvas2DDimensionPainter {
  private readonly context: CanvasRenderingContext2D;
  private widthCssPx = 0;
  private heightCssPx = 0;
  private dpr = 1;
  private disposed = false;
  private readonly glyphTraceCache = new Map<
    string,
    ReturnType<LffFont['trace']>
  >();
  private readonly glyphPathCache = new Map<string, Path2D>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly font: LffFont,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Dimension overlay requires a Canvas2D context');
    this.context = context;
  }

  resize(widthCssPx: number, heightCssPx: number, dpr: number): void {
    if (this.disposed) return;
    if (
      !Number.isFinite(widthCssPx)
      || !Number.isFinite(heightCssPx)
      || !Number.isFinite(dpr)
      || widthCssPx < 0
      || heightCssPx < 0
      || dpr <= 0
    ) {
      throw new RangeError('Dimension canvas size and DPR must be finite');
    }

    this.widthCssPx = widthCssPx;
    this.heightCssPx = heightCssPx;
    this.dpr = dpr;
    const physicalWidth = Math.round(widthCssPx * dpr);
    const physicalHeight = Math.round(heightCssPx * dpr);
    if (this.canvas.width !== physicalWidth) this.canvas.width = physicalWidth;
    if (this.canvas.height !== physicalHeight) this.canvas.height = physicalHeight;
    this.canvas.style.width = `${widthCssPx}px`;
    this.canvas.style.height = `${heightCssPx}px`;
  }

  paint(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
    offset: Vec2 = [0, 0],
  ): void {
    if (this.disposed) return;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.widthCssPx, this.heightCssPx);
    if (
      typeof Path2D !== 'undefined'
      && typeof DOMMatrix !== 'undefined'
    ) {
      this.paintWithPath2D(layouts, theme, offset);
      return;
    }

    const byBatch = new Map<StrokeBatchKey, {
      style: StrokeBatchStyle;
      primitives: LayoutPrimitive[];
    }>();
    for (const layout of layouts) {
      for (const primitive of layout.primitives) {
        const key = strokeBatchKey(primitive);
        const group = byBatch.get(key);
        if (group) group.primitives.push(primitive);
        else {
          byBatch.set(key, {
            style: strokeBatchStyle(primitive),
            primitives: [primitive],
          });
        }
      }
    }

    for (const { style, primitives } of byBatch.values()) {
      this.context.save();
      this.context.strokeStyle =
        theme.colors[style.styleRole as DimensionStyleRole]
        ?? theme.colors.normal;
      this.context.lineWidth = theme.lineWidthPx;
      this.context.setLineDash([
        ...resolveDimensionLineDash(style.styleRole, style.lineStyle),
      ]);
      this.context.beginPath();
      for (const primitive of primitives) {
        if (primitive.kind !== 'glyph-run') {
          appendStrokePrimitive(
            this.context,
            primitive,
            offset,
            theme.lineWidthPx,
          );
          continue;
        }
        const cacheKey = `${primitive.capHeightPx}\u0000${primitive.text}`;
        let traced = this.glyphTraceCache.get(cacheKey);
        if (!traced) {
          traced = this.font.trace(
            primitive.capHeightPx,
            primitive.text,
            [0, 0],
          );
          if (this.glyphTraceCache.size >= 2_048) {
            this.glyphTraceCache.clear();
          }
          this.glyphTraceCache.set(cacheKey, traced);
        }
        for (const segment of traced) {
          this.context.moveTo(
            alignedCoordinate(
              segment.from[0] + primitive.origin[0] + offset[0],
              theme.lineWidthPx,
            ),
            alignedCoordinate(
              segment.from[1] + primitive.origin[1] + offset[1],
              theme.lineWidthPx,
            ),
          );
          this.context.lineTo(
            alignedCoordinate(
              segment.to[0] + primitive.origin[0] + offset[0],
              theme.lineWidthPx,
            ),
            alignedCoordinate(
              segment.to[1] + primitive.origin[1] + offset[1],
              theme.lineWidthPx,
            ),
          );
        }
      }
      this.context.stroke();
      this.context.restore();
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.widthCssPx, this.heightCssPx);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.style.width = '0px';
    this.canvas.style.height = '0px';
    this.glyphTraceCache.clear();
    this.glyphPathCache.clear();
    this.disposed = true;
  }

  private paintWithPath2D(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
    offset: Vec2,
  ): void {
    const byBatch = new Map<StrokeBatchKey, {
      style: StrokeBatchStyle;
      path: Path2D;
    }>();
    const transform = new DOMMatrix();
    const pathFor = (primitive: LayoutPrimitive): Path2D => {
      const key = strokeBatchKey(primitive);
      const existing = byBatch.get(key);
      if (existing) return existing.path;
      const path = new Path2D();
      byBatch.set(key, { style: strokeBatchStyle(primitive), path });
      return path;
    };
    for (const layout of layouts) {
      for (const primitive of layout.primitives) {
        const framePath = pathFor(primitive);
        if (primitive.kind !== 'glyph-run') {
          appendStrokePrimitive(framePath, primitive, offset, theme.lineWidthPx);
          continue;
        }
        const cacheKey = `${primitive.capHeightPx}\u0000${primitive.text}`;
        let glyphPath = this.glyphPathCache.get(cacheKey);
        if (!glyphPath) {
          glyphPath = new Path2D();
          for (const segment of this.traceGlyph(
            cacheKey,
            primitive.capHeightPx,
            primitive.text,
          )) {
            glyphPath.moveTo(segment.from[0], segment.from[1]);
            glyphPath.lineTo(segment.to[0], segment.to[1]);
          }
          if (this.glyphPathCache.size >= 2_048) {
            this.glyphPathCache.clear();
          }
          this.glyphPathCache.set(cacheKey, glyphPath);
        }
        transform.e = primitive.origin[0] + offset[0];
        transform.f = primitive.origin[1] + offset[1];
        framePath.addPath(glyphPath, transform);
      }
    }
    for (const { style, path } of byBatch.values()) {
      this.context.save();
      this.context.strokeStyle =
        theme.colors[style.styleRole as DimensionStyleRole]
        ?? theme.colors.normal;
      this.context.lineWidth = theme.lineWidthPx;
      this.context.setLineDash([
        ...resolveDimensionLineDash(style.styleRole, style.lineStyle),
      ]);
      this.context.stroke(path);
      this.context.restore();
    }
  }

  private traceGlyph(
    cacheKey: string,
    capHeightPx: number,
    text: string,
  ): ReturnType<LffFont['trace']> {
    let traced = this.glyphTraceCache.get(cacheKey);
    if (traced) return traced;
    traced = this.font.trace(capHeightPx, text, [0, 0]);
    if (this.glyphTraceCache.size >= 2_048) this.glyphTraceCache.clear();
    this.glyphTraceCache.set(cacheKey, traced);
    return traced;
  }
}

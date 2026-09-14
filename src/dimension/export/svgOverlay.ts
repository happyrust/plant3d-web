import { applyHomography, unitSquareToQuad } from '../kernel/geometry/homography';
import { isClippedPrimitive } from '../kernel/geometry/sceneGeometry';
import { traceFramedGlyphRun } from '../kernel/glyph/glyphTrace';
import {
  resolveDimensionLineDash,
  resolveTagToneColor,
  resolveTagToneStrokeWidth,
} from '../kernel/theme';

import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { DimensionStyleRole, DimensionTheme } from '../kernel/theme';
import type {
  LayoutPrimitive,
  LayoutResult,
  ScreenGlyphRun,
  ScreenLine,
  Vec2,
} from '../kernel/types';

export type DimensionExportMetadata = Readonly<{
  formatPolicy: DimensionFormatPolicy;
  viewport: Readonly<{
    widthCssPx: number;
    heightCssPx: number;
    dpr: number;
  }>;
  exportedAt: number;
}>;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

function coordinate(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('SVG dimension coordinates must be finite');
  }
  return String(Number(value.toFixed(3)));
}

function point(value: Vec2): string {
  return `${coordinate(value[0])} ${coordinate(value[1])}`;
}

function strokeFor(
  theme: DimensionTheme,
  styleRole: string,
  textStroke = false,
): string {
  const roleKey = styleRole as DimensionStyleRole;
  const textColor = textStroke ? theme.textColors[roleKey] : undefined;
  return textColor ?? theme.colors[roleKey] ?? theme.colors.normal;
}

const ROUND_JOINS = 'stroke-linecap="round" stroke-linejoin="round"';

/**
 * 3D (framed) text: the same unit glyph strokes the painter draws, sent
 * through the frame's screen homography, so the exported value keeps the
 * viewport's perspective; a contrasting halo underneath mirrors the
 * painter's two passes (`theme.dimension3d`).
 */
function framedGlyphPaths(
  primitive: ScreenGlyphRun,
  perspective: NonNullable<ScreenGlyphRun['perspective']>,
  font: LffFont,
  theme: DimensionTheme,
): string {
  const map = unitSquareToQuad(perspective);
  // Trace y points down the glyph; the frame's v axis points up.
  const toScreen = (local: Vec2): Vec2 => applyHomography(map, [local[0], -local[1]]);
  const path = traceFramedGlyphRun(font, primitive.text).map(segment => (
    `M ${point(toScreen(segment.from))} L ${point(toScreen(segment.to))}`
  )).join(' ');
  const rules = theme.dimension3d;
  const role = `data-style-role="${escapeXml(primitive.styleRole)}"`;
  const halo = `<path d="${path}" data-part="label-halo" data-text-plane="3d" stroke="${escapeXml(rules.textHaloColor)}" stroke-width="${coordinate(rules.textStrokeWidthPx + 2 * rules.textHaloWidthPx)}" fill="none" ${ROUND_JOINS} ${role}/>`;
  const glyphs = `<path d="${path}" data-part="label" data-text-plane="3d" stroke="${escapeXml(strokeFor(theme, primitive.styleRole, true))}" stroke-width="${coordinate(rules.textStrokeWidthPx)}" fill="none" ${ROUND_JOINS} ${role}/>`;
  return halo + glyphs;
}

/**
 * A filled arrowhead (`scene-triangle`) projects to its three edges; the
 * export paints the triangle they enclose, as the painter does, instead of
 * outlining it.
 */
function filledTriangle(
  edges: readonly ScreenLine[],
  theme: DimensionTheme,
): string {
  const [first] = edges;
  const fill = escapeXml(strokeFor(theme, first!.styleRole));
  const path = edges.map((edge, index) => (
    `${index === 0 ? 'M' : 'L'} ${point(edge.from)}`
  )).join(' ');
  return `<path d="${path} Z" data-part="${escapeXml(first!.part)}" stroke="none" stroke-width="0" fill="${fill}" ${ROUND_JOINS} data-style-role="${escapeXml(first!.styleRole)}"/>`;
}

function serializePrimitive(
  primitive: LayoutPrimitive,
  font: LffFont,
  theme: DimensionTheme,
): string {
  // A primitive the GPU clipped entirely (behind the camera) is not drawn.
  if (isClippedPrimitive(primitive)) return '';
  if (primitive.kind === 'glyph-run' && primitive.perspective) {
    return framedGlyphPaths(primitive, primitive.perspective, font, theme);
  }
  const isGlyphRun = primitive.kind === 'glyph-run';
  const tone = primitive.kind === 'marker' ? undefined : primitive.tone;
  // Glyph strokes stay solid, slightly heavier, and use the label text
  // color, mirroring the scene painter; tag tones take the tag palette.
  const stroke = escapeXml(tone
    ? resolveTagToneColor(theme, primitive.styleRole, tone)
    : strokeFor(theme, primitive.styleRole, isGlyphRun));
  const dash = isGlyphRun || tone
    ? []
    : resolveDimensionLineDash(primitive.styleRole, primitive.lineStyle);
  const strokeWidthPx = tone
    ? resolveTagToneStrokeWidth(theme, tone)
    : isGlyphRun
      ? theme.textStrokeWidthPx
      : theme.dimensionStrokeWidthPx;
  // A tag body fill is painted, not outlined.
  const filled = tone === 'tag-fill';
  const common = [
    `stroke="${filled ? 'none' : stroke}"`,
    `stroke-width="${coordinate(strokeWidthPx)}"`,
    `fill="${filled ? stroke : 'none'}"`,
    ROUND_JOINS,
    `data-style-role="${escapeXml(primitive.styleRole)}"`,
    ...(tone ? [`data-tone="${escapeXml(tone)}"`] : []),
    ...(dash.length > 0
      ? [`stroke-dasharray="${dash.map(coordinate).join(' ')}"`]
      : []),
  ].join(' ');
  if (primitive.kind === 'line') {
    return `<line x1="${coordinate(primitive.from[0])}" y1="${coordinate(primitive.from[1])}" x2="${coordinate(primitive.to[0])}" y2="${coordinate(primitive.to[1])}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
  }
  if (primitive.kind === 'path') {
    const commands = primitive.points.map((item, index) => (
      `${index === 0 ? 'M' : 'L'} ${point(item)}`
    )).join(' ');
    const closedSuffix = primitive.closed ? ' Z' : '';
    return `<path d="${commands}${closedSuffix}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
  }
  if (primitive.kind === 'marker') {
    const [x, y] = primitive.at;
    if (primitive.shape === 'circle') {
      return `<circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="${coordinate(primitive.radiusPx)}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
    }
    const radius = primitive.radiusPx;
    const crossPath =
      `M ${coordinate(x - radius)} ${coordinate(y)} L ${coordinate(x + radius)} ${coordinate(y)} `
      + `M ${coordinate(x)} ${coordinate(y - radius)} L ${coordinate(x)} ${coordinate(y + radius)}`;
    return `<path d="${crossPath}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
  }
  const path = font.trace(
    primitive.capHeightPx,
    primitive.text,
    primitive.origin,
  ).map((segment) => (
    `M ${point(segment.from)} L ${point(segment.to)}`
  )).join(' ');
  const rotation = primitive.rotationRad && primitive.rotationCenter
    ? ` transform="rotate(${coordinate(
      (primitive.rotationRad * 180) / Math.PI,
    )} ${point(primitive.rotationCenter)})"`
    : '';
  return `<path d="${path}" data-part="label"${rotation} ${common}/>`;
}

/**
 * Serialize one layout. The projected snapshot is walked in step with the
 * scene primitives (a `scene-triangle` projects to its three edges,
 * everything else to one primitive — the correspondence the collision pass
 * relies on too) so filled arrowheads can be told from arrow strokes; a
 * snapshot without scene primitives, or one out of step with them, is
 * serialized primitive by primitive.
 */
function serializeLayout(
  layout: LayoutResult,
  font: LffFont,
  theme: DimensionTheme,
): string {
  const scene = layout.scenePrimitives ?? [];
  const expected = scene.reduce(
    (count, primitive) => count + (primitive.kind === 'scene-triangle' ? 3 : 1),
    0,
  );
  const parts: string[] = [];
  if (scene.length > 0 && expected === layout.primitives.length) {
    let index = 0;
    for (const scenePrimitive of scene) {
      if (scenePrimitive.kind === 'scene-triangle') {
        const edges = layout.primitives.slice(index, index + 3);
        index += 3;
        if (edges.every(isClippedPrimitive)) continue;
        if (edges.every((edge): edge is ScreenLine => edge.kind === 'line')) {
          parts.push(filledTriangle(edges, theme));
          continue;
        }
        parts.push(...edges.map(edge => serializePrimitive(edge, font, theme)));
        continue;
      }
      parts.push(serializePrimitive(layout.primitives[index]!, font, theme));
      index += 1;
    }
  } else {
    for (const primitive of layout.primitives) {
      parts.push(serializePrimitive(primitive, font, theme));
    }
  }
  return `<g data-dimension-id="${escapeXml(layout.dimensionId)}">${parts.join('')}</g>`;
}

export function layoutResultsToSvg(
  layouts: readonly LayoutResult[],
  font: LffFont,
  theme: DimensionTheme,
  metadata: DimensionExportMetadata,
): string {
  const { widthCssPx, heightCssPx, dpr } = metadata.viewport;
  if (
    !Number.isFinite(widthCssPx)
    || !Number.isFinite(heightCssPx)
    || !Number.isFinite(dpr)
    || widthCssPx <= 0
    || heightCssPx <= 0
    || dpr <= 0
  ) {
    throw new RangeError('SVG viewport dimensions must be positive');
  }

  const groups = layouts
    .map(layout => serializeLayout(layout, font, theme))
    .join('');

  const metadataJson = escapeXml(JSON.stringify(metadata));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${coordinate(widthCssPx)}" height="${coordinate(heightCssPx)}" viewBox="0 0 ${coordinate(widthCssPx)} ${coordinate(heightCssPx)}">`,
    `<metadata>${metadataJson}</metadata>`,
    groups,
    '</svg>',
  ].join('');
}

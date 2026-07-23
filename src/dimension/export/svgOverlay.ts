import { resolveDimensionLineDash } from '../kernel/theme';

import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { DimensionStyleRole, DimensionTheme } from '../kernel/theme';
import type { LayoutResult } from '../kernel/types';

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

function strokeFor(theme: DimensionTheme, styleRole: string): string {
  return theme.colors[styleRole as DimensionStyleRole] ?? theme.colors.normal;
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

  const groups = layouts.map((layout) => {
    const primitives = layout.primitives.map((primitive) => {
      const stroke = escapeXml(strokeFor(theme, primitive.styleRole));
      const dash = resolveDimensionLineDash(
        primitive.styleRole,
        primitive.kind === 'glyph-run' ? undefined : primitive.lineStyle,
      );
      const common = [
        `stroke="${stroke}"`,
        `stroke-width="${coordinate(theme.lineWidthPx)}"`,
        'fill="none"',
        'stroke-linecap="round"',
        'stroke-linejoin="round"',
        `data-style-role="${escapeXml(primitive.styleRole)}"`,
        ...(dash.length > 0
          ? [`stroke-dasharray="${dash.map(coordinate).join(' ')}"`]
          : []),
      ].join(' ');
      if (primitive.kind === 'line') {
        return `<line x1="${coordinate(primitive.from[0])}" y1="${coordinate(primitive.from[1])}" x2="${coordinate(primitive.to[0])}" y2="${coordinate(primitive.to[1])}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
      }
      if (primitive.kind === 'path') {
        const commands = primitive.points.map((point, index) => (
          `${index === 0 ? 'M' : 'L'} ${coordinate(point[0])} ${coordinate(point[1])}`
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
        `M ${coordinate(segment.from[0])} ${coordinate(segment.from[1])} `
        + `L ${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`
      )).join(' ');
      const rotation = primitive.rotationRad && primitive.rotationCenter
        ? ` transform="rotate(${coordinate(
          (primitive.rotationRad * 180) / Math.PI,
        )} ${coordinate(primitive.rotationCenter[0])} ${
          coordinate(primitive.rotationCenter[1])
        })"`
        : '';
      return `<path d="${path}" data-part="label"${rotation} ${common}/>`;
    }).join('');
    return `<g data-dimension-id="${escapeXml(layout.dimensionId)}">${primitives}</g>`;
  }).join('');

  const metadataJson = escapeXml(JSON.stringify(metadata));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${coordinate(widthCssPx)}" height="${coordinate(heightCssPx)}" viewBox="0 0 ${coordinate(widthCssPx)} ${coordinate(heightCssPx)}">`,
    `<metadata>${metadataJson}</metadata>`,
    groups,
    '</svg>',
  ].join('');
}

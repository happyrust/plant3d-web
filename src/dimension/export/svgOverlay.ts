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

function dashFor(styleRole: string): string | null {
  if (styleRole === 'external-reference') return '6 4';
  if (styleRole === 'invalid') return '7 3';
  if (styleRole === 'approximate') return '2 2';
  return null;
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
      const dash = dashFor(primitive.styleRole);
      const common = [
        `stroke="${stroke}"`,
        `stroke-width="${coordinate(theme.lineWidthPx)}"`,
        'fill="none"',
        'stroke-linecap="round"',
        'stroke-linejoin="round"',
        `data-style-role="${escapeXml(primitive.styleRole)}"`,
        ...(dash ? [`stroke-dasharray="${dash}"`] : []),
      ].join(' ');
      if (primitive.kind === 'line') {
        return `<line x1="${coordinate(primitive.from[0])}" y1="${coordinate(primitive.from[1])}" x2="${coordinate(primitive.to[0])}" y2="${coordinate(primitive.to[1])}" data-part="${escapeXml(primitive.part)}" ${common}/>`;
      }
      const path = font.trace(
        primitive.capHeightPx,
        primitive.text,
        primitive.origin,
      ).map((segment) => (
        `M ${coordinate(segment.from[0])} ${coordinate(segment.from[1])} `
        + `L ${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`
      )).join(' ');
      return `<path d="${path}" data-part="label" ${common}/>`;
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

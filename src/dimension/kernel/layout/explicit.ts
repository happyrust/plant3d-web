import { projectArcToScreenPath } from '../geometry/arcProjection';
import {
  expandRect,
  makeCenteredGlyphRun,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeMarkerHitRegion,
  makePathHitRegions,
  makeScreenLine,
} from '../geometry/screenGeometry';
import { resolveDimensionStyleRole } from '../theme';

import type {
  ExplicitLayoutInput,
  HitRegion,
  LayoutPrimitive,
  LayoutResult,
  ScreenGlyphRun,
  ScreenLine,
  ScreenMarker,
  ScreenPath,
  Vec2,
  Vec3,
} from '../types';
import type { LayoutContext } from './context';

const DEFAULT_MARKER_RADIUS_PX = 4;

function toScreen(point: Vec3, context: LayoutContext): Vec2 {
  const projected = context.projector.project(point);
  return [projected.x, projected.y];
}

export function layoutExplicit(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const lines: ScreenLine[] = [
    ...input.lines.map((line) => ({
      ...makeScreenLine(
        toScreen(line.from, context),
        toScreen(line.to, context),
        line.part,
        styleRole,
      ),
      ...(line.style ? { lineStyle: line.style } : {}),
    })),
    ...input.arrowLines.map((line) =>
      makeScreenLine(
        toScreen(line.from, context),
        toScreen(line.to, context),
        'arrow',
        styleRole,
      ),
    ),
  ];
  const paths: ScreenPath[] = (input.arcs ?? []).flatMap((arc) => {
    const projected = projectArcToScreenPath(arc, context.projector);
    if (!projected) return [];
    return [{
      kind: 'path' as const,
      points: projected.points,
      closed: projected.closed,
      part: arc.part ?? 'arc',
      styleRole,
      ...(arc.style ? { lineStyle: arc.style } : {}),
    }];
  });
  const markers: ScreenMarker[] = (input.markers ?? []).map((marker) => ({
    kind: 'marker' as const,
    at: toScreen(marker.at, context),
    shape: marker.shape,
    radiusPx: marker.radiusPx ?? DEFAULT_MARKER_RADIUS_PX,
    part: 'marker',
    styleRole,
    ...(marker.style ? { lineStyle: marker.style } : {}),
  }));
  const glyph = makeCenteredGlyphRun(
    context.font,
    input.formattedLabel,
    toScreen(input.labelAnchor, context),
    context.theme.textHeightPx,
    styleRole,
  );
  const lineAdvancePx = context.theme.textHeightPx * 1.5;
  const extraGlyphs: ScreenGlyphRun[] = (input.texts ?? []).map((text) => {
    const anchor = toScreen(text.anchor, context);
    return makeCenteredGlyphRun(
      context.font,
      text.text,
      [anchor[0], anchor[1] + (text.stackIndex ?? 0) * lineAdvancePx],
      context.theme.textHeightPx,
      styleRole,
    );
  });
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
  const primitives: LayoutPrimitive[] = [
    ...lines,
    ...paths,
    ...markers,
    glyph,
    ...extraGlyphs,
  ];
  const hitRegions: HitRegion[] = [
    ...lines.map((line) => makeLineHitRegion(line, context.theme.lineWidthPx)),
    ...paths.flatMap((path) =>
      makePathHitRegions(path, context.theme.lineWidthPx),
    ),
    ...markers.map(makeMarkerHitRegion),
    makeGlyphHitRegion(glyph),
    ...extraGlyphs.map(makeGlyphHitRegion),
  ];

  return {
    dimensionId: input.id,
    primitives,
    hitRegions,
    labelBounds,
    labelPinned: true,
    derived: { formattedLabel: input.formattedLabel },
  };
}

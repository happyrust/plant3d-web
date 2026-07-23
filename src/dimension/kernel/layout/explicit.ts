import { sampleArcToDesignAndScreenPath } from '../geometry/arcProjection';
import {
  expandRect,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeMarkerHitRegion,
  makePathHitRegions,
} from '../geometry/screenGeometry';
import {
  makeSceneLine,
  projectScenePrimitives,
  sceneGlyph,
  sceneMarker,
  scenePath,
  sceneVertex,
} from '../geometry/sceneGeometry';
import { resolveDimensionStyleRole } from '../theme';

import type {
  ExplicitLayoutInput,
  HitRegion,
  LayoutResult,
  ScenePrimitive,
  ScreenGlyphRun,
  ScreenLine,
  ScreenMarker,
  ScreenPath,
} from '../types';
import type { LayoutContext } from './context';

const DEFAULT_MARKER_RADIUS_PX = 4;

export function layoutExplicit(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const sceneLines = [
    ...input.lines.map((line) => ({
      ...makeSceneLine(
        sceneVertex(line.from),
        sceneVertex(line.to),
        line.part,
        styleRole,
      ),
      ...(line.style ? { lineStyle: line.style } : {}),
    })),
    ...input.arrowLines.map((line) =>
      makeSceneLine(
        sceneVertex(line.from),
        sceneVertex(line.to),
        'arrow',
        styleRole,
      ),
    ),
  ];
  const scenePaths = (input.arcs ?? []).flatMap((arc) => {
    const sampled = sampleArcToDesignAndScreenPath(arc, context.projector);
    if (!sampled) return [];
    return [scenePath(
      sampled.designPoints.map(point => sceneVertex(point)),
      sampled.closed,
      arc.part ?? 'arc',
      styleRole,
      arc.style,
    )];
  });
  const sceneMarkers = (input.markers ?? []).map((marker) =>
    sceneMarker(
      sceneVertex(marker.at),
      marker.shape,
      marker.radiusPx ?? DEFAULT_MARKER_RADIUS_PX,
      styleRole,
      marker.style,
    ));
  const glyphScene = sceneGlyph(
    input.formattedLabel,
    sceneVertex(input.labelAnchor),
    context.theme.textHeightPx,
    styleRole,
  );
  const lineAdvancePx = context.theme.textHeightPx * 1.5;
  const extraGlyphScenes = (input.texts ?? []).map((text) =>
    sceneGlyph(
      text.text,
      sceneVertex(
        text.anchor,
        [0, (text.stackIndex ?? 0) * lineAdvancePx],
      ),
      context.theme.textHeightPx,
      styleRole,
    ));
  const scenePrimitives: ScenePrimitive[] = [
    ...sceneLines,
    ...scenePaths,
    ...sceneMarkers,
    glyphScene,
    ...extraGlyphScenes,
  ];
  const primitives = projectScenePrimitives(
    scenePrimitives,
    context.projector,
    context.font,
  );
  const lines = primitives.filter(
    (primitive): primitive is ScreenLine => primitive.kind === 'line',
  );
  const paths = primitives.filter(
    (primitive): primitive is ScreenPath => primitive.kind === 'path',
  );
  const markers = primitives.filter(
    (primitive): primitive is ScreenMarker => primitive.kind === 'marker',
  );
  const glyphs = primitives.filter(
    (primitive): primitive is ScreenGlyphRun =>
      primitive.kind === 'glyph-run',
  );
  const glyph = glyphs[0]!;
  const extraGlyphs = glyphs.slice(1);
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
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
    scenePrimitives,
    primitives,
    hitRegions,
    labelBounds,
    labelPinned: input.labelPinned,
    derived: { formattedLabel: input.formattedLabel },
  };
}

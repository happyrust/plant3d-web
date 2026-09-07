import { sampleArcToDesignAndScreenPath } from '../geometry/arcProjection';
import {
  engineeringTextRotation,
  makeFilledSceneArrow,
  makeSceneLine,
  projectSceneVertex,
  projectScenePrimitives,
  sceneGlyph,
  sceneMarker,
  scenePath,
  sceneVertex,
  sceneVertexAtScreen,
} from '../geometry/sceneGeometry';
import {
  expandRect,
  makeCenteredGlyphRun,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeMarkerHitRegion,
  makePathHitRegions,
} from '../geometry/screenGeometry';
import { trimLineAgainstRotatedRect } from '../geometry/trimLineAgainstRect';
import { resolveDimensionStyleRole } from '../theme';
import { add3, EPSILON, lerp3 } from '../vec';

import type {
  ExplicitArrowInput,
  ExplicitLayoutInput,
  HitRegion,
  LayoutResult,
  SceneLine,
  ScenePrimitive,
  SceneTriangle,
  SceneVertex,
  ScreenGlyphRun,
  ScreenLine,
  ScreenMarker,
  ScreenPath,
  ScreenRect,
  Vec2,
} from '../types';
import type { LayoutContext } from './context';

const DEFAULT_MARKER_RADIUS_PX = 4;

type ExplicitLine = ExplicitLayoutInput['lines'][number];

/**
 * Screen angle of a design-space baseline direction, flipped into the
 * readable half-turn. Zero when the source declares no direction, which keeps
 * viewport-horizontal text as the default.
 */
function textRotation(
  anchor: Vec3,
  along: Vec3 | undefined,
  context: LayoutContext,
): number {
  if (!along) return 0;
  const from = projectSceneVertex(sceneVertex(anchor), context.projector);
  const to = projectSceneVertex(
    sceneVertex(add3(anchor, along)),
    context.projector,
  );
  return Math.hypot(to[0] - from[0], to[1] - from[1]) <= EPSILON
    ? 0
    : engineeringTextRotation(from, to);
}

type LabelClearance = Readonly<{
  /** Unrotated padded box, paired with the rotation applied around center. */
  rect: ScreenRect;
  center: Vec2;
  rotationRad: number;
}>;

/**
 * External sources anchor a dimension label on its own dimension line (rs-mbd
 * emits `label_anchor` at the line midpoint), so the line has to be broken
 * around the label box the same way the native linear layout does. Returns
 * null when nothing can overlap and the extra projection would be wasted.
 */
function labelClearance(
  input: ExplicitLayoutInput,
  rotationRad: number,
  styleRole: string,
  context: LayoutContext,
): LabelClearance | null {
  if (input.formattedLabel.length === 0) return null;
  if (!input.lines.some(line => line.part === 'dimension')) return null;
  const center = projectSceneVertex(
    sceneVertex(input.labelAnchor),
    context.projector,
  );
  const glyph = makeCenteredGlyphRun(
    context.font,
    input.formattedLabel,
    center,
    context.theme.textHeightPx,
    styleRole,
  );
  return {
    rect: expandRect(glyph.bounds, context.theme.labelPaddingPx / 2),
    center,
    rotationRad,
  };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function vertexOnLine(
  line: ExplicitLine,
  fromScreen: Vec2,
  toScreen: Vec2,
  point: Vec2,
  context: LayoutContext,
): SceneVertex {
  const deltaX = toScreen[0] - fromScreen[0];
  const deltaY = toScreen[1] - fromScreen[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const t = lengthSquared <= EPSILON
    ? 0
    : ((point[0] - fromScreen[0]) * deltaX
      + (point[1] - fromScreen[1]) * deltaY) / lengthSquared;
  return sceneVertexAtScreen(
    lerp3(line.from, line.to, t),
    point,
    context.projector,
  );
}

function explicitSceneLines(
  line: ExplicitLine,
  clearance: LabelClearance | null,
  styleRole: string,
  context: LayoutContext,
): SceneLine[] {
  const withStyle = (sceneLine: SceneLine): SceneLine =>
    line.style ? { ...sceneLine, lineStyle: line.style } : sceneLine;
  if (!clearance || line.part !== 'dimension') {
    return [withStyle(makeSceneLine(
      sceneVertex(line.from),
      sceneVertex(line.to),
      line.part,
      styleRole,
    ))];
  }
  const fromScreen = projectSceneVertex(sceneVertex(line.from), context.projector);
  const toScreen = projectSceneVertex(sceneVertex(line.to), context.projector);
  const { segments } = trimLineAgainstRotatedRect(
    fromScreen,
    toScreen,
    clearance.rect,
    clearance.center,
    clearance.rotationRad,
    false,
  );
  const untouched = segments.length === 1
    && samePoint(segments[0]!.from, fromScreen)
    && samePoint(segments[0]!.to, toScreen);
  if (untouched) {
    return [withStyle(makeSceneLine(
      sceneVertex(line.from),
      sceneVertex(line.to),
      line.part,
      styleRole,
    ))];
  }
  return segments.map(segment => withStyle(makeSceneLine(
    vertexOnLine(line, fromScreen, toScreen, segment.from, context),
    vertexOnLine(line, fromScreen, toScreen, segment.to, context),
    line.part,
    styleRole,
  )));
}

function explicitArrow(
  arrow: ExplicitArrowInput,
  styleRole: string,
  context: LayoutContext,
): SceneTriangle[] {
  const tip = projectSceneVertex(sceneVertex(arrow.tip), context.projector);
  const towards = projectSceneVertex(
    sceneVertex(arrow.towards),
    context.projector,
  );
  const deltaX = towards[0] - tip[0];
  const deltaY = towards[1] - tip[1];
  const length = Math.hypot(deltaX, deltaY);
  if (length <= EPSILON) return [];
  const sign = arrow.outside ? -1 : 1;
  return [makeFilledSceneArrow(
    sceneVertex(arrow.tip),
    [(deltaX / length) * sign, (deltaY / length) * sign],
    context.theme.arrowLengthPx,
    context.theme.arrowHalfAngleDeg,
    styleRole,
  )];
}

export function layoutExplicit(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const labelRotationRad = textRotation(
    input.labelAnchor,
    input.labelAlong,
    context,
  );
  const clearance = labelClearance(input, labelRotationRad, styleRole, context);
  const sceneLines = [
    ...input.lines.flatMap(line =>
      explicitSceneLines(line, clearance, styleRole, context)),
    ...input.arrowLines.map((line) =>
      makeSceneLine(
        sceneVertex(line.from),
        sceneVertex(line.to),
        'arrow',
        styleRole,
      ),
    ),
  ];
  const sceneArrows = (input.arrows ?? []).flatMap(arrow =>
    explicitArrow(arrow, styleRole, context));
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
    labelRotationRad,
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
      textRotation(text.anchor, text.along, context),
    ));
  const scenePrimitives: ScenePrimitive[] = [
    ...sceneLines,
    ...sceneArrows,
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
    ...lines.map((line) =>
      makeLineHitRegion(line, context.theme.dimensionStrokeWidthPx)),
    ...paths.flatMap((path) =>
      makePathHitRegions(path, context.theme.dimensionStrokeWidthPx),
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

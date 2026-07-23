import { formatDimensionLabel } from '../format';
import {
  expandRect,
  makeGlyphHitRegion,
  makeLineHitRegion,
} from '../geometry/screenGeometry';
import {
  engineeringTextRotation,
  makeSceneLine,
  projectScenePrimitives,
  sceneGlyph,
  sceneVertexAtScreen,
} from '../geometry/sceneGeometry';
import { trimLineAgainstRotatedRect } from '../geometry/trimLineAgainstRect';
import { resolveDimensionStyleRole } from '../theme';
import { deriveDimensionValue } from '../value';
import {
  add3,
  dot3,
  EPSILON,
  length3,
  lerp3,
  normalize3,
  scale3,
  sub3,
} from '../vec';

import { emptyLayout } from './linear';

import type { LayoutContext } from './context';
import type {
  LayoutResult,
  NormalizedDimensionInput,
  ScenePrimitive,
  ScreenGlyphRun,
  ScreenLine,
  Vec2,
  Vec3,
} from '../types';

function toScreen(point: Vec3, context: LayoutContext): Vec2 {
  const projected = context.projector.project(point);
  return [projected.x, projected.y];
}

export function layoutRadial(
  input: Extract<NormalizedDimensionInput, { kind: 'radial' }>,
  context: LayoutContext,
): LayoutResult {
  const value = deriveDimensionValue(input);
  const formatted = formatDimensionLabel(input, value, context.format);
  if (!value.ok || value.valueM === undefined || !formatted.ok) {
    return emptyLayout(input.id, input.labelPinned);
  }

  const normalLength = length3(input.normal);
  const radiusM = length3(sub3(input.rim, input.center));
  if (normalLength <= EPSILON || radiusM <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned);
  }
  const normal = normalize3(input.normal);
  const directionInPlane = sub3(
    input.placement.leaderDirection,
    scale3(normal, dot3(input.placement.leaderDirection, normal)),
  );
  if (length3(directionInPlane) <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned, formatted.text);
  }

  const direction = normalize3(directionInPlane);
  const circlePoint = add3(input.center, scale3(direction, radiusM));
  const labelAnchor = add3(
    input.center,
    scale3(direction, radiusM + input.placement.labelDistanceM),
  );
  const circleScreen = toScreen(circlePoint, context);
  const labelCenter = toScreen(labelAnchor, context);
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const glyphScene = sceneGlyph(
    formatted.text,
    sceneVertexAtScreen(labelAnchor, labelCenter, context.projector),
    context.theme.textHeightPx,
    styleRole,
    engineeringTextRotation(circleScreen, labelCenter),
  );
  const glyph = projectScenePrimitives(
    [glyphScene],
    context.projector,
    context.font,
  )[0] as ScreenGlyphRun;
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
  const trimBounds = expandRect(
    glyph.unrotatedBounds ?? glyph.bounds,
    context.theme.labelPaddingPx / 2,
  );
  const trimmed = trimLineAgainstRotatedRect(
    circleScreen,
    labelCenter,
    trimBounds,
    glyph.rotationCenter ?? labelCenter,
    glyph.rotationRad ?? 0,
    true,
  );
  const dx = labelCenter[0] - circleScreen[0];
  const dy = labelCenter[1] - circleScreen[1];
  const lengthSquared = dx * dx + dy * dy;
  const vertexOnLeader = (point: Vec2) => {
    const t = (
      (point[0] - circleScreen[0]) * dx
      + (point[1] - circleScreen[1]) * dy
    ) / lengthSquared;
    return sceneVertexAtScreen(
      lerp3(circlePoint, labelAnchor, t),
      point,
      context.projector,
    );
  };
  const scenePrimitives: ScenePrimitive[] = [
    ...trimmed.segments.map((segment) =>
      makeSceneLine(
        vertexOnLeader(segment.from),
        vertexOnLeader(segment.to),
        'leader',
        styleRole,
      )),
    glyphScene,
  ];
  const primitives = projectScenePrimitives(
    scenePrimitives,
    context.projector,
    context.font,
  );
  const lines = primitives.filter(
    (primitive): primitive is ScreenLine => primitive.kind === 'line',
  );
  const projectedGlyph = primitives.find(
    (primitive): primitive is ScreenGlyphRun =>
      primitive.kind === 'glyph-run',
  )!;

  return {
    dimensionId: input.id,
    scenePrimitives,
    primitives,
    hitRegions: [
      ...lines.map((line) => makeLineHitRegion(line, context.theme.lineWidthPx)),
      makeGlyphHitRegion(projectedGlyph),
    ],
    labelBounds,
    labelPinned: input.labelPinned,
    derived: {
      valueM: value.valueM,
      formattedLabel: formatted.text,
    },
  };
}

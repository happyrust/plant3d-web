import { formatDimensionLabel } from '../format';
import {
  expandRect,
  makeGlyphHitRegion,
  makeLineHitRegion,
} from '../geometry/screenGeometry';
import {
  engineeringTextRotation,
  makeFilledSceneArrow,
  makeSceneLine,
  projectScenePrimitives,
  sceneGlyph,
  sceneVertex,
  sceneVertexAtScreen,
} from '../geometry/sceneGeometry';
import { trimLineAgainstRotatedRect } from '../geometry/trimLineAgainstRect';
import { resolveDimensionStyleRole } from '../theme';
import { deriveDimensionValue } from '../value';
import {
  add3,
  clamp,
  cross3,
  dot3,
  EPSILON,
  length2,
  length3,
  lerp3,
  normalize3,
  scale2,
  scale3,
  sub2,
  sub3,
} from '../vec';

import { emptyLayout } from './linear';

import type { LayoutContext } from './context';
import type {
  LayoutResult,
  NormalizedDimensionInput,
  SceneLine,
  ScenePrimitive,
  ScreenGlyphRun,
  ScreenLine,
  Vec2,
  Vec3,
} from '../types';

const MAX_ARC_STEP_RAD = (4 * Math.PI) / 180;

function toScreen(point: Vec3, context: LayoutContext): Vec2 {
  const projected = context.projector.project(point);
  return [projected.x, projected.y];
}

export function layoutAngular(
  input: Extract<NormalizedDimensionInput, { kind: 'angular' }>,
  context: LayoutContext,
): LayoutResult {
  const value = deriveDimensionValue(input);
  const formatted = formatDimensionLabel(input, value, context.format);
  if (!value.ok || value.valueRad === undefined || !formatted.ok) {
    return emptyLayout(input.id, input.labelPinned);
  }

  const rawA = sub3(input.rayA, input.vertex);
  const rawB = sub3(input.rayB, input.vertex);
  if (length3(rawA) <= EPSILON || length3(rawB) <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned);
  }
  const unitA = normalize3(rawA);
  const unitB = normalize3(rawB);
  const rawNormal = cross3(unitA, unitB);
  if (length3(rawNormal) <= EPSILON) return emptyLayout(input.id, input.labelPinned);

  const normal = normalize3(rawNormal);
  const planeV = normalize3(cross3(normal, unitA));
  const minorAngle = Math.acos(clamp(dot3(unitA, unitB), -1, 1));
  const sweep =
    input.placement.arcChoice === 'minor' ? minorAngle : minorAngle - 2 * Math.PI;
  const worldPerPixel = context.projector.worldPerPixelAt(input.vertex);
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned);
  }

  let radiusM = Math.max(
    input.placement.radiusM ?? context.theme.minArcRadiusPx * worldPerPixel,
    context.theme.minArcRadiusPx * worldPerPixel,
  );
  const pointAt = (angle: number, radius = radiusM): Vec3 =>
    add3(
      input.vertex,
      add3(scale3(unitA, radius * Math.cos(angle)), scale3(planeV, radius * Math.sin(angle))),
    );
  const vertexScreen = toScreen(input.vertex, context);
  const initialRadiusPx = length2(sub2(toScreen(pointAt(0), context), vertexScreen));
  if (initialRadiusPx <= EPSILON) return emptyLayout(input.id, input.labelPinned);
  if (initialRadiusPx < context.theme.minArcRadiusPx) {
    radiusM *= context.theme.minArcRadiusPx / initialRadiusPx;
  }

  const labelAngle = sweep * input.placement.labelT;
  const labelAnchor = pointAt(labelAngle);
  const labelCenter = toScreen(labelAnchor, context);
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const tangentScreen = toScreen(
    pointAt(labelAngle + Math.sign(sweep || 1) * 1e-4),
    context,
  );
  const glyphScene = sceneGlyph(
    formatted.text,
    sceneVertexAtScreen(labelAnchor, labelCenter, context.projector),
    context.theme.textHeightPx,
    styleRole,
    engineeringTextRotation(labelCenter, tangentScreen),
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
  const outside = input.placement.labelT < 0 || input.placement.labelT > 1;
  const arcStartT = Math.min(0, input.placement.labelT);
  const arcEndT = Math.max(1, input.placement.labelT);
  const arcStart = sweep * arcStartT;
  const arcEnd = sweep * arcEndT;
  const arcSweep = arcEnd - arcStart;
  const segmentCount = Math.max(1, Math.ceil(Math.abs(arcSweep) / MAX_ARC_STEP_RAD));
  const sceneLines: SceneLine[] = [];

  const extensionRadiusM = radiusM + 5 * worldPerPixel;
  sceneLines.push(
    makeSceneLine(
      sceneVertex(input.vertex),
      sceneVertex(pointAt(0, extensionRadiusM)),
      'extension',
      styleRole,
    ),
    makeSceneLine(
      sceneVertex(input.vertex),
      sceneVertex(pointAt(sweep, extensionRadiusM)),
      'extension',
      styleRole,
    ),
  );

  let previousWorld = pointAt(arcStart);
  let previous = toScreen(previousWorld, context);
  for (let index = 1; index <= segmentCount; index += 1) {
    const angle = arcStart + (arcSweep * index) / segmentCount;
    const currentWorld = pointAt(angle);
    const current = toScreen(currentWorld, context);
    const trimmed = trimLineAgainstRotatedRect(
      previous,
      current,
      trimBounds,
      glyph.rotationCenter ?? labelCenter,
      glyph.rotationRad ?? 0,
      false,
    );
    const dx = current[0] - previous[0];
    const dy = current[1] - previous[1];
    const lengthSquared = dx * dx + dy * dy;
    const vertexOnChord = (point: Vec2) => {
      const t = lengthSquared <= EPSILON
        ? 0
        : (
          (point[0] - previous[0]) * dx
          + (point[1] - previous[1]) * dy
        ) / lengthSquared;
      return sceneVertexAtScreen(
        lerp3(previousWorld, currentWorld, t),
        point,
        context.projector,
      );
    };
    for (const segment of trimmed.segments) {
      sceneLines.push(makeSceneLine(
        vertexOnChord(segment.from),
        vertexOnChord(segment.to),
        'arc',
        styleRole,
      ));
    }
    previousWorld = currentWorld;
    previous = current;
  }

  const sweepSign = Math.sign(sweep);
  const tangentDelta = sweepSign * 1e-4;
  const arrowA = toScreen(pointAt(0), context);
  const arrowB = toScreen(pointAt(sweep), context);
  let inwardA = sub2(toScreen(pointAt(tangentDelta), context), arrowA);
  let inwardB = sub2(toScreen(pointAt(sweep - tangentDelta), context), arrowB);
  if (outside) {
    inwardA = scale2(inwardA, -1);
    inwardB = scale2(inwardB, -1);
  }
  if (length2(inwardA) <= EPSILON || length2(inwardB) <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned, formatted.text);
  }
  const scenePrimitives: ScenePrimitive[] = [
    ...sceneLines,
    makeFilledSceneArrow(
      sceneVertexAtScreen(pointAt(0), arrowA, context.projector),
      inwardA,
      context.theme.arrowLengthPx,
      context.theme.arrowHalfAngleDeg,
      styleRole,
    ),
    makeFilledSceneArrow(
      sceneVertexAtScreen(pointAt(sweep), arrowB, context.projector),
      inwardB,
      context.theme.arrowLengthPx,
      context.theme.arrowHalfAngleDeg,
      styleRole,
    ),
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
      valueRad: value.valueRad,
      formattedLabel: formatted.text,
    },
  };
}

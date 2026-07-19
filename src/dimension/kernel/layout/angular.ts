import { formatDimensionLabel } from '../format';
import { makeOpenArrow } from '../geometry/arrow';
import {
  expandRect,
  makeCenteredGlyphRun,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeScreenLine,
} from '../geometry/screenGeometry';
import { trimLineAgainstRect } from '../geometry/trimLineAgainstRect';
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
  const labelCenter = toScreen(pointAt(labelAngle), context);
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const glyph = makeCenteredGlyphRun(
    context.font,
    formatted.text,
    labelCenter,
    context.theme.textHeightPx,
    styleRole,
  );
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
  const outside = input.placement.labelT < 0 || input.placement.labelT > 1;
  const arcStartT = Math.min(0, input.placement.labelT);
  const arcEndT = Math.max(1, input.placement.labelT);
  const arcStart = sweep * arcStartT;
  const arcEnd = sweep * arcEndT;
  const arcSweep = arcEnd - arcStart;
  const segmentCount = Math.max(1, Math.ceil(Math.abs(arcSweep) / MAX_ARC_STEP_RAD));
  const lines: ScreenLine[] = [];

  const extensionRadiusM = radiusM + 5 * worldPerPixel;
  lines.push(
    makeScreenLine(
      vertexScreen,
      toScreen(pointAt(0, extensionRadiusM), context),
      'extension',
      styleRole,
    ),
    makeScreenLine(
      vertexScreen,
      toScreen(pointAt(sweep, extensionRadiusM), context),
      'extension',
      styleRole,
    ),
  );

  let previous = toScreen(pointAt(arcStart), context);
  for (let index = 1; index <= segmentCount; index += 1) {
    const angle = arcStart + (arcSweep * index) / segmentCount;
    const current = toScreen(pointAt(angle), context);
    const trimmed = trimLineAgainstRect(previous, current, labelBounds, false);
    for (const segment of trimmed.segments) {
      lines.push(makeScreenLine(segment.from, segment.to, 'arc', styleRole));
    }
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
  lines.push(
    ...makeOpenArrow(
      arrowA,
      inwardA,
      context.theme.arrowLengthPx,
      context.theme.arrowHalfAngleDeg,
      styleRole,
    ),
    ...makeOpenArrow(
      arrowB,
      inwardB,
      context.theme.arrowLengthPx,
      context.theme.arrowHalfAngleDeg,
      styleRole,
    ),
  );

  const primitives = [...lines, glyph];
  return {
    dimensionId: input.id,
    primitives,
    hitRegions: [
      ...lines.map((line) => makeLineHitRegion(line, context.theme.lineWidthPx)),
      makeGlyphHitRegion(glyph),
    ],
    labelBounds,
    labelPinned: input.labelPinned,
    derived: {
      valueRad: value.valueRad,
      formattedLabel: formatted.text,
    },
  };
}

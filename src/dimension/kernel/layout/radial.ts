import { formatDimensionLabel } from '../format';
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
  dot3,
  EPSILON,
  length3,
  normalize3,
  scale3,
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
  const glyph = makeCenteredGlyphRun(
    context.font,
    formatted.text,
    labelCenter,
    context.theme.textHeightPx,
    styleRole,
  );
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
  const trimmed = trimLineAgainstRect(circleScreen, labelCenter, labelBounds, true);
  const lines: ScreenLine[] = trimmed.segments.map((segment) =>
    makeScreenLine(segment.from, segment.to, 'leader', styleRole),
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
      valueM: value.valueM,
      formattedLabel: formatted.text,
    },
  };
}

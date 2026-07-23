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
import { EPSILON, lerp3 } from '../vec';

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
import type { LayoutContext } from './context';

type LinearPlacement = Readonly<{ offsetM: number; labelT: number; side: 1 | -1 }>;

export function emptyLayout(
  dimensionId: string,
  labelPinned: boolean,
  formattedLabel = '',
): LayoutResult {
  return {
    dimensionId,
    scenePrimitives: [],
    primitives: [],
    hitRegions: [],
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned,
    derived: { formattedLabel },
  };
}

function toScreen(point: Vec3, context: LayoutContext): Vec2 {
  const projected = context.projector.project(point);
  return [projected.x, projected.y];
}

export function layoutLinearBetween(
  input: NormalizedDimensionInput,
  geometry: Readonly<{ a: Vec3; b: Vec3; placement: LinearPlacement }>,
  context: LayoutContext,
  leadingLines: readonly SceneLine[] = [],
): LayoutResult {
  const value = deriveDimensionValue(input);
  const formatted = formatDimensionLabel(input, value, context.format);
  if (!value.ok || !formatted.ok) return emptyLayout(input.id, input.labelPinned);

  const aScreen = toScreen(geometry.a, context);
  const bScreen = toScreen(geometry.b, context);
  const screenDx = bScreen[0] - aScreen[0];
  const screenDy = bScreen[1] - aScreen[1];
  const screenLength = Math.hypot(screenDx, screenDy);
  if (screenLength <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned, formatted.text);
  }

  const midpoint = lerp3(geometry.a, geometry.b, 0.5);
  const worldPerPixel = context.projector.worldPerPixelAt(midpoint);
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned, formatted.text);
  }

  const alongX = screenDx / screenLength;
  const alongY = screenDy / screenLength;
  const outwardX = alongY * geometry.placement.side;
  const outwardY = -alongX * geometry.placement.side;
  const offsetPx = geometry.placement.offsetM / worldPerPixel;
  const arrowA: Vec2 =
    offsetPx === 0
      ? aScreen
      : [aScreen[0] + outwardX * offsetPx, aScreen[1] + outwardY * offsetPx];
  const arrowB: Vec2 =
    offsetPx === 0
      ? bScreen
      : [bScreen[0] + outwardX * offsetPx, bScreen[1] + outwardY * offsetPx];
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const labelCenter: Vec2 = [
    arrowA[0] + (arrowB[0] - arrowA[0]) * geometry.placement.labelT,
    arrowA[1] + (arrowB[1] - arrowA[1]) * geometry.placement.labelT,
  ];
  const labelAnchor = lerp3(
    geometry.a,
    geometry.b,
    geometry.placement.labelT,
  );
  const glyphScene = sceneGlyph(
    formatted.text,
    sceneVertexAtScreen(labelAnchor, labelCenter, context.projector),
    context.theme.textHeightPx,
    styleRole,
    engineeringTextRotation(arrowA, arrowB),
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
    arrowA,
    arrowB,
    trimBounds,
    glyph.rotationCenter ?? labelCenter,
    glyph.rotationRad ?? 0,
    true,
  );

  const extensionEndX = outwardX * context.theme.extensionOvershootPx;
  const extensionEndY = outwardY * context.theme.extensionOvershootPx;
  const sceneLines: SceneLine[] = [
    ...leadingLines,
    makeSceneLine(
      sceneVertex(geometry.a),
      sceneVertexAtScreen(
        geometry.a,
        [arrowA[0] + extensionEndX, arrowA[1] + extensionEndY],
        context.projector,
      ),
      'extension',
      styleRole,
    ),
    makeSceneLine(
      sceneVertex(geometry.b),
      sceneVertexAtScreen(
        geometry.b,
        [arrowB[0] + extensionEndX, arrowB[1] + extensionEndY],
        context.projector,
      ),
      'extension',
      styleRole,
    ),
  ];
  const screenLengthSquared = screenDx * screenDx + screenDy * screenDy;
  const sceneVertexOnDimension = (point: Vec2) => {
    const t = (
      (point[0] - arrowA[0]) * screenDx
      + (point[1] - arrowA[1]) * screenDy
    ) / screenLengthSquared;
    return sceneVertexAtScreen(
      lerp3(geometry.a, geometry.b, t),
      point,
      context.projector,
    );
  };
  sceneLines.push(...trimmed.segments.map((segment) =>
    makeSceneLine(
      sceneVertexOnDimension(segment.from),
      sceneVertexOnDimension(segment.to),
      'dimension',
      styleRole,
    )));

  if (trimmed.outsideSide < 0) {
    const outsideEnd: Vec2 = [
      arrowB[0] + alongX * context.theme.outsideExtensionPx,
      arrowB[1] + alongY * context.theme.outsideExtensionPx,
    ];
    sceneLines.push(
      makeSceneLine(
        sceneVertexOnDimension(arrowB),
        sceneVertexOnDimension(outsideEnd),
        'dimension',
        styleRole,
      ),
    );
  } else if (trimmed.outsideSide > 0) {
    const outsideEnd: Vec2 = [
          arrowA[0] - alongX * context.theme.outsideExtensionPx,
          arrowA[1] - alongY * context.theme.outsideExtensionPx,
        ];
    sceneLines.push(
      makeSceneLine(
        sceneVertexOnDimension(arrowA),
        sceneVertexOnDimension(outsideEnd),
        'dimension',
        styleRole,
      ),
    );
  }

  const arrowDirectionScale = trimmed.outsideSide === 0 ? 1 : -1;
  const scenePrimitives: ScenePrimitive[] = [
    ...sceneLines,
    makeFilledSceneArrow(
      sceneVertexAtScreen(geometry.a, arrowA, context.projector),
      [alongX * arrowDirectionScale, alongY * arrowDirectionScale],
      context.theme.arrowLengthPx,
      context.theme.arrowHalfAngleDeg,
      styleRole,
    ),
    makeFilledSceneArrow(
      sceneVertexAtScreen(geometry.b, arrowB, context.projector),
      [-alongX * arrowDirectionScale, -alongY * arrowDirectionScale],
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
      ...('valueM' in value ? { valueM: value.valueM } : { valueRad: value.valueRad }),
      formattedLabel: formatted.text,
    },
  };
}

export function layoutLinear(
  input: Extract<NormalizedDimensionInput, { kind: 'linear' }>,
  context: LayoutContext,
): LayoutResult {
  return layoutLinearBetween(input, input, context);
}

import { checkDirectionsAgainstView } from '../../domain/validation';
import { formatDimensionLabel } from '../format';
import {
  engineeringTextRotation,
  makeFilledSceneArrow,
  makeSceneLine,
  projectScenePrimitives,
  sceneGlyph,
  sceneVertex,
  sceneVertexAtScreen,
} from '../geometry/sceneGeometry';
import {
  makeGlyphHitRegion,
  makeLineHitRegion,
} from '../geometry/screenGeometry';
import { trimLineAgainstRotatedRect } from '../geometry/trimLineAgainstRect';
import { resolveDimensionStyleRole } from '../theme';
import { deriveDimensionValue } from '../value';
import { add3, EPSILON, lerp3, scale3, sub3, tryNormalize3 } from '../vec';

import {
  backProjectedSegment,
  labelBoundsOf,
  sceneVertexOnSegment,
  toScreen,
  trimBoundsOf,
} from './shared/screen';

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
  lodHidden?: LayoutResult['derived']['lodHidden'],
  validationErrors?: readonly string[],
): LayoutResult {
  return {
    dimensionId,
    scenePrimitives: [],
    primitives: [],
    hitRegions: [],
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned,
    derived: {
      formattedLabel,
      ...(lodHidden ? { lodHidden } : {}),
      ...(validationErrors && validationErrors.length > 0 ? { validationErrors } : {}),
    },
  };
}

export function layoutLinearBetween(
  input: NormalizedDimensionInput,
  geometry: Readonly<{ a: Vec3; b: Vec3; placement: LinearPlacement }>,
  context: LayoutContext,
  leadingLines: readonly SceneLine[] = [],
  directions: Readonly<{
    dimensionDirection: Vec3 | null;
    projectionDirection?: Vec3 | null;
    /** 尺寸平面里垂直于尺寸线的设计系方向（#75）：给了就沿它偏移 `offsetM`，转相机不动；不给按屏幕法向偏。 */
    offsetDirection?: Vec3 | null;
  }> = {
    dimensionDirection: sub3(geometry.b, geometry.a),
  },
): LayoutResult {
  const value = deriveDimensionValue(input);
  const formatted = formatDimensionLabel(input, value, context.format);
  if (!value.ok || !formatted.ok) return emptyLayout(input.id, input.labelPinned);
  const viewErrors = checkDirectionsAgainstView(directions, context.projector.forward);
  if (viewErrors.length > 0) {
    return emptyLayout(
      input.id,
      input.labelPinned,
      formatted.text,
      undefined,
      viewErrors.map(error => error.code),
    );
  }

  const aScreen = toScreen(geometry.a, context.projector);
  const bScreen = toScreen(geometry.b, context.projector);
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

  let alongX = screenDx / screenLength;
  let alongY = screenDy / screenLength;
  let outwardX = alongY * geometry.placement.side;
  let outwardY = -alongX * geometry.placement.side;
  const offsetPx = geometry.placement.offsetM / worldPerPixel;
  let arrowA: Vec2 =
    offsetPx === 0
      ? aScreen
      : [aScreen[0] + outwardX * offsetPx, aScreen[1] + outwardY * offsetPx];
  let arrowB: Vec2 =
    offsetPx === 0
      ? bScreen
      : [bScreen[0] + outwardX * offsetPx, bScreen[1] + outwardY * offsetPx];
  let lineA = geometry.a;
  let lineB = geometry.b;
  let lineDelta: Vec2 = [screenDx, screenDy];
  const designOffset = directions.offsetDirection
    ? tryNormalize3(directions.offsetDirection)
    : null;
  if (designOffset) {
    const offset = scale3(designOffset, geometry.placement.offsetM * geometry.placement.side);
    const offsetA = add3(geometry.a, offset);
    const offsetB = add3(geometry.b, offset);
    const designArrowA = toScreen(offsetA, context.projector);
    const designArrowB = toScreen(offsetB, context.projector);
    const designDelta: Vec2 = [designArrowB[0] - designArrowA[0], designArrowB[1] - designArrowA[1]];
    const designLength = Math.hypot(designDelta[0], designDelta[1]);
    if (designLength > EPSILON) {
      lineA = offsetA;
      lineB = offsetB;
      arrowA = designArrowA;
      arrowB = designArrowB;
      lineDelta = designDelta;
      alongX = designDelta[0] / designLength;
      alongY = designDelta[1] / designLength;
      const outward: Vec2 = [designArrowA[0] - aScreen[0], designArrowA[1] - aScreen[1]];
      const outwardLength = Math.hypot(outward[0], outward[1]);
      // 偏移方向正对视线时屏幕上看不出往哪偏：延伸线的出头按屏幕法向，与无平面时一致。
      if (outwardLength > EPSILON) {
        outwardX = outward[0] / outwardLength;
        outwardY = outward[1] / outwardLength;
      } else {
        outwardX = alongY * geometry.placement.side;
        outwardY = -alongX * geometry.placement.side;
      }
    }
  }
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const labelCenter: Vec2 = [
    arrowA[0] + (arrowB[0] - arrowA[0]) * geometry.placement.labelT,
    arrowA[1] + (arrowB[1] - arrowA[1]) * geometry.placement.labelT,
  ];
  const labelAnchor = lerp3(
    lineA,
    lineB,
    geometry.placement.labelT,
  );
  const glyphScene = sceneGlyph(
    formatted.text,
    sceneVertexAtScreen(labelAnchor, labelCenter, context.projector),
    context.theme.textHeightPx,
    styleRole,
    engineeringTextRotation(arrowA, arrowB),
    undefined,
    input.textHalo,
  );
  const glyph = projectScenePrimitives(
    [glyphScene],
    context.projector,
    context.font,
  )[0] as ScreenGlyphRun;
  const labelBounds = labelBoundsOf(glyph, context.theme);
  const trimBounds = trimBoundsOf(glyph, context.theme);
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
  // The trimmed pieces are measured along the offset dimension line (origin
  // `arrowA`), with the a → b screen delta; no degenerate guard here because
  // the zero-length case already returned above.
  const dimensionSegment = backProjectedSegment(
    lineA,
    lineB,
    arrowA,
    lineDelta,
  );
  const sceneVertexOnDimension = (point: Vec2) =>
    sceneVertexOnSegment(dimensionSegment, point, context.projector, false);
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
      ...lines.map((line) =>
        makeLineHitRegion(line, context.theme.dimensionStrokeWidthPx)),
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
  return layoutLinearBetween(input, input, context, [], {
    dimensionDirection: input.directions?.dimensionDirection ?? sub3(input.b, input.a),
    offsetDirection: input.directions?.offsetDirection ?? null,
  });
}

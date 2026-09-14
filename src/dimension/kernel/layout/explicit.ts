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

import { layoutDimension3d } from './dimension3d';
import { emptyLayout } from './linear';
import { layoutTagBillboard } from './tagBillboard';

import type {
  ExplicitArrowInput,
  ExplicitLayoutInput,
  ExplicitLodHiddenReason,
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
 * Screen cap height for this input. A source that declares a design-space
 * text height (`textHeightM`, e.g. the MBD group `cheight_mm`) gets it
 * projected at the label anchor — depth-based and orientation-independent,
 * the way PML `cheight` sits on the drawing sheet — and clamped to the
 * theme's source range so a plant-wide view stays legible and a close-up does
 * not fill the viewport with one label. Everything else keeps the fixed
 * theme height.
 */
function projectedSourceTextHeightPx(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): number | null {
  const heightM = input.textHeightM;
  if (heightM === undefined || !(heightM > 0)) return null;
  const metresPerPixel = context.projector.worldPerPixelAt(input.labelAnchor);
  if (!Number.isFinite(metresPerPixel) || !(metresPerPixel > 0)) return null;
  return heightM / metresPerPixel;
}

function resolveTextHeightPx(
  projectedPx: number | null,
  context: LayoutContext,
): number {
  if (projectedPx === null) return context.theme.textHeightPx;
  return Math.min(
    context.theme.sourceTextHeightMaxPx,
    Math.max(context.theme.sourceTextHeightMinPx, projectedPx),
  );
}

/**
 * Level of detail for dense sources (S3): a `secondary` input disappears
 * while its source text height projects below the theme floor (the view is
 * too far out for sub-dimensions), and an input that asked for `hideShort`
 * disappears when its dimension line projects shorter than
 * `theme.lodMinLineToLabelRatio` label widths. Returns the reason, or null
 * to draw normally. Both rules are camera-dependent by design and re-run on
 * every layout, like every other screen-space decision in this kernel.
 */
function lodHiddenReason(
  input: ExplicitLayoutInput,
  projectedPx: number | null,
  textHeightPx: number,
  context: LayoutContext,
): ExplicitLodHiddenReason | null {
  const lod = input.lod;
  if (!lod) return null;
  if (
    lod.tier === 'secondary'
    && projectedPx !== null
    && projectedPx < context.theme.sourceTextHeightMinPx
  ) {
    return 'secondary-far';
  }
  // Detail tier (slope marks, skew aids, branch name): a close-up only.
  if (
    lod.tier === 'detail'
    && projectedPx !== null
    && projectedPx < context.theme.sourceTextHeightMaxPx
  ) {
    return 'detail-far';
  }
  if (lod.hideShort && input.formattedLabel.length > 0) {
    const dimensionLine = input.lines.find(line => line.part === 'dimension');
    if (dimensionLine) {
      const from = projectSceneVertex(sceneVertex(dimensionLine.from), context.projector);
      const to = projectSceneVertex(sceneVertex(dimensionLine.to), context.projector);
      const lineLengthPx = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const labelWidthPx = context.font.getWidth(textHeightPx, input.formattedLabel);
      if (lineLengthPx < labelWidthPx * context.theme.lodMinLineToLabelRatio) {
        return 'short-line';
      }
    }
  }
  return null;
}

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
  textHeightPx: number,
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
    textHeightPx,
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

type ExplicitArrowLine = ExplicitLayoutInput['arrowLines'][number];

/**
 * Source arrow strokes are geometry, not a hint (ADR 0048: respect the MBD
 * arrow segments, do not regenerate them). They still need a legibility
 * floor: a wing of `0.96 · cheight` shrinks to a few pixels on a plant-wide
 * view while the label keeps its screen height. Below `minLength`
 * (`theme.arrowLineMinLengthPx`, or the resolved label height when the source
 * declares its own text height so wing and text keep the solver's ratio) the
 * wing is stretched on screen about its tip (`from`), keeping the projected
 * direction, so the stroke stays anchored to the dimension line at every
 * distance; at or above the floor it draws 1:1. A wing that projects to a
 * point (edge-on to the view) is dropped like any other edge-on segment
 * (ADR 0056).
 */
function explicitArrowLine(
  line: ExplicitArrowLine,
  styleRole: string,
  minLength: number,
  context: LayoutContext,
): SceneLine[] {
  const tip = sceneVertex(line.from);
  const tipScreen = projectSceneVertex(tip, context.projector);
  const baseScreen = projectSceneVertex(
    sceneVertex(line.to),
    context.projector,
  );
  const deltaX = baseScreen[0] - tipScreen[0];
  const deltaY = baseScreen[1] - tipScreen[1];
  const length = Math.hypot(deltaX, deltaY);
  if (length <= EPSILON) return [];
  if (length >= minLength) {
    return [makeSceneLine(tip, sceneVertex(line.to), 'arrow', styleRole)];
  }
  const stretch = minLength / length;
  return [makeSceneLine(
    tip,
    sceneVertex(line.from, [deltaX * stretch, deltaY * stretch]),
    'arrow',
    styleRole,
  )];
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
  // A running dimension presented in 3D rebuilds its own geometry from the
  // solver's pipe points, a tag presented as a billboard builds its body
  // from its text; the flat path below stays for every other input.
  if (input.dimension3d) return layoutDimension3d(input, input.dimension3d, context);
  if (input.tag) return layoutTagBillboard(input, input.tag, context);
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const projectedTextHeightPx = projectedSourceTextHeightPx(input, context);
  const textHeightPx = resolveTextHeightPx(projectedTextHeightPx, context);
  const hidden = lodHiddenReason(input, projectedTextHeightPx, textHeightPx, context);
  if (hidden) {
    return emptyLayout(input.id, input.labelPinned, input.formattedLabel, hidden);
  }
  const arrowMinLengthPx = input.textHeightM !== undefined
    ? textHeightPx
    : context.theme.arrowLineMinLengthPx;
  const labelRotationRad = textRotation(
    input.labelAnchor,
    input.labelAlong,
    context,
  );
  const clearance = labelClearance(
    input,
    labelRotationRad,
    styleRole,
    textHeightPx,
    context,
  );
  const sceneLines = [
    ...input.lines.flatMap(line =>
      explicitSceneLines(line, clearance, styleRole, context)),
    ...input.arrowLines.flatMap(line =>
      explicitArrowLine(line, styleRole, arrowMinLengthPx, context)),
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
    textHeightPx,
    styleRole,
    labelRotationRad,
  );
  const lineAdvancePx = textHeightPx * 1.5;
  const extraGlyphScenes = (input.texts ?? []).map((text) =>
    sceneGlyph(
      text.text,
      sceneVertex(
        text.anchor,
        [0, (text.stackIndex ?? 0) * lineAdvancePx],
      ),
      textHeightPx,
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
    derived: {
      formattedLabel: input.formattedLabel,
      ...(input.subject ? { subject: input.subject } : {}),
    },
  };
}

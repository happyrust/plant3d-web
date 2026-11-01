import { sampleArcToDesignAndScreenPath } from '../geometry/arcProjection';
import { segmentLengthInsideRect } from '../geometry/obstacleGeometry';
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
} from '../geometry/sceneGeometry';
import {
  makeCenteredGlyphRun,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeMarkerHitRegion,
  makePathHitRegions,
} from '../geometry/screenGeometry';
import { trimLineAgainstRotatedRect } from '../geometry/trimLineAgainstRect';
import { resolveDimensionStyleRole } from '../theme';
import { add3, EPSILON } from '../vec';

import { layoutDimension3d } from './dimension3d';
import { emptyLayout } from './linear';
import { lodShortLine, lodTierHiddenReason, projectedSourceTextHeightPx } from './shared/lod';
import { backProjectedSegment, labelBoundsOf, sceneVertexOnSegment } from './shared/screen';

import type { ViewportProjector } from '../projector';
import type {
  ExplicitArcInput,
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
  Vec3,
} from '../types';
import type { LayoutContext } from './context';

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
function sourceTextHeightPx(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): number | null {
  const heightM = input.textHeightM;
  if (heightM === undefined || !(heightM > 0)) return null;
  return projectedSourceTextHeightPx(
    heightM,
    context.projector.worldPerPixelAt(input.labelAnchor),
  );
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
  // Tier rules (secondary floor, detail ceiling) are shared with the 3D and
  // tag presentations; the short-line rule measures this presentation's own
  // dimension line against the label at the resolved text height.
  const tierHidden = lodTierHiddenReason(lod, projectedPx, context.theme);
  if (tierHidden) return tierHidden;
  if (lod.hideShort && input.formattedLabel.length > 0) {
    const dimensionLine = input.lines.find(line => line.part === 'dimension');
    if (dimensionLine) {
      const from = projectSceneVertex(sceneVertex(dimensionLine.from), context.projector);
      const to = projectSceneVertex(sceneVertex(dimensionLine.to), context.projector);
      const lineLengthPx = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const labelWidthPx = context.font.getWidth(textHeightPx, input.formattedLabel);
      if (lodShortLine(lineLengthPx, labelWidthPx, context.theme, lod.tier)) {
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
    rect: labelBoundsOf(glyph, context.theme),
    center,
    rotationRad,
  };
}

/**
 * Q6 `above` presentation: how far the value text rises clear of its dimension
 * line. Half the cap height plus half the label padding, so the padded box the
 * clearance pass would have trimmed against sits just off the stroke instead of
 * touching it, plus half a pixel so a sub-pixel projection cannot make them
 * coincide.
 */
function labelLiftPx(textHeightPx: number, theme: LayoutContext['theme']): number {
  return textHeightPx / 2 + theme.labelPaddingPx / 2 + 0.5;
}

/**
 * Screen offset that lifts the label off its line (Q6 `above`). The direction
 * is the dimension line's screen normal, flipped to point up (screen y grows
 * downwards). Deliberately *not* the extension-line direction: that one follows
 * whichever side the solver offset the dimension to, so a dimension placed below
 * its object would push the text further away from it. A line that projects to a
 * point has no normal, so the text rises straight up.
 */
function labelLiftOffset(
  input: ExplicitLayoutInput,
  context: LayoutContext,
  liftPx: number,
): Vec2 {
  const dimensionLine = input.lines.find(line => line.part === 'dimension');
  if (!dimensionLine) return [0, -liftPx];
  const from = projectSceneVertex(sceneVertex(dimensionLine.from), context.projector);
  const to = projectSceneVertex(sceneVertex(dimensionLine.to), context.projector);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (!(length > EPSILON)) return [0, -liftPx];
  const nx = -dy / length;
  const ny = dx / length;
  return ny > 0
    ? [-nx * liftPx, -ny * liftPx]
    : [nx * liftPx, ny * liftPx];
}

/**
 * Q6: whether this input draws its value text above the line with the line left
 * whole. Only single-line labels qualify — a stack (`texts`) would put its lower
 * rows back onto the line, so it keeps the interrupted presentation.
 */
function drawsLabelAbove(input: ExplicitLayoutInput): boolean {
  return input.labelPresentation === 'above' && (input.texts ?? []).length === 0;
}

/**
 * Screen shapes the `above` row guard measures the lifted label box against:
 * the strokes and markers the same layout call emits, reduced to what a
 * distance check needs.
 */
type AboveGuardObstacle =
  | Readonly<{ kind: 'segment'; from: Vec2; to: Vec2 }>
  | Readonly<{ kind: 'disc'; at: Vec2; radiusPx: number }>;

/**
 * Projected obstacles for the `above` row guard. Screen space on purpose:
 * the lift the label takes (`labelLiftPx`) is a screen-pixel quantity, so
 * "how far the text rises" and "what it rises into" are only comparable once
 * `context.projector` has put both in the same frame — a design-space or
 * pre-projection distance does not track pixel crowding under an oblique or
 * perspective view.
 */
function aboveGuardObstacles(
  primitives: readonly ScenePrimitive[],
  projector: ViewportProjector,
): AboveGuardObstacle[] {
  const obstacles: AboveGuardObstacle[] = [];
  const pushSegment = (from: SceneVertex, to: SceneVertex): void => {
    obstacles.push({
      kind: 'segment',
      from: projectSceneVertex(from, projector),
      to: projectSceneVertex(to, projector),
    });
  };
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'scene-line':
        pushSegment(primitive.from, primitive.to);
        break;
      case 'scene-triangle':
        for (let index = 0; index < 3; index += 1) {
          pushSegment(
            primitive.points[index]!,
            primitive.points[(index + 1) % 3]!,
          );
        }
        break;
      case 'scene-path':
        for (let index = 1; index < primitive.points.length; index += 1) {
          pushSegment(primitive.points[index - 1]!, primitive.points[index]!);
        }
        if (primitive.closed && primitive.points.length > 1) {
          pushSegment(
            primitive.points[primitive.points.length - 1]!,
            primitive.points[0]!,
          );
        }
        break;
      case 'scene-marker':
        obstacles.push({
          kind: 'disc',
          at: projectSceneVertex(primitive.at, projector),
          radiusPx: primitive.radiusPx,
        });
        break;
      default:
        break;
    }
  }
  return obstacles;
}

function pointToSegmentDistancePx(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= EPSILON
    ? 0
    : Math.max(0, Math.min(1,
      ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return Math.hypot(
    point[0] - (from[0] + t * dx),
    point[1] - (from[1] + t * dy),
  );
}

function pointToRectDistancePx(point: Vec2, rect: ScreenRect): number {
  return Math.hypot(
    Math.max(rect.x - point[0], 0, point[0] - rect.x - rect.width),
    Math.max(rect.y - point[1], 0, point[1] - rect.y - rect.height),
  );
}

/**
 * Exact segment → axis-aligned-rect distance in px: 0 on touch or crossing;
 * otherwise the minimum is attained at a vertex of one of the two convex
 * shapes, so comparing the segment ends against the rect and the rect
 * corners against the segment suffices.
 */
function segmentToRectDistancePx(from: Vec2, to: Vec2, rect: ScreenRect): number {
  const inside = (point: Vec2): boolean =>
    point[0] >= rect.x && point[0] <= rect.x + rect.width
    && point[1] >= rect.y && point[1] <= rect.y + rect.height;
  if (inside(from) || inside(to)) return 0;
  if (segmentLengthInsideRect({ from, to }, rect) > 0) return 0;
  const corners: readonly Vec2[] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
  return Math.min(
    pointToRectDistancePx(from, rect),
    pointToRectDistancePx(to, rect),
    ...corners.map(corner => pointToSegmentDistancePx(corner, from, to)),
  );
}

/**
 * Whether the lifted label box crowds any obstacle below `clearancePx`. The
 * box is measured in its local frame — obstacle points are rotated about the
 * box centre by `-rotationRad`, the same world → local move
 * `trimLineAgainstRotatedRect` makes — so a rotated label is checked against
 * its real footprint, not its unrotated bounds.
 */
function aboveLabelIntrudes(
  obstacles: readonly AboveGuardObstacle[],
  rect: ScreenRect,
  center: Vec2,
  rotationRad: number,
  clearancePx: number,
): boolean {
  const rotated = Math.abs(rotationRad) > EPSILON;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const local = (point: Vec2): Vec2 => {
    if (!rotated) return point;
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    return [
      center[0] + dx * cos + dy * sin,
      center[1] - dx * sin + dy * cos,
    ];
  };
  return obstacles.some((obstacle) => {
    const distancePx = obstacle.kind === 'segment'
      ? segmentToRectDistancePx(local(obstacle.from), local(obstacle.to), rect)
      : Math.max(
        0,
        pointToRectDistancePx(local(obstacle.at), rect) - obstacle.radiusPx,
      );
    return distancePx < clearancePx;
  });
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
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
  // A line shorter than EPSILON on screen parks its vertices at `line.from`.
  const trimmedLine = backProjectedSegment(
    line.from,
    line.to,
    fromScreen,
    [toScreen[0] - fromScreen[0], toScreen[1] - fromScreen[1]],
  );
  return segments.map(segment => withStyle(makeSceneLine(
    sceneVertexOnSegment(trimmedLine, segment.from, context.projector, true),
    sceneVertexOnSegment(trimmedLine, segment.to, context.projector, true),
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

/**
 * 弧半径的屏幕像素下限（`theme.minArcRadiusPx`）。
 *
 * 求解器给的角弧半径是 `aod × 0.7`（`plant-mbd/src/angle.rs:452`，aod = 25 mm
 * 即 17.5 mm），整机视图下投影不到 2 px，弧退化成几像素的折线，看起来像污点
 * 而不是角度弧。下限按弧心的 `worldPerPixelAt` 折算成 Design Space 米，只在原
 * 半径更小时抬到下限；`layout/angular.ts:84-98` 是同一条规则。
 *
 * 只有 `part: 'dimension'`（`mapAngleDim` 的标注弧）吃下限。`part: 'arc'` 是
 * `aid_arc` / `aid_circle` 这类几何辅助弧（`mbdV2ExternalAnnotations.ts`
 * `mapAidArc` / `mapAidCircle`），标的是模型上的真实圆/弧，放大就离开真实几何，
 * 必须 1:1 画；`part` 未声明的旧输入同样保持 1:1。
 *
 * 缩放必须发生在采样之前：`sampleArcToDesignAndScreenPath` 的细分按弦误差
 * （`tolerancePx`）决定点数，先放大半径再采样才拿到「真正 15 px 的弧」的合法
 * 细分；对已采样的 2 点退化折线做屏幕放大只会得到一条变长的直线段。
 */
function explicitArc(
  arc: ExplicitArcInput,
  context: LayoutContext,
): ReturnType<typeof sampleArcToDesignAndScreenPath> {
  if (arc.part !== 'dimension') {
    return sampleArcToDesignAndScreenPath(arc, context.projector);
  }
  const worldPerPixel = context.projector.worldPerPixelAt(arc.center);
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= EPSILON) {
    return sampleArcToDesignAndScreenPath(arc, context.projector);
  }
  const floorM = context.theme.minArcRadiusPx * worldPerPixel;
  return sampleArcToDesignAndScreenPath(
    arc.radiusM >= floorM ? arc : { ...arc, radiusM: floorM },
    context.projector,
  );
}

export function layoutExplicit(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  // A running dimension presented in 3D rebuilds its own geometry from the
  // solver's pipe points; the flat path below stays for every other input.
  // Billboard tags never arrive here: `layoutViewport` plans and places them
  // before dispatching the rest to `layoutDimension`.
  if (input.dimension3d) return layoutDimension3d(input, input.dimension3d, context);
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const projectedTextHeightPx = sourceTextHeightPx(input, context);
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
  // Q6: `above` lifts the text off the line and leaves the line whole, so there
  // is nothing to trim — the clearance pass is skipped, which is also what makes
  // the line draw as one untouched segment (see `explicitSceneLines`).
  let above = drawsLabelAbove(input);
  let liftOffsetPx: Vec2 = above
    ? labelLiftOffset(input, context, labelLiftPx(textHeightPx, context.theme))
    : [0, 0];
  let clearance = above
    ? null
    : labelClearance(
      input,
      labelRotationRad,
      styleRole,
      textHeightPx,
      context,
    );
  const buildSceneLines = (trim: LabelClearance | null): SceneLine[] => [
    ...input.lines.flatMap(line =>
      explicitSceneLines(line, trim, styleRole, context)),
    ...input.arrowLines.flatMap(line =>
      explicitArrowLine(line, styleRole, arrowMinLengthPx, context)),
  ];
  let sceneLines = buildSceneLines(clearance);
  const sceneArrows = (input.arrows ?? []).flatMap(arrow =>
    explicitArrow(arrow, styleRole, context));
  const scenePaths = (input.arcs ?? []).flatMap((arc) => {
    const sampled = explicitArc(arc, context);
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
      marker.radiusPx ?? context.theme.markerRadiusPx,
      styleRole,
      marker.style,
    ));
  // Q6 `above` row guard, decided per record. `above` lifts the text off its
  // line along the line normal but never asked what the label rises into:
  // when a neighbouring stroke sits inside the lifted box the record is
  // better off `interrupted`, which at least breaks the line around the
  // label. Per record, not per batch — one row of a dense sheet can have the
  // room the next lacks. Screen space, because the lift itself is a pixel
  // quantity: projector output is the only frame where "how far the text
  // rises" and "what it rises into" are measured alike.
  //
  // Scope boundary: this call sees the record's own emitted primitives only,
  // so "other things" means every scene primitive here except the dimension
  // line the label rose from (it is meant to hover `labelLiftPx` off it —
  // checking it would void the presentation outright) and the label run
  // itself. `LayoutContext` carries no channel to other records' primitives
  // or label boxes, so cross-record row spacing stays the caller's job; if a
  // neighbour channel ever lands on the context, fold its primitives into
  // `obstacles` the same way.
  //
  // An empty label draws no ink, so there is nothing to collide with.
  if (above && input.formattedLabel.length > 0) {
    const liftSourceIndex = input.lines.findIndex(
      line => line.part === 'dimension',
    );
    const obstacles = aboveGuardObstacles([
      // While `above` stands `clearance` is null, so `explicitSceneLines`
      // emitted exactly one scene line per `input.lines` entry, in order —
      // the scene line at `liftSourceIndex` is the very line the lift normal
      // came from. Arrow-stroke outputs trail the input lines and all stay.
      ...sceneLines.filter((_, index) => index !== liftSourceIndex),
      ...sceneArrows,
      ...scenePaths,
      ...sceneMarkers,
    ], context.projector);
    const liftedCenter = projectSceneVertex(
      sceneVertex(input.labelAnchor, liftOffsetPx),
      context.projector,
    );
    // The same padded box `labelClearance` would have trimmed against, only
    // moved to the lifted position.
    const liftedBox = labelBoundsOf(
      makeCenteredGlyphRun(
        context.font,
        input.formattedLabel,
        liftedCenter,
        textHeightPx,
        styleRole,
      ),
      context.theme,
    );
    const minClearancePx = context.theme.aboveRowClearancePx;
    const staysAbove = !aboveLabelIntrudes(
      obstacles,
      liftedBox,
      liftedCenter,
      labelRotationRad,
      minClearancePx,
    );
    if (!staysAbove) {
      // Fall back to `interrupted` for this record: revert the lift, let the
      // clearance pass build its trim box and re-emit the lines so the
      // dimension line is broken around the label again.
      above = false;
      liftOffsetPx = [0, 0];
      clearance = labelClearance(
        input,
        labelRotationRad,
        styleRole,
        textHeightPx,
        context,
      );
      sceneLines = buildSceneLines(clearance);
    }
  }
  const glyphScene = sceneGlyph(
    input.formattedLabel,
    sceneVertex(input.labelAnchor, liftOffsetPx),
    textHeightPx,
    styleRole,
    labelRotationRad,
  );
  const lineAdvancePx = textHeightPx * context.theme.labelLineAdvance;
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
  const labelBounds = labelBoundsOf(glyph, context.theme);
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

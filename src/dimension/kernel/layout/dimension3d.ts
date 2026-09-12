import { stablePerpendicular } from '../geometry/planeBasis';
import {
  makeSceneLine,
  projectScenePrimitives,
  projectSceneVertex,
  projectTextFrameQuad,
  sceneGlyph,
  sceneGlyphInFrame,
  sceneVertex,
} from '../geometry/sceneGeometry';
import {
  expandRect,
  makeGlyphHitRegion,
  makeLineHitRegion,
} from '../geometry/screenGeometry';
import { resolveDimensionStyleRole } from '../theme';
import {
  add3,
  cross3,
  dot3,
  EPSILON,
  lerp3,
  scale3,
  sub3,
  tryNormalize3,
} from '../vec';

import { emptyLayout } from './linear';

import type {
  ExplicitDimension3dInput,
  ExplicitLayoutInput,
  ExplicitLodHiddenReason,
  HitRegion,
  LayoutResult,
  SceneGlyphRun,
  ScenePrimitive,
  SceneTextFrame,
  SceneTriangle,
  ScreenGlyphRun,
  ScreenLine,
  ScreenLinePart,
  ScreenRect,
  Vec2,
  Vec3,
} from '../types';
import type { LayoutContext } from './context';

type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * View ray through `point` in Design Space, pointing away from the camera.
 * Exact for a perspective camera (the near/far unprojections of the point's
 * own pixel); the camera's forward axis is the fallback when the projector
 * cannot unproject.
 */
function viewDirectionAt(point: Vec3, context: LayoutContext): Vec3 {
  const { projector } = context;
  const screen = projector.project(point);
  const near = projector.unproject({ x: screen.x, y: screen.y, depth: -1 });
  const far = projector.unproject({ x: screen.x, y: screen.y, depth: 1 });
  const ray = sub3(far, near);
  if (!ray.every(Number.isFinite)) return projector.forward;
  return tryNormalize3(ray) ?? projector.forward;
}

function rectCorners(rect: ScreenRect): Quad {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
}

/**
 * True-3D presentation of a solver-authored running dimension (reference
 * drawing style, 2026-09-12). Everything is built in Design Space in units of
 * the text height `h = max(source cheight, theme floor · worldPerPixel)`:
 *
 * - the dimension line moves out along the solver's `dim_dir` to
 *   `surface + standoff·h + row·rowSpacing·h`, so it clears the pipe body
 *   and the solver's atta / main rows stay apart at every distance;
 * - extension lines start just outside the pipe surface and overshoot the
 *   dimension line (GB/T 4458.4 / ISO 129-1 drawing convention);
 * - the value text lies in the plane that contains the dimension line and
 *   faces the camera (rotated about the line), reads left → right (vertical
 *   runs read upwards, ISO 129-1 §4.1.1) and sits above the line, not in a
 *   break (ISO 129-1 §5.7.2);
 * - filled arrowheads are triangles in the same plane; when the value does
 *   not fit between them the heads flip outwards and the text moves past one
 *   end (ISO 129-1 §5.7.3 a, PML `sepSmallDim`).
 *
 * The solver's value, segmentation, row and along-line text position are
 * untouched; the contract's own arrow strokes are not drawn here because the
 * line they were attached to has moved. LOD follows the flat presentation
 * (S3); the projected text quad is exported for the pairwise declutter (S1).
 */
export function layoutDimension3d(
  input: ExplicitLayoutInput,
  spec: ExplicitDimension3dInput,
  context: LayoutContext,
): LayoutResult {
  const { theme, projector, font } = context;
  const rules = theme.dimension3d;
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const label = input.formattedLabel;
  const hidden = (reason: ExplicitLodHiddenReason): LayoutResult =>
    emptyLayout(input.id, input.labelPinned, label, reason);
  const empty = (): LayoutResult => emptyLayout(input.id, input.labelPinned, label);

  const normal = tryNormalize3(spec.direction);
  const axisMid = lerp3(spec.from, spec.to, 0.5);
  const metresPerPixel = projector.worldPerPixelAt(axisMid);
  if (!normal || !Number.isFinite(metresPerPixel) || metresPerPixel <= EPSILON) {
    return empty();
  }

  const sourceHeightM = input.textHeightM !== undefined && input.textHeightM > 0
    ? input.textHeightM
    : 0;
  const h = Math.max(sourceHeightM, rules.textFloorPx * metresPerPixel);
  const idealHeightPx = h / metresPerPixel;

  // Level of detail (S3), same rules as the flat presentation: a secondary
  // (atta) row disappears while the source text height projects below the
  // theme floor; a running dimension disappears once its line is shorter
  // than its own value text.
  if (
    input.lod?.tier === 'secondary'
    && sourceHeightM > 0
    && sourceHeightM / metresPerPixel < theme.sourceTextHeightMinPx
  ) {
    return hidden('secondary-far');
  }

  const standoff = spec.surfaceM + (rules.standoffH + spec.row * rules.rowSpacingH) * h;
  const lineStart = add3(spec.from, scale3(normal, standoff));
  const lineEnd = add3(spec.to, scale3(normal, standoff));
  const along = tryNormalize3(sub3(lineEnd, lineStart));
  if (!along) return empty();
  const startScreen = projectSceneVertex(sceneVertex(lineStart), projector);
  const endScreen = projectSceneVertex(sceneVertex(lineEnd), projector);
  const lineLengthPx = Math.hypot(
    endScreen[0] - startScreen[0],
    endScreen[1] - startScreen[1],
  );
  const labelWidthPx = font.getWidth(idealHeightPx, label);
  if (
    input.lod?.hideShort
    && label.length > 0
    && lineLengthPx < labelWidthPx * theme.lodMinLineToLabelRatio
  ) {
    return hidden('short-line');
  }

  // Text plane: contains the dimension line, turned about it to face the
  // camera. `up` is the in-plane direction across the line; its sign and the
  // reading direction are fixed on screen below.
  const mid = lerp3(lineStart, lineEnd, 0.5);
  const view = viewDirectionAt(mid, context);
  const planeNormal = tryNormalize3(sub3(view, scale3(along, dot3(view, along))))
    ?? stablePerpendicular(along);
  if (!planeNormal) return empty();
  let up = tryNormalize3(cross3(planeNormal, along));
  if (!up) return empty();

  const midScreen = projectSceneVertex(sceneVertex(mid), projector);
  const screenDelta = (direction: Vec3): Vec2 => {
    const point = projectSceneVertex(
      sceneVertex(add3(mid, scale3(direction, h))),
      projector,
    );
    return [point[0] - midScreen[0], point[1] - midScreen[1]];
  };
  // Reads left → right; a vertical run reads upwards (ISO 129-1 §4.1.1).
  let reading = along;
  let baseline = screenDelta(reading);
  if (
    baseline[0] < -EPSILON
    || (Math.abs(baseline[0]) <= EPSILON && baseline[1] > 0)
  ) {
    reading = scale3(along, -1);
    baseline = screenDelta(reading);
  }
  // "Above the line" is the baseline turned 90° counter-clockwise on screen.
  const wantUp: Vec2 = [baseline[1], -baseline[0]];
  const upScreen = screenDelta(up);
  if (upScreen[0] * wantUp[0] + upScreen[1] * wantUp[1] < 0) {
    up = scale3(up, -1);
  }
  const baselinePx = Math.hypot(baseline[0], baseline[1]);
  const foreshortened = baselinePx < rules.foreshortenRatio * idealHeightPx;

  const arrowLength = rules.arrowLengthH * h;
  const arrowHalfWidth = arrowLength
    * Math.tan((theme.arrowHalfAngleDeg * Math.PI) / 180);
  const arrowLengthPx = arrowLength / metresPerPixel;
  const fits = lineLengthPx
    >= labelWidthPx + 2 * arrowLengthPx + rules.outsideClearancePx;
  const outside: ExplicitDimension3dInput['outside'] = spec.outside
    ?? (label.length > 0 && !fits ? 'end' : undefined);

  const primitives: ScenePrimitive[] = [];
  const line = (from: Vec3, to: Vec3, part: ScreenLinePart): void => {
    primitives.push(makeSceneLine(sceneVertex(from), sceneVertex(to), part, styleRole));
  };
  line(lineStart, lineEnd, 'dimension');
  const extensionStart = spec.surfaceM + rules.extensionStartH * h;
  const overshoot = rules.extensionOvershootH * h;
  for (const [pipe, end] of [[spec.from, lineStart], [spec.to, lineEnd]] as const) {
    line(
      add3(pipe, scale3(normal, extensionStart)),
      add3(end, scale3(normal, overshoot)),
      'extension',
    );
  }
  // Filled heads in the text plane; `outside` flips them to point inwards
  // from beyond the extension lines and adds the tails they sit on.
  const inward = outside ? -1 : 1;
  const head = (tip: Vec3, towards: Vec3): SceneTriangle => {
    const base = add3(tip, scale3(towards, arrowLength * inward));
    return {
      kind: 'scene-triangle',
      points: [
        sceneVertex(tip),
        sceneVertex(add3(base, scale3(up, arrowHalfWidth))),
        sceneVertex(add3(base, scale3(up, -arrowHalfWidth))),
      ],
      part: 'arrow',
      styleRole,
    };
  };
  primitives.push(head(lineStart, along), head(lineEnd, scale3(along, -1)));
  const tail = arrowLength + rules.outsideTailH * h;
  if (outside) {
    line(lineStart, add3(lineStart, scale3(along, -tail)), 'dimension');
    line(lineEnd, add3(lineEnd, scale3(along, tail)), 'dimension');
  }

  const textWidthM = font.getWidth(h, label);
  const textCentre = outside === 'start'
    ? add3(lineStart, scale3(along, -(tail + textWidthM / 2)))
    : outside === 'end'
      ? add3(lineEnd, scale3(along, tail + textWidthM / 2))
      : mid;
  const origin = add3(textCentre, scale3(up, rules.textGapH * h));
  let glyphScene: SceneGlyphRun;
  let textQuad: Quad | null = null;
  if (label.length > 0 && !foreshortened) {
    const frame: SceneTextFrame = {
      origin,
      xAxis: scale3(reading, h),
      yAxis: scale3(up, h),
    };
    glyphScene = sceneGlyphInFrame(
      label,
      frame,
      idealHeightPx,
      Math.atan2(baseline[1], baseline[0]),
      styleRole,
    );
    textQuad = projectTextFrameQuad(label, frame, projector, font);
  } else {
    // Edge-on plane: view-plane text at the same anchor, viewport-horizontal
    // (GB/T 4458.4 method 2), capped like any flat source text.
    glyphScene = sceneGlyph(
      label,
      sceneVertex(origin),
      Math.min(idealHeightPx, theme.sourceTextHeightMaxPx),
      styleRole,
    );
  }
  primitives.push(glyphScene);

  const projected = projectScenePrimitives(primitives, projector, font);
  const lines = projected.filter(
    (primitive): primitive is ScreenLine => primitive.kind === 'line',
  );
  const glyph = projected.find(
    (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
  )!;
  const hitRegions: HitRegion[] = [
    ...lines.map(item => makeLineHitRegion(item, theme.dimensionStrokeWidthPx)),
    makeGlyphHitRegion(glyph),
  ];
  // Pairwise declutter (S1): main rows beat atta rows, then the longer line
  // per label width wins; `declutterOverlaps` breaks the remaining ties by id.
  const rank = (input.lod?.tier === 'secondary' ? 0 : 1000)
    + lineLengthPx / Math.max(1, labelWidthPx);

  return {
    dimensionId: input.id,
    scenePrimitives: primitives,
    primitives: projected,
    hitRegions,
    labelBounds: expandRect(glyph.bounds, theme.labelPaddingPx / 2),
    labelPinned: input.labelPinned,
    derived: {
      formattedLabel: label,
      ...(label.length > 0
        ? { declutter: { rank, quad: textQuad ?? rectCorners(glyph.bounds) } }
        : {}),
    },
  };
}

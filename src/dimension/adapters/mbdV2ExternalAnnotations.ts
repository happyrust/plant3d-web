import { Matrix4, Vector3 } from 'three';

import {
  stablePerpendicular,
  stablePlaneBasis,
} from '../kernel/geometry/planeBasis';
import {
  add3,
  dot3,
  length3,
  lerp3,
  scale3,
  sub3,
  tryNormalize3,
} from '../kernel/vec';

import type {
  MbdPrimitive,
  MbdV2AidArc,
  MbdV2AidCircle,
  MbdV2AngleDim,
  MbdV2ArcFrame,
  MbdV2Label,
  MbdV2LeaderLine,
  MbdV2LinearDim,
  MbdV2PipeData,
  MbdV2Vec3,
} from './mbdV2Contract';
import type {
  ExternalDimensionCategory,
  ExternalDimensionRecord,
} from './normalizeExternalDimensions';
import type { Vec3 } from '../domain/types';
import type {
  DimensionLineStyle,
  ExplicitArcInput,
  ExplicitArrowInput,
  ExplicitLayoutInput,
  ExplicitLodInput,
  ExplicitMarkerInput,
  ExplicitTagInput,
  ExplicitTagStyle,
  ExplicitTextInput,
  ScreenLinePart,
} from '../kernel/types';

export type MbdV2MappingResult = Readonly<{
  records: readonly ExternalDimensionRecord[];
  skipped: readonly Readonly<{ id: string; reason: string }>[];
}>;

const WELD_MARKER_RADIUS_PX = 5;
const SLOPE_ARROW_LENGTH_RATIO = 0.08;
const SLOPE_ARROW_HALF_ANGLE_RAD = (20 * Math.PI) / 180;

type ExplicitLine = Readonly<{
  from: Vec3;
  to: Vec3;
  part: ScreenLinePart;
  style?: DimensionLineStyle;
}>;

type TransformPoint = (point: MbdV2Vec3) => Vec3;

/**
 * Payload → Design Space. Points take the full affine matrix; axis vectors
 * take its upper 3×3 and come back unit length (or null when they collapse),
 * so `source_to_design` rotation reaches arc frames while translation and
 * scale do not.
 */
type FrameTransform = Readonly<{
  point: TransformPoint;
  direction: (direction: MbdV2Vec3) => Vec3 | null;
}>;

function frameTransformer(data: MbdV2PipeData): FrameTransform | null {
  if (data.meta.geometry_space === 'design_m') {
    return {
      point: point => [point[0], point[1], point[2]],
      direction: direction => tryNormalize3(direction),
    };
  }
  if (!data.meta.source_to_design) return null;
  const matrix = new Matrix4().fromArray([...data.meta.source_to_design]);
  return {
    point: (point) => {
      const transformed = new Vector3(...point).applyMatrix4(matrix);
      return [transformed.x, transformed.y, transformed.z];
    },
    direction: (direction) => {
      const transformed = new Vector3(...direction).transformDirection(matrix);
      return tryNormalize3([transformed.x, transformed.y, transformed.z]);
    },
  };
}

/**
 * Group text height in Design Space: `meta.cheight_mm` (PML `isoline`
 * character height, one value per payload) taken through the same transform
 * as the geometry — the length of a cheight-long vector, so a uniform
 * `source_to_design` scale reaches it while translation does not. A
 * `design_m` payload still declares the height in millimetres. Undefined when
 * the solver did not report one; the kernel then keeps its fixed text height.
 */
function groupTextHeightM(
  data: MbdV2PipeData,
  transform: FrameTransform,
): number | undefined {
  const cheight = data.meta.cheight_mm;
  if (cheight === undefined || cheight === null || !(cheight > 0)) return undefined;
  if (data.meta.geometry_space === 'design_m') return cheight / 1000;
  const length = length3(sub3(
    transform.point([cheight, 0, 0]),
    transform.point([0, 0, 0]),
  ));
  return length > 0 ? length : undefined;
}

function lineStyleFrom(style: string | undefined): DimensionLineStyle | undefined {
  switch (style) {
    case 'solid':
    case 'dashed':
      return style;
    case 'dash_dot':
      return 'dash-dot';
    default:
      return undefined;
  }
}

function midpoint(a: MbdV2Vec3, b: MbdV2Vec3): Vec3 {
  return lerp3(a, b, 0.5);
}

function slopeArrowLines(
  start: MbdV2Vec3,
  end: MbdV2Vec3,
): readonly Readonly<{ from: Vec3; to: Vec3 }>[] {
  const delta = sub3(end, start);
  const size = length3(delta);
  const direction = tryNormalize3(delta);
  if (!direction) return [];
  const side = stablePerpendicular(direction);
  if (!side) return [];
  const arrowLength = size * SLOPE_ARROW_LENGTH_RATIO;
  const back = Math.cos(SLOPE_ARROW_HALF_ANGLE_RAD) * arrowLength;
  const spread = Math.sin(SLOPE_ARROW_HALF_ANGLE_RAD) * arrowLength;
  const tip: Vec3 = [end[0], end[1], end[2]];
  return [1, -1].map((flip) => ({
    from: tip,
    to: [
      tip[0] - direction[0] * back + side[0] * spread * flip,
      tip[1] - direction[1] * back + side[1] * spread * flip,
      tip[2] - direction[2] * back + side[2] * spread * flip,
    ] as Vec3,
  }));
}

function splitTextLines(text: string): readonly string[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  return lines.length > 0 ? lines : [text];
}

function multiLineTexts(
  text: string,
  anchor: MbdV2Vec3,
): Readonly<{ formattedLabel: string; texts: readonly ExplicitTextInput[] }> {
  const [first, ...rest] = splitTextLines(text);
  return {
    formattedLabel: first ?? '',
    texts: rest.map((line, index) => ({
      text: line,
      anchor: [anchor[0], anchor[1], anchor[2]] as Vec3,
      stackIndex: index + 1,
    })),
  };
}

type ExplicitParts = Readonly<{
  formattedLabel: string;
  labelAnchor: Vec3;
  labelAlong?: Vec3;
  lines?: readonly ExplicitLine[];
  arrowLines?: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  arrows?: readonly ExplicitArrowInput[];
  arcs?: readonly ExplicitArcInput[];
  markers?: readonly ExplicitMarkerInput[];
  texts?: readonly ExplicitTextInput[];
  lod?: ExplicitLodInput;
  dimension3d?: ExplicitLayoutInput['dimension3d'];
  tag?: ExplicitTagInput;
}>;

function explicitRecord(
  primitive: MbdPrimitive,
  category: ExternalDimensionCategory,
  parts: ExplicitParts,
  role: 'external' | 'external-reference' = 'external',
): ExternalDimensionRecord {
  const layout: ExplicitLayoutInput = {
    id: primitive.id,
    role,
    // The solver already placed every label (`label_anchor`, ADR 0003
    // deterministic layout), so no MBD record takes part in the Web declutter:
    // `resolveLabelCollisions` only lets pinned labels claim space, never moves
    // them, and never invents a leader to a relocated label. This matches the
    // parquet channel (`mbdExternalDimensions.ts`); PR6's `layoutAuthority`
    // will carry the same decision explicitly.
    labelPinned: true,
    formattedLabel: parts.formattedLabel,
    lines: parts.lines ?? [],
    labelAnchor: parts.labelAnchor,
    ...(parts.labelAlong ? { labelAlong: parts.labelAlong } : {}),
    arrowLines: parts.arrowLines ?? [],
    ...(parts.arrows && parts.arrows.length > 0
      ? { arrows: parts.arrows }
      : {}),
    ...(parts.arcs && parts.arcs.length > 0 ? { arcs: parts.arcs } : {}),
    ...(parts.markers && parts.markers.length > 0
      ? { markers: parts.markers }
      : {}),
    ...(parts.texts && parts.texts.length > 0 ? { texts: parts.texts } : {}),
    ...(parts.lod ? { lod: parts.lod } : {}),
    ...(parts.dimension3d ? { dimension3d: parts.dimension3d } : {}),
    ...(parts.tag ? { tag: parts.tag } : {}),
  };
  return {
    id: primitive.id,
    source: 'mbd',
    sourceLabel: `MBD: ${primitive.id}`,
    role,
    category,
    layout,
  };
}

/** Two Design Space points closer than this (0.1 mm) count as the same point. */
const SAME_POINT_TOLERANCE_M = 1e-4;

function samePoint(a: Vec3, b: Vec3): boolean {
  return length3(sub3(a, b)) <= SAME_POINT_TOLERANCE_M;
}

/**
 * Pair every `label` with the `leader_line` that starts on it: by the
 * producer's id convention (`<label id>:leader`, plant-mbd tags) first, else
 * by geometry (the leader starts at the label position). Each leader is
 * spent once. The pair becomes one record — the text plus its leader — so
 * the billboard presentation can move the body while the leader keeps
 * pointing at the pipe, and hiding / selecting the tag takes the leader
 * along.
 */
function pairLeaders(
  data: MbdV2PipeData,
  transformPoint: TransformPoint,
): ReadonlyMap<string, MbdV2LeaderLine> {
  const leaders = data.primitives.filter(
    (primitive): primitive is MbdV2LeaderLine => primitive.kind === 'leader_line',
  );
  const labels = data.primitives.filter(
    (primitive): primitive is MbdV2Label => primitive.kind === 'label',
  );
  const spent = new Set<string>();
  const byLabel = new Map<string, MbdV2LeaderLine>();
  for (const label of labels) {
    const named = leaders.find(leader =>
      !spent.has(leader.id) && leader.id === `${label.id}:leader`);
    const leader = named ?? leaders.find(leader =>
      !spent.has(leader.id)
      && samePoint(transformPoint(leader.start), transformPoint(label.position)));
    if (!leader) continue;
    spent.add(leader.id);
    byLabel.set(label.id, leader);
  }
  return byLabel;
}

type TagClass = Readonly<{
  style: ExplicitTagStyle;
  dot: boolean;
  lod?: ExplicitLodInput;
  /** Lines matching this pattern stay on a mid-range view; the rest are close-up detail. */
  primaryLine?: RegExp;
}>;

/**
 * What kind of drawing call-out a solver tag is. plant-mbd names its tags
 * (`…:tag:connection:<end>` end-point coordinate blocks, `…:tag:elbo:<refno>`
 * elbow angle + elevation, `…:tag:name:<refno>` component name,
 * `…:tag:branch-name`); a label from another producer is classified by its
 * text — a coordinate block (`X … / Y … / PE …`) reads as a card, anything
 * else as a framed name. The reference drawing style keeps coordinate blocks
 * and names at every distance, shows elbow elevations from mid range (the
 * angle only on a close-up) and the branch name only on a close-up.
 */
function classifyTag(primitive: MbdV2Label): TagClass {
  const id = primitive.id;
  if (id.includes(':tag:connection:')) return { style: 'card', dot: true };
  if (id.includes(':tag:name:')) return { style: 'frame', dot: false };
  if (id.includes(':tag:elbo:')) {
    return { style: 'pill', dot: false, lod: { tier: 'secondary' }, primaryLine: /^PE\b/ };
  }
  if (id.includes(':tag:branch-name')) {
    return { style: 'pill', dot: false, lod: { tier: 'detail' } };
  }
  const coordinateBlock = splitTextLines(primitive.text)
    .some(line => /^(?:X|Y|PE)\s/.test(line));
  return coordinateBlock ? { style: 'card', dot: true } : { style: 'frame', dot: false };
}

/**
 * Direction out of the pipe at `point`, from the running dimensions: when
 * exactly one dimension has an extension line rooted there the point is an
 * open end and the pipe runs in from the dimension's other root. A point
 * shared by two dimensions (a connection inside the branch) has no single
 * outward direction.
 */
function awayFromPipe(
  point: Vec3,
  dimensions: readonly MbdV2LinearDim[],
  transformPoint: TransformPoint,
): Vec3 | undefined {
  let touching = 0;
  let away: Vec3 | undefined;
  for (const dimension of dimensions) {
    const roots = dimension.extension_lines.map(line => transformPoint(line.from));
    const index = roots.findIndex(root => samePoint(root, point));
    if (index < 0) continue;
    touching += 1;
    const other = roots.find((_, otherIndex) => otherIndex !== index);
    if (other) away = tryNormalize3(sub3(point, other)) ?? undefined;
  }
  return touching === 1 ? away : undefined;
}

/**
 * Tag (`label`, optionally with its `leader_line`): the flat presentation is
 * the solver's text at its position plus the leader as drawn; with `tag`
 * the kernel presents it as a billboard call-out (card / frame / pill) that
 * keeps its leader on the pipe point (reference drawing style, 2026-09-12).
 * The `mbd_3d=0` switch strips `tag` and gets the flat presentation back.
 */
function mapLabel(
  primitive: MbdV2Label,
  leader: MbdV2LeaderLine | undefined,
  dimensions: readonly MbdV2LinearDim[],
  transformPoint: TransformPoint,
): ExternalDimensionRecord {
  const position = transformPoint(primitive.position);
  const { formattedLabel, texts } = multiLineTexts(primitive.text, position);
  const target = leader ? transformPoint(leader.end) : undefined;
  const tagClass = classifyTag(primitive);
  const tag: ExplicitTagInput = {
    style: tagClass.style,
    lines: splitTextLines(primitive.text).map(text => ({
      text,
      ...(tagClass.primaryLine && !tagClass.primaryLine.test(text) ? { detail: true } : {}),
    })),
    ...(target ? { target } : {}),
    ...(target && tagClass.style === 'card'
      ? (() => {
        const away = awayFromPipe(target, dimensions, transformPoint);
        return away ? { away } : {};
      })()
      : {}),
    ...(tagClass.dot ? { dot: true } : {}),
  };
  return explicitRecord(primitive, 'annotation', {
    formattedLabel,
    labelAnchor: position,
    texts,
    ...(target ? { lines: [{ from: position, to: target, part: 'leader' as const }] } : {}),
    ...(tagClass.lod ? { lod: tagClass.lod } : {}),
    tag,
  });
}

/** Slope marks and skew aids are close-up detail in the reference drawing style. */
function isDetailAid(id: string): boolean {
  return id.includes(':slope:') || id.includes(':skew:');
}

/**
 * Group facts the 3D presentation needs from the whole payload: the solver's
 * row spacing is `1.2 · cheight` (plant-mbd `isodim.rs` row offset), and its
 * innermost row sits `od` from the pipe centre line, so the shortest
 * extension line in the branch reads as the pipe surface distance. The lower
 * quartile rather than the minimum keeps one odd short line from pulling the
 * whole branch inwards; on a branch with several pipe sizes the larger pipe's
 * rows come out one or two rows further, which still clears its body.
 */
type Presentation3dContext = Readonly<{
  cheightM: number;
  surfaceM: number;
}>;

const SOLVER_ROW_SPACING_CHEIGHT = 1.2;

function extensionLengthM(
  primitive: MbdV2LinearDim,
  transformPoint: TransformPoint,
): number | null {
  if (primitive.extension_lines.length === 0) return null;
  const total = primitive.extension_lines.reduce((sum, line) =>
    sum + length3(sub3(transformPoint(line.to), transformPoint(line.from))), 0);
  return total / primitive.extension_lines.length;
}

function presentation3dContext(
  data: MbdV2PipeData,
  transformPoint: TransformPoint,
  cheightM: number | undefined,
): Presentation3dContext | null {
  if (cheightM === undefined) return null;
  const lengths = data.primitives
    .flatMap(primitive => (primitive.kind === 'linear_dim'
      ? [extensionLengthM(primitive, transformPoint)]
      : []))
    .filter((length): length is number => length !== null && length > 0)
    .sort((a, b) => a - b);
  if (lengths.length === 0) return null;
  return {
    cheightM,
    surfaceM: lengths[Math.floor(lengths.length * 0.25)]!,
  };
}

/**
 * Per-dimension 3D presentation input (`ExplicitDimension3dInput`): the pipe
 * centre-line points are the extension lines' `from`, `dim_dir` is their
 * direction, and the solver row is read back from the extension length. A
 * dimension without exactly two extension lines (nothing to stand off from)
 * keeps the flat presentation.
 */
function dimension3dInput(
  primitive: MbdV2LinearDim,
  start: Vec3,
  end: Vec3,
  labelAnchor: Vec3,
  transformPoint: TransformPoint,
  context: Presentation3dContext,
): ExplicitLayoutInput['dimension3d'] | undefined {
  if (primitive.extension_lines.length !== 2) return undefined;
  const [first, second] = primitive.extension_lines.map(line => ({
    from: transformPoint(line.from),
    to: transformPoint(line.to),
  }));
  const firstAtStart = length3(sub3(first!.to, start)) <= length3(sub3(second!.to, start));
  const atStart = firstAtStart ? first! : second!;
  const atEnd = firstAtStart ? second! : first!;
  const direction = tryNormalize3(sub3(atStart.to, atStart.from));
  if (!direction) return undefined;
  const extension = (length3(sub3(atStart.to, atStart.from))
    + length3(sub3(atEnd.to, atEnd.from))) / 2;
  const row = Math.max(0, Math.round(
    (extension - context.surfaceM) / (SOLVER_ROW_SPACING_CHEIGHT * context.cheightM),
  ));
  const span = sub3(end, start);
  const spanLength = dot3(span, span);
  const alongT = spanLength > 0 ? dot3(sub3(labelAnchor, start), span) / spanLength : 0.5;
  return {
    from: atStart.from,
    to: atEnd.from,
    direction,
    surfaceM: context.surfaceM,
    row,
    ...(primitive.sub_kind === 'small'
      ? { outside: alongT < 0.5 ? 'start' : 'end' }
      : {}),
  };
}

/**
 * Arrowheads are the contract's `arrow_lines` — one stroke per wing, `from`
 * on the dimension line — drawn 1:1 (ADR 0048: respect the source's arrow
 * segments, do not regenerate them). The solver scales them with the group
 * character height and already points them outwards for small dimensions,
 * so no `sub_kind` heuristic is needed; the kernel's legibility floor
 * (`arrowLineMinLengthPx`, ADR 0056) keeps them readable on a plant-wide
 * view. Sources that carry no strokes (older parquet rows, hand-authored
 * data) fall back to the kernel's screen-scaled filled heads.
 *
 * With a group `cheight` the record also carries `dimension3d`, and the
 * kernel presents it as true 3D annotation standing off the pipe (reference
 * drawing style, 2026-09-12); the flat geometry below stays as the fallback
 * the `mbd_3d=0` debug switch returns to.
 */
function mapLinearDim(
  primitive: MbdV2LinearDim,
  transformPoint: TransformPoint,
  presentation3d: Presentation3dContext | null,
): ExternalDimensionRecord {
  const role = primitive.reference ? 'external-reference' : 'external';
  const start = transformPoint(primitive.start);
  const end = transformPoint(primitive.end);
  const labelAnchor = transformPoint(primitive.label_anchor);
  const lines: ExplicitLine[] = [
    { from: start, to: end, part: 'dimension' },
    ...primitive.extension_lines.map(line => ({
      from: transformPoint(line.from),
      to: transformPoint(line.to),
      part: 'extension' as const,
    })),
  ];
  const arrowLines = primitive.arrow_lines.map(line => ({
    from: transformPoint(line.from),
    to: transformPoint(line.to),
  }));
  const outside = primitive.sub_kind === 'small';
  const dimension3d = presentation3d
    ? dimension3dInput(primitive, start, end, labelAnchor, transformPoint, presentation3d)
    : undefined;
  return explicitRecord(primitive, 'dimension', {
    formattedLabel: primitive.text,
    // Level of detail (S3): ATTA sub-dimensions are secondary and drop out on
    // a plant-wide view; a running dimension hides once its line projects
    // shorter than its own value text — except `small` ones, whose text the
    // solver already moved outside the line (PML `sepSmallDim`), so they stay
    // readable at any length. `sub_kind` is the solver's own label.
    lod: {
      tier: primitive.sub_kind === 'atta' ? 'secondary' : 'primary',
      hideShort: !outside,
    },
    labelAnchor,
    // 「工程文字朝向」: a dimension value runs along its dimension line. The
    // contract carries no orientation yet, but for a linear dim the direction
    // is the line itself, so this needs no guess. Tag/aid text keeps viewport
    // horizontal until the contract declares PML's `ori`.
    labelAlong: sub3(end, start),
    lines,
    ...(dimension3d ? { dimension3d } : {}),
    ...(arrowLines.length > 0
      ? { arrowLines }
      : {
        arrows: [
          { tip: start, towards: end, ...(outside ? { outside } : {}) },
          { tip: end, towards: start, ...(outside ? { outside } : {}) },
        ],
      }),
  }, role);
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Kernel arc with both angles resolved, plus the basis they are measured in. */
type MappedArc = Readonly<{
  arc: ExplicitArcInput & Readonly<{ startAngle: number; endAngle: number }>;
  basis: Readonly<{ u: Vec3; v: Vec3 }>;
}>;

const ARC_KINDS: ReadonlySet<string> = new Set(['angle_dim', 'aid_arc', 'aid_circle']);
const DEGENERATE_ARC_REASON = 'degenerate arc frame: normal or x_axis collapses '
  + 'or they are parallel after source_to_design';

/**
 * Contract arc frame → kernel arc. The contract measures angles from its own
 * `x_axis`; the kernel measures from `stablePlaneBasis(normal).u`, so the
 * start angle is re-expressed in that basis (ADR 0055). `x_axis` is
 * re-orthogonalised against `normal` to absorb float noise; the radius is
 * the Design Space length of the transformed radius vector, so a uniform
 * `source_to_design` scale reaches it while translation does not.
 */
function mappedArc(
  frame: MbdV2ArcFrame,
  transform: FrameTransform,
  part: ScreenLinePart,
  style?: DimensionLineStyle,
): MappedArc | null {
  const center = transform.point(frame.center);
  const normal = transform.direction(frame.normal);
  const xAxisRaw = transform.direction(frame.x_axis);
  if (!normal || !xAxisRaw) return null;
  const xAxis = tryNormalize3(
    sub3(xAxisRaw, scale3(normal, dot3(xAxisRaw, normal))),
  );
  const basis = stablePlaneBasis(normal);
  if (!xAxis || !basis) return null;
  const unitXAxis = tryNormalize3(frame.x_axis);
  if (!unitXAxis) return null;
  const rim = transform.point(
    add3(frame.center, scale3(unitXAxis, frame.radius)),
  );
  const radiusM = length3(sub3(rim, center));
  if (!(radiusM > 0)) return null;
  const startAngle = Math.atan2(dot3(xAxis, basis.v), dot3(xAxis, basis.u))
    + frame.start_angle_deg * DEGREES_TO_RADIANS;
  const endAngle = startAngle + frame.sweep_angle_deg * DEGREES_TO_RADIANS;
  return {
    arc: {
      center,
      normal,
      radiusM,
      startAngle,
      endAngle,
      part,
      ...(style ? { style } : {}),
    },
    basis,
  };
}

function arcPoint(mapped: MappedArc, angle: number): Vec3 {
  const { arc, basis } = mapped;
  return add3(
    arc.center,
    add3(
      scale3(basis.u, Math.cos(angle) * arc.radiusM),
      scale3(basis.v, Math.sin(angle) * arc.radiusM),
    ),
  );
}

/** Counter-clockwise tangent (about `normal`) at `angle`. */
function arcTangent(mapped: MappedArc, angle: number): Vec3 {
  const { basis } = mapped;
  return add3(
    scale3(basis.u, -Math.sin(angle)),
    scale3(basis.v, Math.cos(angle)),
  );
}

/**
 * PML `isoline.drawangle`: arc + two legs + the value text. The value runs
 * along the arc, so its baseline is the tangent at mid-sweep (the same
 * 「工程文字朝向」 rule `mapLinearDim` applies along its dimension line).
 */
function mapAngleDim(
  primitive: MbdV2AngleDim,
  transform: FrameTransform,
): ExternalDimensionRecord | null {
  const mapped = mappedArc(primitive, transform, 'dimension');
  if (!mapped) return null;
  const lines: ExplicitLine[] = primitive.leg_lines.map(line => ({
    from: transform.point(line.from),
    to: transform.point(line.to),
    part: 'extension' as const,
  }));
  const midAngle = (mapped.arc.startAngle + mapped.arc.endAngle) / 2;
  return explicitRecord(primitive, 'dimension', {
    formattedLabel: primitive.text,
    labelAnchor: transform.point(primitive.label_anchor),
    labelAlong: arcTangent(mapped, midAngle),
    lines,
    arcs: [mapped.arc],
  });
}

function mapAidArc(
  primitive: MbdV2AidArc,
  transform: FrameTransform,
): ExternalDimensionRecord | null {
  const mapped = mappedArc(
    primitive,
    transform,
    'arc',
    lineStyleFrom(primitive.style),
  );
  if (!mapped) return null;
  return explicitRecord(primitive, 'annotation', {
    formattedLabel: '',
    // Like `aid_line` anchors on its start point.
    labelAnchor: arcPoint(mapped, mapped.arc.startAngle),
    arcs: [mapped.arc],
  });
}

/** Full circle: no angles, radius measured along any in-plane direction. */
function mapAidCircle(
  primitive: MbdV2AidCircle,
  transform: FrameTransform,
): ExternalDimensionRecord | null {
  const center = transform.point(primitive.center);
  const normal = transform.direction(primitive.normal);
  const inPlane = stablePerpendicular(primitive.normal);
  if (!normal || !inPlane) return null;
  const rim = transform.point(
    add3(primitive.center, scale3(inPlane, primitive.radius)),
  );
  const radiusM = length3(sub3(rim, center));
  if (!(radiusM > 0)) return null;
  const style = lineStyleFrom(primitive.style);
  return explicitRecord(primitive, 'annotation', {
    formattedLabel: '',
    labelAnchor: center,
    arcs: [{
      center,
      normal,
      radiusM,
      part: 'arc',
      ...(style ? { style } : {}),
    }],
  });
}

/**
 * Map frozen-contract primitives onto read-only external records rendered by
 * the shared dimension kernel (ADR 0041). Weld and slope symbols are
 * assembled from arcs/lines/markers/text instead of dedicated primitives
 * (ADR 0042); angle dims, aid arcs and aid circles carry PML `AIDARC`
 * frames and map onto the kernel's native arc (ADR 0055).
 */
export function mbdV2ToExternalRecords(
  data: MbdV2PipeData,
): MbdV2MappingResult {
  const records: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const seenIds = new Set<string>();
  const transform = frameTransformer(data);

  if (!transform) {
    return {
      records,
      skipped: data.primitives.map(primitive => ({
        id: primitive.id,
        reason: 'source_mm payload requires a valid source_to_design matrix',
      })),
    };
  }
  const transformPoint = transform.point;
  const textHeightM = groupTextHeightM(data, transform);
  const presentation3d = presentation3dContext(data, transformPoint, textHeightM);
  const leaderByLabel = pairLeaders(data, transformPoint);
  const pairedLeaderIds = new Set([...leaderByLabel.values()].map(leader => leader.id));
  const linearDims = data.primitives.filter(
    (primitive): primitive is MbdV2LinearDim => primitive.kind === 'linear_dim',
  );

  for (const primitive of data.primitives) {
    if (seenIds.has(primitive.id)) {
      skipped.push({
        id: primitive.id,
        reason: 'Duplicate primitive id within MBD payload',
      });
      continue;
    }
    if (primitive.kind === 'leader_line' && pairedLeaderIds.has(primitive.id)) {
      // Drawn as part of its label's record (see `pairLeaders`).
      seenIds.add(primitive.id);
      continue;
    }
    let record: ExternalDimensionRecord | null = null;
    switch (primitive.kind) {
      case 'linear_dim':
        record = mapLinearDim(primitive, transformPoint, presentation3d);
        break;
      case 'angle_dim':
        record = mapAngleDim(primitive, transform);
        break;
      case 'aid_arc':
        record = mapAidArc(primitive, transform);
        break;
      case 'aid_circle':
        record = mapAidCircle(primitive, transform);
        break;
      case 'label':
        record = mapLabel(
          primitive,
          leaderByLabel.get(primitive.id),
          linearDims,
          transformPoint,
        );
        break;
      case 'aid_text': {
        const position = transformPoint(primitive.position);
        const { formattedLabel, texts } = multiLineTexts(
          primitive.text,
          position,
        );
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel,
          labelAnchor: position,
          texts,
          ...(isDetailAid(primitive.id) ? { lod: { tier: 'detail' } } : {}),
        });
        break;
      }
      case 'leader_line': {
        const start = transformPoint(primitive.start);
        const end = transformPoint(primitive.end);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: '',
          labelAnchor: start,
          lines: [{ from: start, to: end, part: 'leader' }],
        });
        break;
      }
      case 'aid_line': {
        const start = transformPoint(primitive.start);
        const end = transformPoint(primitive.end);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: '',
          labelAnchor: start,
          lines: [{
            from: start,
            to: end,
            part: 'extension',
            ...(lineStyleFrom(primitive.style)
              ? { style: lineStyleFrom(primitive.style) }
              : {}),
          }],
          ...(isDetailAid(primitive.id) ? { lod: { tier: 'detail' } } : {}),
        });
        break;
      }
      case 'aid_point': {
        const position = transformPoint(primitive.position);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: '',
          labelAnchor: position,
          markers: [{ at: position, shape: 'cross' }],
        });
        break;
      }
      case 'weld_mark': {
        const position = transformPoint(primitive.position);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: '',
          labelAnchor: position,
          markers: [
            {
              at: position,
              shape: 'circle',
              radiusPx: WELD_MARKER_RADIUS_PX,
            },
            ...(primitive.weld_type === 'field'
              ? [{
                at: position,
                shape: 'cross' as const,
                radiusPx: WELD_MARKER_RADIUS_PX,
              }]
              : []),
          ],
        });
        break;
      }
      case 'slope_mark': {
        const start = transformPoint(primitive.start);
        const end = transformPoint(primitive.end);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: primitive.text,
          labelAnchor: midpoint(start, end),
          lines: [{ from: start, to: end, part: 'dimension' }],
          arrowLines: slopeArrowLines(start, end),
          // Slopes are close-up detail in the reference drawing style.
          lod: { tier: 'detail' },
        });
        break;
      }
    }

    if (record) {
      seenIds.add(primitive.id);
      // Every record here comes from `explicitRecord`, so the layout is an
      // `ExplicitLayoutInput`; the group text height rides along with it so
      // the kernel can scale labels and the arrow floor with the model (S2).
      records.push(textHeightM === undefined
        ? record
        : {
          ...record,
          layout: { ...(record.layout as ExplicitLayoutInput), textHeightM },
        });
    } else {
      // Parse already checked structure, so the arc kinds are the only ones
      // that can fail here (axes collapsing under the transform). Diagnose it
      // like a duplicate id instead of letting the primitive vanish.
      skipped.push({
        id: primitive.id,
        reason: ARC_KINDS.has(primitive.kind)
          ? DEGENERATE_ARC_REASON
          : `unsupported primitive kind ${primitive.kind}`,
      });
    }
  }

  return { records, skipped };
}

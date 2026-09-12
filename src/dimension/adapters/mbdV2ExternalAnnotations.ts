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

/**
 * Arrowheads are the contract's `arrow_lines` — one stroke per wing, `from`
 * on the dimension line — drawn 1:1 (ADR 0048: respect the source's arrow
 * segments, do not regenerate them). The solver scales them with the group
 * character height and already points them outwards for small dimensions,
 * so no `sub_kind` heuristic is needed; the kernel's legibility floor
 * (`arrowLineMinLengthPx`, ADR 0056) keeps them readable on a plant-wide
 * view. Sources that carry no strokes (older parquet rows, hand-authored
 * data) fall back to the kernel's screen-scaled filled heads.
 */
function mapLinearDim(
  primitive: MbdV2LinearDim,
  transformPoint: TransformPoint,
): ExternalDimensionRecord {
  const role = primitive.reference ? 'external-reference' : 'external';
  const start = transformPoint(primitive.start);
  const end = transformPoint(primitive.end);
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
    labelAnchor: transformPoint(primitive.label_anchor),
    // 「工程文字朝向」: a dimension value runs along its dimension line. The
    // contract carries no orientation yet, but for a linear dim the direction
    // is the line itself, so this needs no guess. Tag/aid text keeps viewport
    // horizontal until the contract declares PML's `ori`.
    labelAlong: sub3(end, start),
    lines,
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

  for (const primitive of data.primitives) {
    if (seenIds.has(primitive.id)) {
      skipped.push({
        id: primitive.id,
        reason: 'Duplicate primitive id within MBD payload',
      });
      continue;
    }
    let record: ExternalDimensionRecord | null = null;
    switch (primitive.kind) {
      case 'linear_dim':
        record = mapLinearDim(primitive, transformPoint);
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

import { Matrix4, Vector3 } from 'three';

import { stablePerpendicular } from '../kernel/geometry/planeBasis';
import { length3, lerp3, sub3, tryNormalize3 } from '../kernel/vec';

import { CONTRACT_INCOMPLETE_KINDS } from './mbdV2Contract';

import type {
  MbdContractIncompleteKind,
  MbdPrimitive,
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
  ExplicitArrowInput,
  ExplicitLayoutInput,
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

function pointTransformer(data: MbdV2PipeData): TransformPoint | null {
  if (data.meta.geometry_space === 'design_m') {
    return point => [point[0], point[1], point[2]];
  }
  if (!data.meta.source_to_design) return null;
  const matrix = new Matrix4().fromArray([...data.meta.source_to_design]);
  return (point) => {
    const transformed = new Vector3(...point).applyMatrix4(matrix);
    return [transformed.x, transformed.y, transformed.z];
  };
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

type ContractIncompletePrimitive = Extract<
  MbdPrimitive,
  { kind: MbdContractIncompleteKind }
>;

/**
 * Defensive twin of the parse-time whole-payload rejection: live payloads are
 * already rejected by `parseMbdV2PipeData`, but internally constructed
 * payloads (parquet conversion, tests) still route through here. The kind
 * list is shared with the contract so the two layers cannot drift.
 */
function isContractIncomplete(
  primitive: MbdPrimitive,
): primitive is ContractIncompletePrimitive {
  return (CONTRACT_INCOMPLETE_KINDS as readonly string[]).includes(
    primitive.kind,
  );
}

type ExplicitParts = Readonly<{
  formattedLabel: string;
  labelAnchor: Vec3;
  labelAlong?: Vec3;
  lines?: readonly ExplicitLine[];
  arrowLines?: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  arrows?: readonly ExplicitArrowInput[];
  markers?: readonly ExplicitMarkerInput[];
  texts?: readonly ExplicitTextInput[];
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
    labelPinned: category !== 'dimension',
    formattedLabel: parts.formattedLabel,
    lines: parts.lines ?? [],
    labelAnchor: parts.labelAnchor,
    ...(parts.labelAlong ? { labelAlong: parts.labelAlong } : {}),
    arrowLines: parts.arrowLines ?? [],
    ...(parts.arrows && parts.arrows.length > 0
      ? { arrows: parts.arrows }
      : {}),
    ...(parts.markers && parts.markers.length > 0
      ? { markers: parts.markers }
      : {}),
    ...(parts.texts && parts.texts.length > 0 ? { texts: parts.texts } : {}),
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
 * The contract sends arrowheads as millimetre strokes (24 mm long), which
 * shrink to a few pixels on a plant-wide view while the label stays at its
 * screen height. Rebuild them as the kernel's screen-scaled filled heads
 * instead, keeping the solver's outside-pointing choice for small dimensions.
 */
function mapLinearDim(
  primitive: MbdV2LinearDim,
  transformPoint: TransformPoint,
): ExternalDimensionRecord {
  const role = primitive.reference ? 'external-reference' : 'external';
  const start = transformPoint(primitive.start);
  const end = transformPoint(primitive.end);
  const outside = primitive.sub_kind === 'small';
  const lines: ExplicitLine[] = [
    { from: start, to: end, part: 'dimension' },
    ...primitive.extension_lines.map(line => ({
      from: transformPoint(line.from),
      to: transformPoint(line.to),
      part: 'extension' as const,
    })),
  ];
  return explicitRecord(primitive, 'dimension', {
    formattedLabel: primitive.text,
    labelAnchor: transformPoint(primitive.label_anchor),
    // 「工程文字朝向」: a dimension value runs along its dimension line. The
    // contract carries no orientation yet, but for a linear dim the direction
    // is the line itself, so this needs no guess. Tag/aid text keeps viewport
    // horizontal until the contract declares PML's `ori`.
    labelAlong: sub3(end, start),
    lines,
    arrows: [
      { tip: start, towards: end, ...(outside ? { outside } : {}) },
      { tip: end, towards: start, ...(outside ? { outside } : {}) },
    ],
  }, role);
}

/**
 * Map frozen-contract primitives onto read-only external records rendered by
 * the shared dimension kernel (ADR 0041). Weld and slope symbols are
 * assembled from arcs/lines/markers/text instead of dedicated primitives
 * (ADR 0042); angle/arc/circle primitives are diagnosed until the upstream
 * contract defines their geometry.
 */
export function mbdV2ToExternalRecords(
  data: MbdV2PipeData,
): MbdV2MappingResult {
  const records: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const seenIds = new Set<string>();
  const transformPoint = pointTransformer(data);

  if (!transformPoint) {
    return {
      records,
      skipped: data.primitives.map(primitive => ({
        id: primitive.id,
        reason: 'source_mm payload requires a valid source_to_design matrix',
      })),
    };
  }

  for (const primitive of data.primitives) {
    if (seenIds.has(primitive.id)) {
      skipped.push({
        id: primitive.id,
        reason: 'Duplicate primitive id within MBD payload',
      });
      continue;
    }
    if (isContractIncomplete(primitive)) {
      skipped.push({
        id: primitive.id,
        reason: `contract-incomplete: ${primitive.kind} geometry is not yet `
          + 'defined by the rs-mbd Phase 0 contract',
      });
      continue;
    }
    let record: ExternalDimensionRecord | null = null;
    switch (primitive.kind) {
      case 'linear_dim':
        record = mapLinearDim(primitive, transformPoint);
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
      records.push(record);
    }
  }

  return { records, skipped };
}

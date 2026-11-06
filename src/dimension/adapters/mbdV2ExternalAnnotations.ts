import * as affine from '../kernel/geometry/affine';
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
  MbdV2Isoline,
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
  ExplicitPolarInput,
  ExplicitTagInput,
  ExplicitTagStyle,
  ExplicitTextInput,
  ScreenLinePart,
} from '../kernel/types';

export type MbdV2MappingResult = Readonly<{
  records: readonly ExternalDimensionRecord[];
  skipped: readonly Readonly<{ id: string; reason: string }>[];
}>;

/**
 * 映射期的呈现选项（W5-4 / Q6）。全部可选，缺省即当前线上行为。
 *
 * `labelPresentation: 'above'` 让长度尺寸的数字浮在尺寸线上方、线不切段
 * （ISO 读法）。**默认不开**：`above` 要的行距 ≥ 2.96 字高（见计划 §11.2），
 * 而 MBD 的求解器行距是 `1.2 · cheight`（`presentation3dContext` 的
 * `SOLVER_ROW_SPACING_CHEIGHT`），堆叠尺寸组会互相侵入。它是 A/B 与后续
 * 排布改造的试验开关，不是产品默认。
 */
export type MbdV2MappingOptions = Readonly<{
  labelPresentation?: 'interrupted' | 'above';
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

/** What names a primitive's model object: the declared `object_refno` (T4.4), else its id. */
type ObjectRef = Readonly<{ id: string; object_refno?: string }>;

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
  const matrix = data.meta.source_to_design;
  return {
    point: point => affine.transformPoint(matrix, point),
    direction: direction => tryNormalize3(affine.transformDirection(matrix, direction)),
  };
}

/**
 * Text baseline of a `label` / `aid_text` / `slope_mark` from its `text_dir`
 * (PML AIDTXT `ori` X axis, T4.3), through the direction part of the
 * transform like an arc axis: unit length in Design Space. Undefined when the
 * primitive declares none — every producer before the field — or when the
 * transform collapses it: the kernel then keeps viewport-horizontal text, so
 * a lost direction costs orientation only, never the primitive (parse already
 * rejected a zero or non-finite vector). A billboard tag never reads it (its
 * body is screen-facing); the `mbd_3d=0` flat presentation does.
 */
function textBaseline(
  primitive: Readonly<{ text_dir?: MbdV2Vec3 }>,
  transform: FrameTransform,
): Vec3 | undefined {
  if (!primitive.text_dir) return undefined;
  return transform.direction(primitive.text_dir) ?? undefined;
}

/**
 * A source-space (mm) length through the same transform as the geometry: the
 * length of a that-long vector, so a uniform `source_to_design` scale reaches
 * it while translation does not. Undefined for a non-positive length or a
 * transform that collapses it.
 */
function sourceLengthToDesignM(
  transform: FrameTransform,
  millimetres: number,
): number | undefined {
  if (!(millimetres > 0)) return undefined;
  const length = length3(sub3(
    transform.point([millimetres, 0, 0]),
    transform.point([0, 0, 0]),
  ));
  return length > 0 ? length : undefined;
}

/**
 * A declared text height (always millimetres, on both geometry spaces) in
 * Design Space. A `design_m` payload still declares heights in millimetres,
 * so it divides by 1000; a `source_mm` payload goes through the transform.
 */
function textHeightToDesignM(
  data: MbdV2PipeData,
  transform: FrameTransform,
  millimetres: number,
): number | undefined {
  if (!(millimetres > 0)) return undefined;
  if (data.meta.geometry_space === 'design_m') return millimetres / 1000;
  return sourceLengthToDesignM(transform, millimetres);
}

/**
 * Payload-wide group text height in Design Space: `meta.cheight_mm` (the
 * largest main-dimension `cheight` over the branch's isolines, one value per
 * payload) taken through the same transform as the geometry — the length of
 * a cheight-long vector, so a uniform `source_to_design` scale reaches it
 * while translation does not. A `design_m` payload still declares the height
 * in millimetres. Undefined when the solver did not report one; the kernel
 * then keeps its fixed text height.
 */
function payloadTextHeightM(
  data: MbdV2PipeData,
  transform: FrameTransform,
): number | undefined {
  const cheight = data.meta.cheight_mm;
  if (cheight === undefined || cheight === null) return undefined;
  return textHeightToDesignM(data, transform, cheight);
}

/**
 * Per-isoline text heights in Design Space keyed by `meta.isolines[].index`
 * (T4.2 / W3-3): the solver's isoline-level `cheight` after
 * `changeCheightAuto`, which is also what spaces that isoline's dimension
 * rows (plant-mbd `isodim.rs`, `ROW_STEP_CHEIGHT_RATIO · cheight`). Empty
 * when the payload carries no table.
 */
function isolineTextHeightsM(
  data: MbdV2PipeData,
  transform: FrameTransform,
): ReadonlyMap<number, number> {
  const heights = new Map<number, number>();
  for (const isoline of data.meta.isolines ?? []) {
    const heightM = textHeightToDesignM(data, transform, isoline.cheight_mm);
    if (heightM !== undefined) heights.set(isoline.index, heightM);
  }
  return heights;
}

/**
 * Group layer of the D7 text-height order for one primitive: its isoline's
 * height when `isoline_idx` names a row of the table, else the payload-wide
 * height. A dangling index is not an error (the contract does not
 * cross-check the two); it simply falls through. The primitive layer
 * (`text_height_mm`) goes on top of this at the call site.
 */
function groupTextHeightM(
  primitive: Readonly<{ isoline_idx?: number }>,
  isolineHeightsM: ReadonlyMap<number, number>,
  payloadHeightM: number | undefined,
): number | undefined {
  if (primitive.isoline_idx !== undefined) {
    const isolineHeightM = isolineHeightsM.get(primitive.isoline_idx);
    if (isolineHeightM !== undefined) return isolineHeightM;
  }
  return payloadHeightM;
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

/**
 * First line as the primary label, the rest as glyph runs stacked under the
 * same anchor; every run shares the label's baseline (`along`) when the
 * primitive declares one.
 */
function multiLineTexts(
  text: string,
  anchor: MbdV2Vec3,
  along?: Vec3,
): Readonly<{ formattedLabel: string; texts: readonly ExplicitTextInput[] }> {
  const [first, ...rest] = splitTextLines(text);
  return {
    formattedLabel: first ?? '',
    texts: rest.map((line, index) => ({
      text: line,
      anchor: [anchor[0], anchor[1], anchor[2]] as Vec3,
      stackIndex: index + 1,
      ...(along ? { along } : {}),
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
  /** The model object the record sits on (its refno), for the inspection pass. */
  subject?: string;
  /** Q6 presentation mode, forwarded verbatim when the caller asked for one. */
  labelPresentation?: 'interrupted' | 'above';
  /** T3.6a opt-in; see `polarInputForLabel`. */
  polar?: ExplicitPolarInput;
  /** T3.6b opt-in for a non-polar sibling; see `mapLinearDim`. */
  polarObstacle?: Readonly<{ groupKey: string }>;
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
    // deterministic layout): the record declares `layoutAuthority: 'solver'`
    // below, `normalizeExternalDimension` folds that into `labelPinned`, and
    // `resolveLabelCollisions` only lets a pinned label claim its space — it
    // never moves one and never invents a leader to a relocated label.
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
    ...(parts.labelPresentation ? { labelPresentation: parts.labelPresentation } : {}),
    ...(parts.dimension3d ? { dimension3d: parts.dimension3d } : {}),
    ...(parts.tag ? { tag: parts.tag } : {}),
    ...(parts.subject ? { subject: parts.subject } : {}),
    ...(parts.polar ? { polar: parts.polar } : {}),
    ...(parts.polarObstacle ? { polarObstacle: parts.polarObstacle } : {}),
  };
  return {
    id: primitive.id,
    source: 'mbd',
    sourceLabel: `MBD: ${primitive.id}`,
    role,
    category,
    layoutAuthority: 'solver',
    ...(primitive.isoline_idx !== undefined
      ? { isolineIndex: primitive.isoline_idx }
      : {}),
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
  /** The component the tag names (its refno), when the id carries one. */
  subject?: string;
}>;

/**
 * The component a tag names, for the inspection pass: the contract's
 * `object_refno` when the producer declares it (T4.4), else — plant-mbd ids
 * — the refno after `:tag:<kind>:`: the elbow, the bend, the tee, the
 * support (`atta`), the named component, the component a connection card or
 * an elevation sits at; every kind plant-mbd emits puts the component last
 * (2026-09-14: `bend` / `atta` / `elevation` / `tee` tags were probed like
 * refno-less cards before). A branch end (`connection:Head` /
 * `connection:Tail`) is a point on the pipe, not a component, and has none;
 * so has `branch-name` (no component segment).
 */
function tagSubject(primitive: ObjectRef): string | undefined {
  if (primitive.object_refno) return primitive.object_refno;
  const match = /:tag:[^:]+:([^:]+)$/.exec(primitive.id);
  const subject = match?.[1];
  if (!subject || subject === 'Head' || subject === 'Tail') return undefined;
  return subject;
}

/**
 * The WELD component a weld mark names: the contract's `object_refno` when
 * declared (T4.4), else the refno a plant-mbd id carries after `:weld:mark:`
 * (`<bran>:isoline:<n>:weld:mark:<refno>`). The mark's position is that
 * component's origin — the weld point on the bore axis, inside the bead the
 * model draws for the WELD and inside the pipe wall — so the inspection
 * pass needs the refno to leave the weld's own geometry out of the ray
 * (2026-09-14: 27 / 27 weld marks of BRAN 24381_146979 faded without it).
 * Another producer that declares neither gets the mark probed plainly.
 */
function weldSubject(primitive: ObjectRef): string | undefined {
  return primitive.object_refno
    ?? (/:weld:mark:([^:]+)$/.exec(primitive.id)?.[1] || undefined);
}

/**
 * Elevation call-out at a point on the pipe: a pill from mid range on,
 * showing the elevation (`PE …`) line only; any other line — an elbow's
 * angle, a bend's angle and radius — appears on a close-up. plant-mbd's
 * `elbo` (`<angle> / PE`), `bend` (`<angle> / 弯曲半径:<r> / PE`),
 * `elevation` (`PE`, a level change along the run) and `tee` (`PE` at the
 * branch point) tags are all this one drawing note and read the same
 * (2026-09-14: `bend`, then `elevation` / `tee`, used to fall through to the
 * text rule, which took their `PE` line for a coordinate block — a card with
 * a dot, no LOD, drawn at every distance; 5185 bend + 821 elevation + 155 tee
 * tags against 1637 elbo tags across the project's 2469 BRANs, so most of
 * the far-view card cloud was them).
 */
const ELEVATION_TAG: TagClass = {
  style: 'pill',
  dot: false,
  lod: { tier: 'secondary' },
  primaryLine: /^PE\b/,
};

/**
 * What kind of drawing call-out a solver tag is. plant-mbd names its tags
 * (`…:tag:connection:<end | refno>` coordinate blocks, `…:tag:elbo:<refno>`
 * elbow angle + elevation, `…:tag:bend:<refno>` bend angle + radius +
 * elevation, `…:tag:elevation:<refno>` / `…:tag:tee:<refno>` elevation at a
 * point, `…:tag:name:<refno>` component name, `…:tag:branch-name`); a
 * label from another producer is classified by its text — a coordinate
 * block (`X … / Y … / PE …`) reads as a card, anything else as a framed
 * name. The reference drawing style keeps coordinate blocks and names at
 * every distance, shows elevations from mid range (an elbow's angle and a
 * bend's radius only on a close-up) and the branch name only on a close-up.
 * The tag's `subject` for the inspection pass is the declared `object_refno`,
 * else the refno in a plant-mbd id (any kind).
 */
function classifyTag(primitive: MbdV2Label): TagClass {
  const id = primitive.id;
  const subject = tagSubject(primitive);
  const withSubject = (tagClass: TagClass): TagClass =>
    subject ? { ...tagClass, subject } : tagClass;
  if (id.includes(':tag:connection:')) return withSubject({ style: 'card', dot: true });
  if (id.includes(':tag:name:')) return withSubject({ style: 'frame', dot: false });
  if (/:tag:(?:elbo|bend|elevation|tee):/.test(id)) return withSubject(ELEVATION_TAG);
  if (id.includes(':tag:branch-name')) {
    return withSubject({ style: 'pill', dot: false, lod: { tier: 'detail' } });
  }
  const coordinateBlock = splitTextLines(primitive.text)
    .some(line => /^(?:X|Y|PE)\s/.test(line));
  return withSubject(coordinateBlock ? { style: 'card', dot: true } : { style: 'frame', dot: false });
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
 * Half the `disRange` window around a label's axial position (T3.6a plan
 * point 3): named so the 3× factor reads as a choice, not a stray literal.
 */
const POLAR_DIS_RANGE_HALF_SPAN_CHEIGHTS = 3;

/**
 * T3.6a: builds the polar placement input for a `label` (plan point 3),
 * or `undefined` when any required fact is missing — isoline membership,
 * a same-isoline `linear_dim` to read the pipe axis from, or that
 * isoline's declared outer diameter — in which case the record keeps its
 * solver anchor untouched (the flag only ever adds a field, never changes
 * one the kernel already draws from).
 *
 * Pipe axis: the first same-isoline `linear_dim`'s `start`/`end` (same
 * source → Design Space path as everywhere else, `transform.point`).
 * `basicRadiusM`: `od_mm / 2` through the same mm → Design-metre
 * conversion the text heights take (`textHeightToDesignM`). `disRange`:
 * the label's own projection onto the axis, padded
 * `POLAR_DIS_RANGE_HALF_SPAN_CHEIGHTS` text heights each way — the solver
 * does not give this record an explicit axial span, so the window is
 * sized off the one length already available at this call site.
 */
function polarInputForLabel(
  primitive: MbdV2Label,
  dimensions: readonly MbdV2LinearDim[],
  isolines: readonly MbdV2Isoline[],
  data: MbdV2PipeData,
  transform: FrameTransform,
  position: Vec3,
  textHeightM: number | undefined,
): ExplicitPolarInput | undefined {
  if (primitive.isoline_idx === undefined || textHeightM === undefined) return undefined;
  const axisDim = dimensions.find(dimension => dimension.isoline_idx === primitive.isoline_idx);
  if (!axisDim) return undefined;
  const isoline = isolines.find(entry => entry.index === primitive.isoline_idx);
  if (!isoline) return undefined;
  const odM = textHeightToDesignM(data, transform, isoline.od_mm);
  if (odM === undefined) return undefined;
  const origin = transform.point(axisDim.start);
  const end = transform.point(axisDim.end);
  const axis = tryNormalize3(sub3(end, origin));
  if (!axis) return undefined;
  const span = sub3(end, origin);
  const spanLength = dot3(span, span);
  const dis = spanLength > 0 ? dot3(sub3(position, origin), span) / Math.sqrt(spanLength) : 0;
  const halfSpanM = POLAR_DIS_RANGE_HALF_SPAN_CHEIGHTS * textHeightM;
  return {
    origin,
    axis,
    disRange: [dis - halfSpanM, dis + halfSpanM],
    basicRadiusM: odM / 2,
    textHeightM,
    // T3.6b: every record on this isoline shares one group, so
    // `layoutViewport` fences off candidates and `polarObstacle` anchors
    // across labels — and against `mapLinearDim`'s own anchor below —
    // instead of only the pipe body (plan point 1).
    groupKey: `isoline:${primitive.isoline_idx}`,
  };
}

/**
 * Tag (`label`, optionally with its `leader_line`): the flat presentation is
 * the solver's text at its position (along its `text_dir` when declared)
 * plus the leader as drawn; with `tag` the kernel presents it as a billboard
 * call-out (card / frame / pill) that keeps its leader on the pipe point
 * (reference drawing style, 2026-09-12). The `mbd_3d=0` switch strips `tag`
 * and gets the flat presentation back.
 */
function mapLabel(
  primitive: MbdV2Label,
  leader: MbdV2LeaderLine | undefined,
  dimensions: readonly MbdV2LinearDim[],
  isolines: readonly MbdV2Isoline[],
  data: MbdV2PipeData,
  transform: FrameTransform,
  textHeightM: number | undefined,
): ExternalDimensionRecord {
  const transformPoint = transform.point;
  const position = transformPoint(primitive.position);
  const along = textBaseline(primitive, transform);
  const { formattedLabel, texts } = multiLineTexts(primitive.text, position, along);
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
    ...(tagClass.subject ? { subject: tagClass.subject } : {}),
  };
  const polar = polarInputForLabel(primitive, dimensions, isolines, data, transform, position, textHeightM);
  return explicitRecord(primitive, 'annotation', {
    formattedLabel,
    labelAnchor: position,
    ...(along ? { labelAlong: along } : {}),
    texts,
    ...(target ? { lines: [{ from: position, to: target, part: 'leader' as const }] } : {}),
    ...(tagClass.lod ? { lod: tagClass.lod } : {}),
    tag,
    ...(polar ? { polar } : {}),
  });
}

/** Slope marks and skew aids are close-up detail in the reference drawing style. */
function isDetailAid(id: string): boolean {
  return id.includes(':slope:') || id.includes(':skew:');
}

/**
 * Facts the 3D presentation needs beyond one primitive. The solver's
 * innermost row sits `od` — the isoline's outside diameter — from the pipe
 * centre line (plant-mbd `isodim.rs` row offset `od + 1.2 · cheight · (row − 1)`),
 * and `meta.isolines[].od_mm` (T4.6) is that very `od`, so a record the table
 * names reads its surface distance from there. Without the table the
 * shortest extension line in the branch stands in for it: the lower quartile
 * rather than the minimum keeps one odd short line from pulling the whole
 * branch inwards; on a branch with several pipe sizes the larger pipe's rows
 * then come out one or two rows further, which still clears its body. The row
 * spacing itself is `1.2 · cheight` with the record's own group height
 * (`groupTextHeightM`: its isoline's when the table names it, else the
 * payload-wide one).
 */
type Presentation3dContext = Readonly<{
  /** Branch-wide surface distance: the extension-length lower quartile. */
  surfaceM: number;
  /** Per-isoline `od_mm` in Design Space, keyed by the table's `index`. */
  isolineSurfacesM: ReadonlyMap<number, number>;
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
  transform: FrameTransform,
  transformPoint: TransformPoint,
): Presentation3dContext | null {
  const lengths = data.primitives
    .flatMap(primitive => (primitive.kind === 'linear_dim'
      ? [extensionLengthM(primitive, transformPoint)]
      : []))
    .filter((length): length is number => length !== null && length > 0)
    .sort((a, b) => a - b);
  if (lengths.length === 0) return null;
  const isolineSurfacesM = new Map<number, number>();
  for (const isoline of data.meta.isolines ?? []) {
    // The same millimetre → Design Space conversion the text heights take.
    const surfaceM = textHeightToDesignM(data, transform, isoline.od_mm);
    if (surfaceM !== undefined) isolineSurfacesM.set(isoline.index, surfaceM);
  }
  return { surfaceM: lengths[Math.floor(lengths.length * 0.25)]!, isolineSurfacesM };
}

/**
 * Per-dimension 3D presentation input (`ExplicitDimension3dInput`): the pipe
 * centre-line points are the extension lines' `from`, `dim_dir` is their
 * direction, and the solver row is read back from the extension length with
 * its isoline's `od_mm` (else the branch-wide quartile) as the surface and
 * the record's group height as the row step. A dimension without exactly two
 * extension lines (nothing to stand off from) keeps the flat presentation.
 */
function dimension3dInput(
  primitive: MbdV2LinearDim,
  start: Vec3,
  end: Vec3,
  labelAnchor: Vec3,
  transformPoint: TransformPoint,
  context: Presentation3dContext,
  cheightM: number,
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
  const surfaceM = (primitive.isoline_idx === undefined
    ? undefined
    : context.isolineSurfacesM.get(primitive.isoline_idx)) ?? context.surfaceM;
  const row = Math.max(0, Math.round(
    (extension - surfaceM) / (SOLVER_ROW_SPACING_CHEIGHT * cheightM),
  ));
  const span = sub3(end, start);
  const spanLength = dot3(span, span);
  const alongT = spanLength > 0 ? dot3(sub3(labelAnchor, start), span) / spanLength : 0.5;
  return {
    from: atStart.from,
    to: atEnd.from,
    direction,
    surfaceM,
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
 * view. Sources that carry no strokes (older payload rows, hand-authored
 * data) fall back to the kernel's screen-scaled filled heads.
 *
 * With a group `cheight` (its isoline's or the payload-wide one) the record
 * also carries `dimension3d`, and the kernel presents it as true 3D
 * annotation standing off the pipe (reference drawing style, 2026-09-12); the
 * flat geometry below stays as the fallback the `mbd_3d=0` debug switch
 * returns to.
 */
function mapLinearDim(
  primitive: MbdV2LinearDim,
  transformPoint: TransformPoint,
  presentation3d: Presentation3dContext | null,
  cheightM: number | undefined,
  options: MbdV2MappingOptions,
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
  const dimension3d = presentation3d && cheightM !== undefined
    ? dimension3dInput(primitive, start, end, labelAnchor, transformPoint, presentation3d, cheightM)
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
    // T3.6b: this dimension does not opt into polar itself (its own
    // `label_anchor` stands, same as always), but when it names an
    // isoline it fences that anchor off as an obstacle for any same-isoline
    // `label` that does opt in — `groupKey` matches `polarInputForLabel`'s
    // own `isoline:<idx>`. No `isoline_idx` (plain running dimension, no
    // isoline membership) = this field is omitted, v1 behaviour.
    ...(primitive.isoline_idx !== undefined
      ? { polarObstacle: { groupKey: `isoline:${primitive.isoline_idx}` } }
      : {}),
    // 「工程文字朝向」: a dimension value runs along its dimension line, which
    // is the direction itself, so a linear dim needs no field for it. Tag /
    // aid / slope text takes the contract's `text_dir` (`textBaseline`) and
    // stays viewport-horizontal without one.
    labelAlong: sub3(end, start),
    // Q6: opt-in only. Omitted = `interrupted`, which is what every existing
    // payload already draws — the field's absence is the whole compatibility
    // guarantee, so do not default it to anything else.
    ...(options.labelPresentation ? { labelPresentation: options.labelPresentation } : {}),
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
  options: MbdV2MappingOptions = {},
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
  const payloadHeightM = payloadTextHeightM(data, transform);
  const isolineHeightsM = isolineTextHeightsM(data, transform);
  const presentation3d = presentation3dContext(data, transform, transformPoint);
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
    // D7 group layer for this record; a linear dim also spaces its 3D rows by it.
    const groupHeightM = groupTextHeightM(primitive, isolineHeightsM, payloadHeightM);
    switch (primitive.kind) {
      case 'linear_dim':
        record = mapLinearDim(primitive, transformPoint, presentation3d, groupHeightM, options);
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
          data.meta.isolines ?? [],
          data,
          transform,
          groupHeightM,
        );
        break;
      case 'aid_text': {
        const position = transformPoint(primitive.position);
        const along = textBaseline(primitive, transform);
        const { formattedLabel, texts } = multiLineTexts(
          primitive.text,
          position,
          along,
        );
        // T3.6b ruling: `aid_text` never gets `polar` or `polarObstacle`,
        // even when its `isoline_idx` matches a same-isoline `label`'s
        // polar group. In PML, every `aidtext` placement the producer draws
        // either sits off a leg/skew frame that is not the pipe's own axis
        // — `isoposAidtext`'s skew-leg X:/Y:/Z: text builds a throwaway
        // `polarsystem` off the leg's own two endpoints and explicitly
        // comments `--!this.polarsystem.add(!aidtext.name) $*no need to
        // add` (`markpipe/object/isoline.pmlobj:2480-2521`, call sites
        // `:2388`/`:2431`) — or is a fixed offset with no polar call at all
        // (`drawslope`, `:2568-2591`; the weld-length adjustment text,
        // `:2141-2147`). plant-mbd's Rust producer matches: every `AidText`
        // sets `isoline_idx: None` (`slope.rs:295-303`, `angle.rs:524-532`,
        // `adjust_weld.rs:205-211`; the field is optional in
        // `contract.rs:283`), so in real payloads this case never even
        // reaches the `axisDim`/`isoline` lookups `polarInputForLabel`
        // would need. The fixture at `mbdV2ExternalAnnotations.test.ts`
        // that gives an `aid_text` an `isoline_idx` does so only to
        // exercise `groupTextHeightM`'s isoline-height lookup, not to
        // imply a pipe axis for it.
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel,
          labelAnchor: position,
          ...(along ? { labelAlong: along } : {}),
          texts,
          ...(isDetailAid(primitive.id) ? { lod: { tier: 'detail' } } : {}),
        });
        // A per-primitive height wins over the group height: the solver draws
        // the installation-angle direction labels at `cheight / 2` so they stay
        // subordinate to the value text. Absent = keep following the group.
        const ownTextHeightM = primitive.text_height_mm === undefined
          ? undefined
          : textHeightToDesignM(data, transform, primitive.text_height_mm);
        if (ownTextHeightM !== undefined) {
          record = {
            ...record,
            layout: {
              ...(record.layout as ExplicitLayoutInput),
              textHeightM: ownTextHeightM,
            },
          };
        }
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
        const subject = weldSubject(primitive);
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
          ...(subject ? { subject } : {}),
        });
        break;
      }
      case 'slope_mark': {
        const start = transformPoint(primitive.start);
        const end = transformPoint(primitive.end);
        const along = textBaseline(primitive, transform);
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel: primitive.text,
          labelAnchor: midpoint(start, end),
          ...(along ? { labelAlong: along } : {}),
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
      // D7 order: a record that already declared its own height (`aid_text`
      // `text_height_mm`, e.g. the half-height direction labels) keeps it,
      // otherwise it takes its isoline's, otherwise the payload-wide one.
      const hasOwnTextHeightM
        = (record.layout as ExplicitLayoutInput).textHeightM !== undefined;
      records.push(groupHeightM === undefined || hasOwnTextHeightM
        ? record
        : {
          ...record,
          layout: { ...(record.layout as ExplicitLayoutInput), textHeightM: groupHeightM },
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

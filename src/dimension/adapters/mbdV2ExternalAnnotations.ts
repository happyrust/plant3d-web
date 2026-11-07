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

import { mbdFunctionLodTier } from './mbdFunctionLod';
import { isPipePackage } from './mbdV2Contract';

import type { MbdLodTier } from './mbdFunctionLod';
import type {
  MbdPrimitive,
  MbdV2AidArc,
  MbdV2AidCircle,
  MbdV2AidLine,
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
  ExplicitLabel3dInput,
  ExplicitLabelBlockInput,
  ExplicitLabelFrameInput,
  ExplicitLayoutInput,
  ExplicitLodInput,
  ExplicitMarkerInput,
  ExplicitTagInput,
  ExplicitTagStyle,
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
 * Text baseline of a `label` / `aid_text` / `slope_mark` / `angle_dim` from
 * its `text_dir` (PML AIDTXT `ori` X axis, T4.3), through the direction part
 * of the transform like an arc axis: unit length in Design Space. Undefined
 * when the primitive declares none — every producer before the field — or
 * when the transform collapses it: the record then keeps its default baseline
 * (viewport-horizontal text, an angle's arc), so a lost direction costs
 * orientation only, never the primitive (parse already rejected a zero or
 * non-finite vector). A billboard tag never reads it (its body is
 * screen-facing), nor does an angle's 3D run; the `mbd_3d=0` flat
 * presentation does.
 */
function textBaseline(
  primitive: Readonly<{ text_dir?: MbdV2Vec3 }>,
  transform: FrameTransform,
): Vec3 | undefined {
  if (!primitive.text_dir) return undefined;
  return transform.direction(primitive.text_dir) ?? undefined;
}

/**
 * Up of the text plane of a `label` / `aid_text` / `angle_dim` (`text_up`,
 * #103 M1-3 / CT-15) in Design Space, re-orthogonalised against the baseline:
 * the contract leaves that to the consumer, as with an arc frame (ADR 0055).
 * Undefined when the primitive declares none, when the transform collapses
 * it, or when it runs along the baseline; the block then stacks on screen, so
 * a lost plane costs the stacking direction only, never the primitive.
 */
function textUp(
  primitive: Readonly<{ text_up?: MbdV2Vec3 }>,
  transform: FrameTransform,
  baseline: Vec3 | undefined,
): Vec3 | undefined {
  if (!primitive.text_up) return undefined;
  const up = transform.direction(primitive.text_up);
  if (!up) return undefined;
  if (!baseline) return up;
  return tryNormalize3(sub3(up, scale3(baseline, dot3(up, baseline)))) ?? undefined;
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

/**
 * Primitive layer of the D7 text-height order: the height a primitive
 * declares for its own text (`text_height_mm`) in Design Space. `aid_text`
 * has carried it from the start — the solver draws the installation-angle
 * direction labels at `cheight / 2` so they stay subordinate to the value
 * text — and #103 M1-3 extends it to `linear_dim`, `label`, `angle_dim` and
 * `slope_mark`. Only the kinds the contract defines it on are read: the
 * default parse ignores a stray `text_height_mm` on any other kind, and so
 * does this. Undefined when the primitive declares none, so the record keeps
 * following its group.
 *
 * A pipe package (`isPipePackage`) only takes it from `aid_text`, the
 * direction labels' half height it has always drawn; on its other kinds the
 * declared height is not read (ADR 0071), so the default pipe presentation
 * stays as it is. The solver sends PML's heights there — the pipe name at
 * three times the isoline height, a cut-pipe segment number at twice — and
 * the record's height is what that presentation keys on: a billboard tag's
 * level of detail and close-up lines (`planTagBillboard`), the text and
 * standoff of a 3D running dimension, the flat text size. The heights stay in
 * the payload for the drawing output and the flat presentation to read later.
 */
function primitiveTextHeightM(
  primitive: MbdPrimitive,
  data: MbdV2PipeData,
  transform: FrameTransform,
): number | undefined {
  switch (primitive.kind) {
    case 'linear_dim':
    case 'angle_dim':
    case 'label':
    case 'slope_mark':
      if (isPipePackage(data.annotation_type)) return undefined;
      break;
    case 'aid_text':
      break;
    default:
      return undefined;
  }
  return primitive.text_height_mm === undefined
    ? undefined
    : textHeightToDesignM(data, transform, primitive.text_height_mm);
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
 * PML stacks the lines of a multi-line text as MLABELs one `1.2 · text
 * height` apart along −`text_up` (plant-mbd field dictionary ruling 8).
 */
const TEXT_LINE_PITCH_CHEIGHT = 1.2;

/**
 * First line as the primary label; with more lines, the whole text is one
 * block centred on the primitive's `position` — the solver's ruling 8 puts
 * the position at the centre of the block — stacking along the text plane's
 * `up` when the primitive declares one. Single-line text stays a plain label.
 */
function multiLineLabel(
  text: string,
  up: Vec3 | undefined,
): Readonly<{ formattedLabel: string; labelBlock?: ExplicitLabelBlockInput }> {
  const [first, ...rows] = splitTextLines(text);
  return {
    formattedLabel: first ?? '',
    ...(rows.length > 0
      ? { labelBlock: { rows, lineAdvance: TEXT_LINE_PITCH_CHEIGHT, ...(up ? { up } : {}) } }
      : {}),
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
  labelBlock?: ExplicitLabelBlockInput;
  labelFrame?: ExplicitLabelFrameInput;
  lod?: ExplicitLodInput;
  dimension3d?: ExplicitLayoutInput['dimension3d'];
  tag?: ExplicitTagInput;
  label3d?: ExplicitLabel3dInput;
  /** The model object the record sits on (its refno), for the inspection pass. */
  subject?: string;
  /** Q6 presentation mode, forwarded verbatim when the caller asked for one. */
  labelPresentation?: 'interrupted' | 'above';
  /** Pairwise declutter opt-in; see `angleDeclutter`. */
  declutter?: ExplicitLayoutInput['declutter'];
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
    ...(parts.labelBlock ? { labelBlock: parts.labelBlock } : {}),
    ...(parts.labelFrame ? { labelFrame: parts.labelFrame } : {}),
    ...(parts.lod ? { lod: parts.lod } : {}),
    ...(parts.labelPresentation ? { labelPresentation: parts.labelPresentation } : {}),
    ...(parts.dimension3d ? { dimension3d: parts.dimension3d } : {}),
    ...(parts.tag ? { tag: parts.tag } : {}),
    ...(parts.label3d ? { label3d: parts.label3d } : {}),
    ...(parts.subject ? { subject: parts.subject } : {}),
    ...(parts.declutter ? { declutter: parts.declutter } : {}),
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
    ...(primitive.chain_id !== undefined ? { chainId: primitive.chain_id } : {}),
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

const FRAME_LINE_ID = /^(.+):frame:\d+$/;

/**
 * Pair every `label` with the `aid_line`s that frame it: plant-mbd draws the
 * PML `drawframe` box round the name of a component name tag as four lines
 * `<label id>:frame:0..3` (function 位号). Only by that id convention — loose
 * lines have no tie to one label the way a leader starts on it; a frame line
 * whose label is not in the payload stays a line of its own. Like a leader,
 * the frame then travels in its label's record (`labelFrame`), and the solver's
 * world-space lines are not drawn: the flat presentation draws the frame round
 * the name row at the size the text is drawn, and a billboard's framed body
 * stands in for it.
 */
function pairFrames(data: MbdV2PipeData): ReadonlyMap<string, readonly MbdV2AidLine[]> {
  const labelIds = new Set(data.primitives
    .filter(primitive => primitive.kind === 'label')
    .map(primitive => primitive.id));
  const byLabel = new Map<string, MbdV2AidLine[]>();
  for (const primitive of data.primitives) {
    if (primitive.kind !== 'aid_line') continue;
    const labelId = FRAME_LINE_ID.exec(primitive.id)?.[1];
    if (labelId === undefined || !labelIds.has(labelId)) continue;
    byLabel.set(labelId, [...(byLabel.get(labelId) ?? []), primitive]);
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
 * Tag (`label`, optionally with its `leader_line` and its frame): the flat
 * presentation is the solver's text centred on its position (along its
 * `text_dir`, stacked along its `text_up`, when declared) plus the leader as
 * drawn and the frame round the name row (`framed`, see `pairFrames`); with
 * `tag` the kernel presents it as a billboard call-out (card / frame / pill)
 * that keeps its leader on the pipe point (reference drawing style,
 * 2026-09-12). The `mbd_3d=0` switch strips `tag` and gets the flat
 * presentation back.
 */
function mapLabel(
  primitive: MbdV2Label,
  leader: MbdV2LeaderLine | undefined,
  framed: boolean,
  dimensions: readonly MbdV2LinearDim[],
  transform: FrameTransform,
): ExternalDimensionRecord {
  const transformPoint = transform.point;
  const position = transformPoint(primitive.position);
  const along = textBaseline(primitive, transform);
  const { formattedLabel, labelBlock } = multiLineLabel(
    primitive.text,
    textUp(primitive, transform, along),
  );
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
  return explicitRecord(primitive, 'annotation', {
    formattedLabel,
    labelAnchor: position,
    ...(along ? { labelAlong: along } : {}),
    ...(labelBlock ? { labelBlock } : {}),
    // plant-mbd puts the name, the row PML frames, first: PML's own first row
    // (the material number) is not drawn.
    ...(framed ? { labelFrame: { row: 0 } } : {}),
    ...(target ? { lines: [{ from: position, to: target, part: 'leader' as const }] } : {}),
    ...(tagClass.lod ? { lod: tagClass.lod } : {}),
    tag,
  });
}

/**
 * Slope marks, skew aids and the two direction notes of an installation angle
 * are close-up detail in the reference drawing style (the angle's own record
 * takes the same tier in `mapAngleDim`).
 */
function isDetailAid(id: string): boolean {
  return id.includes(':slope:') || id.includes(':skew:') || ANGLE_DIRECTION_NOTE_SUFFIX.test(id);
}

/**
 * A non-pipe record's level of detail from its PML FUNCTION (`mbdFunctionLodTier`):
 * the function's tier replaces the kind-level one and keeps the rest (a dimension's
 * `hideShort`). `primary` on a record that carries no hint stays without one — that
 * is already how the kernel draws it. No tier (a pipe package, an undeclared or
 * unregistered function) leaves the hint as the mapper built it.
 */
function withFunctionTier(
  lod: ExplicitLodInput | undefined,
  tier: MbdLodTier | undefined,
): ExplicitLodInput | undefined {
  if (tier === undefined || (tier === 'primary' && lod === undefined)) return lod;
  return { ...lod, tier };
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
 * Installation angles rank between the 3D running dimensions' main rows
 * (1000 + length / width) and their atta rows (0 + the same ratio), so an
 * angle never hides a pipe length but does win over an atta detail.
 */
const ANGLE_DECLUTTER_RANK = 500;
const ANGLE_DIRECTION_NOTE_SUFFIX = /:dirtext\d+$/;

/**
 * An installation angle is three records — the `angle_dim` (arc, legs,
 * value) and the two direction notes plant-mbd emits as `aid_text`
 * `<angle id>:dirtext1/2` — and the solver stacks them without avoidance,
 * so along a run of same-tilt members the groups pile up into one
 * unreadable column. They join the pairwise declutter as one group: when any
 * of the three overlaps a kept label, all three are hidden for this view.
 */
function angleDeclutter(primitive: MbdPrimitive): ExplicitLayoutInput['declutter'] | undefined {
  if (primitive.kind === 'angle_dim') {
    return { rank: ANGLE_DECLUTTER_RANK, group: primitive.id };
  }
  if (primitive.kind === 'aid_text' && ANGLE_DIRECTION_NOTE_SUFFIX.test(primitive.id)) {
    return { rank: ANGLE_DECLUTTER_RANK, group: primitive.id.replace(ANGLE_DIRECTION_NOTE_SUFFIX, '') };
  }
  return undefined;
}

/**
 * The value text of an angle. Without a text plane it is one run along the
 * arc. With one (`text_dir` / `text_up`, #103 CT-15) the flat presentation
 * lays it out in that plane like a `label`: along `text_dir` (the arc while
 * only `text_up` is declared or the baseline collapses), lines stacked along
 * `text_up`. `label3d` keeps the run along the arc for the default 3D
 * presentation, which therefore reads as before; the `mbd_3d=0` switch strips
 * it.
 */
function angleLabel(
  primitive: MbdV2AngleDim,
  transform: FrameTransform,
  arcBaseline: Vec3,
): Pick<ExplicitParts, 'formattedLabel' | 'labelAlong' | 'labelBlock' | 'label3d'> {
  if (!primitive.text_dir && !primitive.text_up) {
    return { formattedLabel: primitive.text, labelAlong: arcBaseline };
  }
  const along = textBaseline(primitive, transform) ?? arcBaseline;
  const { formattedLabel, labelBlock } = multiLineLabel(
    primitive.text,
    textUp(primitive, transform, along),
  );
  return {
    formattedLabel,
    labelAlong: along,
    ...(labelBlock ? { labelBlock } : {}),
    label3d: { text: primitive.text, along: arcBaseline },
  };
}

/**
 * PML `isoline.drawangle`: arc + two legs + the value text. The value runs
 * along the arc, so its baseline is the tangent at mid-sweep (the same
 * 「工程文字朝向」 rule `mapLinearDim` applies along its dimension line); a
 * declared text plane moves it into that plane in the flat presentation
 * (`angleLabel`).
 *
 * Detail tier: PML sizes the arc from the text length (a few millimetres), so
 * the value and its two direction notes only stand apart near true scale —
 * from further away the legibility floor enlarges all three into one clump the
 * group declutter cannot split (it only reacts to labels outside the group).
 * A non-pipe package replaces the tier with its FUNCTION's (`mbdFunctionLodTier`).
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
    ...angleLabel(primitive, transform, arcTangent(mapped, midAngle)),
    labelAnchor: transform.point(primitive.label_anchor),
    lines,
    arcs: [mapped.arc],
    lod: { tier: 'detail' },
    declutter: angleDeclutter(primitive),
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
  const pipePackage = isPipePackage(data.annotation_type);
  const payloadHeightM = payloadTextHeightM(data, transform);
  const isolineHeightsM = isolineTextHeightsM(data, transform);
  const presentation3d = presentation3dContext(data, transform, transformPoint);
  const leaderByLabel = pairLeaders(data, transformPoint);
  const pairedLeaderIds = new Set([...leaderByLabel.values()].map(leader => leader.id));
  const framesByLabel = pairFrames(data);
  const pairedFrameIds = new Set([...framesByLabel.values()].flat().map(line => line.id));
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
    if (
      (primitive.kind === 'leader_line' && pairedLeaderIds.has(primitive.id))
      || (primitive.kind === 'aid_line' && pairedFrameIds.has(primitive.id))
    ) {
      // Drawn as part of its label's record (see `pairLeaders` / `pairFrames`).
      seenIds.add(primitive.id);
      continue;
    }
    let record: ExternalDimensionRecord | null = null;
    // D7 group layer for this record; a linear dim also spaces its 3D rows by
    // it, whatever height its own text declares.
    const groupHeightM = groupTextHeightM(primitive, isolineHeightsM, payloadHeightM);
    const textHeightM = primitiveTextHeightM(primitive, data, transform) ?? groupHeightM;
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
          framesByLabel.has(primitive.id),
          linearDims,
          transform,
        );
        break;
      case 'aid_text': {
        const position = transformPoint(primitive.position);
        const along = textBaseline(primitive, transform);
        const { formattedLabel, labelBlock } = multiLineLabel(
          primitive.text,
          textUp(primitive, transform, along),
        );
        record = explicitRecord(primitive, 'annotation', {
          formattedLabel,
          labelAnchor: position,
          ...(along ? { labelAlong: along } : {}),
          ...(labelBlock ? { labelBlock } : {}),
          ...(isDetailAid(primitive.id) ? { lod: { tier: 'detail' } } : {}),
          declutter: angleDeclutter(primitive),
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
      // `ExplicitLayoutInput`; the text height rides along with it so the
      // kernel can scale labels and the arrow floor with the model (S2).
      // D7 order: the primitive's own `text_height_mm` (e.g. the half-height
      // direction labels), otherwise its isoline's, otherwise the payload-wide one.
      // A non-pipe record also takes its function's LOD tier here, whatever its
      // kind, and carries the function for the panel's category groups; a
      // paired leader or frame travels inside its label's record and so follows
      // it. A pipe record keeps neither, so its panel goes on grouping by
      // isoline (ADR 0071).
      const layout = record.layout as ExplicitLayoutInput;
      const lod = withFunctionTier(
        layout.lod,
        mbdFunctionLodTier(data.annotation_type, primitive.function, primitive.kind),
      );
      const retiered = lod !== undefined && lod !== layout.lod;
      const mbdFunction = pipePackage ? undefined : primitive.function;
      records.push(textHeightM === undefined && !retiered && mbdFunction === undefined
        ? record
        : {
          ...record,
          ...(mbdFunction !== undefined ? { mbdFunction } : {}),
          layout: {
            ...layout,
            ...(retiered ? { lod } : {}),
            ...(textHeightM !== undefined ? { textHeightM } : {}),
          },
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

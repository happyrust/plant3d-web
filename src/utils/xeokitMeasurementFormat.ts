import { convertLength, formatLengthMeters, formatPdmsPos } from './unitFormat';

import type {
  MeasurementPoint,
  MeasurementRecord,
  Vec3,
  XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import type { LengthUnit } from '@/composables/useUnitSettingsStore';

import { MEASUREMENT_PICK_SOURCE_LABELS } from '@/composables/useMeasurementPickSources';
import { buildThreePointAngle } from '@/measurement/kernel/threePointAngle';
import {
  designPointToFrame,
  designVectorToFrame,
  type ReferenceFrameAxisLabels,
  type ResolvedReferenceFrame,
} from '@/measurement/reference-frame';
import { formatCompassDirection } from '@/measurement/reference-frame/compassDirection';
import {
  DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
  formatMeasurementAngle,
  formatMeasurementAngleDms,
  type MeasurementAngleUnitSelection,
} from '@/measurement/units/measurementAngleUnits';
import {
  formatMeasurementLengthMeters,
  type MeasurementDistanceFormat,
} from '@/measurement/units/measurementUnits';
import { formatPdmsRef } from '@/utils/pdmsRefno';

type MeasurementLike = MeasurementRecord | XeokitMeasurementRecord;

export function getMeasurementPointElevation(point: MeasurementPoint): number {
  return Number(point.designWorldPos?.[2] ?? point.worldPos?.[2] ?? 0);
}

export function formatSignedLengthMeters(
  valueMeters: number,
  unit: LengthUnit,
  precision: number,
  opts?: { suffix?: boolean },
): string {
  const sign = valueMeters >= 0 ? '+' : '-';
  return `${sign}${formatLengthMeters(Math.abs(valueMeters), unit, precision, opts)}`;
}

export function formatMeasurementKindLabel(kind: MeasurementLike['kind']): string {
  switch (kind) {
    case 'distance':
      return '距离测量';
    case 'angle':
      return '角度测量';
    case 'elevation_point':
      return '位置/标高';
    case 'elevation_delta':
      return '高差';
  }
}

function formatMeasurementPointSource(point: MeasurementPoint): string {
  const source = point.sourceInfo?.source;
  if (!source) return formatMeasurementEntityId(point.entityId);
  const label = MEASUREMENT_PICK_SOURCE_LABELS[source] ?? source;
  const pointLabel = point.sourceInfo?.label;
  if (pointLabel === label || pointLabel?.startsWith(`${label} `)) return pointLabel;
  return pointLabel ? `${label} ${pointLabel}` : label;
}

function formatMeasurementEntityId(entityId: string): string {
  const objectMatch = /^o:([^:]+):\d+$/.exec(entityId);
  return formatPdmsRef(objectMatch?.[1] ?? entityId);
}

function formatMeasurementPoint(point: MeasurementPoint): string {
  const entityText = formatMeasurementEntityId(point.entityId);
  if (!point.sourceInfo) return entityText;
  const sourceText = formatMeasurementPointSource(point);
  return sourceText === point.entityId ? entityText : `${entityText} (${sourceText})`;
}

export function formatMeasurementSummary(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
  opts?: {
    showAxisBreakdown?: boolean;
    referenceFrame?: ResolvedReferenceFrame;
    /** 角度摘要按测量会话的 Units 框出；不给就用 E3D 缺省（Default / 2 位）。 */
    angleUnits?: MeasurementAngleUnitSelection;
  },
): string {
  switch (measurement.kind) {
    case 'distance': {
      const origin = measurement.origin.designWorldPos;
      const target = measurement.target.designWorldPos;
      const points = `起点 ${formatMeasurementPoint(measurement.origin)} -> 终点 ${formatMeasurementPoint(measurement.target)}`;
      if (!origin || !target) return points;
      const worldDeltas: Vec3 = [
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
      ];
      const interpreted = opts?.referenceFrame
        ? computeDistanceMeasurementResultInFrame(
          measurement.origin,
          measurement.target,
          opts.referenceFrame,
        )
        : null;
      const deltas = interpreted?.offsets.components ?? worldDeltas;
      const labels = interpreted?.axisLabels ?? DISTANCE_AXIS_LABELS;
      const total = `距离 ${formatLengthMeters(Math.hypot(...worldDeltas), unit, precision)}`;
      if (opts?.showAxisBreakdown === false) return `${total} · ${points}`;
      const deltaText = interpreted?.offsetMode === 'magnitude'
        ? (delta: number) => formatLengthMeters(Math.abs(delta), unit, precision)
        : (delta: number) => formatSignedLengthMeters(delta, unit, precision);
      const axisParts = deltas
        .map((delta, index) => `${labels[index]} ${deltaText(delta)}`)
        .join(' · ');
      return `${total} · ${axisParts} · ${points}`;
    }
    case 'angle': {
      const points = `起点 ${formatMeasurementPoint(measurement.origin)} -> 拐点 ${formatMeasurementPoint(measurement.corner)} -> 终点 ${formatMeasurementPoint(measurement.target)}`;
      const rows = opts?.referenceFrame
        ? buildAngleMeasurementResultRows(
          measurement.corner,
          measurement.origin,
          measurement.target,
          opts.referenceFrame,
          opts.angleUnits,
        )
        : [];
      if (rows.length === 0) return points;
      return `${rows.map((row) => `${row.label} ${row.valueText}`).join(' · ')} · ${points}`;
    }
    case 'elevation_point': {
      const datumElevation = Number.isFinite(measurement.datumElevation)
        ? measurement.datumElevation
        : 0;
      const interpreted = opts?.referenceFrame
        ? computeElevationPointMeasurementResultInFrame(
          measurement.point,
          datumElevation,
          opts.referenceFrame,
        )
        : null;
      const position = interpreted
        ? ` · ${formatFrameName(opts!.referenceFrame!)} ${formatFramePosition(
          interpreted.position,
          interpreted.axisLabels,
          unit,
          precision,
        )}`
        : measurement.point.designWorldPos
          ? ` · World ${formatPdmsPos(measurement.point.designWorldPos, unit, precision)}`
          : '';
      const absoluteElevation = interpreted?.absoluteElevation ?? measurement.absoluteElevation;
      const relativeElevation = interpreted?.relativeElevation ?? measurement.relativeElevation;
      return `点 ${formatMeasurementPointSource(measurement.point)}${position} · 绝对 ${formatSignedLengthMeters(absoluteElevation, unit, precision)} · 相对基准 ${formatSignedLengthMeters(relativeElevation, unit, precision)}`;
    }
    case 'elevation_delta': {
      const interpreted = opts?.referenceFrame
        ? computeElevationDeltaMeasurementResultInFrame(
          measurement.origin,
          measurement.target,
          opts.referenceFrame,
        )
        : null;
      return `起点 ${formatMeasurementPointSource(measurement.origin)} ${formatSignedLengthMeters(interpreted?.originElevation ?? measurement.originElevation, unit, precision)} · 终点 ${formatMeasurementPointSource(measurement.target)} ${formatSignedLengthMeters(interpreted?.targetElevation ?? measurement.targetElevation, unit, precision)} · 高差 ${formatSignedLengthMeters(interpreted?.deltaElevation ?? measurement.deltaElevation, unit, precision)}`;
    }
  }
}

/**
 * P0 仅支持 World 笛卡尔参考系，因此使用中性的 X/Y/Z。
 * E3D 的最终 X/Y/Z、E/N/U 或 U/V/W 文案受 COORD/UQCORD 与 wrt 影响，
 * 应在 ReferenceFrameResolver 落地后由参考系提供，不能在这里假定。
 */
export const DISTANCE_AXIS_LABELS: readonly [string, string, string] = ['X', 'Y', 'Z'];

/**
 * 标准距离结果模型。P0 仅解析 World XYZ；后续由参考系解析器提供
 * E3D COORD/WRT 对应的轴标签和局部分量。
 */
export type DistanceMeasurementResultValues = {
  /** 两点真实三维距离（米，设计坐标）。 */
  distance: number;
  /** Offset：两点偏移在当前参考系下的分量（P0 为 World ΔX/ΔY/ΔZ，米）。 */
  offsets: { frame: 'world'; components: Vec3 };
  /** 两点连线方向单位向量；零距离时为 null。 */
  direction: { vector: Vec3 } | null;
  /** 结果解释参考系；第一阶段只有 world。 */
  wrt: 'world';
};

/**
 * Offset 行的口径：普通帧是带符号的投影分量；GENSEC 帧是**非负**投影（E3D `offsetType()`，golden G3-04
 * `1920.14 / 400.28 / 4430.67mm`），显示时不带符号。
 */
export type DistanceOffsetMode = 'signed' | 'magnitude';

export type DistanceMeasurementFrameResultValues = Readonly<{
  distance: number;
  offsets: Readonly<{ components: Vec3 }>;
  /**
   * Unit direction components expressed in the resolved frame — except for a GENSEC frame,
   * where E3D expresses Direction in World (`gphmeasure.pmlfrm` 396–399, golden G3-04).
   */
  direction: Readonly<{ vector: Vec3 }> | null;
  axisLabels: ReferenceFrameAxisLabels;
  offsetMode: DistanceOffsetMode;
  frame: ResolvedReferenceFrame;
}>;

/** E3D 只对 `hardtype eq 'GENSEC'` 的 wrt 走特殊口径（SCTN 等不算）。 */
export function isGensecReferenceFrame(frame: ResolvedReferenceFrame): boolean {
  return frame.kind === 'element' && frame.noun === 'GENSEC';
}

/** 差向量在一组正交单位轴上的非负投影 |Δ·u| / |Δ·v| / |Δ·w|（E3D GENSEC 的 `offsetType()`）。 */
function projectMagnitudes(delta: Vec3, basis: ResolvedReferenceFrame['basis']): Vec3 {
  const along = (axis: readonly [number, number, number]): number => (
    Math.abs(delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2])
  );
  return [along(basis.u), along(basis.v), along(basis.w)];
}

export type ElevationPointFrameResultValues = Readonly<{
  position: Vec3;
  absoluteElevation: number;
  relativeElevation: number;
  axisLabels: ReferenceFrameAxisLabels;
  frame: ResolvedReferenceFrame;
}>;

export type ElevationDeltaFrameResultValues = Readonly<{
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  verticalAxisLabel: string;
  frame: ResolvedReferenceFrame;
}>;

/** 由起终点设计坐标派生距离结果模型；任一点缺坐标返回 null。 */
export function computeDistanceMeasurementResult(
  origin: MeasurementPoint,
  target: MeasurementPoint,
): DistanceMeasurementResultValues | null {
  const from = measurementPointDesignPos(origin);
  const to = measurementPointDesignPos(target);
  if (!from || !to) return null;
  const components: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const distance = Math.hypot(components[0], components[1], components[2]);
  return {
    distance,
    offsets: { frame: 'world', components },
    direction: distance > 0
      ? {
        vector: [
          components[0] / distance,
          components[1] / distance,
          components[2] / distance,
        ],
      }
      : null,
    wrt: 'world',
  };
}

/**
 * Reinterpret immutable design-world anchors in a resolved WRT frame.
 * The three-dimensional distance is invariant; only components and labels change.
 */
export function computeDistanceMeasurementResultInFrame(
  origin: MeasurementPoint,
  target: MeasurementPoint,
  frame: ResolvedReferenceFrame,
): DistanceMeasurementFrameResultValues | null {
  const from = measurementPointDesignPos(origin);
  const to = measurementPointDesignPos(target);
  if (!from || !to) return null;
  const designDelta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const projected = designVectorToFrame(frame, designDelta);
  if (!projected.ok) return null;
  const distance = Math.hypot(...designDelta);
  // GENSEC 当 wrt（`gphmeasure.pmlfrm` 396–399 + G3-04）：Offset 是沿**截面标架**（yDir / zDir，不是 ORI）
  // 三根轴的**非负**投影，Direction 按 World 算。截面标架拿不到时退回 ORI 帧的轴。
  const gensec = isGensecReferenceFrame(frame);
  const components: Vec3 = gensec
    ? projectMagnitudes(designDelta, frame.sectionBasis ?? frame.basis)
    : [...projected.value];
  const directionSource: Vec3 = gensec ? designDelta : [...projected.value];
  return {
    distance,
    offsets: { components },
    direction: distance > 0
      ? {
        vector: [
          directionSource[0] / distance,
          directionSource[1] / distance,
          directionSource[2] / distance,
        ],
      }
      : null,
    axisLabels: frame.axisLabels,
    offsetMode: gensec ? 'magnitude' : 'signed',
    frame,
  };
}

export function computeElevationPointMeasurementResultInFrame(
  point: MeasurementPoint,
  datumElevation: number,
  frame: ResolvedReferenceFrame,
): ElevationPointFrameResultValues | null {
  const designPosition = measurementPointDesignPos(point);
  if (!designPosition || !Number.isFinite(datumElevation)) return null;
  const transformed = designPointToFrame(frame, designPosition);
  if (!transformed.ok) return null;
  const position: Vec3 = [...transformed.value];
  return {
    position,
    absoluteElevation: position[2],
    relativeElevation: position[2] - datumElevation,
    axisLabels: frame.axisLabels,
    frame,
  };
}

export function computeElevationDeltaMeasurementResultInFrame(
  origin: MeasurementPoint,
  target: MeasurementPoint,
  frame: ResolvedReferenceFrame,
): ElevationDeltaFrameResultValues | null {
  const from = measurementPointDesignPos(origin);
  const to = measurementPointDesignPos(target);
  if (!from || !to) return null;
  const originResult = designPointToFrame(frame, from);
  const targetResult = designPointToFrame(frame, to);
  if (!originResult.ok || !targetResult.ok) return null;
  return {
    originElevation: originResult.value[2],
    targetElevation: targetResult.value[2],
    deltaElevation: targetResult.value[2] - originResult.value[2],
    verticalAxisLabel: frame.axisLabels[2],
    frame,
  };
}

export type DistanceMeasurementResultRow = Readonly<{
  key: 'distance' | 'offset-x' | 'offset-y' | 'offset-z' | 'direction';
  label: string;
  valueText: string;
}>;

type DistanceMeasurementRowsSource = Readonly<{
  distance: number;
  offsets: Readonly<{ components: readonly [number, number, number] }>;
  direction: Readonly<{ vector: readonly [number, number, number] }> | null;
  axisLabels?: ReferenceFrameAxisLabels;
  /** 不给按 `signed`（World / 普通帧）；GENSEC 帧的结果给 `magnitude`，Offset 不带符号。 */
  offsetMode?: DistanceOffsetMode;
}>;

/**
 * 给定测量会话的 Units 选择时，结果表的长度按它渲染（E3D
 * `gphMeasure.measureFormat`）；不给就沿用调用方的全局显示单位 + 小数位。
 */
function lengthFormatters(
  unit: LengthUnit,
  precision: number,
  format?: MeasurementDistanceFormat | null,
): Readonly<{ plain: (v: number) => string; signed: (v: number) => string }> {
  if (!format) {
    return {
      plain: (v) => formatLengthMeters(v, unit, precision),
      signed: (v) => formatSignedLengthMeters(v, unit, precision),
    };
  }
  return {
    plain: (v) => formatMeasurementLengthMeters(v, format),
    signed: (v) => formatMeasurementLengthMeters(v, format, { signed: true }),
  };
}

/** E3D 标准距离结果的五行结构；P0 的参考系固定为 World XYZ。 */
export function buildDistanceMeasurementResultRows(
  result: DistanceMeasurementRowsSource,
  unit: LengthUnit,
  precision: number,
  format?: MeasurementDistanceFormat | null,
): DistanceMeasurementResultRow[] {
  const [offsetX, offsetY, offsetZ] = result.offsets.components;
  const labels = result.axisLabels ?? DISTANCE_AXIS_LABELS;
  const fmt = lengthFormatters(unit, precision, format);
  // GENSEC 帧的 Offset 是非负投影，E3D 单元格就是 `1920.14mm`，不带符号。
  const offsetText = result.offsetMode === 'magnitude'
    ? (v: number) => fmt.plain(Math.abs(v))
    : fmt.signed;
  const offsetRows: DistanceMeasurementResultRow[] = [
    {
      key: 'offset-x',
      label: `Offset ${labels[0]}`,
      valueText: offsetText(offsetX),
    },
    {
      key: 'offset-y',
      label: `Offset ${labels[1]}`,
      valueText: offsetText(offsetY),
    },
    {
      key: 'offset-z',
      label: `Offset ${labels[2]}`,
      valueText: offsetText(offsetZ),
    },
  ];
  // E3D 的 Direction 是罗盘字串（`DIRECTION.string()`），字母按当前 wrt 帧的三根轴走。
  // E3D 这张表原样带 ` WRT /*` 尾巴（`gphmeasure.pmlfrm` 403 只 `.trim()`，截图 G1-02-result），
  // 用户 2026-09-14 拍板不要——三张表都只出纯罗盘串，wrt 在结果卡顶上另有一格。
  const directionText = result.direction
    ? formatCompassDirection(result.direction.vector)
    : '--';

  return [
    {
      key: 'distance',
      label: 'Distance',
      valueText: fmt.plain(result.distance),
    },
    ...offsetRows,
    {
      key: 'direction',
      label: 'Direction',
      valueText: directionText,
    },
  ];
}

export type AngleMeasurementFrameResultValues = Readonly<{
  angleDeg: number;
  /** root → first 的单位方向，按当前 wrt 帧表达。 */
  direction1: Vec3;
  /** root → second 的单位方向，按当前 wrt 帧表达。 */
  direction2: Vec3;
  axisLabels: ReferenceFrameAxisLabels;
}>;

/**
 * 三点角在当前 wrt 帧下的结果。三点顺序是 E3D 的 root / first / second
 * （Web 草稿里分别是第一击 `corner`、第二击 `origin`、第三击 `target`）。
 * 角度本身与参考系无关（内核只报 minor 角），换帧只换两条臂方向的分量与轴标签。
 * 内核判退化（0° / 180° / 重合点）时回 null —— E3D 那边是 `alert.error`、不出结果。
 */
export function computeThreePointAngleInFrame(
  root: MeasurementPoint,
  first: MeasurementPoint,
  second: MeasurementPoint,
  frame: ResolvedReferenceFrame,
): AngleMeasurementFrameResultValues | null {
  const rootPos = measurementPointDesignPos(root);
  const firstPos = measurementPointDesignPos(first);
  const secondPos = measurementPointDesignPos(second);
  if (!rootPos || !firstPos || !secondPos) return null;
  const built = buildThreePointAngle(rootPos, firstPos, secondPos);
  if (!built.ok) return null;
  const projected1 = designVectorToFrame(frame, [...built.value.direction1]);
  const projected2 = designVectorToFrame(frame, [...built.value.direction2]);
  if (!projected1.ok || !projected2.ok) return null;
  return {
    angleDeg: built.value.angleDeg,
    direction1: [...projected1.value],
    direction2: [...projected2.value],
    axisLabels: frame.axisLabels,
  };
}

export type AngleMeasurementResultRow = Readonly<{
  key: 'angle' | 'dms' | 'direction1' | 'direction2';
  label: string;
  valueText: string;
}>;

/**
 * E3D「Measure Angle」结果表的四行（`gphanglemeasure.pmlfrm` 334–342 / 407–410）：
 * `Decimal Angle`（按 Units 框的 Unit 换算 + Decimal Places，数值后面缀单位词）、
 * `DMS`（恒按十进制度截断出度 / 分 / 秒）、`Direction1` / `Direction2`
 * （两条臂的单位方向，按当前 wrt 帧表达，每个数也按 Decimal Places 出）。
 */
export function buildAngleMeasurementResultRows(
  root: MeasurementPoint,
  first: MeasurementPoint,
  second: MeasurementPoint,
  frame: ResolvedReferenceFrame,
  angleUnits: MeasurementAngleUnitSelection = DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
): AngleMeasurementResultRow[] {
  const values = computeThreePointAngleInFrame(root, first, second, frame);
  if (!values) return [];
  // 两条 Direction 也是罗盘字串，`.before('WRT')` 切掉尾巴（371 / 392）；每个角度再按
  // Decimal Places 走一遍 `!!realFmt`（374–385，留尾零）。
  const directionText = (vector: Vec3): string => formatCompassDirection(vector, {
    decimals: angleUnits.decimalPlaces,
  });
  return [
    {
      key: 'angle',
      label: 'Decimal Angle',
      valueText: formatMeasurementAngle(values.angleDeg, angleUnits),
    },
    { key: 'dms', label: 'DMS', valueText: formatMeasurementAngleDms(values.angleDeg) },
    { key: 'direction1', label: 'Direction1', valueText: directionText(values.direction1) },
    { key: 'direction2', label: 'Direction2', valueText: directionText(values.direction2) },
  ];
}

export type PerpendicularMeasurementResultRow = Readonly<{
  key: 'distance' | 'vertical' | 'horizontal' | 'direction';
  label: string;
  valueText: string;
}>;

/**
 * E3D「Perpendicular to」结果的四行结构（`gphmeasure.perpendicularSetup`）：
 * Distance、Vertical = |Δup|（World）、Horizontal = √(Distance² − Vertical²)、
 * Direction 从垂足指向源点并固定按 World 表达（golden G4-06）。
 * `origin` 是源点，`target` 是垂足。
 */
export function buildPerpendicularMeasurementResultRows(
  origin: MeasurementPoint,
  target: MeasurementPoint,
  unit: LengthUnit,
  precision: number,
  format?: MeasurementDistanceFormat | null,
): PerpendicularMeasurementResultRow[] {
  const source = measurementPointDesignPos(origin);
  const foot = measurementPointDesignPos(target);
  if (!source || !foot) return [];
  const delta: Vec3 = [source[0] - foot[0], source[1] - foot[1], source[2] - foot[2]];
  const distance = Math.hypot(delta[0], delta[1], delta[2]);
  const vertical = Math.abs(delta[2]);
  const horizontal = Math.sqrt(Math.max(0, distance * distance - vertical * vertical));
  // 垂距的 Direction 从垂足指向源点，固定按 World 表达（golden G4-06）；
  // 这张表 `.before('WRT')` 切掉尾巴（`gphmeasure.pmlfrm` 666，截图 G4-03）。
  const directionText = distance > 0 ? formatCompassDirection(delta) : '--';
  const fmt = lengthFormatters(unit, precision, format);
  return [
    { key: 'distance', label: 'Distance', valueText: fmt.plain(distance) },
    { key: 'vertical', label: 'Vertical', valueText: fmt.plain(vertical) },
    { key: 'horizontal', label: 'Horizontal', valueText: fmt.plain(horizontal) },
    { key: 'direction', label: 'Direction', valueText: directionText },
  ];
}

function measurementPointDesignPos(point: MeasurementPoint): Vec3 | null {
  const value = point.designWorldPos;
  if (!value || value.length !== 3 || value.some(component => !Number.isFinite(component))) {
    return null;
  }
  return value;
}

/**
 * 三点角的角度值。走的是与结果表同一个内核（`buildThreePointAngle`，golden G6）：
 * 只报 minor 角，0° / 180° / 重合点回 null（E3D 那边这几种造不出 ARC）。
 * 三点顺序 root = `corner`（第一击）、first = `origin`、second = `target`。
 */
function computeAngleDegrees(
  origin: MeasurementPoint,
  corner: MeasurementPoint,
  target: MeasurementPoint,
): number | null {
  const o = measurementPointDesignPos(origin);
  const c = measurementPointDesignPos(corner);
  const t = measurementPointDesignPos(target);
  if (!o || !c || !t) return null;
  const built = buildThreePointAngle(c, o, t);
  return built.ok ? built.value.angleDeg : null;
}

/** 右键菜单「复制值」文本：距离/角度/标高/高差的当前显示值。 */
export function buildMeasurementValueText(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
  referenceFrame?: ResolvedReferenceFrame,
  angleUnits: MeasurementAngleUnitSelection = DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
): string | null {
  switch (measurement.kind) {
    case 'distance': {
      const origin = measurement.origin.designWorldPos;
      const target = measurement.target.designWorldPos;
      if (!origin || !target) return null;
      const dx = target[0] - origin[0];
      const dy = target[1] - origin[1];
      const dz = target[2] - origin[2];
      return formatLengthMeters(Math.hypot(dx, dy, dz), unit, precision);
    }
    case 'angle': {
      const degrees = computeAngleDegrees(
        measurement.origin,
        measurement.corner,
        measurement.target,
      );
      return degrees === null ? null : formatMeasurementAngle(degrees, angleUnits);
    }
    case 'elevation_point': {
      const interpreted = referenceFrame
        ? computeElevationPointMeasurementResultInFrame(
          measurement.point,
          Number.isFinite(measurement.datumElevation) ? measurement.datumElevation : 0,
          referenceFrame,
        )
        : null;
      return formatSignedLengthMeters(
        interpreted?.absoluteElevation ?? measurement.absoluteElevation,
        unit,
        precision,
      );
    }
    case 'elevation_delta': {
      const interpreted = referenceFrame
        ? computeElevationDeltaMeasurementResultInFrame(
          measurement.origin,
          measurement.target,
          referenceFrame,
        )
        : null;
      return formatSignedLengthMeters(
        interpreted?.deltaElevation ?? measurement.deltaElevation,
        unit,
        precision,
      );
    }
  }
}

/** 右键菜单「复制分量」文本：距离测量的轴向分量（多行）。 */
export function buildMeasurementComponentsText(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
  referenceFrame?: ResolvedReferenceFrame,
): string | null {
  if (measurement.kind !== 'distance') return null;
  const origin = measurement.origin.designWorldPos;
  const target = measurement.target.designWorldPos;
  if (!origin || !target) return null;
  const interpreted = referenceFrame
    ? computeDistanceMeasurementResultInFrame(
      measurement.origin,
      measurement.target,
      referenceFrame,
    )
    : null;
  const deltas = interpreted?.offsets.components ?? [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2],
  ];
  const labels = interpreted?.axisLabels ?? DISTANCE_AXIS_LABELS;
  const deltaText = interpreted?.offsetMode === 'magnitude'
    ? (delta: number) => formatLengthMeters(Math.abs(delta), unit, precision)
    : (delta: number) => formatSignedLengthMeters(delta, unit, precision);
  return deltas
    .map((delta, index) => `${labels[index]} ${deltaText(delta)}`)
    .join('\n');
}

function formatFrameName(frame: ResolvedReferenceFrame): string {
  return frame.kind === 'world' ? 'World' : `WRT ${formatPdmsRef(frame.refno)}`;
}

function formatFramePosition(
  position: Vec3,
  labels: ReferenceFrameAxisLabels,
  unit: LengthUnit,
  precision: number,
): string {
  const digits = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)));
  return position.map((value, index) => (
    `${labels[index]} ${convertLength(value, 'm', unit).toFixed(digits)}${unit}`
  )).join(' ');
}

export function buildElevationPointLabelLines(input: {
  worldPosition?: Vec3;
  absoluteElevation: number;
  relativeElevation: number;
  unit: LengthUnit;
  precision: number;
  showAbsolute: boolean;
  showRelative: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.worldPosition) {
    lines.push(`World ${formatPdmsPos(input.worldPosition, input.unit, input.precision)}`);
  }
  if (input.showAbsolute) {
    lines.push(`标高 ${formatSignedLengthMeters(input.absoluteElevation, input.unit, input.precision)}`);
  }
  if (input.showRelative) {
    lines.push(`相对基准 ${formatSignedLengthMeters(input.relativeElevation, input.unit, input.precision)}`);
  }
  return lines;
}

export function buildElevationDeltaLabelTexts(input: {
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  unit: LengthUnit;
  precision: number;
}): {
  origin: string;
  target: string;
  delta: string;
} {
  return {
    origin: `起 ${formatSignedLengthMeters(input.originElevation, input.unit, input.precision)}`,
    target: `终 ${formatSignedLengthMeters(input.targetElevation, input.unit, input.precision)}`,
    delta: `高差 ${formatSignedLengthMeters(input.deltaElevation, input.unit, input.precision)}`,
  };
}

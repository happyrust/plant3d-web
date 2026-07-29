import { formatLengthMeters, formatPdmsPos } from './unitFormat';

import type {
  MeasurementPoint,
  MeasurementRecord,
  Vec3,
  XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import type { LengthUnit } from '@/composables/useUnitSettingsStore';

import { MEASUREMENT_PICK_SOURCE_LABELS } from '@/composables/useMeasurementPickSources';
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
  opts?: { showAxisBreakdown?: boolean },
): string {
  switch (measurement.kind) {
    case 'distance': {
      const origin = measurement.origin.designWorldPos;
      const target = measurement.target.designWorldPos;
      const points = `起点 ${formatMeasurementPoint(measurement.origin)} -> 终点 ${formatMeasurementPoint(measurement.target)}`;
      if (!origin || !target) return points;
      const deltas = [
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
      ];
      const total = `距离 ${formatLengthMeters(Math.hypot(deltas[0], deltas[1], deltas[2]), unit, precision)}`;
      if (opts?.showAxisBreakdown === false) return `${total} · ${points}`;
      const axisParts = deltas
        .map((delta, index) => (
          `${DISTANCE_AXIS_LABELS[index]} ${formatSignedLengthMeters(delta, unit, precision)}`
        ))
        .join(' · ');
      return `${total} · ${axisParts} · ${points}`;
    }
    case 'angle':
      return `起点 ${formatMeasurementPoint(measurement.origin)} -> 拐点 ${formatMeasurementPoint(measurement.corner)} -> 终点 ${formatMeasurementPoint(measurement.target)}`;
    case 'elevation_point': {
      const world = measurement.point.designWorldPos
        ? ` · World ${formatPdmsPos(measurement.point.designWorldPos, unit, precision)}`
        : '';
      return `点 ${formatMeasurementPointSource(measurement.point)}${world} · 绝对 ${formatSignedLengthMeters(measurement.absoluteElevation, unit, precision)} · 相对基准 ${formatSignedLengthMeters(measurement.relativeElevation, unit, precision)}`;
    }
    case 'elevation_delta':
      return `起点 ${formatMeasurementPointSource(measurement.origin)} ${formatSignedLengthMeters(measurement.originElevation, unit, precision)} · 终点 ${formatMeasurementPointSource(measurement.target)} ${formatSignedLengthMeters(measurement.targetElevation, unit, precision)} · 高差 ${formatSignedLengthMeters(measurement.deltaElevation, unit, precision)}`;
  }
}

/**
 * 距离轴向分量的展示标签，按 E3D 工程坐标语义 E/N/U（东/北/高）。
 * 映射假设 E=ΔX、N=ΔY、U=ΔZ（PDMS 设计坐标惯例），待 E3D 实机验证后如不符只改这里。
 */
export const DISTANCE_AXIS_LABELS: readonly [string, string, string] = ['E', 'N', 'U'];

function measurementPointDesignPos(point: MeasurementPoint): Vec3 | null {
  return point.designWorldPos ?? point.worldPos ?? null;
}

function computeAngleDegrees(
  origin: MeasurementPoint,
  corner: MeasurementPoint,
  target: MeasurementPoint,
): number | null {
  const o = measurementPointDesignPos(origin);
  const c = measurementPointDesignPos(corner);
  const t = measurementPointDesignPos(target);
  if (!o || !c || !t) return null;
  const v1 = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const v2 = [t[0] - c[0], t[1] - c[1], t[2] - c[2]];
  const len1 = Math.hypot(v1[0], v1[1], v1[2]);
  const len2 = Math.hypot(v2[0], v2[1], v2[2]);
  if (len1 === 0 || len2 === 0) return null;
  const dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (len1 * len2);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** 右键菜单「复制值」文本：距离/角度/标高/高差的当前显示值。 */
export function buildMeasurementValueText(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
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
      return degrees === null ? null : `${degrees.toFixed(1)}°`;
    }
    case 'elevation_point':
      return formatSignedLengthMeters(measurement.absoluteElevation, unit, precision);
    case 'elevation_delta':
      return formatSignedLengthMeters(measurement.deltaElevation, unit, precision);
  }
}

/** 右键菜单「复制分量」文本：距离测量的轴向分量（多行）。 */
export function buildMeasurementComponentsText(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
): string | null {
  if (measurement.kind !== 'distance') return null;
  const origin = measurement.origin.designWorldPos;
  const target = measurement.target.designWorldPos;
  if (!origin || !target) return null;
  const deltas = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2],
  ];
  return deltas
    .map((delta, index) => (
      `${DISTANCE_AXIS_LABELS[index]} ${formatSignedLengthMeters(delta, unit, precision)}`
    ))
    .join('\n');
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

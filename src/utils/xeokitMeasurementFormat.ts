import type { LengthUnit } from '@/composables/useUnitSettingsStore';
import type {
  MeasurementPoint,
  MeasurementRecord,
  XeokitMeasurementRecord,
} from '@/composables/useToolStore';

import { formatLengthMeters } from './unitFormat';

type MeasurementLike = MeasurementRecord | XeokitMeasurementRecord;

export function getMeasurementPointElevation(point: MeasurementPoint): number {
  return Number(point.worldPos?.[2] ?? 0);
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
      return '点标高';
    case 'elevation_delta':
      return '高差';
  }
}

export function formatMeasurementSummary(
  measurement: MeasurementLike,
  unit: LengthUnit,
  precision: number,
): string {
  switch (measurement.kind) {
    case 'distance':
      return `起点 ${measurement.origin.entityId} · 终点 ${measurement.target.entityId}`;
    case 'angle':
      return `起点 ${measurement.origin.entityId} · 拐点 ${measurement.corner.entityId} · 终点 ${measurement.target.entityId}`;
    case 'elevation_point':
      return `绝对 ${formatSignedLengthMeters(measurement.absoluteElevation, unit, precision)} · 相对基准 ${formatSignedLengthMeters(measurement.relativeElevation, unit, precision)}`;
    case 'elevation_delta':
      return `起点 ${formatSignedLengthMeters(measurement.originElevation, unit, precision)} · 终点 ${formatSignedLengthMeters(measurement.targetElevation, unit, precision)} · 高差 ${formatSignedLengthMeters(measurement.deltaElevation, unit, precision)}`;
  }
}

export function buildElevationPointLabelLines(input: {
  absoluteElevation: number;
  relativeElevation: number;
  unit: LengthUnit;
  precision: number;
  showAbsolute: boolean;
  showRelative: boolean;
}): string[] {
  const lines: string[] = [];
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

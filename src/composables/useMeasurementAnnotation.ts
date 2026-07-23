/**
 * 测量标注适配器
 *
 * 将 useToolStore 中的测量记录转换为三维标注系统的标注对象
 */

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type {
  MeasurementPoint,
  MeasurementRecord,
  Vec3,
} from './useToolStore';
import type { DimensionSystem, ExternalDimensionRecord } from '@/dimension';

/** 测量标注 ID 前缀 */
const DIMENSION_MEASUREMENT_PREFIX = 'measurement:';

type MeasurementAnnotationManagerOptions = Readonly<{
  getDimensionSystem?: () => DimensionSystem | null | undefined;
  sceneWorldToDesignMetres?: (point: Vec3) => readonly [number, number, number];
}>;

/** 格式化长度值 */
function formatLength(meters: number, unit: string, precision: number): string {
  let value = meters;
  let suffix = 'm';

  if (unit === 'mm') {
    value = meters * 1000;
    suffix = 'mm';
  } else if (unit === 'cm') {
    value = meters * 100;
    suffix = 'cm';
  } else if (unit === 'ft') {
    value = meters * 3.28084;
    suffix = 'ft';
  } else if (unit === 'in') {
    value = meters * 39.3701;
    suffix = 'in';
  }

  return `${value.toFixed(precision)} ${suffix}`;
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toDesignPoint(
  point: MeasurementPoint,
  fallback?: (point: Vec3) => readonly [number, number, number],
): readonly [number, number, number] {
  return point.designWorldPos ?? fallback?.(point.worldPos) ?? point.worldPos;
}

function measurementToExternalRecord(
  rec: MeasurementRecord,
  unit: string,
  precision: number,
  sceneWorldToDesignMetres?: (point: Vec3) => readonly [number, number, number],
): ExternalDimensionRecord | null {
  if (!rec.visible) return null;
  const id = `${DIMENSION_MEASUREMENT_PREFIX}${rec.id}`;
  if (rec.kind === 'distance') {
    const a = toDesignPoint(rec.origin, sceneWorldToDesignMetres);
    const b = toDesignPoint(rec.target, sceneWorldToDesignMetres);
    return {
      id,
      source: 'measurement',
      sourceLabel: 'Measurement',
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: formatLength(distance(a, b), unit, precision),
        a,
        b,
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
  }
  if (rec.kind === 'angle') {
    return {
      id,
      source: 'measurement',
      sourceLabel: 'Measurement',
      role: 'external',
      layout: {
        id,
        kind: 'angular',
        role: 'external',
        labelPinned: false,
        vertex: toDesignPoint(rec.corner, sceneWorldToDesignMetres),
        rayA: toDesignPoint(rec.origin, sceneWorldToDesignMetres),
        rayB: toDesignPoint(rec.target, sceneWorldToDesignMetres),
        placement: { radiusM: 0.5, labelT: 0.5, arcChoice: 'minor' },
      },
    };
  }
  if (rec.kind === 'elevation_delta') {
    const a = toDesignPoint(rec.origin, sceneWorldToDesignMetres);
    const b = toDesignPoint(rec.target, sceneWorldToDesignMetres);
    return {
      id,
      source: 'measurement',
      sourceLabel: 'Measurement',
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: formatLength(rec.deltaElevation, unit, precision),
        a,
        b,
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
  }
  const at = toDesignPoint(rec.point, sceneWorldToDesignMetres);
  return {
    id,
    source: 'measurement',
    sourceLabel: 'Measurement',
    role: 'external',
    category: 'annotation',
    layout: {
      id,
      role: 'external',
      labelPinned: false,
      formattedLabel: formatLength(rec.absoluteElevation, unit, precision),
      lines: [],
      labelAnchor: at,
      arrowLines: [],
      markers: [{ at, shape: 'circle', radiusPx: 4 }],
      texts: [{
        text: `REL ${formatLength(rec.relativeElevation, unit, precision)}`,
        anchor: at,
        stackIndex: 1,
      }],
    },
  };
}

/**
 * 测量标注管理器
 *
 * 负责将测量记录同步到标注系统
 */
export class MeasurementAnnotationManager {
  private getDimensionSystem: (() => DimensionSystem | null | undefined) | null;
  private sceneWorldToDesignMetres:
    | ((point: Vec3) => readonly [number, number, number])
    | undefined;
  private unit = 'm';
  private precision = 2;

  constructor(
    annotationSystem: UseAnnotationThreeReturn,
    options: MeasurementAnnotationManagerOptions = {},
  ) {
    void annotationSystem;
    this.getDimensionSystem = options.getDimensionSystem ?? null;
    this.sceneWorldToDesignMetres = options.sceneWorldToDesignMetres;
  }

  /** 设置显示单位 */
  setUnit(unit: string): void {
    this.unit = unit;
  }

  /** 设置精度 */
  setPrecision(precision: number): void {
    this.precision = precision;
  }

  /** 同步测量记录到标注系统 */
  sync(records: MeasurementRecord[]): void {
    const dimensionSystem = this.getDimensionSystem?.() ?? null;
    const externalRecords = records
      .map(record => measurementToExternalRecord(
        record,
        this.unit,
        this.precision,
        this.sceneWorldToDesignMetres,
      ))
      .filter((record): record is ExternalDimensionRecord => record !== null);
    dimensionSystem?.replaceExternalSource('measurement', externalRecords);
  }

  /** 清空所有测量标注 */
  clear(): void {
    this.getDimensionSystem?.()?.replaceExternalSource('measurement', []);
  }

  /** 高亮指定测量 */
  highlight(measurementId: string | null): void {
    this.getDimensionSystem?.()?.viewport.setSelection(
      measurementId ? `${DIMENSION_MEASUREMENT_PREFIX}${measurementId}` : null,
    );
  }

  /** 更新可见性 */
  setVisible(measurementId: string, visible: boolean): void {
    this.getDimensionSystem?.()?.externalRegistry.setHidden(
      `${DIMENSION_MEASUREMENT_PREFIX}${measurementId}`,
      !visible,
    );
  }
}

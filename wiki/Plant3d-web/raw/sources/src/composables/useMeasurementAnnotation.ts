/**
 * 测量标注适配器
 *
 * 将 useToolStore 中的测量记录转换为三维标注系统的标注对象
 */

import * as THREE from 'three';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { MeasurementRecord, DistanceMeasurementRecord, AngleMeasurementRecord } from './useToolStore';

import {
  LinearDimension,
  AlignedDimension,
  AngleDimension,
} from '@/utils/three/annotation';

/** 测量标注 ID 前缀 */
const MEASUREMENT_PREFIX = 'meas_';

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

/** 创建距离测量标注 */
function createDistanceAnnotation(
  annotationSystem: UseAnnotationThreeReturn,
  rec: DistanceMeasurementRecord,
  unit: string,
  precision: number
): void {
  const id = MEASUREMENT_PREFIX + rec.id;
  const start = new THREE.Vector3(...rec.origin.worldPos);
  const end = new THREE.Vector3(...rec.target.worldPos);
  const distance = start.distanceTo(end);

  const dim = new AlignedDimension(annotationSystem.materials, {
    start,
    end,
    text: formatLength(distance, unit, precision),
  });

  dim.visible = rec.visible;
  annotationSystem.addAnnotation(id, dim);
}

/** 创建角度测量标注 */
function createAngleAnnotation(
  annotationSystem: UseAnnotationThreeReturn,
  rec: AngleMeasurementRecord,
  precision: number
): void {
  const id = MEASUREMENT_PREFIX + rec.id;
  const origin = new THREE.Vector3(...rec.origin.worldPos);
  const corner = new THREE.Vector3(...rec.corner.worldPos);
  const target = new THREE.Vector3(...rec.target.worldPos);

  const angle = new AngleDimension(annotationSystem.materials, {
    vertex: corner,
    point1: origin,
    point2: target,
    arcRadius: 0.5,
    decimals: precision,
  });

  angle.visible = rec.visible;
  annotationSystem.addAnnotation(id, angle);
}

/**
 * 测量标注管理器
 *
 * 负责将测量记录同步到标注系统
 */
export class MeasurementAnnotationManager {
  private annotationSystem: UseAnnotationThreeReturn;
  private currentIds = new Set<string>();
  private unit = 'm';
  private precision = 2;

  constructor(annotationSystem: UseAnnotationThreeReturn) {
    this.annotationSystem = annotationSystem;
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
    const newIds = new Set<string>();

    for (const rec of records) {
      const id = MEASUREMENT_PREFIX + rec.id;
      newIds.add(id);

      // 检查是否已存在
      const existing = this.annotationSystem.getAnnotation(id);
      if (existing) {
        existing.visible = rec.visible;
        continue;
      }

      // 创建新标注
      if (rec.kind === 'distance') {
        createDistanceAnnotation(
          this.annotationSystem,
          rec,
          this.unit,
          this.precision
        );
      } else if (rec.kind === 'angle') {
        createAngleAnnotation(
          this.annotationSystem,
          rec,
          this.precision
        );
      }
    }

    // 移除不再存在的标注
    for (const id of this.currentIds) {
      if (!newIds.has(id)) {
        this.annotationSystem.removeAnnotation(id);
      }
    }

    this.currentIds = newIds;
  }

  /** 清空所有测量标注 */
  clear(): void {
    for (const id of this.currentIds) {
      this.annotationSystem.removeAnnotation(id);
    }
    this.currentIds.clear();
  }

  /** 高亮指定测量 */
  highlight(measurementId: string | null): void {
    const id = measurementId ? MEASUREMENT_PREFIX + measurementId : null;
    this.annotationSystem.highlightAnnotation(id);
  }

  /** 更新可见性 */
  setVisible(measurementId: string, visible: boolean): void {
    const id = MEASUREMENT_PREFIX + measurementId;
    const annotation = this.annotationSystem.getAnnotation(id);
    if (annotation) {
      annotation.visible = visible;
    }
  }
}
/**
 * 尺寸标注适配器（与测量分离）
 *
 * 将 useToolStore 中的 dimensions 记录转换为三维标注系统的标注对象：
 * - 线性尺寸：LinearDimension3D（Line2 + Mesh 箭头 + troika 3D text）
 * - 角度尺寸：AngleDimension3D（Line2 + troika 3D text）
 */

import * as THREE from 'three';

import { useDimensionStyleStore } from './useDimensionStyleStore';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { DimensionRecord, LinearDistanceDimensionRecord, AngleDimensionRecord } from './useToolStore';

import { AngleDimension3D, LinearDimension3D } from '@/utils/three/annotation';
import { formatLengthMeters } from '@/utils/unitFormat';

/** 尺寸标注 ID 前缀 */
const DIMENSION_PREFIX = 'dim_';

function formatAngleDegrees(deg: number, precision: number): string {
  const p = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)));
  return `${deg.toFixed(p)}°`;
}

function createLinearDimension(
  annotationSystem: UseAnnotationThreeReturn,
  rec: LinearDistanceDimensionRecord,
  unit: 'm' | 'cm' | 'mm',
  precision: number
): void {
  const id = DIMENSION_PREFIX + rec.id;
  const start = new THREE.Vector3(...rec.origin.worldPos);
  const end = new THREE.Vector3(...rec.target.worldPos);
  const distance = start.distanceTo(end);
  const direction = rec.direction ? new THREE.Vector3(...rec.direction) : undefined;
  const text = rec.textOverride ?? formatLengthMeters(distance, unit, precision);

  const labelOffsetWorld = rec.labelOffsetWorld
    ? new THREE.Vector3(rec.labelOffsetWorld[0], rec.labelOffsetWorld[1], rec.labelOffsetWorld[2])
    : undefined;
  const { style } = useDimensionStyleStore();
  const dim = new LinearDimension3D(annotationSystem.materials, {
    start,
    end,
    offset: rec.offset,
    labelT: rec.labelT ?? 0.5,
    labelOffsetWorld: labelOffsetWorld ?? null,
    isReference: rec.isReference ?? false,
    direction,
    text,
    decimals: precision,
    unit: unit === 'm' ? '' : unit,
    arrowStyle: style.arrowStyle,
    arrowSizePx: style.arrowSizePx,
    arrowAngleDeg: style.arrowAngleDeg,
    extensionOvershootPx: style.extensionOvershootPx,
  });
  dim.userData.pickable = true;
  dim.userData.draggable = true;
  dim.visible = rec.visible;
  annotationSystem.addAnnotation(id, dim);
}

function createAngleDimension(
  annotationSystem: UseAnnotationThreeReturn,
  rec: AngleDimensionRecord,
  precision: number
): void {
  const id = DIMENSION_PREFIX + rec.id;
  const origin = new THREE.Vector3(...rec.origin.worldPos);
  const corner = new THREE.Vector3(...rec.corner.worldPos);
  const target = new THREE.Vector3(...rec.target.worldPos);

  const labelOffsetWorld = rec.labelOffsetWorld
    ? new THREE.Vector3(rec.labelOffsetWorld[0], rec.labelOffsetWorld[1], rec.labelOffsetWorld[2])
    : undefined;
  const dim = new AngleDimension3D(annotationSystem.materials, {
    vertex: corner,
    point1: origin,
    point2: target,
    arcRadius: Math.max(0.3, Math.min(1.2, rec.offset || 0.8)),
    labelT: rec.labelT ?? 0.5,
    labelOffsetWorld: labelOffsetWorld ?? null,
    isReference: rec.isReference ?? false,
    supplementary: rec.supplementary ?? false,
    decimals: precision,
    text: rec.textOverride ?? formatAngleDegrees(0, precision),
  });
  dim.userData.pickable = true;
  dim.userData.draggable = true;
  if (!rec.textOverride) {
    const deg = dim.getAngleDegrees();
    dim.setParams({ text: formatAngleDegrees(deg, precision) });
  }

  dim.visible = rec.visible;
  annotationSystem.addAnnotation(id, dim);
}

/**
 * 尺寸标注管理器
 *
 * 负责将尺寸标注记录同步到标注系统
 */
export class DimensionAnnotationManager {
  private annotationSystem: UseAnnotationThreeReturn;
  private currentIds = new Set<string>();
  private unit: 'm' | 'cm' | 'mm' = 'm';
  private precision = 2;
  private bgColor: THREE.ColorRepresentation | null = null;

  constructor(annotationSystem: UseAnnotationThreeReturn) {
    this.annotationSystem = annotationSystem;
  }

  setBackgroundColor(color: THREE.ColorRepresentation): void {
    this.bgColor = color;
    for (const id of this.currentIds) {
      const ann = this.annotationSystem.getAnnotation(id);
      ann?.setBackgroundColor(color);
    }
  }

  setUnit(unit: 'm' | 'cm' | 'mm'): void {
    this.unit = unit;
  }

  setPrecision(precision: number): void {
    this.precision = precision;
  }

  sync(records: DimensionRecord[]): void {
    const newIds = new Set<string>();

    for (const rec of records) {
      const id = DIMENSION_PREFIX + rec.id;
      newIds.add(id);

      const existing = this.annotationSystem.getAnnotation(id);
      if (existing) {
        existing.visible = rec.visible;
        const ud = ((existing as any).userData ||= {});
        ud.pickable = true;
        ud.draggable = true;
        if (rec.kind === 'linear_distance' && existing instanceof LinearDimension3D) {
          const start = new THREE.Vector3(...rec.origin.worldPos);
          const end = new THREE.Vector3(...rec.target.worldPos);
          const distance = start.distanceTo(end);
          const direction = rec.direction ? new THREE.Vector3(...rec.direction) : undefined;
          const text = rec.textOverride ?? formatLengthMeters(distance, this.unit, this.precision);
          const low = rec.labelOffsetWorld
            ? new THREE.Vector3(rec.labelOffsetWorld[0], rec.labelOffsetWorld[1], rec.labelOffsetWorld[2])
            : null;
          existing.setParams({
            start, end, offset: rec.offset, labelT: rec.labelT ?? 0.5,
            labelOffsetWorld: low, isReference: rec.isReference ?? false,
            direction, text,
          });
        } else if (rec.kind === 'angle' && existing instanceof AngleDimension3D) {
          const origin = new THREE.Vector3(...rec.origin.worldPos);
          const corner = new THREE.Vector3(...rec.corner.worldPos);
          const target = new THREE.Vector3(...rec.target.worldPos);
          const low = rec.labelOffsetWorld
            ? new THREE.Vector3(rec.labelOffsetWorld[0], rec.labelOffsetWorld[1], rec.labelOffsetWorld[2])
            : null;
          existing.setParams({
            vertex: corner, point1: origin, point2: target,
            arcRadius: Math.max(0.3, Math.min(10, rec.offset || 0.8)),
            labelT: rec.labelT ?? 0.5,
            labelOffsetWorld: low, isReference: rec.isReference ?? false,
            supplementary: rec.supplementary ?? false,
          });
          const deg = existing.getAngleDegrees();
          const text = rec.textOverride ?? formatAngleDegrees(deg, this.precision);
          existing.setParams({ text });
        }
        continue;
      }

      if (rec.kind === 'linear_distance') {
        createLinearDimension(this.annotationSystem, rec, this.unit, this.precision);
      } else if (rec.kind === 'angle') {
        createAngleDimension(this.annotationSystem, rec, this.precision);
      }
      if (this.bgColor != null) {
        const created = this.annotationSystem.getAnnotation(id);
        created?.setBackgroundColor(this.bgColor);
      }
    }

    for (const id of this.currentIds) {
      if (!newIds.has(id)) {
        this.annotationSystem.removeAnnotation(id);
      }
    }
    this.currentIds = newIds;
  }

  clear(): void {
    for (const id of this.currentIds) {
      this.annotationSystem.removeAnnotation(id);
    }
    this.currentIds.clear();
  }

  highlight(dimensionId: string | null): void {
    const id = dimensionId ? DIMENSION_PREFIX + dimensionId : null;
    this.annotationSystem.highlightAnnotation(id);
  }

  select(dimensionId: string | null): void {
    const id = dimensionId ? DIMENSION_PREFIX + dimensionId : null;
    this.annotationSystem.selectAnnotation(id);
  }
}

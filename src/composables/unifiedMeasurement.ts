/**
 * 统一测量记录类型 — 测量体系统一 Phase B 的基础设施。
 *
 * `UnifiedMeasurementRecord` 现在是内存写入与 V7 持久化的唯一真相。
 * classic / xeokit 记录只作为兼容读写投影存在；新来源证据通过
 * `ComputationProvenance` 无损往返，缺少证据的旧记录保守升级为
 * `legacy-unknown`，不得由旧 `approximate=false` 反推成精确结果。
 *
 * 本模块提供：
 *   1) 统一类型定义 `UnifiedMeasurementRecord`
 *   2) 正反向适配器（classic ↔ unified、xeokit ↔ unified）
 *   3) 旧记录 provenance 升级与 V7 runtime guard
 *   4) 兼容期 flag helper（`isUnifiedMeasurementStoreEnabled()`）
 *
 * 参见 `docs/plans/2026-04-23-measurement-unification-plan.md` §4 Phase B。
 *
 * 四种测量类型全部覆盖。转换一律走 `switch (rec.kind)` 且以 `assertNever` 收尾：
 * 再加第五种 kind 时这里编译不过，作者必须显式处理，而不是让它悄悄掉进某个
 * 兜底分支里被转成别的类型（本模块早期就是这么把高程测量转成残缺角度记录的）。
 */

import type {
  AngleMeasurementRecord,
  DistanceMeasurementRecord,
  ElevationDeltaMeasurementRecord,
  ElevationPointMeasurementRecord,
  MeasurementRecord,
  MeasurementSourceLink,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
  XeokitElevationDeltaMeasurementRecord,
  XeokitElevationPointMeasurementRecord,
  XeokitMeasurementRecord,
  LineAngleMeasurementInfo,
  MeasurementPoint,
  PerpendicularMeasurementInfo,
  ShortestMeasurementInfo,
} from '@/composables/useToolStore';

import {
  createComputationProvenance,
  isComputationProvenance,
  toLegacyApproximate,
  type ComputationProvenance,
} from '@/measurement/domain/computationProvenance';

export type MeasurementSource = 'classic' | 'xeokit' | 'replay';

export type UnifiedMeasurementKind =
  | 'distance'
  | 'angle'
  | 'elevation_point'
  | 'elevation_delta';

type UnifiedMeasurementBase = {
  id: string;
  visible: boolean;
  createdAt: number;
  approximate: boolean;
  source: MeasurementSource;
  provenance: ComputationProvenance;
} & MeasurementSourceLink;

export type UnifiedDistanceMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  /** E3D Perpendicular to 结果标记（target 为垂足）；普通距离没有此字段。 */
  perpendicular?: PerpendicularMeasurementInfo;
  /** Web 增强「最短距离」结果标记（origin / target 为两个 witness，d-619）；普通距离没有此字段。 */
  shortest?: ShortestMeasurementInfo;
};

export type UnifiedAngleMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  /** E3D Angle 2 Lines 结果标记（两条臂来自拾中的线 / 面）；三点角没有此字段。 */
  lineAngle?: LineAngleMeasurementInfo;
};

export type UnifiedElevationPointMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'elevation_point';
  point: MeasurementPoint;
  absoluteElevation: number;
  datumElevation: number;
  relativeElevation: number;
};

export type UnifiedElevationDeltaMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'elevation_delta';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  datumElevation: number;
};

export type UnifiedMeasurementRecord =
  | UnifiedDistanceMeasurementRecord
  | UnifiedAngleMeasurementRecord
  | UnifiedElevationPointMeasurementRecord
  | UnifiedElevationDeltaMeasurementRecord;

function assertNever(value: never): never {
  const kind = (value as { kind?: unknown } | null)?.kind;
  throw new Error(`未处理的测量类型: ${String(kind)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMeasurementPoint(value: unknown): value is MeasurementPoint {
  if (!isRecord(value) || typeof value.entityId !== 'string' || !value.entityId.trim()) {
    return false;
  }
  if (!isFinitePointTuple(value.worldPos)) return false;
  return value.designWorldPos === undefined || isFinitePointTuple(value.designWorldPos);
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return hasFiniteNumber(value) ? value : fallback;
}

export function isUnifiedMeasurementRecord(
  value: unknown,
): value is UnifiedMeasurementRecord {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.visible !== 'boolean'
    || !hasFiniteNumber(value.createdAt)
    || typeof value.approximate !== 'boolean'
    || (
      value.source !== 'classic'
      && value.source !== 'xeokit'
      && value.source !== 'replay'
    )
    || !isComputationProvenance(value.provenance)
  ) {
    return false;
  }

  switch (value.kind) {
    case 'distance':
      return isMeasurementPoint(value.origin) && isMeasurementPoint(value.target);
    case 'angle':
      return isMeasurementPoint(value.origin)
        && isMeasurementPoint(value.corner)
        && isMeasurementPoint(value.target);
    case 'elevation_point':
      return isMeasurementPoint(value.point)
        && hasFiniteNumber(value.absoluteElevation)
        && hasFiniteNumber(value.datumElevation)
        && hasFiniteNumber(value.relativeElevation);
    case 'elevation_delta':
      return isMeasurementPoint(value.origin)
        && isMeasurementPoint(value.target)
        && hasFiniteNumber(value.originElevation)
        && hasFiniteNumber(value.targetElevation)
        && hasFiniteNumber(value.deltaElevation)
        && hasFiniteNumber(value.datumElevation);
    default:
      return false;
  }
}

export function normalizeUnifiedMeasurementRecord(
  record: UnifiedMeasurementRecord,
): UnifiedMeasurementRecord {
  return {
    ...record,
    id: record.id.trim(),
    approximate: toLegacyApproximate(record.provenance.accuracyClass),
  };
}

function sourceLinkOf(
  rec: MeasurementRecord | XeokitMeasurementRecord,
): MeasurementSourceLink {
  return {
    sourceAnnotationId: rec.sourceAnnotationId,
    sourceAnnotationType: rec.sourceAnnotationType,
    formId: rec.formId,
    taskId: rec.taskId,
  };
}

function isFinitePointTuple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function measurementPoints(
  rec: MeasurementRecord | XeokitMeasurementRecord,
): readonly MeasurementPoint[] {
  switch (rec.kind) {
    case 'distance':
    case 'elevation_delta':
      return [rec.origin, rec.target];
    case 'angle':
      return [rec.origin, rec.corner, rec.target];
    case 'elevation_point':
      return [rec.point];
    default:
      return assertNever(rec);
  }
}

function operandFromPoint(point: MeasurementPoint) {
  const refno = point.sourceInfo?.refno?.trim() || undefined;
  const candidateId = point.sourceInfo?.candidateId?.trim() || undefined;
  return {
    entityId: point.entityId,
    ...(refno ? { refno } : {}),
    ...(candidateId ? { candidateId } : {}),
  };
}

export function createLegacyMeasurementProvenance(
  rec: MeasurementRecord | XeokitMeasurementRecord,
): ComputationProvenance {
  const points = measurementPoints(rec);
  const sourcePoint = points[0]!;
  const targetPoint = points[points.length - 1]!;
  const hasDesignCoordinates = points.every(
    point => isFinitePointTuple(point.designWorldPos),
  );
  return createComputationProvenance({
    method: 'legacy-unknown',
    accuracyClass: 'legacy-unknown',
    coordinateSpace: hasDesignCoordinates ? 'design-world' : 'scene-world',
    sourceModelVersion: null,
    source: operandFromPoint(sourcePoint),
    target: operandFromPoint(targetPoint),
    warnings: [{
      code: 'LEGACY_PROVENANCE_UNKNOWN',
      message: 'Legacy measurement did not record its computation method or accuracy.',
    }],
  });
}

function provenanceOf(
  rec: MeasurementRecord | XeokitMeasurementRecord,
): ComputationProvenance {
  return isComputationProvenance(rec.provenance)
    ? rec.provenance
    : createLegacyMeasurementProvenance(rec);
}

/**
 * Classic 测量 → 统一记录。classic 没有可信的旧精度字段；缺少 provenance
 * 时必须按 `legacy-unknown` 处理。
 */
export function fromClassicMeasurement(rec: MeasurementRecord): UnifiedMeasurementRecord {
  const provenance = provenanceOf(rec);
  const base = {
    id: rec.id,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: toLegacyApproximate(provenance.accuracyClass),
    source: 'classic' as const,
    provenance,
    ...sourceLinkOf(rec),
  };

  switch (rec.kind) {
    case 'distance':
      return { ...base, kind: 'distance', origin: rec.origin, target: rec.target };
    case 'angle':
      return {
        ...base,
        kind: 'angle',
        origin: rec.origin,
        corner: rec.corner,
        target: rec.target,
      };
    case 'elevation_point':
    {
      const absoluteElevation = finiteOr(rec.absoluteElevation, 0);
      const datumElevation = finiteOr(rec.datumElevation, 0);
      const relativeElevation = finiteOr(
        rec.relativeElevation,
        absoluteElevation - datumElevation,
      );
      return {
        ...base,
        kind: 'elevation_point',
        point: rec.point,
        absoluteElevation,
        datumElevation,
        relativeElevation,
      };
    }
    case 'elevation_delta':
    {
      const originElevation = finiteOr(rec.originElevation, 0);
      const targetElevation = finiteOr(rec.targetElevation, originElevation);
      return {
        ...base,
        kind: 'elevation_delta',
        origin: rec.origin,
        target: rec.target,
        originElevation,
        targetElevation,
        deltaElevation: finiteOr(
          rec.deltaElevation,
          targetElevation - originElevation,
        ),
        datumElevation: finiteOr(rec.datumElevation, 0),
      };
    }
    default:
      return assertNever(rec);
  }
}

/**
 * Xeokit 测量 → 统一记录。`source='xeokit'`，保留 `approximate`。
 */
export function fromXeokitMeasurement(rec: XeokitMeasurementRecord): UnifiedMeasurementRecord {
  const provenance = provenanceOf(rec);
  const base = {
    id: rec.id,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: toLegacyApproximate(provenance.accuracyClass),
    source: 'xeokit' as const,
    provenance,
    ...sourceLinkOf(rec),
  };

  switch (rec.kind) {
    case 'distance':
      return {
        ...base,
        kind: 'distance',
        origin: rec.origin,
        target: rec.target,
        ...(rec.perpendicular ? { perpendicular: rec.perpendicular } : {}),
        ...(rec.shortest ? { shortest: rec.shortest } : {}),
      };
    case 'angle':
      return {
        ...base,
        kind: 'angle',
        origin: rec.origin,
        corner: rec.corner,
        target: rec.target,
        ...(rec.lineAngle ? { lineAngle: rec.lineAngle } : {}),
      };
    case 'elevation_point':
    {
      const absoluteElevation = finiteOr(rec.absoluteElevation, 0);
      const datumElevation = finiteOr(rec.datumElevation, 0);
      return {
        ...base,
        kind: 'elevation_point',
        point: rec.point,
        absoluteElevation,
        datumElevation,
        relativeElevation: finiteOr(
          rec.relativeElevation,
          absoluteElevation - datumElevation,
        ),
      };
    }
    case 'elevation_delta':
    {
      const originElevation = finiteOr(rec.originElevation, 0);
      const targetElevation = finiteOr(rec.targetElevation, originElevation);
      return {
        ...base,
        kind: 'elevation_delta',
        origin: rec.origin,
        target: rec.target,
        originElevation,
        targetElevation,
        deltaElevation: finiteOr(
          rec.deltaElevation,
          targetElevation - originElevation,
        ),
        datumElevation: finiteOr(rec.datumElevation, 0),
      };
    }
    default:
      return assertNever(rec);
  }
}

/**
 * 统一记录 → Classic。会丢弃 `approximate` / `source` 字段。
 * 用于与旧代码 / 导出路径兼容。
 */
export function toClassicMeasurement(u: UnifiedMeasurementRecord): MeasurementRecord {
  const base = {
    id: u.id,
    visible: u.visible,
    createdAt: u.createdAt,
    sourceAnnotationId: u.sourceAnnotationId,
    sourceAnnotationType: u.sourceAnnotationType,
    formId: u.formId,
    taskId: u.taskId,
    provenance: u.provenance,
  };

  switch (u.kind) {
    case 'distance': {
      const result: DistanceMeasurementRecord = {
        ...base,
        kind: 'distance',
        origin: u.origin,
        target: u.target,
      };
      return result;
    }
    case 'angle': {
      const result: AngleMeasurementRecord = {
        ...base,
        kind: 'angle',
        origin: u.origin,
        corner: u.corner,
        target: u.target,
      };
      return result;
    }
    case 'elevation_point': {
      const result: ElevationPointMeasurementRecord = {
        ...base,
        kind: 'elevation_point',
        point: u.point,
        absoluteElevation: u.absoluteElevation,
        datumElevation: u.datumElevation,
        relativeElevation: u.relativeElevation,
      };
      return result;
    }
    case 'elevation_delta': {
      const result: ElevationDeltaMeasurementRecord = {
        ...base,
        kind: 'elevation_delta',
        origin: u.origin,
        target: u.target,
        originElevation: u.originElevation,
        targetElevation: u.targetElevation,
        deltaElevation: u.deltaElevation,
        datumElevation: u.datumElevation,
      };
      return result;
    }
    default:
      return assertNever(u);
  }
}

/**
 * 统一记录 → Xeokit。保留 `approximate`。
 * `source` 信息会丢失，但 Xeokit 侧不关心来源。
 */
export function toXeokitMeasurement(u: UnifiedMeasurementRecord): XeokitMeasurementRecord {
  const base = {
    id: u.id,
    visible: u.visible,
    approximate: toLegacyApproximate(u.provenance.accuracyClass),
    createdAt: u.createdAt,
    sourceAnnotationId: u.sourceAnnotationId,
    sourceAnnotationType: u.sourceAnnotationType,
    formId: u.formId,
    taskId: u.taskId,
    provenance: u.provenance,
  };

  switch (u.kind) {
    case 'distance': {
      const result: XeokitDistanceMeasurementRecord = {
        ...base,
        kind: 'distance',
        origin: u.origin,
        target: u.target,
        ...(u.perpendicular ? { perpendicular: u.perpendicular } : {}),
        ...(u.shortest ? { shortest: u.shortest } : {}),
      };
      return result;
    }
    case 'angle': {
      const result: XeokitAngleMeasurementRecord = {
        ...base,
        kind: 'angle',
        origin: u.origin,
        corner: u.corner,
        target: u.target,
        ...(u.lineAngle ? { lineAngle: u.lineAngle } : {}),
      };
      return result;
    }
    case 'elevation_point': {
      const result: XeokitElevationPointMeasurementRecord = {
        ...base,
        kind: 'elevation_point',
        point: u.point,
        absoluteElevation: u.absoluteElevation,
        datumElevation: u.datumElevation,
        relativeElevation: u.relativeElevation,
      };
      return result;
    }
    case 'elevation_delta': {
      const result: XeokitElevationDeltaMeasurementRecord = {
        ...base,
        kind: 'elevation_delta',
        origin: u.origin,
        target: u.target,
        originElevation: u.originElevation,
        targetElevation: u.targetElevation,
        deltaElevation: u.deltaElevation,
        datumElevation: u.datumElevation,
      };
      return result;
    }
    default:
      return assertNever(u);
  }
}

/**
 * 读取测量统一 store 的 flag 状态。
 *
 * 默认关闭。可通过以下方式启用（按优先级）：
 *   1. `localStorage['measurement.unified_store']='1'`
 *   2. `import.meta.env.VITE_MEASUREMENT_UNIFIED_STORE='1'`
 *
 * Phase B 当前仅用于观测性开关，**运行时行为不依赖此 flag**（computed 聚合始终返回正确值）。
 * Phase B2–E 逐步切换写入路径时会消费此 flag。
 */
const UNIFIED_STORE_LOCAL_KEY = 'measurement.unified_store';
const UNIFIED_STORE_ENV_KEY = 'VITE_MEASUREMENT_UNIFIED_STORE';

function safeReadLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseBoolLike(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  const v = value.toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

export function isUnifiedMeasurementStoreEnabled(): boolean {
  const override = parseBoolLike(safeReadLocalStorage(UNIFIED_STORE_LOCAL_KEY));
  if (override !== null) return override;

  try {
    const metaEnv = (import.meta as ImportMeta).env as Record<string, string | undefined> | undefined;
    if (metaEnv && metaEnv[UNIFIED_STORE_ENV_KEY] !== undefined) {
      return parseBoolLike(metaEnv[UNIFIED_STORE_ENV_KEY]) ?? false;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * 合并 store 里全部测量为统一数组：classic + 四路 xeokit。
 * 调用方可直接用于 computed 聚合。
 *
 * 四个 xeokit 参数都是必填：`useToolStore` 每加一路 xeokit ref 就必须在这里显式
 * 接上，漏接会编译不过。此前高程两路就是因为参数可省而被静默漏掉的。
 */
export function combineMeasurements(
  classic: readonly MeasurementRecord[],
  xeokitDistance: readonly XeokitDistanceMeasurementRecord[],
  xeokitAngle: readonly XeokitAngleMeasurementRecord[],
  xeokitElevationPoint: readonly XeokitElevationPointMeasurementRecord[],
  xeokitElevationDelta: readonly XeokitElevationDeltaMeasurementRecord[],
): UnifiedMeasurementRecord[] {
  const out: UnifiedMeasurementRecord[] = [];
  for (const rec of classic) out.push(fromClassicMeasurement(rec));
  for (const rec of xeokitDistance) out.push(fromXeokitMeasurement(rec));
  for (const rec of xeokitAngle) out.push(fromXeokitMeasurement(rec));
  for (const rec of xeokitElevationPoint) out.push(fromXeokitMeasurement(rec));
  for (const rec of xeokitElevationDelta) out.push(fromXeokitMeasurement(rec));
  return out;
}

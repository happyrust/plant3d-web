/**
 * 统一测量记录类型 — 测量体系统一 Phase B 的基础设施。
 *
 * 目标：合并 `MeasurementRecord`（classic）/ `XeokitMeasurementRecord`（xeokit）
 * 两套存储到单一类型，为后续 Phase B2–E 的 store 合并铺路。
 *
 * 本模块当前仅提供：
 *   1) 统一类型定义 `UnifiedMeasurementRecord`
 *   2) 正反向适配器（classic ↔ unified、xeokit ↔ unified）
 *   3) flag helper（`isUnifiedMeasurementStoreEnabled()`）
 *
 * 不做：
 *   - 运行时 UI 行为改变
 *   - 重新定义持久化格式
 *   - 修改 add/update/remove 写入路径
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
  MeasurementPoint,
} from '@/composables/useToolStore';

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
} & MeasurementSourceLink;

export type UnifiedDistanceMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
};

export type UnifiedAngleMeasurementRecord = UnifiedMeasurementBase & {
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
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

/**
 * Classic 测量 → 统一记录。`approximate` 恒为 `false`（classic 侧不带该字段），
 * `source='classic'`。
 */
export function fromClassicMeasurement(rec: MeasurementRecord): UnifiedMeasurementRecord {
  const base = {
    id: rec.id,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: false,
    source: 'classic' as const,
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
      return {
        ...base,
        kind: 'elevation_point',
        point: rec.point,
        absoluteElevation: rec.absoluteElevation,
        datumElevation: rec.datumElevation,
        relativeElevation: rec.relativeElevation,
      };
    case 'elevation_delta':
      return {
        ...base,
        kind: 'elevation_delta',
        origin: rec.origin,
        target: rec.target,
        originElevation: rec.originElevation,
        targetElevation: rec.targetElevation,
        deltaElevation: rec.deltaElevation,
        datumElevation: rec.datumElevation,
      };
    default:
      return assertNever(rec);
  }
}

/**
 * Xeokit 测量 → 统一记录。`source='xeokit'`，保留 `approximate`。
 */
export function fromXeokitMeasurement(rec: XeokitMeasurementRecord): UnifiedMeasurementRecord {
  const base = {
    id: rec.id,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: rec.approximate,
    source: 'xeokit' as const,
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
      return {
        ...base,
        kind: 'elevation_point',
        point: rec.point,
        absoluteElevation: rec.absoluteElevation,
        datumElevation: rec.datumElevation,
        relativeElevation: rec.relativeElevation,
      };
    case 'elevation_delta':
      return {
        ...base,
        kind: 'elevation_delta',
        origin: rec.origin,
        target: rec.target,
        originElevation: rec.originElevation,
        targetElevation: rec.targetElevation,
        deltaElevation: rec.deltaElevation,
        datumElevation: rec.datumElevation,
      };
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
    approximate: u.approximate,
    createdAt: u.createdAt,
    sourceAnnotationId: u.sourceAnnotationId,
    sourceAnnotationType: u.sourceAnnotationType,
    formId: u.formId,
    taskId: u.taskId,
  };

  switch (u.kind) {
    case 'distance': {
      const result: XeokitDistanceMeasurementRecord = {
        ...base,
        kind: 'distance',
        origin: u.origin,
        target: u.target,
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

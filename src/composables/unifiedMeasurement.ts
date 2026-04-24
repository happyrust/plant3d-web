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
 */

import type {
  AngleMeasurementRecord,
  DistanceMeasurementRecord,
  MeasurementRecord,
  MeasurementSourceLink,
  XeokitAngleMeasurementRecord,
  XeokitDistanceMeasurementRecord,
  XeokitMeasurementRecord,
  MeasurementPoint,
} from '@/composables/useToolStore';

export type MeasurementSource = 'classic' | 'xeokit' | 'replay';

export type UnifiedDistanceMeasurementRecord = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
  approximate: boolean;
  source: MeasurementSource;
} & MeasurementSourceLink;

export type UnifiedAngleMeasurementRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
  approximate: boolean;
  source: MeasurementSource;
} & MeasurementSourceLink;

export type UnifiedMeasurementRecord =
  | UnifiedDistanceMeasurementRecord
  | UnifiedAngleMeasurementRecord;

/**
 * Classic 测量 → 统一记录。`approximate` 默认 `false`，`source='classic'`。
 */
export function fromClassicMeasurement(rec: MeasurementRecord): UnifiedMeasurementRecord {
  const base: MeasurementSourceLink = {
    sourceAnnotationId: rec.sourceAnnotationId,
    sourceAnnotationType: rec.sourceAnnotationType,
    formId: rec.formId,
  };

  if (rec.kind === 'distance') {
    return {
      id: rec.id,
      kind: 'distance',
      origin: rec.origin,
      target: rec.target,
      visible: rec.visible,
      createdAt: rec.createdAt,
      approximate: false,
      source: 'classic',
      ...base,
    };
  }

  return {
    id: rec.id,
    kind: 'angle',
    origin: rec.origin,
    corner: rec.corner,
    target: rec.target,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: false,
    source: 'classic',
    ...base,
  };
}

/**
 * Xeokit 测量 → 统一记录。`source='xeokit'`，保留 `approximate`。
 */
export function fromXeokitMeasurement(rec: XeokitMeasurementRecord): UnifiedMeasurementRecord {
  const base: MeasurementSourceLink = {
    sourceAnnotationId: rec.sourceAnnotationId,
    sourceAnnotationType: rec.sourceAnnotationType,
    formId: rec.formId,
  };

  if (rec.kind === 'distance') {
    return {
      id: rec.id,
      kind: 'distance',
      origin: rec.origin,
      target: rec.target,
      visible: rec.visible,
      createdAt: rec.createdAt,
      approximate: rec.approximate,
      source: 'xeokit',
      ...base,
    };
  }

  return {
    id: rec.id,
    kind: 'angle',
    origin: rec.origin,
    corner: rec.corner,
    target: rec.target,
    visible: rec.visible,
    createdAt: rec.createdAt,
    approximate: rec.approximate,
    source: 'xeokit',
    ...base,
  };
}

/**
 * 统一记录 → Classic。会丢弃 `approximate` / `source` 字段。
 * 用于与旧代码 / 导出路径兼容。
 */
export function toClassicMeasurement(u: UnifiedMeasurementRecord): MeasurementRecord {
  const base: MeasurementSourceLink = {
    sourceAnnotationId: u.sourceAnnotationId,
    sourceAnnotationType: u.sourceAnnotationType,
    formId: u.formId,
  };

  if (u.kind === 'distance') {
    const result: DistanceMeasurementRecord = {
      id: u.id,
      kind: 'distance',
      origin: u.origin,
      target: u.target,
      visible: u.visible,
      createdAt: u.createdAt,
      ...base,
    };
    return result;
  }

  const result: AngleMeasurementRecord = {
    id: u.id,
    kind: 'angle',
    origin: u.origin,
    corner: u.corner,
    target: u.target,
    visible: u.visible,
    createdAt: u.createdAt,
    ...base,
  };
  return result;
}

/**
 * 统一记录 → Xeokit。保留 `approximate`。
 * `source` 信息会丢失，但 Xeokit 侧不关心来源。
 */
export function toXeokitMeasurement(u: UnifiedMeasurementRecord): XeokitMeasurementRecord {
  const base: MeasurementSourceLink = {
    sourceAnnotationId: u.sourceAnnotationId,
    sourceAnnotationType: u.sourceAnnotationType,
    formId: u.formId,
  };

  if (u.kind === 'distance') {
    const result: XeokitDistanceMeasurementRecord = {
      id: u.id,
      kind: 'distance',
      origin: u.origin,
      target: u.target,
      visible: u.visible,
      approximate: u.approximate,
      createdAt: u.createdAt,
      ...base,
    };
    return result;
  }

  const result: XeokitAngleMeasurementRecord = {
    id: u.id,
    kind: 'angle',
    origin: u.origin,
    corner: u.corner,
    target: u.target,
    visible: u.visible,
    approximate: u.approximate,
    createdAt: u.createdAt,
    ...base,
  };
  return result;
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
 * 合并三路测量为统一数组：classic + xeokit distance + xeokit angle。
 * 调用方可直接用于 computed 聚合。
 */
export function combineMeasurements(
  classic: readonly MeasurementRecord[],
  xeokitDistance: readonly XeokitDistanceMeasurementRecord[],
  xeokitAngle: readonly XeokitAngleMeasurementRecord[],
): UnifiedMeasurementRecord[] {
  const out: UnifiedMeasurementRecord[] = [];
  for (const rec of classic) out.push(fromClassicMeasurement(rec));
  for (const rec of xeokitDistance) out.push(fromXeokitMeasurement(rec));
  for (const rec of xeokitAngle) out.push(fromXeokitMeasurement(rec));
  return out;
}

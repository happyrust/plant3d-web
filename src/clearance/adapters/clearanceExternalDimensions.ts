
import type { ClearanceFaceKind, ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { ExternalDimensionMappingResult, ExternalDimensionRecord, Vec3 } from '@/dimension';

import { toLegacyApproximate } from '@/measurement/domain/computationProvenance';

/**
 * ClearanceRecord → 只读 external 线性尺寸（09-11 PR1.1 第 4 条：外部尺寸源只负责画，不拥有记录）。
 * 记录里的点已是 design-world 米（service 边界转过一次，D3），这里不再换算。
 *
 * 文字口径（D2「近似不得以精确呈现」）：`exact-surface` 直接给 `312mm`；万一进来近似档带 `≈`；
 * 相交给 `相交`；`stale` 前缀「（过期）」；命中的是墙主面且垂距在，尾巴加 `⊥`——这条最近线就是垂直于墙面的那条。
 */

export const CLEARANCE_EXTERNAL_SOURCE = 'clearance' as const;

const FACE_LABEL: Readonly<Record<ClearanceFaceKind, string>> = Object.freeze({
  inner: '墙面内侧',
  outer: '墙面外侧',
  side: '墙面',
  top: '墙顶',
  bottom: '墙底',
  end: '墙端',
  unknown: '',
});

export function clearanceFaceLabel(kind: ClearanceFaceKind | null | undefined): string {
  return kind ? FACE_LABEL[kind] : '';
}

function formatMillimetres(distanceM: number): string {
  const mm = distanceM * 1000;
  // 亚毫米有意义（弦高 0.5 mm）：不足 10 mm 保留一位小数，其余取整。
  return mm < 10 ? `${mm.toFixed(1)}mm` : `${Math.round(mm)}mm`;
}

/** 尺寸文字：`（过期）` 前缀 + `≈`（近似档）+ 距离 + `⊥`（垂距成立）；相交时是 `相交`。 */
export function clearanceDimensionText(record: ClearanceRecord): string {
  const snapshot = record.snapshot;
  if (!snapshot) return '';
  const stale = record.status === 'stale' ? '（过期）' : '';
  if (snapshot.intersects) return `${stale}相交`;
  const approximate = toLegacyApproximate(record.provenance.accuracyClass) ? '≈' : '';
  const perpendicular = snapshot.perpendicular ? ' ⊥' : '';
  return `${stale}${approximate}${formatMillimetres(snapshot.distanceM)}${perpendicular}`;
}

/** 来源标签：`外表面净距: 24384_22582 → 17496_105912（墙面外侧）`。 */
export function clearanceSourceLabel(record: ClearanceRecord): string {
  const face = clearanceFaceLabel(record.snapshot?.targetFace?.kind);
  const method = record.provenance.method === 'surface-to-surface' ? '外表面净距' : '净距';
  return `${method}: ${record.inputs.sourceRefno} → ${record.inputs.targetRefno}${face ? `（${face}）` : ''}`;
}

export type ClearanceExternalDimensionOptions = Readonly<{
  /** 尺寸线离两点连线的偏移（米），缺省 0.5 */
  offsetM?: number;
}>;

/**
 * 只画有快照的记录；`failed` 但留着旧快照的也画（文字照记录状态来）。
 * 相交（两点重合、`witness = aabb-overlap-center`）没有可画的线，进 `skipped`，由列表 UI 用文字表达。
 */
export function clearanceRecordsToExternalDimensions(
  records: readonly ClearanceRecord[],
  options: ClearanceExternalDimensionOptions = {},
): ExternalDimensionMappingResult {
  const out: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const offsetM = options.offsetM ?? 0.5;
  for (const record of records) {
    const id = `${CLEARANCE_EXTERNAL_SOURCE}:${record.id}`;
    const snapshot = record.snapshot;
    if (!snapshot) {
      skipped.push({ id, reason: 'No snapshot (beyond max distance or never computed)' });
      continue;
    }
    if (snapshot.intersects) {
      skipped.push({ id, reason: 'Intersecting objects have no dimension line' });
      continue;
    }
    const a: Vec3 = snapshot.sourcePoint;
    const b: Vec3 = snapshot.targetPoint;
    out.push({
      id,
      source: CLEARANCE_EXTERNAL_SOURCE,
      sourceLabel: clearanceSourceLabel(record),
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: clearanceDimensionText(record),
        a,
        b,
        placement: { offsetM, labelT: 0.5, side: 1 },
      },
    });
  }
  return { records: out, skipped };
}

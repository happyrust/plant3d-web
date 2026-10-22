
import type { ClearanceFaceKind, ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { ExternalDimensionMappingResult, ExternalDimensionRecord, Vec3 } from '@/dimension';

import { pipeRowPairKey } from '@/clearance/adapters/pipeRowRecords';
import { pipeRowGapEstimated } from '@/clearance/domain/pipeRowTypes';
import { computationMethodLabel } from '@/composables/measurementMethodLabel';
import { toLegacyApproximate } from '@/measurement/domain/computationProvenance';

/**
 * ClearanceRecord → 只读 external 线性尺寸（09-11 PR1.1 第 4 条：外部尺寸源只负责画，不拥有记录）。
 * 记录里的点已是 design-world 米（service 边界转过一次，D3），这里不再换算。
 *
 * 文字口径（D2「近似不得以精确呈现」）：`exact-surface` 直接给 `312mm`；万一进来近似档带 `≈`；
 * 相交给 `相交`；`stale` 前缀「（过期）」；命中的是墙主面（含洞壁 `opening`）且垂距在，尾巴加 `⊥`——这条最近线就是
 * 垂直于那面的那条。
 */

export const CLEARANCE_EXTERNAL_SOURCE = 'clearance' as const;

const FACE_LABEL: Readonly<Record<ClearanceFaceKind, string>> = Object.freeze({
  inner: '墙面内侧',
  outer: '墙面外侧',
  side: '墙面',
  opening: '洞口',
  top: '墙顶',
  bottom: '墙底',
  end: '墙端',
  unknown: '',
});

/** 非墙族目标（`any` 口径的柱 / 楼板等）的中性措辞——柱子的底面不是「墙底」。 */
const FACE_LABEL_GENERIC: Readonly<Record<ClearanceFaceKind, string>> = Object.freeze({
  inner: '内侧',
  outer: '外侧',
  side: '表面',
  opening: '洞口',
  top: '顶部',
  bottom: '底部',
  end: '端部',
  unknown: '',
});

/** 与 gen-model `surface_clearance::WALL_NOUNS` 逐字相同；拾取过滤与措辞判定共用这一份。 */
export const CLEARANCE_WALL_NOUNS: readonly string[] = Object.freeze(['CWALL', 'WALL', 'STWALL', 'GWALL', 'PANE']);

export function isWallClearanceNoun(noun: string | null | undefined): boolean {
  return !!noun && CLEARANCE_WALL_NOUNS.includes(noun.trim().toUpperCase());
}

export function clearanceFaceLabel(kind: ClearanceFaceKind | null | undefined, targetNoun?: string): string {
  if (!kind) return '';
  return (targetNoun !== undefined && !isWallClearanceNoun(targetNoun) ? FACE_LABEL_GENERIC : FACE_LABEL)[kind];
}

function formatMillimetres(distanceM: number): string {
  const mm = distanceM * 1000;
  // 亚毫米有意义（弦高 0.5 mm）：不足 10 mm 保留一位小数，其余取整。
  return mm < 10 ? `${mm.toFixed(1)}mm` : `${Math.round(mm)}mm`;
}

/** 尺寸文字：`（过期）` 前缀 + `≈`（近似档；连排推导间隔只在外径为估算时带）+ 距离 + `⊥`（垂距成立）；相交时是 `相交`。
 *  连排记录带度量前缀——「中心距 312mm」与「名义间隔 50mm」是同一条连线上的两种口径，
 *  推导间隔是平行圆柱模型的名义值，不是网格精算净距，文字必须自带口径。 */
export function clearanceDimensionText(record: ClearanceRecord): string {
  const snapshot = record.snapshot;
  if (!snapshot) return '';
  const stale = record.status === 'stale' ? '（过期）' : record.status === 'failed' ? '（重算失败，旧值）' : '';
  if (snapshot.intersects) return `${stale}相交`;
  // 推导间隔的「推导」由口径前缀与方法标签表达；`≈` 只留给外径本身是估算的情形（plan §4.2）。
  const approximate = (record.pipeRow?.metric === 'derived-gap'
    ? pipeRowGapEstimated(record.pipeRow)
    : toLegacyApproximate(record.provenance.accuracyClass)) ? '≈' : '';
  const rowMetric = record.pipeRow ? (record.pipeRow.metric === 'center-distance' ? '中心距 ' : '名义间隔 ') : '';
  const perpendicular = snapshot.perpendicular ? ' ⊥' : '';
  return `${stale}${approximate}${rowMetric}${formatMillimetres(snapshot.distanceM)}${perpendicular}`;
}

/** 来源标签：`外表面净距: 24384_22582 → 17496_105912（墙面外侧）`。方法按记录 provenance 说真话。 */
export function clearanceSourceLabel(record: ClearanceRecord): string {
  const face = clearanceFaceLabel(record.snapshot?.targetFace?.kind, record.targetNoun);
  const method = computationMethodLabel(record.provenance.method);
  return `${method}: ${record.inputs.sourceRefno} → ${record.inputs.targetRefno}${face ? `（${face}）` : ''}`;
}

export type ClearanceExternalDimensionOptions = Readonly<{
  /** 尺寸线离两点连线的偏移（米），缺省 0.5 */
  offsetM?: number;
  /**
   * 连排同一对的中心距与推导间隔都画。缺省只画一条：推导间隔画得出就画它（中心距写进它的来源说明），
   * 名义接触 / 重叠 / 缺外径（推导间隔没有快照）或它被隐藏时画中心距。
   */
  pipeRowBothMetrics?: boolean;
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
  const gapDrawnPairs = new Set<string>();
  const centerByPair = new Map<string, ClearanceRecord>();
  if (!options.pipeRowBothMetrics) {
    for (const record of records) {
      const pairKey = pipeRowPairKey(record);
      if (!pairKey) continue;
      if (record.pipeRow!.metric === 'center-distance') centerByPair.set(pairKey, record);
      else if (record.snapshot && !record.snapshot.intersects) gapDrawnPairs.add(pairKey);
    }
  }
  for (const record of records) {
    const id = `${CLEARANCE_EXTERNAL_SOURCE}:${record.id}`;
    const snapshot = record.snapshot;
    const pairKey = pipeRowPairKey(record);
    if (pairKey && record.pipeRow!.metric === 'center-distance' && gapDrawnPairs.has(pairKey)) {
      skipped.push({ id, reason: 'Pipe-row pair is drawn as its nominal gap' });
      continue;
    }
    if (!snapshot) {
      skipped.push({
        id,
        reason: record.pipeRow?.metric === 'derived-gap'
          ? 'Derived nominal gap not drawable (missing OD evidence or nominal overlap)'
          : 'No snapshot (beyond max distance or never computed)',
      });
      continue;
    }
    if (snapshot.intersects) {
      skipped.push({ id, reason: 'Intersecting objects have no dimension line' });
      continue;
    }
    const a: Vec3 = snapshot.sourcePoint;
    const b: Vec3 = snapshot.targetPoint;
    const foldedCenter = pairKey && record.pipeRow!.metric === 'derived-gap' ? centerByPair.get(pairKey)?.snapshot : null;
    out.push({
      id,
      source: CLEARANCE_EXTERNAL_SOURCE,
      sourceLabel: foldedCenter
        ? `${clearanceSourceLabel(record)}；中心距 ${formatMillimetres(foldedCenter.distanceM)}`
        : clearanceSourceLabel(record),
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: clearanceDimensionText(record),
        a,
        b,
        // 连排双度量同连线：推导间隔画到另一侧，不与中心距的尺寸线互相叠。
        placement: { offsetM, labelT: 0.5, side: record.pipeRow?.metric === 'derived-gap' ? -1 : 1 },
      },
    });
  }
  return { records: out, skipped };
}


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
 *  连排记录在三维里只写简洁数值（如 `187mm` / `≈187mm`），避免「名义间隔 / 中心距」前缀压线重叠；
 *  度量口径（「名义间隔」或「中心距」）与同对另一口径值统一放在 `sourceLabel`（悬停提示与尺寸列表）中展示。 */
export function clearanceDimensionText(record: ClearanceRecord): string {
  const snapshot = record.snapshot;
  if (!snapshot) return '';
  const stale = record.status === 'stale' ? '（过期）' : record.status === 'failed' ? '（重算失败，旧值）' : '';
  if (snapshot.intersects) return `${stale}相交`;
  // 推导间隔的「推导」由来源标签与方法标签表达；`≈` 只留给外径本身是估算的情形（plan §4.2）。
  const approximate = (record.pipeRow?.metric === 'derived-gap'
    ? pipeRowGapEstimated(record.pipeRow)
    : toLegacyApproximate(record.provenance.accuracyClass)) ? '≈' : '';
  const perpendicular = snapshot.perpendicular ? ' ⊥' : '';
  return `${stale}${approximate}${formatMillimetres(snapshot.distanceM)}${perpendicular}`;
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
   * 连排同一对的中心距也画。缺省只画名义间隔（推导间隔），中心距写进它的来源说明；名义接触 / 重叠 / 缺外径
   * （推导间隔没有快照）时这一对不画尺寸线。
   */
  pipeRowBothMetrics?: boolean;
  /** 连排每对加一组关键点标注：截面上两管中心（×）、推导间隔两端的外表面点（○）、管底对齐的管底点（○）与虚线支承线。 */
  pipeRowKeyPoints?: boolean;
}>;

/** 显式布局（标注图元）与其中的点标记：`@/dimension` 门面不导出内核类型，从外部尺寸记录的 layout 里取。 */
type ExplicitLayout = Extract<ExternalDimensionRecord['layout'], { arrowLines: unknown }>;
type ExplicitMarker = NonNullable<ExplicitLayout['markers']>[number];

const KEY_POINT_RADIUS_PX = 3;

function formatPointM(point: Vec3): string {
  return `(${point.map(v => v.toFixed(3)).join(', ')})`;
}

/**
 * 连排每一对的关键点（外部标注图元）：点取自这对的记录本身——中心距快照的两端是截面上的两管中心，推导间隔快照的两端是
 * 外表面点，管底对齐另有 `pipeRow.bottomPoints`——和尺寸线同一组数。
 */
function pipeRowKeyPointRecords(records: readonly ClearanceRecord[]): ExternalDimensionRecord[] {
  const pairs = new Map<string, { center?: ClearanceRecord; gap?: ClearanceRecord }>();
  for (const record of records) {
    const pairKey = pipeRowPairKey(record);
    if (!pairKey) continue;
    const entry = pairs.get(pairKey) ?? {};
    if (record.pipeRow!.metric === 'center-distance') entry.center = record;
    else entry.gap = record;
    pairs.set(pairKey, entry);
  }
  const drawable = (record?: ClearanceRecord) => (record?.snapshot && !record.snapshot.intersects ? record.snapshot : null);
  const out: ExternalDimensionRecord[] = [];
  for (const [pairKey, { center, gap }] of pairs) {
    const centers = drawable(center);
    const surface = drawable(gap);
    const pipeRow = (center ?? gap)!.pipeRow!;
    const bottom = pipeRow.bottomPoints ?? null;
    const markers: ExplicitMarker[] = [
      ...(centers ? [centers.sourcePoint, centers.targetPoint].map(at => ({ at, shape: 'cross' as const })) : []),
      ...(surface ? [surface.sourcePoint, surface.targetPoint].map(at => ({ at, shape: 'circle' as const, radiusPx: KEY_POINT_RADIUS_PX })) : []),
      ...(bottom ?? []).map(at => ({ at, shape: 'circle' as const, radiusPx: KEY_POINT_RADIUS_PX })),
    ];
    if (markers.length === 0) continue;
    const id = `${CLEARANCE_EXTERNAL_SOURCE}:${pairKey}:key-points`;
    const layout: ExplicitLayout = {
      id,
      role: 'external',
      labelPinned: true,
      formattedLabel: '',
      lines: bottom ? [{ from: bottom[0], to: bottom[1], part: 'extension', style: 'dashed' }] : [],
      labelAnchor: pipeRow.section.point,
      arrowLines: [],
      markers,
    };
    const label = [
      centers ? `中心 ${formatPointM(centers.sourcePoint)} / ${formatPointM(centers.targetPoint)}` : '',
      surface ? `外表面点 ${formatPointM(surface.sourcePoint)} / ${formatPointM(surface.targetPoint)}` : '',
      bottom ? `管底点 ${formatPointM(bottom[0])} / ${formatPointM(bottom[1])}` : '',
    ].filter(Boolean).join('；');
    out.push({ id, source: CLEARANCE_EXTERNAL_SOURCE, sourceLabel: `连排关键点（m）: ${label}`, role: 'external', category: 'annotation', layout });
  }
  return out;
}

/** 同一排内相邻对交错偏移与文字站位：并排的多条尺寸线错开高度和文字位置，避免相邻对压字。 */
const PIPE_ROW_OFFSET_TIERS_M: readonly number[] = [0.22, 0.36];
const PIPE_ROW_LABEL_TS: readonly number[] = [0.5, 0.36, 0.64];

function resolvePipeRowPlacement(
  record: ClearanceRecord,
  rowIndex: number,
  defaultOffsetM: number,
  explicitOffset: boolean,
): Readonly<{ offsetM: number; labelT: number; side: 1 | -1 }> {
  const side: 1 | -1 = record.pipeRow?.metric === 'derived-gap' ? -1 : 1;
  if (!record.pipeRow || explicitOffset) {
    return { offsetM: defaultOffsetM, labelT: 0.5, side };
  }
  const tierOffset = PIPE_ROW_OFFSET_TIERS_M[rowIndex % PIPE_ROW_OFFSET_TIERS_M.length]!;
  const labelT = PIPE_ROW_LABEL_TS[rowIndex % PIPE_ROW_LABEL_TS.length]!;
  return { offsetM: tierOffset, labelT, side };
}
export function clearanceRecordsToExternalDimensions(
  records: readonly ClearanceRecord[],
  options: ClearanceExternalDimensionOptions = {},
): ExternalDimensionMappingResult {
  const out: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const explicitOffset = options.offsetM !== undefined;
  const offsetM = options.offsetM ?? 0.5;
  const centerByPair = new Map<string, ClearanceRecord>();
  const gapByPair = new Map<string, ClearanceRecord>();
  const pairIndexByRow = new Map<string, Map<string, number>>();
  for (const record of records) {
    const pairKey = pipeRowPairKey(record);
    if (!pairKey) continue;
    if (record.pipeRow!.metric === 'center-distance') centerByPair.set(pairKey, record);
    else gapByPair.set(pairKey, record);
    const rowGroupId = record.pipeRow!.rowGroupId;
    let rowPairs = pairIndexByRow.get(rowGroupId);
    if (!rowPairs) {
      rowPairs = new Map<string, number>();
      pairIndexByRow.set(rowGroupId, rowPairs);
    }
    if (!rowPairs.has(pairKey)) rowPairs.set(pairKey, rowPairs.size);
  }
  for (const record of records) {
    const id = `${CLEARANCE_EXTERNAL_SOURCE}:${record.id}`;
    const snapshot = record.snapshot;
    const pairKey = pipeRowPairKey(record);
    if (!options.pipeRowBothMetrics && record.pipeRow?.metric === 'center-distance') {
      skipped.push({ id, reason: 'Pipe-row center distance is drawn only when both metrics are shown' });
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
    const siblingSummary = (() => {
      if (!pairKey) return '';
      if (record.pipeRow!.metric === 'derived-gap') {
        const centerSnap = centerByPair.get(pairKey)?.snapshot;
        return centerSnap ? `；中心距 ${formatMillimetres(centerSnap.distanceM)}` : '';
      }
      const gapRecord = gapByPair.get(pairKey);
      const gapSnap = gapRecord?.snapshot;
      return gapSnap && !gapSnap.intersects
        ? `；名义间隔 ${clearanceDimensionText(gapRecord)}`
        : '';
    })();
    const rowPairIndex = pairKey && record.pipeRow
      ? (pairIndexByRow.get(record.pipeRow.rowGroupId)?.get(pairKey) ?? 0)
      : 0;
    out.push({
      id,
      source: CLEARANCE_EXTERNAL_SOURCE,
      sourceLabel: `${clearanceSourceLabel(record)}${siblingSummary}`,
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: clearanceDimensionText(record),
        a,
        b,
        // 连排双度量同连线：推导间隔画到另一侧，同一排内相邻对交错偏移，不互相叠字。
        placement: resolvePipeRowPlacement(record, rowPairIndex, offsetM, explicitOffset),
      },
    });
  }
  if (options.pipeRowKeyPoints) out.push(...pipeRowKeyPointRecords(records));
  return { records: out, skipped };
}

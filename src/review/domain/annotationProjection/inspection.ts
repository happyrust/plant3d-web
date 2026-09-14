/**
 * 云线 inspection 遮挡淡化——2026-09-14 方案 §10（D12）的纯函数部分（P4 第三步，开关 `cloudInspectionFade`）。
 *
 * - **默认仍 `always-on-top`**；任何模式都保持 `depthTest:false`，inspection 只调透明度，不让深度测试把批注抹掉。
 * - 中心射线只能作启发式：先验证射线**确实命中成员表面**，再判断其前方是否有更近的非目标命中；
 *   未命中目标是 `unknown`，不是「被挡住」。
 * - 只有全部有效样本都 `blocked` 才淡化；激活 / 悬停 / 拖动（emphasized）、失效记录（STALE / missing 提示要可读）一律不淡。
 * - α 取尺寸系统 `theme.inspection.occludedAlpha`（当前 0.35），不另定常量。
 *
 * 射线本身由适配层打（复用 ADR-0061 的 `isWorldSegmentBlocked` 缝，成员 refno 作 `subject`）；这里只决定
 * 「探哪几个成员的哪个点」与「探测结果 → 透明度因子」。
 */

import type { RegionV1 } from '../cloudRegion';

export type OcclusionProbe = 'clear' | 'blocked' | 'unknown';

/** `always-on-top` = 现状置顶；`inspection` = 与尺寸系统的检视显示模式（URL `mbd_mode=inspection`）同一口径 */
export type CloudInspectionMode = 'always-on-top' | 'inspection';

export type InspectionProbeMember = {
  refno: string;
  /** 世界坐标探测点（成员放置盒中心 / 目标 AABB 中心）；射线从相机打向它，命中成员表面处才是真正的目标点 */
  point: readonly [number, number, number];
};

/**
 * 探测结果 → 透明度因子（方案 §10 `inspectionFactor`）。
 * 置顶 / 强调 / 快照失效 → 1；有样本且全部 blocked → `occludedAlpha`；有可见或未知证据时保守保持可读 → 1。
 */
export function inspectionFactor(
  mode: CloudInspectionMode,
  probes: readonly OcclusionProbe[],
  emphasized: boolean,
  snapshotInvalid: boolean,
  occludedAlpha: number,
): number {
  if (mode === 'always-on-top' || emphasized || snapshotInvalid) return 1;
  if (probes.length === 0) return 1;
  for (const p of probes) if (p !== 'blocked') return 1;
  return Number.isFinite(occludedAlpha) ? Math.min(1, Math.max(0, occludedAlpha)) : 1;
}

/** 从 n 个里按位置均匀挑 ≤ max 个（首、尾、中间），保持原顺序 */
function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return [items[0]!];
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const index = Math.round((i * (items.length - 1)) / (max - 1));
    out.push(items[index]!);
  }
  return out;
}

/**
 * 选代表性成员作探测样本：`origin:'members'` 的 `obb-union` 范围体 → 每个成员 refno 取它第一个盒的中心（按 refno 字典序，
 * 再均匀挑 ≤ `max` 个）；没有可用范围体 → 用 `fallbackPoint`（目标合并 AABB 中心）配前 ≤ `max` 个成员 refno；
 * 两者都没有 → 空（结果 `unknown`，保持可读）。
 */
export function chooseInspectionProbeMembers(
  region: RegionV1 | null | undefined,
  memberRefnos: readonly string[],
  fallbackPoint: readonly [number, number, number] | null,
  max = 3,
): InspectionProbeMember[] {
  const limit = Math.max(1, Math.floor(max));
  if (region && region.kind === 'obb-union' && region.origin === 'members') {
    const byRefno = new Map<string, InspectionProbeMember>();
    for (const box of region.boxes) {
      const refno = box.memberRefno;
      if (!refno || byRefno.has(refno)) continue;
      const [x, y, z] = box.center;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      byRefno.set(refno, { refno, point: [x, y, z] });
    }
    if (byRefno.size > 0) {
      const ordered = [...byRefno.keys()].sort().map((refno) => byRefno.get(refno)!);
      return spread(ordered, limit);
    }
  }
  if (!fallbackPoint) return [];
  const refnos = [...new Set(memberRefnos.filter((r) => typeof r === 'string' && r.length > 0))].sort();
  return spread(refnos, limit).map((refno) => ({ refno, point: [fallbackPoint[0], fallbackPoint[1], fallbackPoint[2]] }));
}

/** 与尺寸面板同一口径：URL `mbd_mode=inspection` = 检视模式，其它 = 置顶 */
export function inspectionModeFromSearch(search: string | null | undefined): CloudInspectionMode {
  if (!search) return 'always-on-top';
  try {
    return new URLSearchParams(search).get('mbd_mode')?.trim() === 'inspection' ? 'inspection' : 'always-on-top';
  } catch {
    return 'always-on-top';
  }
}

/**
 * 批注关联（bindings）的失效解析——ADR-0050 的纯函数部分。
 *
 * 模型加载 / 版本切换后，对每条绑定的 refno 判一次状态；不可解析的绑定进入失效态，
 * 由面板降级显示，只允许移除或重新绑定，不静默删、不自动改记录。
 *
 * 四态口径（对齐 2026-07-28 云线绑定方案 §5.2 与尺寸系统 STALE 语义）：
 * - `resolved`：构件几何已在场景里。
 * - `unloaded`：几何未加载。分两档写进 reason——运行时索引里认识它（只是没装），
 *   或索引里也没有（**存在性未验证**，不得据此说它不存在）。
 * - `missing`：有权威证据说明当前模型里找不到它（一次按 refno 的定位 / 加载明确失败）。
 * - `stale`：refno 能解析、几何已加载，但记录里的锚点世界坐标已不在该构件的包围盒附近
 *   ——「锚点无法重定位」。只对 anchor 角色判，member 没有坐标快照可比。
 *
 * 渲染始终只读记录里的坐标快照，这里的结论只用于提示与操作门控。
 */

import type { AnnotationType, CloudBindingRole, Vec3 } from '@/composables/useToolStore';

export type BindingResolveState = 'resolved' | 'unloaded' | 'missing' | 'stale';

export type BindingResolveEntry = {
  state: BindingResolveState;
  checkedAt: number;
  /** 给人看的一句原因，面板里做 tooltip / 次级文字 */
  reason?: string;
};

export type BindingResolveProbe = {
  /** 构件几何是否已在场景里 */
  isLoaded: (refno: string) => boolean;
  /** 运行时索引是否认识这个 refno（noun 已知），与是否装了几何无关 */
  isKnown: (refno: string) => boolean;
  /** 是否有权威证据说明当前模型里没有它（如按 refno 加载明确失败） */
  isVerifiedMissing: (refno: string) => boolean;
  /**
   * 权威 missing 的具体原因（那次定位 / 加载回执里的错误文本），拼在默认句后面给人看；
   * 没有就只出默认句。只在 `isVerifiedMissing` 为 true 时被问。
   */
  missingReason?: (refno: string) => string | null | undefined;
  /**
   * 锚点是否已漂离构件：true = 漂离（判 stale），false = 仍在范围内，
   * null / undefined = 无法判断（没有包围盒能力时一律回 null，不猜）。
   */
  anchorDrift?: (refno: string, worldPos: Vec3) => boolean | null | undefined;
};

export type BindingResolveInput = {
  refno: string;
  role: CloudBindingRole;
  /** 只有 anchor 角色带；来自记录里的坐标快照（cloud.anchorWorldPos / text.worldPos） */
  anchorWorldPos?: Vec3;
};

export const BINDING_RESOLVE_REASONS = {
  missing: '模型中未找到该构件（按 refno 定位加载失败）',
  unloadedKnown: '构件几何尚未加载；定位高亮会按需加载',
  unloadedUnknown: '不在当前已加载的模型索引里，存在性未验证；定位高亮会尝试加载',
  stale: '锚点坐标已不在该构件包围盒附近，锚点不可更换，只能另建批注',
} as const;

export function classifyBinding(
  input: BindingResolveInput,
  probe: BindingResolveProbe,
  now: number = Date.now(),
): BindingResolveEntry {
  const refno = input.refno.trim();
  if (probe.isVerifiedMissing(refno)) {
    const detail = probe.missingReason?.(refno)?.trim();
    return {
      state: 'missing',
      checkedAt: now,
      reason: detail ? `${BINDING_RESOLVE_REASONS.missing}：${detail}` : BINDING_RESOLVE_REASONS.missing,
    };
  }
  if (probe.isLoaded(refno)) {
    if (input.role === 'anchor' && input.anchorWorldPos && probe.anchorDrift) {
      const drift = probe.anchorDrift(refno, input.anchorWorldPos);
      if (drift === true) {
        return { state: 'stale', checkedAt: now, reason: BINDING_RESOLVE_REASONS.stale };
      }
    }
    return { state: 'resolved', checkedAt: now };
  }
  return {
    state: 'unloaded',
    checkedAt: now,
    reason: probe.isKnown(refno) ? BINDING_RESOLVE_REASONS.unloadedKnown : BINDING_RESOLVE_REASONS.unloadedUnknown,
  };
}

export type BindingResolveSummary = {
  total: number;
  resolved: number;
  unloaded: number;
  missing: number;
  stale: number;
  /** 可用 = 已解析 + 未加载（未加载只是没装，仍可定位）；missing / stale 不算 */
  usable: number;
};

export function summarizeBindingResolve(entries: readonly (BindingResolveEntry | undefined)[]): BindingResolveSummary {
  const summary: BindingResolveSummary = { total: 0, resolved: 0, unloaded: 0, missing: 0, stale: 0, usable: 0 };
  for (const entry of entries) {
    if (!entry) continue;
    summary.total += 1;
    summary[entry.state] += 1;
  }
  summary.usable = summary.resolved + summary.unloaded;
  return summary;
}

/**
 * 面板显示配置。`resolved` 不出徽标（正常态不加噪音），其余三态各一枚。
 * 色彩：未加载 = 中性灰；不存在 = 红（对齐「元素不存在」警示）；失效 = 琥珀（对齐尺寸 STALE）。
 */
export function getBindingResolveDisplay(state: BindingResolveState): {
  label: string;
  tone: string;
  showBadge: boolean;
  /** 该绑定还能不能「定位高亮」——找不到的构件没有可去的地方 */
  canLocate: boolean;
} {
  switch (state) {
    case 'resolved':
      return { label: '已解析', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', showBadge: false, canLocate: true };
    case 'unloaded':
      return { label: '未加载', tone: 'bg-slate-100 text-slate-600 border-slate-200', showBadge: true, canLocate: true };
    case 'missing':
      return { label: '⚠ 元素不存在', tone: 'bg-rose-50 text-rose-700 border-rose-200', showBadge: true, canLocate: false };
    case 'stale':
      return { label: 'STALE 位置失效', tone: 'bg-amber-50 text-amber-700 border-amber-200', showBadge: true, canLocate: true };
  }
}

/** 解析结果的索引键：类型 + 记录 id + 角色 + refno（同一 refno 双角色是两条）。 */
export function buildBindingResolveKey(
  type: AnnotationType,
  annotationId: string,
  role: CloudBindingRole,
  refno: string,
): string {
  return `${type}:${annotationId}:${role}:${refno.trim()}`;
}

/** 包围盒的两种写法：`{min,max}` 或查看器 `scene.getAABB()` 回的平铺 6 元数组 `[minx,miny,minz,maxx,maxy,maxz]`。 */
export type AabbLike =
  | { min: ArrayLike<number>; max: ArrayLike<number> }
  | ArrayLike<number>;

type MinMax = { min: [number, number, number]; max: [number, number, number] };

function readTriple(source: ArrayLike<number>, offset: number): [number, number, number] | null {
  const a = source[offset];
  const b = source[offset + 1];
  const c = source[offset + 2];
  if (a === undefined || b === undefined || c === undefined) return null;
  return [a, b, c];
}

function toMinMax(aabb: AabbLike | null | undefined): MinMax | null {
  if (!aabb) return null;
  if ('min' in aabb && 'max' in aabb) {
    const min = readTriple(aabb.min, 0);
    const max = readTriple(aabb.max, 0);
    return min && max ? { min, max } : null;
  }
  const min = readTriple(aabb, 0);
  const max = readTriple(aabb, 3);
  return min && max ? { min, max } : null;
}

/**
 * 锚点漂移判据：世界点是否落在包围盒外扩后的范围之外。
 * 外扩量取对角线的 25% 与 `minPad` 中的较大者——宁可漏判也不把正常锚点打成 STALE。
 * 包围盒缺失 / 退化（min/max 无效）时回 null，不判。
 */
export function isAnchorOutsideAabb(
  worldPos: Vec3,
  aabb: AabbLike | null | undefined,
  minPad = 100,
): boolean | null {
  const box = toMinMax(aabb);
  if (!box) return null;
  const dx = box.max[0] - box.min[0];
  const dy = box.max[1] - box.min[1];
  const dz = box.max[2] - box.min[2];
  if (![dx, dy, dz].every((d) => Number.isFinite(d) && d >= 0)) return null;
  const pad = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.25, minPad);
  const axes: readonly (0 | 1 | 2)[] = [0, 1, 2];
  for (const axis of axes) {
    const value = worldPos[axis];
    if (!Number.isFinite(value)) return null;
    if (value < box.min[axis] - pad || value > box.max[axis] + pad) return true;
  }
  return false;
}

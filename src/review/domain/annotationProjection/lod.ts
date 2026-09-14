/**
 * 云线 LOD——2026-09-14 方案 §9.3（D11）的纯函数部分（P4 第一步，开关 `cloudAdaptiveLod` = 交互方案 `annotationUx.adaptiveLod`）。
 *
 * 上千条云线时，全轮廓（齐次裁剪 → 凸包 → 圆角 → 波纹 → `setPoints` → 文字框排版）只保留**激活批注 + 有限集合**，
 * 初始预算 64 条；其余降为图钉（`pin`）——**不算凸包、不 `setPoints`、不创建完整文字 DOM**。
 *
 * 约束（§9.3 / 交互方案 §3.4）：
 * - LOD 是运行时决策：不改记录、不写 `visible=false`；隐藏记录仍隐藏；列表与成员统计不受影响。
 * - 激活 / 拖动中 / 悬停 / 待编辑的云线固定高等级（`pinnedHigh`），不参与预算竞争、不被滞回剔除。
 * - 切换加滞回：已是 `full` 的条目排名掉到 `budget + slack` 之外才降档；`pin` 条目排进 `budget` 之内才升档——
 *   相机小幅摆动时预算边界附近的条目不来回抖。
 * - 图钉不宣称「包住范围」：pin 档只是可发现入口。
 *
 * 优先级（越小越优先）由适配层算：屏内锚点 = 到视口中心的 NDC 距离（0 … √2），屏外 = 2 + 出屏距离，相机背后 = 4 + …。
 * 同分按 id 字典序，保证确定性。
 */

export type CloudLodLevel = 'full' | 'pin';

export type CloudLodCandidate = {
  id: string;
  /** 越小越优先（见 `cloudLodPriority`）；非有限值按最低优先级处理 */
  priority: number;
  /** 激活 / 拖动 / 悬停 / 待编辑：固定 `full` */
  pinnedHigh: boolean;
  /** 上一次计划里的等级；null = 首次出现 */
  previous: CloudLodLevel | null;
};

export type CloudLodPlanOptions = {
  /** 全轮廓预算（§9.3 初始 64） */
  budget: number;
  /** 滞回带宽：已是 full 的条目排名在 `[budget, budget + slack)` 内保持 full */
  slack: number;
};

export type CloudLodPlan = {
  levels: Map<string, CloudLodLevel>;
  fullCount: number;
  pinCount: number;
  /** 候选数超过预算（LOD 真正生效）；false = 全部 full */
  overBudget: boolean;
};

export const DEFAULT_CLOUD_LOD_BUDGET = 64;
export const DEFAULT_CLOUD_LOD_SLACK = 16;
export const DEFAULT_CLOUD_LOD_OPTIONS: Readonly<CloudLodPlanOptions> = Object.freeze({
  budget: DEFAULT_CLOUD_LOD_BUDGET,
  slack: DEFAULT_CLOUD_LOD_SLACK,
});

/**
 * 锚点 NDC → 优先级。`behind` = 锚点在相机背后（视空间 z ≥ 0）；屏内按到视口中心的距离，屏外按出屏距离。
 * 三段不重叠：屏内 [0, √2]、屏外 [2, ∞)、背后 [4, ∞)。
 */
export function cloudLodPriority(ndcX: number, ndcY: number, behind: boolean): number {
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return Number.POSITIVE_INFINITY;
  const outsideX = Math.max(0, Math.abs(ndcX) - 1);
  const outsideY = Math.max(0, Math.abs(ndcY) - 1);
  const outside = Math.hypot(outsideX, outsideY);
  if (behind) return 4 + outside;
  if (outside > 0) return 2 + outside;
  return Math.hypot(ndcX, ndcY);
}

function comparePriority(a: CloudLodCandidate, b: CloudLodCandidate): number {
  const pa = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
  const pb = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function planCloudLod(
  candidates: readonly CloudLodCandidate[],
  options: CloudLodPlanOptions = DEFAULT_CLOUD_LOD_OPTIONS,
): CloudLodPlan {
  const budget = Math.max(0, Math.floor(options.budget));
  const slack = Math.max(0, Math.floor(options.slack));
  const levels = new Map<string, CloudLodLevel>();

  // 不超预算：全部 full，不排序（≤ 64 条是常态，LOD 零开销）
  if (candidates.length <= budget) {
    for (const c of candidates) levels.set(c.id, 'full');
    return { levels, fullCount: candidates.length, pinCount: 0, overBudget: false };
  }

  let fullCount = 0;
  const contenders: CloudLodCandidate[] = [];
  for (const c of candidates) {
    if (c.pinnedHigh) {
      levels.set(c.id, 'full');
      fullCount += 1;
    } else {
      contenders.push(c);
    }
  }
  contenders.sort(comparePriority);

  // 固定高档的条目占掉预算；剩余名额按优先级分给其它条目，滞回带只对「已经是 full」的条目生效
  const room = Math.max(0, budget - fullCount);
  for (let rank = 0; rank < contenders.length; rank++) {
    const c = contenders[rank]!;
    const keep = c.previous === 'full' && rank < room + slack;
    const promote = rank < room;
    const level: CloudLodLevel = keep || promote ? 'full' : 'pin';
    levels.set(c.id, level);
    if (level === 'full') fullCount += 1;
  }
  return { levels, fullCount, pinCount: candidates.length - fullCount, overBudget: true };
}

/**
 * 「一键完全重新部署」选库页的勾选合并。
 *
 * 打开弹窗时默认全选；点「刷新」重新拉一次 /dbnums 后，新冒出来的库要跟打开时一致地勾上，
 * 否则新库会悄悄漏出这次部署。刷新前已经取消勾选的库保持不勾，不因为刷新被重新选上。
 */
export type PickMergeResult = {
  picked: Set<number>;
  /** 这次刷新后见到的候选库，供下次刷新判断「新出现」。 */
  seen: Set<number>;
}

/**
 * @param before 刷新前的勾选
 * @param wasAll 刷新前是不是全选状态
 * @param dbnums 刷新后的候选库
 * @param seen 刷新前见到的候选库
 */
export function mergePickedAfterRefresh(
  before: Set<number>,
  wasAll: boolean,
  dbnums: number[],
  seen: Set<number>,
): PickMergeResult {
  const alive = new Set(dbnums);
  const next = new Set([...before].filter((dbnum) => alive.has(dbnum)));
  // 只有本来就在全选状态时才把新库一并勾上；用户主动点掉全选的，刷新不该擅自加回来
  if (wasAll) {
    for (const dbnum of dbnums) {
      if (!seen.has(dbnum)) next.add(dbnum);
    }
  }
  return { picked: next, seen: alive };
}

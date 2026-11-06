/**
 * 「一键完全重新部署」选库页的勾选对账。
 *
 * 打开弹窗时默认全选。候选库会在选库页开着的时候变化：点「刷新」、任务结束、别的客户端触发的
 * 后台刷新都会改写同一份库列表。新冒出来的库要跟打开时一致地勾上，否则会悄悄漏出这次部署；
 * 用户点掉过的库保持不勾。
 */
export type PickState = {
  /** 当前勾选 */
  picked: Set<number>;
  /** 上次对过账的候选库，之后冒出来的才算新库 */
  seen: Set<number>;
  /** 用户的意图是不是「全都要」；点掉任何一个库就不再是 */
  wantAll: boolean;
  /** 现在的候选库 */
  candidates: number[];
};

export type PickReconcile = {
  /** 没有变化时原样返回传入的集合（同一个引用），调用方据此跳过写回 */
  picked: Set<number>;
  seen: Set<number>;
};

export function reconcilePicks({ picked, seen, wantAll, candidates }: PickState): PickReconcile {
  const alive = new Set(candidates);
  let changed = false;
  const next = new Set<number>();
  for (const dbnum of picked) {
    if (alive.has(dbnum)) next.add(dbnum);
    else changed = true;
  }
  if (wantAll) {
    for (const dbnum of candidates) {
      if (!seen.has(dbnum) && !next.has(dbnum)) {
        next.add(dbnum);
        changed = true;
      }
    }
  }
  return { picked: changed ? next : picked, seen: alive };
}

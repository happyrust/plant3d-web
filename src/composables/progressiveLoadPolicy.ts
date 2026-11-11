/**
 * 边取边画（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` A3）的装载节奏：
 * 记录按成员一批批到，什么时候把攒着的构件装进场景。
 *
 * 每装一批都要整层重建显卡资源（`recompile`）、刷新空间索引，代价随场景里已有的对象数涨，所以不能到一批装一批：
 * - 第一批立刻装——先出图；
 * - 之后攒够「不少于已装数量」再装——翻倍，全部重建量只比最后那一次多一倍；
 * - 攒不够翻倍、但离上一批装完已经够久，也装一次。「够久」至少 0.5 秒，且不短于上一批耗时的
 *   `PROGRESSIVE_COST_MULTIPLE` 倍：大场景一批要几百毫秒，照固定 0.5 秒装会让装载把主线程占满、拖慢取数，
 *   按倍数拉开后装载占用的份额不超过 1 / (1 + 倍数)。
 *
 * 全部收齐之后的那一批不归这里管：显示流程自己把剩下的装完并收尾。
 */

/** 按时间触发的最短间隔（毫秒） */
export const PROGRESSIVE_MIN_INTERVAL_MS = 500;
/** 按时间触发的间隔不短于上一批耗时的这么多倍 */
export const PROGRESSIVE_COST_MULTIPLE = 6;

export type ProgressiveLoadState = {
  /** 攒着还没装的构件数 */
  pending: number;
  /** 已经装进场景的构件数 */
  loaded: number;
  /** 离上一批装完多久了（毫秒）；一批都没装过时不看 */
  sinceLastBatchMs: number;
  /** 上一批装了多久（毫秒，含等这一批的网格） */
  lastBatchMs: number;
};

function timeTriggerMs(state: ProgressiveLoadState): number {
  return Math.max(PROGRESSIVE_MIN_INTERVAL_MS, PROGRESSIVE_COST_MULTIPLE * state.lastBatchMs);
}

/** 现在该不该把攒着的构件装一批。 */
export function shouldLoadProgressiveBatch(state: ProgressiveLoadState): boolean {
  if (state.pending <= 0) return false;
  if (state.loaded <= 0) return true;
  if (state.pending >= state.loaded) return true;
  return state.sinceLastBatchMs >= timeTriggerMs(state);
}

/** 还要等多久再看一次（给定时器用）：没有攒着的回 `null`；已经该装了回 0。 */
export function progressiveBatchWaitMs(state: ProgressiveLoadState): number | null {
  if (state.pending <= 0) return null;
  if (shouldLoadProgressiveBatch(state)) return 0;
  return Math.max(0, timeTriggerMs(state) - state.sinceLastBatchMs);
}

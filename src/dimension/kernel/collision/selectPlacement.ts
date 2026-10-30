/**
 * 按候选序降级的通用选择器（W1-2 T3.5 的前半）。
 *
 * `resolveLabelCollisions` 里那段「先看原位置、不行就沿四个方向按步长试」的逻辑
 * 与 polar 放置层要做的事**形状相同、判据不同**：
 *
 * | | 候选从哪来 | 「行不行」怎么判 |
 * | --- | --- | --- |
 * | 标签避让（`resolveLabelCollisions`） | 围绕原位按 `DIRECTIONS` × 步长现算 | `LabelOccupancy.overlapsAt` |
 * | polar 屏幕校验（T3.5） | `place()` 给出的 `candidates`（已按 score 升序） | 投影后的像素净空 |
 *
 * 把两者塞进同一个函数只能靠回调透传，那就等于没抽。所以这里抽的是**共同的骨架**：
 * 「按顺序试候选、第一个通过的胜出、全都不过就退回第一个（或标记失败）」。候选
 * 的产生与判据都留在调用方。
 *
 * 为什么不放在 `polar/`：polar 目录是另一路（T3.4）的在飞产物，W1-2 不得碰
 * （计划 §3 的入库顺序约束）。这个函数不依赖 polar 的任何类型——入参是结构化
 * 最小接口——所以放 `kernel/collision/` 由两边共用，等 `place()` 入库后在 polar
 * 侧补一层薄适配即可。
 */

/**
 * 候选的最小形状约束：只需要能算出「它在屏幕上占哪块」。
 *
 * 刻意不要求 `PolarCandidate` 的字段（`score` / `dis` / `angle` / `radius` / …）：
 * 抽这层的目的是让判据可替换，把 polar 的字段名写进签名会把两个模块焊死。
 */
export type PlacementCandidateConstraint = Readonly<{
  /** 该候选在屏幕上的包围盒，px。 */
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

/** 判据：给定候选，回答「放在这里行不行」。`true` = 可接受。 */
export type PlacementPredicate<T> = (candidate: T, index: number) => boolean;

export type PlacementChoice<T> = Readonly<{
  /** 胜出的候选；一个都不可接受时是 `fallback`。 */
  chosen: T;
  /** 胜出候选在原数组里的下标；不可接受时是 `-1`。 */
  index: number;
  /** `accepted` = 某个候选通过判据；`exhausted` = 全部不通过，退回兜底。 */
  outcome: 'accepted' | 'exhausted';
  /** 依次试过的候选个数（含最后那个不通过的）。 */
  tried: number;
}>;

export type SelectPlacementOptions<T> = Readonly<{
  /**
   * 全部候选都不通过时返回哪个。缺省取 `candidates[0]`（「候选已按优先级排序，
   * 最差也比不画强」）；显式给 `null` 表示「没有可接受的位置」要能被调用方看见。
   */
  fallback?: T | null;
  /**
   * 逐个候选被拒时的回调，用于诊断（「第几个候选、为什么不行」）。
   * 只在 `accepted` 之前的候选上调用，不改变选择结果。
   */
  onReject?: (candidate: T, index: number) => void;
}>;

/**
 * 按顺序试 `candidates`，返回第一个满足 `accept` 的。
 *
 * **不排序**：入参顺序就是优先级（`place()` 的 `candidates` 已按 `score` 升序，
 * 标签避让的方向序也是写死的优先级）。这里再排一次会把调用方的意图覆盖掉。
 *
 * **不修改入参**：返回的是原候选对象，调用方拿去用就行。
 *
 * **空候选列表**：`fallback` 给了就返回它（`index: -1`），没给就抛——那说明调用方
 * 在没有候选的情况下还在问「选哪个」，是编排错误，不该静默返回 `undefined` 让
 * 下游去猜。
 */
export function selectPlacement<T>(
  candidates: readonly T[],
  accept: PlacementPredicate<T>,
  options: SelectPlacementOptions<T> = {},
): PlacementChoice<T> {
  const { fallback, onReject } = options;
  const hasFallback = 'fallback' in options;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (accept(candidate, index)) {
      return { chosen: candidate, index, outcome: 'accepted', tried: index + 1 };
    }
    onReject?.(candidate, index);
  }

  const tried = candidates.length;
  if (hasFallback && fallback !== undefined && fallback !== null) {
    return { chosen: fallback, index: -1, outcome: 'exhausted', tried };
  }
  if (hasFallback) {
    // 调用方显式要「没有就告诉我」，把判断权交回去。
    throw new NoAcceptablePlacementError(tried);
  }
  const first = candidates[0];
  if (first === undefined) {
    throw new NoAcceptablePlacementError(0);
  }
  // 缺省兜底：最优先的候选。候选序本身就是优先级，最差也比不画强。
  return { chosen: first, index: 0, outcome: 'exhausted', tried };
}

/**
 * 所有候选都被拒、且调用方要求「没有可接受位置」时报的错。
 *
 * 带 `tried` 是为了让日志能区分「候选表是空的」（`0`，编排错误）与「候选都撞了」
 * （`> 0`，数据/密度问题）——这两种情况的处理方式完全不同。
 */
export class NoAcceptablePlacementError extends Error {
  readonly tried: number;

  constructor(tried: number) {
    super(
      tried === 0
        ? 'selectPlacement: no candidates to choose from'
        : `selectPlacement: all ${tried} candidates were rejected`,
    );
    this.name = 'NoAcceptablePlacementError';
    this.tried = tried;
  }
}

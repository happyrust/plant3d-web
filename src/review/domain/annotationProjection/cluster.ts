/**
 * pin 档图钉的屏幕聚合——2026-09-14 方案 §9.3「其他降为图钉或屏幕网格聚合」、交互方案 §3.4「密集图钉聚合，点击列成员或放大」的纯函数部分
 * （P4 LOD 第二步）。
 *
 * 输入是本帧 LOD 已降为 `pin`、且锚点在屏内的云线（overlay 像素坐标）；输出哪些图钉合成一枚带计数的聚合徽标、徽标画在哪。
 * 聚合**只是视口运行时呈现**：不改记录、不改列表数量、不写 `visible`；`full` 档（激活 / 悬停 / 预算内）的云线不参与聚合，
 * 「选中问题始终可找到」。
 *
 * 算法：以种子为中心的贪心半径聚合（不是网格——网格会让相邻两枚恰好跨格线的图钉合不到一起）：
 * 1. 上一帧的种子先当种子（同一簇的徽标不因相机小动就换种子 / 换位置）；
 * 2. 其余按 id 字典序（与相机无关，确定性）：上一帧同簇且离种子 ≤ `stayRadiusPx` 的留在原簇（滞回）；否则加入第一个
 *    离种子 ≤ `joinRadiusPx` 的簇；都不是就自己开一簇；
 * 3. 成员 ≥ `minSize` 的才是聚合，徽标放成员质心；其余仍是各自的图钉。
 */

export type PinClusterItem = {
  id: string;
  /** overlay 像素坐标 */
  x: number;
  y: number;
};

export type PinCluster = {
  /** 簇的身份 = 种子 id（跨帧稳定，徽标 DOM 与弹出列表按它复用） */
  seedId: string;
  /** 成员质心（overlay 像素） */
  x: number;
  y: number;
  /** 按 id 字典序 */
  memberIds: string[];
};

export type PinClusterOptions = {
  /** 新成员加入：到种子的距离上限 */
  joinRadiusPx: number;
  /** 上一帧已在簇里的成员：离种子不超过它就留下（≥ joinRadiusPx，滞回带） */
  stayRadiusPx: number;
  /** 至少几枚才合成一枚徽标 */
  minSize: number;
};

export type PinClusterResult = {
  clusters: PinCluster[];
  /** 被合进徽标的成员 id → 种子 id（下一帧当 `previousSeedOf` 传回来） */
  seedOf: Map<string, string>;
};

export const DEFAULT_PIN_CLUSTER_OPTIONS: Readonly<PinClusterOptions> = Object.freeze({
  joinRadiusPx: 28,
  stayRadiusPx: 40,
  minSize: 2,
});

type Group = { seed: PinClusterItem; members: PinClusterItem[] };

function dist(a: PinClusterItem, b: PinClusterItem): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function byId(a: PinClusterItem, b: PinClusterItem): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function clusterPins(
  items: readonly PinClusterItem[],
  previousSeedOf: ReadonlyMap<string, string> | null,
  options: PinClusterOptions = DEFAULT_PIN_CLUSTER_OPTIONS,
): PinClusterResult {
  const joinRadius = Math.max(0, options.joinRadiusPx);
  const stayRadius = Math.max(joinRadius, options.stayRadiusPx);
  const minSize = Math.max(2, Math.floor(options.minSize));

  const finite = items.filter((it) => Number.isFinite(it.x) && Number.isFinite(it.y)).sort(byId);
  const groups: Group[] = [];
  const groupBySeed = new Map<string, Group>();
  const openGroup = (seed: PinClusterItem): Group => {
    const g: Group = { seed, members: [seed] };
    groups.push(g);
    groupBySeed.set(seed.id, g);
    return g;
  };

  // 1. 上一帧的种子（还在场的）先立起来，保持簇身份稳定
  const previousSeeds = new Set<string>();
  if (previousSeedOf) for (const seedId of previousSeedOf.values()) previousSeeds.add(seedId);
  const rest: PinClusterItem[] = [];
  for (const it of finite) {
    if (previousSeeds.has(it.id)) openGroup(it);
    else rest.push(it);
  }

  // 2. 其余按 id 顺序归簇：先看上一帧的老簇（滞回半径），再看第一个够近的簇，都不行自己开一簇
  for (const it of rest) {
    const prevSeed = previousSeedOf?.get(it.id);
    const prevGroup = prevSeed ? groupBySeed.get(prevSeed) : undefined;
    if (prevGroup && dist(it, prevGroup.seed) <= stayRadius) {
      prevGroup.members.push(it);
      continue;
    }
    let joined = false;
    for (const g of groups) {
      if (dist(it, g.seed) <= joinRadius) {
        g.members.push(it);
        joined = true;
        break;
      }
    }
    if (!joined) openGroup(it);
  }

  // 3. 成员够多的才是聚合
  const clusters: PinCluster[] = [];
  const seedOf = new Map<string, string>();
  for (const g of groups) {
    if (g.members.length < minSize) continue;
    let sx = 0;
    let sy = 0;
    for (const m of g.members) {
      sx += m.x;
      sy += m.y;
      seedOf.set(m.id, g.seed.id);
    }
    clusters.push({
      seedId: g.seed.id,
      x: sx / g.members.length,
      y: sy / g.members.length,
      memberIds: g.members.map((m) => m.id).sort(),
    });
  }
  return { clusters, seedOf };
}

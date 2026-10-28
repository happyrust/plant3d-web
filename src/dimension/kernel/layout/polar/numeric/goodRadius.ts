/**
 * PML `polarsystem.getgoodradiusfrombadradiuss` 的修正移植
 * （vendor/MBD/object/polarsystem/polarsystem.pmlobj:969-1025，计划缺陷 C7）。
 *
 * PML 原行为：:971-982 把坏带（[内半径, 外半径]）按内半径排序，:984-996 把相接 /
 * 重叠的带合并（:987 用 le，相接也算重叠）；:998 初值 width/2；:1001-1017 顺序找
 * 第一个够宽的空隙——第一带以内 `diss1[1] − width > textlen/2` 取 textlen/2，否则
 * 第 x 带与第 x−1 带之间 `diss1[x] − diss2[x−1] > width` 取 diss2[x−1]，命中即
 * break；但 :1018 `!goodradius = !diss2.last()` 写在循环之后、:1023 return 之前，
 * break 出来仍被执行，结果无条件变成最外坏带的外缘。
 *
 * 为什么错：循环算出的空隙永远被覆盖，PML 实际返回的总是「最外坏带外缘」——
 * 角度弧被推到所有障碍之外，障碍多时离顶点极远（计划 :215：3D 下标注飞出视口）。
 *
 * 本实现：break 之后不再覆盖（等价于按注释意图把 break 改成 return），:1018 只作
 * 「没有空隙」的兜底；再按计划 :215 加 `maxRadius` 上界（调用方传 1.5 × limitMaxDis）。
 * 两个 break 都只跳出 for，之后唯一出口是 `return Math.min(radius, maxRadius)`，所以
 * 上界对「找到空隙」与「兜底」两条路径同样生效。PML 对空数组会在 `.last()` 上报错，
 * 这里返回 textLen/2——调用方 getgoodradius :923-925 在没有障碍时本来就返回它。
 */

/** 一条坏带：文字不能落进去的径向区间 [inner, outer]。 */
export type RadiusBand = readonly [inner: number, outer: number];

/** 按内半径排序后把相接 / 重叠的带并成一条（polarsystem.pmlobj:980-996）。 */
function mergeBands(bands: readonly RadiusBand[]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [inner, outer] of [...bands].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && inner <= last[1]) last[1] = Math.max(last[1], outer);
    else merged.push([inner, outer]);
  }
  return merged;
}

/**
 * 「width = 文字环带需要的径向厚度，也是相邻坏带之间可用空隙的最小宽度门槛（PML
 * 调用方传 1.2·cheight）：第 i 带与第 i−1 带之间 inner_i − outer_{i−1} > width 才算
 * 空隙；textLen/2 = 半径下限，文字以顶点为中心摆放时半径不得小于其半长，只用于第一
 * 带以内的空隙判定 inner_0 − width > textLen/2，即环带 [textLen/2, textLen/2 + width]
 * 必须整个落在第一坏带之下」
 *
 * @param bands 坏带列表，顺序任意、允许重叠。
 * @param width 文字环带的径向厚度 / 空隙宽度门槛（见上）。
 * @param textLen 文字长度；textLen/2 是半径下限（见上）。
 * @param maxRadius 计划 :215 的上界（1.5 × limitMaxDis）；缺省不限。
 * @returns 文字环带的内半径。
 */
export function goodRadiusFromBadRadii(
  bands: readonly RadiusBand[],
  width: number,
  textLen: number,
  maxRadius = Number.POSITIVE_INFINITY,
): number {
  const merged = mergeBands(bands);
  if (merged.length === 0) return Math.min(textLen / 2, maxRadius);
  // :1018 — the fallback when no gap is wide enough: just outside the outermost band.
  let radius = merged[merged.length - 1]![1];
  for (let i = 0; i < merged.length; i += 1) {
    if (i === 0) {
      // :1003-1005 — room for the whole band [textLen/2, textLen/2 + width] under the first bad band.
      if (merged[0]![0] - width > textLen / 2) {
        radius = textLen / 2;
        break;
      }
    } else if (merged[i]![0] - merged[i - 1]![1] > width) {
      // :1010-1012 — the first gap between consecutive bands that fits the band.
      radius = merged[i - 1]![1];
      break;
    }
  }
  return Math.min(radius, maxRadius);
}

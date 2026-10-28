/**
 * PML `polarsystem.getBestPosAndOri` Step 14 的修正移植
 * （vendor/MBD/object/polarsystem/polarsystem.pmlobj:1285-1294，计划缺陷 C8）。
 *
 * PML 原行为：Step 8–13 没有找到任何可接受位置时，:1289-1291 直接取第一个轴向单元
 * 与第一个径向单元的中点兜底：
 *   :1289 gooddis    = (disrange[1][1] + disrange[1][2]) / 2
 *   :1290 goodangle  = (allradiusrange[1][1][1] + allradiusrange[1][1][2]) / 2
 *   :1291 goodradius = (allradiusrange[1][1][1] + allradiusrange[1][1][2]) / 2
 *
 * 为什么错：:1290 与 :1291 完全同式——goodangle 取的是径向单元的中点（半径，mm），
 * 却在 :1294 getresult 里被当成角度（度）用；是复制 :1291 时忘了改变量。角度的正确
 * 来源是 :1085 `allangleranges[x] = balancearr[1]`：每个轴向单元的角度区间列表
 * （isdim 且有 maindimdir 时是 :591-595 以它为中心 ±needangle/2 的单区间，否则是
 * :1061 getanglerange 的结果，无限制时为 [[0, 360]]）。
 *
 * 本实现：angle 改取 allAngleRanges[0][0] 的中点；dis / radius 照旧。三者任一缺失时
 * PML 会在 unset 下标上报错，这里返回 null，由 T3.4 的摆放层决定退路。
 */

/** 闭区间 [start, end]：轴向距离、角度（度）或半径都用它。 */
export type Range = readonly [number, number];

const midpoint = (range: Range): number => (range[0] + range[1]) / 2;

/**
 * @param disRanges 轴向可放置单元（Step 2 的 disrange）。
 * @param allAngleRanges 每个轴向单元的角度区间列表（:1085 allangleranges）。
 * @param allRadiusRanges 每个轴向单元的径向单元列表（:1095-1154 allradiusrange）。
 */
export function fallbackPlacement(
  disRanges: readonly Range[],
  allAngleRanges: readonly (readonly Range[])[],
  allRadiusRanges: readonly (readonly Range[])[],
): Readonly<{ dis: number; angle: number; radius: number }> | null {
  const dis = disRanges[0];
  const angle = allAngleRanges[0]?.[0];
  const radius = allRadiusRanges[0]?.[0];
  if (!dis || !angle || !radius) return null;
  return { dis: midpoint(dis), angle: midpoint(angle), radius: midpoint(radius) };
}

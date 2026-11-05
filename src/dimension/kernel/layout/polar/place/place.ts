/**
 * PML `polarsystem.getBestPosAndOri(inputdisranges, inputallangleranges,
 * inputradiusranges, needs, bestdiss, bestdirs, bestradiuss, isdim,
 * inputleadline)` 的忠实移植（T3.4b）。
 *
 * 源：`polarsystem.pmlobj:1028-1296`。14 步，逐步行号见下；总体是「先按轴向/
 * 径向切单元，再给每个单元打分，取分最低者，全失败时兜底」。
 *
 * ## 为什么只实现「五种重载收敛后」的一份
 *
 * `PolarPlaceParams`（T3.4a 定稿）没有 `bestDiss` / `bestDirs` / `bestRadiuss` /
 * `inputDisRanges` / `inputAllAngleRanges` / `inputRadiusRanges` 字段——即
 * PML 侧这些入参在本端口里**恒为 unset**（等价于 PML 自己的 easy way 1
 * `:437-472` 在 `point` 已经决定 `bestdis` 后，把 `bestdirs` / `bestradiuss`
 * 留空传给本方法）。因此：
 *
 * - Step 2 的 `!this.getdisrange(bestdiss, needs[1])` 恒走 `bestdiss.unset()`
 *   分支（`:653-666`），即 `[[limitMinDis, limitMaxDis]]` = `[reference.disRange]`；
 * - Step 3 的 `getanglerange(inputallangleranges, needs[2], bestdirs)` 恒走
 *   `allAngleRanges=[]` 且 `bestDirs=[]` 分支，即 `normalAngleRange()`；
 * - Step 4 的 `inputradiusranges.set()` 恒假，`radiusRange = []`，
 *   `allMaxRadius[x] = 0` for every x（`:1106-1110`）。
 *
 * `params.easy` 字段目前没有可用的入参（PML easy way 1 需要 `point` /
 * `text` / `realOd` / `cheight`，`PolarPlaceParams` 都没有）可供分派，这里
 * 两种取值走同一条路径；差异留给 T3.5/T3.6 按需补齐输入时再区分
 * （见本次报告「未做」一节）。
 *
 * ## 14 步与行号
 *
 * 1. `:1037` `getNormalDirs()`；
 * 2. `:1042-1056` 轴向单元：`splitRange([reference.disRange], needs[0], [], false)`，
 *    结果为空时回退到未切分的 `[reference.disRange]`（`:1053-1056`）；
 * 3. `:1061` `getAngleRange([], needs[1], [], reference)` = `normalAngleRange()`；
 * 4. `:1063-1071` 径向范围初值（恒 `radiusRange = []`，见上）；
 * 5. `:1079-1094` 每个轴向单元调用 `balance`，收集 `allAngleRanges` /
 *    `allBestDirs` / `allEles` / `allRadii`；
 * 6. `:1095-1111` `allRadiusRange[x] = []`、`allMaxRadius[x] = 0`（恒此分支）；
 * 7. `:1118-1131` 每个轴向单元按 `allRadii[x]` 展开出径向候选带
 *    `[radius + needRadius/10, radius + needRadius*11/10]`，仅当
 *    `minRadius >= allMaxRadius[x]`（恒真，因为 `allMaxRadius[x] = 0`）才追加；
 *    `:1132-1153` 的第二个候选带算法在块注释 `$( … $)` 内，是死代码，不移植；
 * 8. `:1157` `tolerance = 0.01`（PML 毫米裸数，换算成 `0.00001` 米）；
 * 9. `:1178-1190` 每个径向候选带收集障碍元素（`radiusEles`）与引线候选
 *    （`leadRadiusEles`）；
 * 10-12. `:1198-1243` 按径向带打分：`getDirAndCha` → `weightedWeight`；带引线
 *    候选的再追加一次（`:1227-1242`，`eles` 多了引线元素，必须重新调用
 *    `getDirAndCha`，不能复用 Step 9 的 `usedAngles`）；
 * 13. `:1245-1271` 本轴向单元最优（`values.sortedindices()[1]`，平局保序）；
 *    `:1261` 的 `ifAcceptableToQuit` 恒 `false`（`:1163`），提前退出分支不可达，
 *    不移植；每个轴向单元的最优进 `alldisbests`；
 *    `:1273-1281` 按 `score` 排序取第一名——本移植保留完整排序为
 *    `candidates`，`best = candidates[0]`，与 PML 逐值一致（PML 实际只用
 *    第一名，排序本身已蕴含）；
 * 14. `:1284-1292` 兜底：`alldisbests` 为空时走 `fallbackPlacement`
 *    （已有缺陷修正 C8，见 `numeric/fallbackPlacement.ts` 文件头）。
 *
 * 最终都经 `:1294` `getresult(goodDis, goodAngle, goodRadius, needs, isDim)`
 * 换算成 `pos` / `textOri`（`isDim` 在有效代码里不影响 `getResult`，见
 * `result.ts` 文件头）。
 *
 * ## 发现：Step 14 兜底在合法输入下不可达
 *
 * `getDirAndCha`（`dirAndCha.ts`）只在 `bestDirs` 为空时才可能返回 `null`
 * （已逐支核对：非空 `bestDirs` 时，段 1/2/3 任一分支都至少能兜到
 * 「跨度最大的中点方向」，`angleCha` 退化成 360 但仍非 `null`）。而
 * `bestDirs` 只有两个来源：`getNormalDirs()` 的结果（Step 1）或
 * `[mainDimDir]`（`:586-595` 强制分支，恒 1 个元素）。所以 `allCandidates`
 * 要在全部轴向单元上同时为空，唯一途径是 `getNormalDirs() === []`。
 *
 * 但 `getNormalDirs` 的两个分支与 `getResult`（`result.ts`）失败的分支
 * 用的是**同一个退化判定**：
 * - 竖直管分支：两者都调 `orthogonal(showDir, up)`，`showDir ∥ up` 时都失败；
 * - 水平管分支：两者都调 `getZDir()`，它失败的条件两处一致。
 *
 * 也就是说，任何能让 `getNormalDirs() === []` 的参考系，`getResult` 对
 * **任意** `(dis, angle, radius)` 都会抛同样的 `RangeError`——包括 Step 14
 * 兜底自己算出的 `(dis, angle, radius)`。已用暴力测试验证：全圆单个障碍物、
 * 12 个几乎相切的障碍物（缝隙仅 1°）等「看起来应该测不到解」的场景，
 * `getDirAndCha` 依然能找到方向（`angleCha` 退化到 360，但非 null），
 * `usedFallback` 始终是 `false`；唯一能触发 `allCandidates.length === 0`
 * 的输入，`getResult` 本身也会抛错。
 *
 * 结论：**在任何几何合法的参考系下，Step 14 兜底不可达**；它在 PML 里
 * 同样是防御性代码（`:1286` 注释「不能返回空值，标注元素总要放一个地方
 * 的」，`:1287` 的调试打印暗示作者也认为这是极少数/意外情况）。本移植
 * 仍按任务要求原样实现 Step 14（代码路径与 `fallbackPlacement` 的单测
 * 覆盖都在），但集成测试只能确认「退化输入下 `polarPlace` 抛出
 * `RangeError`」，无法构造出一个「`usedFallback === true` 且成功返回
 * `source: 'fallback'`」的合法场景。见 `place.test.ts` 与本次报告。
 */

import { angleUnique } from '../numeric/angleRanges';
import { arcDirection } from '../numeric/arc';
import { fallbackPlacement } from '../numeric/fallbackPlacement';
import { splitRange } from '../numeric/splitRange';
import { weightedWeight } from '../numeric/weightedWeight';

import { getAngleRange, getNormalDirs } from './angles';
import { balance } from './balance';
import { getDirAndCha } from './dirAndCha';
import { angleOfDirection, getResult, polarArcFrame } from './result';

import type {
  PolarCandidate,
  PolarPerDisBest,
  PolarPlaceDiagnostics,
  PolarPlaceParams,
  PolarPlaceResult,
} from './types';
import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { PolarElement, PolarReference } from '../reference/types';

/** `:1157` `!tolerance = 0.01`：PML 毫米裸数，本层单位是米，换算成 `0.00001`。 */
const RADIUS_BAND_TOLERANCE_M = 0.00001;

/** `:1121-1122` `needs[3]/10` 与 `needs[3]*11/10` 的候选带偏移系数。 */
const RADIUS_BAND_MIN_FACTOR = 1 / 10;
const RADIUS_BAND_MAX_FACTOR = 11 / 10;

/** Step 9 内层：一个径向候选带收集到的障碍元素与引线候选元素。 */
type RadiusBandEles = Readonly<{
  radiusEles: readonly PolarElement[];
  leadRadiusEles: readonly PolarElement[];
}>;

/**
 * Step 9（`:1178-1190`）：把 `diseles` 按径向候选带分类。
 *
 * `not(ele.startradius > maxradius - tol || ele.endradius < minradius + tol)`
 * 的否定即「径向区间与候选带重叠（容忍一点点越界）」。不重叠但满足引线条件
 * （`leadline` 为真、非管本体、起始半径明显小于候选带下限、末端半径大于
 * `basicRadius`）时记作引线候选。
 */
function classifyByRadiusBand(
  diseles: readonly PolarElement[],
  radiusBands: readonly AngleRange[],
  leadLine: boolean,
  basicRadius: number,
): RadiusBandEles[] {
  const bands: { radiusEles: PolarElement[]; leadRadiusEles: PolarElement[] }[] = radiusBands.map(
    () => ({ radiusEles: [], leadRadiusEles: [] }),
  );

  for (const ele of diseles) {
    for (let x = 0; x < radiusBands.length; x += 1) {
      const minRadius = radiusBands[x]![0];
      const maxRadius = radiusBands[x]![1];
      const overlaps = !(
        ele.radius[0] > maxRadius - RADIUS_BAND_TOLERANCE_M ||
        ele.radius[1] < minRadius + RADIUS_BAND_TOLERANCE_M
      );
      if (overlaps) {
        bands[x]!.radiusEles.push(ele);
      } else if (
        leadLine &&
        !ele.basic &&
        ele.radius[0] < minRadius - RADIUS_BAND_TOLERANCE_M &&
        ele.radius[1] > basicRadius
      ) {
        bands[x]!.leadRadiusEles.push(ele);
      }
    }
  }

  return bands;
}

/** Step 10-12（`:1198-1243`）：对一个轴向单元的所有径向带打分，收集候选。 */
function scoreRadiusBands(
  reference: PolarReference,
  disIndex: number,
  dis: number,
  radiusBands: readonly AngleRange[],
  bandEles: readonly RadiusBandEles[],
  disBestDirs: readonly Vec3[],
  disAngleRange: readonly AngleRange[],
  needAngle: number,
): PolarCandidate[] {
  const out: PolarCandidate[] = [];

  for (let level = 0; level < radiusBands.length; level += 1) {
    const { radiusEles, leadRadiusEles } = bandEles[level]!;
    const minRadius = radiusBands[level]![0];
    const haveLead = leadRadiusEles.length > 0;

    out.push(
      ...scoreOneLevel(
        reference,
        disIndex,
        dis,
        level,
        minRadius,
        radiusEles,
        disBestDirs,
        disAngleRange,
        needAngle,
        haveLead,
      ),
    );

    // `:1227-1242`：带引线候选的径向带再评一次，元素集合多了引线元素——
    // 不能复用上一次（任务要求：`getDirAndCha` 自己会重新算 `usedAngles`，
    // 两次调用之间不传 `precomputedUsedAngles`）。
    if (haveLead) {
      const combinedEles = [...radiusEles, ...leadRadiusEles];
      out.push(
        ...scoreOneLevel(
          reference,
          disIndex,
          dis,
          level,
          minRadius,
          combinedEles,
          disBestDirs,
          disAngleRange,
          needAngle,
          haveLead,
        ),
      );
    }
  }

  return out;
}

/** Step 11-12 单次调用：`getDirAndCha` → `weightedWeight` → 一个候选打分记录。 */
function scoreOneLevel(
  reference: PolarReference,
  disIndex: number,
  dis: number,
  level: number,
  minRadius: number,
  eles: readonly PolarElement[],
  disBestDirs: readonly Vec3[],
  disAngleRange: readonly AngleRange[],
  needAngle: number,
  haveLead: boolean,
): PolarCandidate[] {
  // 不传 precomputedUsedAngles：本单元每次调用的 eles 都可能不同
  // （带引线候选时追加了引线元素），必须让 getDirAndCha 自己重算 usedAngles。
  const dirAndCha = getDirAndCha(reference, eles, needAngle, disBestDirs, disAngleRange, {});
  if (!dirAndCha) return [];

  const score = weightedWeight(dirAndCha.angleCha, minRadius, haveLead, needAngle, {
    basicRadius: reference.basicRadius,
    isInstPipe: reference.isInstPipe,
  });

  const goodAngle = angleOfDirection(reference, dirAndCha.dir);
  if (goodAngle === null) return [];

  return [
    {
      // `score` / `dis` / `angle` / `radius` 之外的字段由调用方补齐（radius 真实值
      // 要等 radiusBand 的 [min,max] 中点，这里先占位，调用方立即覆盖）。
      score,
      dis,
      angle: goodAngle,
      radius: minRadius,
      dir: dirAndCha.dir,
      disIndex,
      radiusIndex: level,
      haveLead,
      pos: [0, 0, 0],
      textOri: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
      source: 'solved',
    } satisfies PolarCandidate,
  ];
}

/**
 * Step 7（`:1118-1131`）：按 `radii`（含 `basicRadius`）展开径向候选带。
 * `maxRadius` 恒为 0（见文件头 Step 6），`minRadius >= allMaxRadius` 恒真。
 */
function buildRadiusBands(radii: readonly number[], needRadius: number): AngleRange[] {
  return radii.map(radius => [
    radius + needRadius * RADIUS_BAND_MIN_FACTOR,
    radius + needRadius * RADIUS_BAND_MAX_FACTOR,
  ]);
}

/** PML `array.sortedindices()`：稳定排序的下标表（升序，平局保留原顺序）。 */
function stableSortByScore<T extends { score: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.score - right.item.score || left.index - right.index)
    .map(entry => entry.item);
}

/**
 * PML `getBestPosAndOri`（五种重载收敛后的一份，`:1028-1296`）。
 *
 * @see 文件头「为什么只实现『五种重载收敛后』的一份」。
 */
export function polarPlace(params: PolarPlaceParams): PolarPlaceResult {
  const { reference, elements, needs, isDim } = params;
  const [needDis, needAngle, needRadius] = needs;
  const leadLine = params.leadLine ?? true; // `:1029-1033`
  const ignoreLine = params.ignoreLine ?? false;
  const maxCandidates = params.maxCandidates;

  // Step 1（`:1037`）。
  const normalDirs = getNormalDirs(reference);

  // Step 2（`:1042-1056`）：bestDiss 恒 unset → disRange = [reference.disRange]。
  const oldDisRange: AngleRange[] = [[reference.disRange[0], reference.disRange[1]]];
  let disRange = splitRange(oldDisRange, needDis, [], false);
  if (disRange.length === 0) disRange = oldDisRange;

  // Step 3（`:1061`）：inputAllAngleRanges / bestDirs 恒空 → normalAngleRange()。
  const angleRange = getAngleRange([], needAngle, [], reference);

  // Step 4（`:1063-1071`）：inputRadiusRanges 恒 unset → radiusRange = []。
  // Step 6（`:1095-1111`）：因此 allMaxRadius[x] = 0 对所有 x。

  const allAngleRanges: AngleRange[][] = [];
  const allBestDirs: Vec3[][] = [];
  const allEles: PolarElement[][] = [];
  const allRadii: number[][] = [];
  const radiusBandCounts: number[] = [];

  let forcedMainDimDirAny = false;

  // Step 5（`:1079-1094`）。
  for (const disArr of disRange) {
    const result = balance(
      reference,
      elements,
      [disArr[0], disArr[1]],
      angleRange,
      needAngle,
      normalDirs,
      isDim,
      ignoreLine,
    );
    allAngleRanges.push(result.angleRanges.map(range => [range[0], range[1]] as AngleRange));
    // `:1086-1091`：bestdirs（本端口恒空）+ balance 返回的方向。
    allBestDirs.push([...result.bestDirs]);
    allEles.push([...result.elements]);
    allRadii.push([...result.radii]);
    if (result.forcedMainDimDir) forcedMainDimDirAny = true;
  }

  // Step 7（`:1118-1131`）。
  const allRadiusRange: AngleRange[][] = disRange.map((_disArr, x) =>
    buildRadiusBands(allRadii[x]!, needRadius),
  );
  for (const bands of allRadiusRange) radiusBandCounts.push(bands.length);

  const perDisBest: PolarPerDisBest[] = [];
  const allCandidates: PolarCandidate[] = [];

  // Step 8-13（`:1157-1281`）。
  for (let disIndex = 0; disIndex < disRange.length; disIndex += 1) {
    const disArr = disRange[disIndex]!;
    const dis = (disArr[0] + disArr[1]) / 2;
    const disAngleRange = allAngleRanges[disIndex]!;
    const disBestDirs = allBestDirs[disIndex]!;
    const diseles = allEles[disIndex]!;
    const radiusBands = allRadiusRange[disIndex]!;

    const bandEles = classifyByRadiusBand(diseles, radiusBands, leadLine, reference.basicRadius);
    const levelCandidates = scoreRadiusBands(
      reference,
      disIndex,
      dis,
      radiusBands,
      bandEles,
      disBestDirs,
      disAngleRange,
      needAngle,
    );

    if (levelCandidates.length === 0) continue;

    const sorted = stableSortByScore(levelCandidates);
    const bestOfDis = sorted[0]!;
    // `:1253` / `:1256`：gooddis 是本单元中点，goodradius 是该径向带中点
    // （Step 11-12 只算了 minRadius，这里补成中点，与 PML `:1256` 一致）。
    const levelIndex = bestOfDis.radiusIndex;
    const band = radiusBands[levelIndex]!;
    const goodRadius = (band[0] + band[1]) / 2;

    const finalized: PolarCandidate = { ...bestOfDis, dis, radius: goodRadius };
    allCandidates.push(finalized);
    perDisBest.push({
      disIndex,
      score: finalized.score,
      dis: finalized.dis,
      angle: finalized.angle,
      radius: finalized.radius,
    });
  }

  let usedFallback = false;
  let candidates: PolarCandidate[];

  if (allCandidates.length > 0) {
    // `:1273-1281`：按 score 排序，PML 只用第一名；本移植保留全量排序。
    candidates = stableSortByScore(allCandidates).map(candidate => withPlacement(reference, needs, candidate));
  } else {
    // Step 14（`:1284-1292`，含缺陷修正 C8，见 numeric/fallbackPlacement.ts）。
    usedFallback = true;
    const fallback = fallbackPlacement(disRange, allAngleRanges, allRadiusRange);
    if (!fallback) {
      throw new RangeError('polarPlace: no disRange/angleRange/radiusRange available for fallback');
    }
    const placement = getResult(reference, fallback.dis, fallback.angle, fallback.radius, needs);
    candidates = [
      {
        score: Number.POSITIVE_INFINITY,
        dis: fallback.dis,
        angle: angleUnique(fallback.angle),
        radius: fallback.radius,
        dir: directionFromAngle(reference, fallback.angle),
        disIndex: 0,
        radiusIndex: 0,
        haveLead: false,
        pos: placement.pos,
        textOri: placement.textOri,
        source: 'fallback',
      },
    ];
  }

  if (maxCandidates !== undefined && candidates.length > maxCandidates) {
    candidates = candidates.slice(0, maxCandidates);
  }

  const diagnostics: PolarPlaceDiagnostics = {
    usedFallback,
    disRangeCount: disRange.length,
    radiusBandCounts,
    forcedMainDimDir: forcedMainDimDirAny,
  };

  return {
    best: candidates[0]!,
    candidates,
    perDisBest,
    diagnostics,
  };
}

/** 把 Step 13 算出的 `(dis, angle, radius)` 换算成 `pos` / `textOri`（`:1294`）。 */
function withPlacement(
  reference: PolarReference,
  needs: PolarPlaceParams['needs'],
  candidate: PolarCandidate,
): PolarCandidate {
  const placement = getResult(reference, candidate.dis, candidate.angle, candidate.radius, needs);
  return { ...candidate, pos: placement.pos, textOri: placement.textOri };
}

/** Step 14 兜底用：角度 → 方向，供 `PolarCandidate.dir` 填值（不参与计分）。 */
function directionFromAngle(reference: PolarReference, angleDegrees: number): Vec3 {
  return arcDirection(polarArcFrame(reference), angleDegrees);
}

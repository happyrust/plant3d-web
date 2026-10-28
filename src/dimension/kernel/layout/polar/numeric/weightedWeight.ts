/**
 * PML `polarsystem.weightedweight`（vendor/MBD/object/polarsystem/polarsystem.pmlobj:1298-1418）：
 * 给一个候选位置打分——角度偏差与径向距离各查一张档位表，相加后乘引线系数，
 * 越小越好。档位表 1:1 照搬，未作任何调整。
 *
 * - :1305 角度偏差先乘 needAngle / 30 归一：需求角越宽，同样的偏差越严重。
 * - 角度表取 :1309-1325；:1326-1343 的另一张表整段落在 `$( … $)` 块注释里，是死代码。
 * - 径向按 rt = minRadius / basicRadius 分档，basicRadius 为 0 时用 200（:1346-1350）；
 *   isInstPipe 走 :1381-1401 的表，否则走 :1354-1378 的表。inst 表 :1397 的
 *   `rt lt 40 → 20` 排在同条件 `lt 40 → 15`（:1395）之后，永远不可达，这里不复制。
 * - 有引线（haveLead）整体乘 1.3（:1299-1303, :1412）。
 *
 * PML 里 basicRadius / isinstpipe 是 polarsystem 的成员；这里作为 `system`
 * 参数传入，函数保持纯。
 */

/** 打分时用到的 polarsystem 成员（polarsystem.pmlobj:74, :109）。 */
export type WeightedWeightSystem = Readonly<{
  /** 管半径一类的基准半径；0 视为未知，按 PML 退到 200。 */
  basicRadius: number;
  /** 仪表管走另一张更宽松的径向档位表。 */
  isInstPipe: boolean;
}>;

type Step = Readonly<{
  /** 档位上限；`inclusive` 为 true 时 `<=`，否则 `<`（照 PML 的 le / lt）。 */
  limit: number;
  inclusive: boolean;
  weight: number;
}>;

/** polarsystem.pmlobj:1309-1325 */
const ANGLE_STEPS: readonly Step[] = [
  { limit: 5, inclusive: true, weight: 0 },
  { limit: 15, inclusive: true, weight: 3 },
  { limit: 20, inclusive: false, weight: 5 },
  { limit: 30, inclusive: false, weight: 8 },
  { limit: 45, inclusive: false, weight: 10 },
  { limit: 60, inclusive: false, weight: 12 },
  { limit: 80, inclusive: false, weight: 15 },
];
const ANGLE_WEIGHT_BEYOND = 25;

/** polarsystem.pmlobj:1354-1378 */
const RADIUS_STEPS: readonly Step[] = [
  { limit: 2, inclusive: false, weight: 0 },
  { limit: 3, inclusive: false, weight: 1 },
  { limit: 4, inclusive: false, weight: 3 },
  { limit: 5, inclusive: false, weight: 5 },
  { limit: 7, inclusive: false, weight: 6 },
  { limit: 10, inclusive: false, weight: 7 },
  { limit: 15, inclusive: false, weight: 9 },
  { limit: 20, inclusive: false, weight: 11 },
  { limit: 25, inclusive: false, weight: 12 },
  { limit: 30, inclusive: false, weight: 13 },
  { limit: 40, inclusive: false, weight: 14 },
];

/** polarsystem.pmlobj:1381-1401（:1397 的不可达 20 档已略）。 */
const INST_PIPE_RADIUS_STEPS: readonly Step[] = [
  { limit: 4, inclusive: false, weight: 0 },
  { limit: 6, inclusive: false, weight: 1 },
  { limit: 8, inclusive: false, weight: 3 },
  { limit: 10, inclusive: false, weight: 5 },
  { limit: 14, inclusive: false, weight: 6 },
  { limit: 20, inclusive: false, weight: 7 },
  { limit: 30, inclusive: false, weight: 10 },
  { limit: 40, inclusive: false, weight: 15 },
];
const RADIUS_WEIGHT_BEYOND = 50;

const DEFAULT_BASIC_RADIUS = 200;
const LEAD_COEFFICIENT = 1.3;

function stepWeight(value: number, steps: readonly Step[], beyond: number): number {
  for (const step of steps) {
    if (step.inclusive ? value <= step.limit : value < step.limit) return step.weight;
  }
  return beyond;
}

/**
 * @param angleCha 候选方向与最近优选方向的夹角（度）。
 * @param minRadius 候选径向单元的内半径。
 * @param haveLead 该单元是否要考虑引线元素（:1206-1212）。
 * @param needAngle 标注需要的角宽（度），用来归一 `angleCha`。
 */
export function weightedWeight(
  angleCha: number,
  minRadius: number,
  haveLead: boolean,
  needAngle: number,
  system: WeightedWeightSystem,
): number {
  const normalizedAngle = (angleCha * needAngle) / 30;
  const angleWeight = stepWeight(normalizedAngle, ANGLE_STEPS, ANGLE_WEIGHT_BEYOND);
  const basicRadius = system.basicRadius !== 0 ? system.basicRadius : DEFAULT_BASIC_RADIUS;
  const radiusWeight = stepWeight(
    minRadius / basicRadius,
    system.isInstPipe ? INST_PIPE_RADIUS_STEPS : RADIUS_STEPS,
    RADIUS_WEIGHT_BEYOND,
  );
  return (angleWeight + radiusWeight) * (haveLead ? LEAD_COEFFICIENT : 1);
}

/**
 * #103：非管道 MBD 记录按 PML FUNCTION（契约图元的 `function`，记录上的 `mbdFunction`）分 LOD 档。
 *
 * 档位就是内核的三档（`ExplicitLodInput.tier`，判据在 `kernel/layout/shared/lod.ts`），不另设门槛：
 * - `primary`：任何距离都画（尺寸另受 `hideShort` 短线规则约束）。
 * - `secondary`：中景档。本条字高投影低于 `theme.lodSecondaryMinPx` 时隐去；缺省主题这个门槛是 0
 *   （2026-10-29：管道字高跨 BRAN 差一个量级，任何正数都会整条 BRAN 消失），所以今天远景照样画，
 *   区别只在三维尺寸两两消隐时排在主档之后、尺寸短线比例放宽到 0.5。
 * - `detail`：近景档。本条自己的字高投影到 `theme.lodDetailMinPx`（18 px）才画，所以从不被放大到
 *   可读字号——远景挤成一团的正是这些被放大的小字。图元自己没有字高时（无字的辅助线 / 圆 / 弧）
 *   按包的 `meta.cheight_mm` 判；包也没声明（设备包）就判不了，照常画。
 *
 * 判档口径：对象身份（设备 / 墙板名、位号、支架功能、房间号、门）与主尺寸链是主档；坐标、定位墙板名、
 * 标高 / 厚度 / 强度等级、管道信息、构造附注、二级尺寸与它们的角度是次档；方向小字、偏转角度、弧墙
 * 极角半径、孔洞 / 埋件的编号名称与尺寸、局部坐标系是细节档。
 *
 * 一个 function 下的图元同档：配对的引线本来就在它的标签记录里，单独成记录的引线带同一个 function；
 * 坐标系箭头、厚度圈这类无字辅助线随它们的字。唯一按 kind 再分的是土建「尺寸标注」（字段字典裁决 2：
 * 词表不拆，组内按 kind 分）：墙段尺寸链是主档，孔 / 埋件的定位值标签与引线和「孔洞尺寸」同为细节档。
 *
 * 词表：plant-mbd `docs/field-dictionary.md`「`function` 封闭词表」（2026-11-07 按 PML 全量重读的版本），
 * 每个类型登记的原文全收，含登记但不产出的「材料」（裁决 4，只可能出现在旧包里）和规范值之前的 PML
 * 原文 `Dim dir`（规范值「标注方向」）。草表里的历史值（如支架「管夹标号」）不登记、不收。
 *
 * 管道包（`em4_pipe` / `em9_pipe` / 缺 `annotation_type` 的老包）不走本表，档位照旧由 mapper 按 id 判
 * （`classifyTag`、坡度 / 斜管辅助线）。非管道包里没声明 function、或 function 不在该类型登记表里的
 * 图元，本表也不发话，保留 mapper 的缺省——标签、辅助文字、引线都是主档：认不出的不藏。
 */
import { isPipePackage } from './mbdV2Contract';

import type { MbdPrimitiveKind, MbdV2AnnotationType } from './mbdV2Contract';
import type { ExplicitLodInput } from '../kernel/types';

export type MbdLodTier = NonNullable<ExplicitLodInput['tier']>;

export type MbdNonPipeAnnotationType = Exclude<MbdV2AnnotationType, 'em4_pipe' | 'em9_pipe'>;

/** 一个 function 的档位；同一个 function 盖两种画法时按图元 kind 细分，没列的 kind 取 `tier`。 */
export type MbdFunctionTier =
  | MbdLodTier
  | Readonly<{ tier: MbdLodTier; byKind: Readonly<Partial<Record<MbdPrimitiveKind, MbdLodTier>>> }>;

export type MbdFunctionTierTable = Readonly<Record<string, MbdFunctionTier>>;

/** 设备两类（EM4 / EM9）同一个 `markEqui`，词表完全相同。 */
const EQUIPMENT_TIERS: MbdFunctionTierTable = {
  '设备信息': 'primary',
  // 设备到南北 / 东西墙的定位尺寸：设备的主尺寸链。
  '定位尺寸': 'primary',
  '设备坐标': 'secondary',
  '定位墙体': 'secondary',
  '定位楼板': 'secondary',
  '楼板标高': 'secondary',
  '楼板厚度': 'secondary',
  // 定位尺寸偏离正轴时的方向小字。
  '标注方向': 'detail',
  'Dim dir': 'detail',
  // 弧 + 角度字 + 两条半字高方向字（偏差极小时只有轴线与轴名）：整组挤在基准点上，近景才看。
  '偏转角度': 'detail',
};

export const MBD_FUNCTION_LOD_TIERS: Readonly<Record<MbdNonPipeAnnotationType, MbdFunctionTierTable>> = {
  em4_supp: {
    '一级尺寸': 'primary',
    // 纯管卡支架相邻 ATTA 的间距：那种支架唯一的尺寸链。
    '定位尺寸': 'primary',
    // 链尺寸旁的「+N」，是主尺寸读数的一部分（管道侧同名小字也是主档）。
    '调整焊附加长度': 'primary',
    '二级尺寸': 'secondary',
    // 板孔、斜型钢的角度，与板孔 / 斜型钢的二级尺寸同一层。
    '螺栓孔角度': 'secondary',
    '型钢斜角': 'secondary',
    // 每根管一组（带圈首字母）；管道中心十字随它。
    '管道信息': 'secondary',
    '管道中心标识': 'secondary',
    '焊缝': 'secondary',
    '钢板孔洞信息': 'secondary',
    '拉杆材料': 'secondary',
    '加工方式': 'secondary',
    '护板说明': 'secondary',
    // 零部件序号，登记但不产出（裁决 4）；与埋件编号同为编号类。
    '材料': 'detail',
  },
  em9_inst_supp: {
    '位号': 'primary',
    '一级尺寸': 'primary',
    '定位尺寸': 'primary',
    '二级尺寸': 'secondary',
    // 位号下方 X / Y / PE 三行。
    '坐标信息': 'secondary',
    '定位墙体': 'secondary',
    '标注方向': 'detail',
    'Dim dir': 'detail',
    '材料': 'detail',
  },
  em9_pipe_supp: {
    '支架功能': 'primary',
    '一级尺寸': 'primary',
    '二级尺寸': 'secondary',
    '材料': 'detail',
  },
  civil: {
    '名称': 'primary',
    '房间号': 'primary',
    // 墙段 / 外露边尺寸链是主档；孔 / 埋件在墙面内的定位值（标签 + 引线、50 字高）与孔洞尺寸同档。
    '尺寸标注': { tier: 'primary', byKind: { label: 'detail', leader_line: 'detail' } },
    '标高': 'secondary',
    // 厚度字与两个同心圈同档。
    '厚度': 'secondary',
    '强度等级': 'secondary',
    '孔洞尺寸': 'detail',
    // 墙段相对正方向的偏角（弧 + 两腿 + 字）。
    '偏转角度': 'detail',
    // 弧墙各点的极角与内外径。
    '弧度半径': 'detail',
    '局部坐标系': 'detail',
    '预埋件编号': 'detail',
    '预埋件名称': 'detail',
  },
  arch: {
    '名称': 'primary',
    '门': 'primary',
    '房间号': 'primary',
    // 两个标高数值连同圈与 r / f 字母。
    '建筑标高': 'secondary',
    '孔洞尺寸': 'detail',
    '预埋件编号': 'detail',
    '预埋件名称': 'detail',
  },
  em4_equi: EQUIPMENT_TIERS,
  em9_equi: EQUIPMENT_TIERS,
};

/**
 * 一条非管道图元按 function 取的档位。`undefined` = 本表不发话：管道包、没声明 function、或 function
 * 不在该类型的登记表里（`constructor` 之类的原型键同样不算登记），调用方保留自己的缺省档。
 */
export function mbdFunctionLodTier(
  annotationType: MbdV2AnnotationType | undefined,
  mbdFunction: string | undefined,
  kind: MbdPrimitiveKind,
): MbdLodTier | undefined {
  if (isPipePackage(annotationType) || mbdFunction === undefined) return undefined;
  const table = MBD_FUNCTION_LOD_TIERS[annotationType];
  if (!Object.prototype.hasOwnProperty.call(table, mbdFunction)) return undefined;
  const entry = table[mbdFunction]!;
  return typeof entry === 'string' ? entry : entry.byKind[kind] ?? entry.tier;
}

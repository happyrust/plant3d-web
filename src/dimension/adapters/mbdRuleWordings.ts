/**
 * MBD 诊断规则号（`MbdV2Issue.rule_id`）→ 中文说明的唯一共用对照表（#134 空包标题原因、#135 422 根错误中文提示共用）。
 */

export type MbdRuleWordingEntry = Readonly<{ ruleId: string; text: string | null }>;

/** 空包（200、0 图元）里出现过的 13 个规则号及展示优先级（#134）。 */
export const MBD_EMPTY_REASON_WORDINGS: readonly MbdRuleWordingEntry[] = [
  // —— 为什么空 ——
  { ruleId: 'data.empty_branch', text: '这条支管下面没有任何管件，没有可标注的内容。' },
  { ruleId: 'civil.geometry_missing', text: '这个土建构件缺少出图要用的几何（面或轴线），标不出来。' },
  { ruleId: 'adapter.civil_wall_without_solid', text: null },
  { ruleId: 'support.no_parts', text: '这个支架下面没有能当作零件的元件，没有可标注的几何。' },
  { ruleId: 'support.nothing_to_annotate', text: '这个支架的构件出不了尺寸，也出不了标签，没有可标注的内容。' },
  {
    ruleId: 'civil.nothing_to_annotate',
    text: '这块建筑楼板上没有可标注的内容：建筑窗体只标墙名与门、房间号与标高、地沟开孔，这里三样都没有能标的。',
  },
  { ruleId: 'civil.arch_floor_only', text: '建筑窗体只给楼板（FLOOR）出标注，这个对象不是楼板。' },
  // —— 陪着出现的细节 ——
  { ruleId: 'support.em4_no_pipe_atta', text: '这个支架的管道上没有点 ATTA，找不了墙，也定不出参考视向。' },
  { ruleId: 'data.view_issue', text: null },
  { ruleId: 'support.part_geometry_missing', text: '有构件缺少可用的截面数据（POSS / POSE / 截面点），被跳过了。' },
  { ruleId: 'civil.member_off_face', text: '随这个构件交来的成员里有不在它任何一个面上的，这些成员没有标注。' },
  { ruleId: 'civil.arch_round_member', text: '有圆形的开孔，建筑窗体不标圆形开孔。' },
  { ruleId: 'adapter.implied_tube_not_drawn', text: '首尾之间的隐含直管与端口不同轴，E3D 在这里不画管子，所以不标管长。' },
];

/** 422 根错误（`BranchQueryError::RootError` 等）里出现的规则号（#135）。 */
export const MBD_ROOT_ERROR_WORDINGS: readonly MbdRuleWordingEntry[] = [
  { ruleId: 'adapter.no_members_with_geometry', text: '这条支管下的管件都缺少可用几何，已全部跳过' },
  { ruleId: 'adapter.branch_has_no_members', text: '这条支管下面没有管件，首尾之间也没有隐含直管，没有可标注的内容' },
  { ruleId: 'adapter.head_port_missing', text: '这条支管既没有首端坐标与方向（HPOS / HDIR），也没有带到达端口的管件，定不出起点（Head）' },
];

export const MBD_RULE_CHINESE_WORDINGS: readonly MbdRuleWordingEntry[] = [
  ...MBD_EMPTY_REASON_WORDINGS,
  ...MBD_ROOT_ERROR_WORDINGS,
];

const RULE_WORDING_MAP = new Map(
  MBD_RULE_CHINESE_WORDINGS.map((entry, index) => [entry.ruleId, { text: entry.text, rank: index }] as const),
);

export function lookupMbdRuleWording(ruleId: string | undefined): Readonly<{ text: string | null; rank: number }> | undefined {
  if (!ruleId) return undefined;
  return RULE_WORDING_MAP.get(ruleId);
}

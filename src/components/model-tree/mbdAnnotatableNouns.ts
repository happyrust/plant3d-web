/**
 * 模型树右键「查看尺寸标注」/「加入尺寸标注视图」对哪些 E3D 类型（noun）开放（#103 M7）。
 *
 * 这里只是入口过滤，不判标注类型：类型由服务端按项目配置从对象所在 SITE / ZONE 判定（ADR 0071），
 * 同一个 STRU 只有在支架区下才出支架标注；服务端标不了的对象回 422 `not_annotatable`，那句话经
 * `describeMbdV2HttpFailure` 直接显示在尺寸面板上。所以列表宁宽勿窄，收的是九种标注类型可能的主体：
 * - 管道：BRAN；
 * - 设备：EQUI、NOZZ；
 * - 支架（SUPP 区下）：SUPPO、STRU、REST、HANG、FRMW、SCTN、PANE、PCLA；
 * - 土建 / 建筑：WALL、STWALL、GWALL、FLOOR。
 */
export const MBD_ANNOTATABLE_NOUNS = [
  'BRAN',
  'EQUI',
  'NOZZ',
  'SUPPO',
  'STRU',
  'REST',
  'HANG',
  'FRMW',
  'SCTN',
  'PANE',
  'PCLA',
  'WALL',
  'STWALL',
  'GWALL',
  'FLOOR',
] as const;

const ANNOTATABLE: ReadonlySet<string> = new Set(MBD_ANNOTATABLE_NOUNS);

/** 树节点的类型（`TreeNode.type`，大小写与两端空白不计）是否给 MBD 标注入口。 */
export function isMbdAnnotatableNoun(noun: unknown): boolean {
  return ANNOTATABLE.has(String(noun ?? '').trim().toUpperCase());
}

export type TreeNodeDto = {
  refno: string;
  /** 显示名；gen-model-v1 下无名构件是 E3D 的整条默认全名（`ZONE 4 of SITE 2`） */
  name: string;
  noun: string;
  owner?: string | null;
  children_count?: number | null;
  /** 所属库号；只有 gen-model-v1 数据源给（服务端骨架解出），legacy 源没有这一格 */
  dbnum?: number | null;
  /** 无名构件的短形态（`ZONE 4`）；只有 gen-model-v1 数据源给，且只在与 `name` 不同时带 */
  short_name?: string | null;
  /** 文件里存的 NAME，无名构件为 `null`；只有 gen-model-v1 数据源给 */
  stored_name?: string | null;
  /** 解析视图里经由的 GPITEM（`a_b`）；只有分组下的二级成员行带 */
  via?: string | null;
  /** 二级成员：属主在别处、只是被分组（GPSET）收录；同一元素在主位置那一行不带 */
  secondary?: boolean;
  /** SCOSEL 规则组求值出的成员；gen-model 支持规则组之前恒为 `false` */
  rule?: boolean;
};

/** E3D 分组节点：GPWL（分组世界）/ GPSET（分组）。成员由 GPITEM.GPREF 引用，不是属主关系。 */
export function isGroupNoun(noun: string | null | undefined): boolean {
  const upper = (noun ?? '').trim().toUpperCase();
  return upper === 'GPWL' || upper === 'GPSET';
}

/** 分组里解析不出的 GPITEM 槽（refno 已归一为 `a_b`）；只有 gen-model-v1 的解析视图给 */
export type UnresolvedGroupSlot = {
  via: string;
  /** GPREF 原值；GPITEM 没有 GPREF 时为 `null` */
  target: string | null;
  reason: string;
};

export type NodeResponse = {
  success: boolean;
  node: TreeNodeDto | null;
  error_message?: string | null;
};

export type ChildrenResponse = {
  success: boolean;
  parent_refno: string;
  children: TreeNodeDto[];
  truncated: boolean;
  /** 分组节点解析不出的成员槽；只有 gen-model-v1 的解析视图、且有坏槽时给 */
  unresolved?: UnresolvedGroupSlot[];
  /**
   * gen-model-v1 实体父节点回的视图：`resolved` = 服务端认了 `resolved=1`；没回这一格的老服务端记 `stored`，
   * 分组下列的就是 GPITEM 槽本身（GPSET 行提示「后端未支持分组解析」）。虚拟根与 legacy 源没有这一格。
   */
  view?: 'stored' | 'resolved';
  error_message?: string | null;
};

/** 主链上的某一级被分组经 GPITEM 收录（refno 一律 `a_b`）。 */
export type SecondaryParentDto = {
  /** 被收录的那一级：构件自己，或它主链上的某个祖先 */
  member: string;
  group: string;
  group_noun: string;
  /** 分组的 `NAME`；服务端没给或无名时为 null */
  group_name: string | null;
  via: string;
};

export type AncestorsResponse = {
  success: boolean;
  refnos: string[];
  /** 缺省 = 不知道（老服务端 / 反查不可用），不等于「不在任何分组里」。 */
  secondary_parents?: SecondaryParentDto[];
  error_message?: string | null;
};

export type SubtreeRefnosResponse = {
  success: boolean;
  refnos: string[];
  truncated: boolean;
  error_message?: string | null;
};

/** gen-model-v1 `visibleInsts` 这次 ensure → records **没收齐**时的明细（refno 一律 `a_b`）；legacy 源不填。 */
export type VisibleInstsIncomplete = {
  /** 还在后台生成（202 / 504）或 409 尚未进投影的生成根 */
  pending: string[];
  /** 因 maxRoots / maxContainerDepth / maxRecordsRoots 没处理到的容器或根 */
  truncated_roots: string[];
  /** 出错的根 → 错误信息 */
  errors: Record<string, string>;
};

export type VisibleInstsResponse = {
  success: boolean;
  refno: string;
  refnos: string[];
  error_message?: string | null;
  /**
   * 收集没完成时给明细，缺省 / `null` = 收齐。已取得的 `refnos` 仍可绘制，但调用方**不能**把这个节点记成
   * 「已完整加载」——否则后续普通显示会被短路，恢复的 pending 根永远补不上。只有 gen-model-v1 填。
   */
  incomplete?: VisibleInstsIncomplete | null;
  debug?: {
    candidates_count?: number;
    filtered_count?: number;
    visible_count?: number;
    source?: string;
  } | null;
};

export type SearchRequest = {
  keyword: string;
  nouns?: string[];
  limit?: number;
};

export type SearchResponse = {
  success: boolean;
  items: TreeNodeDto[];
  error_message?: string | null;
};


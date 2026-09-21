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
  error_message?: string | null;
};

export type AncestorsResponse = {
  success: boolean;
  refnos: string[];
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


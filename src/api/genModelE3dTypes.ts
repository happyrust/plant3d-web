export type TreeNodeDto = {
  refno: string;
  name: string;
  noun: string;
  owner?: string | null;
  children_count?: number | null;
  /** 所属库号；只有 gen-model-v1 数据源给（服务端骨架解出），legacy 源没有这一格 */
  dbnum?: number | null;
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

export type VisibleInstsResponse = {
  success: boolean;
  refno: string;
  refnos: string[];
  error_message?: string | null;
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


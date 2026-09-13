export type SpatialQueryMode = 'range' | 'distance';

export type SpatialQueryCenterSource = 'selected' | 'pick' | 'coordinates' | 'refno';

export type SpatialQueryShape = 'sphere' | 'cube';

export type SpatialQuerySortBy = 'distanceAsc' | 'nameAsc' | 'specThenDistance';

export type SpatialQueryStatus =
  | 'idle'
  | 'resolving-center'
  | 'querying-local'
  | 'querying-server'
  | 'merging-results'
  | 'ready'
  | 'loading-model-for-result'
  | 'loading-results-batch'
  | 'flying-to-result'
  | 'error';

export type SpatialQueryPoint = {
  x: number;
  y: number;
  z: number;
};

export type SpatialQueryServerCenter = SpatialQueryPoint & {
  source: string;
  refno?: string;
};

export type SpatialQueryAabb = {
  min: SpatialQueryPoint;
  max: SpatialQueryPoint;
};

export type SpatialQueryFilters = {
  nouns: string[];
  keyword: string;
  onlyLoaded: boolean;
  onlyVisible: boolean;
  includeNegative: boolean;
  specValues: number[];
};

export type SpatialQueryRequest = {
  mode: SpatialQueryMode;
  centerSource: SpatialQueryCenterSource;
  center: SpatialQueryPoint;
  radius: number;
  shape: SpatialQueryShape;
  filters: SpatialQueryFilters;
  limit: number;
  sortBy: SpatialQuerySortBy;
  refno?: string;
  includeSelf?: boolean;
};

export type SpatialQueryResultItem = {
  refno: string;
  noun: string;
  specValue: number;
  specName: string;
  /** 所属库；gen-model-v1 源由服务端直接给，legacy 结果里没有（批量加载时按 refno 另查） */
  dbnum?: number | null;
  distance: number | null;
  loaded: boolean;
  visible: boolean;
  matchedBy: 'viewer-local' | 'server-spatial-index' | 'merged';
  sourceModel?: string | null;
  name?: string | null;
  position?: SpatialQueryPoint | null;
  bbox?: SpatialQueryAabb | null;
};

export type SpatialQueryResultGroup = {
  specValue: number;
  specName: string;
  count: number;
  items: SpatialQueryResultItem[];
};

/** 完整命中集合按库（dbnum）的计数，不受分页影响；gen-model-v1 源给（它没有专业维度），legacy 没有。 */
export type SpatialQueryDbnumGroupCount = {
  dbnum: number;
  count: number;
};

/**
 * 当前数据源在空间查询上的能力（来自 `getModelSource().spatial.capabilities`）。
 * `specValues=false`（gen-model-v1）时抽屉隐藏专业筛选 / 专业排序 / 专业分组，结果改按库分组。
 */
export type SpatialQueryCapabilities = {
  specValues: boolean;
};

export type SpatialQueryFilterOptions = {
  nouns: {
    value: string;
    count: number;
    isNegative: boolean;
  }[];
  specValues: {
    value: number;
    count: number;
    label: string;
  }[];
  includeNegative: boolean;
};

/**
 * 当前查询条件下的完整命中集合（不受分页影响）。
 *
 * 批量操作（全部显示 / 隔离 / 加载全部筛选结果）需要整个结果集；
 * 只用当前页会让这些操作静默地只作用于一页。
 */
export type SpatialQueryFullMatchSet = {
  refnos: string[];
  byDbnum: Record<string, string[]>;
  bySpecValue: Record<string, string[]>;
  total: number;
  truncated: boolean;
};

export type SpatialQueryResultSet = {
  request: SpatialQueryRequest;
  items: SpatialQueryResultItem[];
  /** 完整命中集合；未取到时批量操作回退到当前页 */
  fullMatches?: SpatialQueryFullMatchSet | null;
  filterOptions?: SpatialQueryFilterOptions | null;
  center?: SpatialQueryServerCenter | null;
  queryBBox?: SpatialQueryAabb | null;
  serverRadius?: number | null;
  serverShape?: SpatialQueryShape | string | null;
  truncatedCandidates?: boolean;
  truncatedResults?: boolean;
  candidateCount?: number | null;
  candidateCap?: number | null;
  resultCap?: number | null;
  page: number;
  perPage: number;
  returnedCount: number;
  totalPages: number;
  hasMore: boolean;
  total: number;
  loadedCount: number;
  unloadedCount: number;
  truncated: boolean;
  warnings: string[];
  groups: SpatialQueryResultGroup[];
  /** 服务端给的按库分组计数（gen-model-v1）；legacy 为 null */
  dbnumGroups?: SpatialQueryDbnumGroupCount[] | null;
  /** gen-model-v1：结果覆盖的索引层（`global-tree` = 只含已生成过模型的构件）；legacy 为 null */
  coverage?: string | null;
};

export type SpatialQueryDraft = {
  mode: SpatialQueryMode;
  rangeCenterSource: Exclude<SpatialQueryCenterSource, 'refno'>;
  distanceCenterSource: Extract<SpatialQueryCenterSource, 'coordinates' | 'refno'>;
  refno: string;
  center: SpatialQueryPoint;
  radius: number;
  shape: SpatialQueryShape;
  nounText: string;
  keyword: string;
  onlyLoaded: boolean;
  onlyVisible: boolean;
  includeNegative: boolean;
  specValues: number[];
  limit: number;
  sortBy: SpatialQuerySortBy;
};

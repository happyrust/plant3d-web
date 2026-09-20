export type SpatialQueryMode = 'range' | 'distance';

/**
 * 查询中心 / 源几何从哪来。`bran_centerline` 只在距离查询里出现：源仍是一个 refno（BRAN），
 * 但服务端沿它的真实中心线走廊量距，而不是取包围盒中心画球。
 */
export type SpatialQueryCenterSource = 'selected' | 'pick' | 'coordinates' | 'refno' | 'bran_centerline';

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
  /**
   * 房间过滤（ADR 0067）：所选房间的 refno（`a_b`）；空 = 不按房间过滤。命中 = 房间归属含任一所选房间，
   * 由服务端分页前过滤（本地扫描判不了归属，所以有它时本地独有命中不追加、「仅看已加载 / 仅看可见」也改走服务端）。
   */
  rooms: string[];
};

/** 抽屉里选中的一间房：refno 是身份，房间号 / 名字只为 chip 显示（来自 `SpatialQueryRoomOption` 或 `roomsOf` 解析）。 */
export type SpatialQueryRoomSelection = {
  /** `a_b` */
  refno: string;
  roomNum: string;
  name: string | null;
};

/** `GET /api/v1/spatial/rooms` 的一间在册房间，可搜索下拉的一个选项。 */
export type SpatialQueryRoomOption = {
  /** `a_b` */
  refno: string;
  roomNum: string;
  name: string | null;
  dbnum: number | null;
  panelCount: number;
};

/** 房间体制此刻的状态（`SpatialSource.rooms()`）：不是 `ready` / `degraded` 就整块收起，`reason` 写为什么。 */
export type SpatialQueryRoomsStatus = {
  status: 'idle' | 'loading' | 'ready' | 'degraded' | 'initializing' | 'disabled' | 'unsupported' | 'failed' | 'error' | (string & {});
  reason: string | null;
};

/** 服务端给的房间过滤状态（`room_status`）；只在请求带了房间时有。 */
export type SpatialQueryRoomStatus = {
  rooms: { refno: string; roomNum: string }[];
  source: string;
  matched: number;
  unresolved: number;
  definitionVersion: string | null;
  libraryAlignmentCurrent: boolean | null;
};

/** 结果分组维度（Q11）：legacy 只有按专业；v1 两维都在，缺省按专业、可切按库。 */
export type SpatialQueryGroupDimension = 'spec' | 'dbnum';

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
 * `specValues=false` 时抽屉隐藏专业筛选 / 专业排序 / 专业分组，结果改按库分组（2026-09-20 起两源都为 true，ADR 0067）。
 */
export type SpatialQueryCapabilities = {
  specValues: boolean;
  /** 源认不认房间过滤（gen-model-v1 true / legacy false）；服务端此刻能不能看 `roomsStatus` */
  rooms: boolean;
  /** 距离查询能否「沿 BRAN 中心线」：legacy 有（`/query?mode=bran_centerline`），gen-model-v1 没有，抽屉据此收起那一档 */
  branCenterline: boolean;
  /** 服务端关键字匹不匹配构件名称：legacy 匹配 refno / noun / name，gen-model-v1 只匹配 refno / noun；抽屉据此切关键字文案 */
  keywordMatchesName: boolean;
  /** 「按名称」是不是真按名称排整个命中集合：legacy 是；gen-model-v1 按 noun / refno 近似排、只为本页补名字，抽屉与结果区据此提示 */
  nameSortExact: boolean;
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
  /** 服务端按 `cap` 截断了全集（gen-model-v1 `result_cap` 100000；legacy 中心线模式一页 10000）：`refnos` 少于 `total`，批量操作只能作用于取到的这部分 */
  truncated: boolean;
  cap?: number | null;
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
  /** 请求带了房间时服务端给的房间过滤状态（ADR 0067）；没带 / legacy 为 null */
  roomStatus?: SpatialQueryRoomStatus | null;
  /**
   * 结果只来自查看器已加载构件的本地扫描，没打服务端：「仅看已加载 / 仅看当前可见」的点模式查询走这里
   * （结果 ⊆ 已加载集，本地扫描对它是完备的），不分页、前端排序。
   */
  localOnly?: boolean;
};

export type SpatialQueryDraft = {
  mode: SpatialQueryMode;
  rangeCenterSource: Exclude<SpatialQueryCenterSource, 'refno' | 'bran_centerline'>;
  distanceCenterSource: Extract<SpatialQueryCenterSource, 'coordinates' | 'refno' | 'bran_centerline'>;
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
  /** 已选房间（ADR 0067）；请求里只发 refno */
  rooms: SpatialQueryRoomSelection[];
  limit: number;
  sortBy: SpatialQuerySortBy;
};

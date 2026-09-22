/**
 * 空间查询的响应 / 请求形状（`SpatialNearbyParams` / `SpatialQueryResult` / `BranNearestClearance*` …）。
 *
 * 这些形状是旧后端 `/api/sqlite-spatial/*` 与 `/api/space/*` 定下来的契约；gen-model-v1 适配器
 * （`model-source/genModelV1/spatialSource.ts`、`useSpatialCompute.ts`）按同一形状给，调用方一行不改。
 * 旧后端的取数函数（`querySpatialIndex` / `queryNearby*` / `fetchNegativeNouns` / `postSpace*` / `queryBranCenterlineNearestClearance` …）
 * 2026-09-20 随 legacy 退役：空间查询走 `getModelSource().spatial`，BRAN 净距走 `genModelV1SpatialNearestClearance`，
 * 管-管 / 管-墙净距走 `genModelV1SurfaceClearance`。下面几个函数类型给 `useSpatialQuery` 的可注入依赖用。
 */
import type { TreeNodeDto } from './genModelE3dTypes';

export type SpatialQueryResultItem = {
  /** "dbnum_refno" 格式的字符串 */
  refno: string;
  noun: string;
  spec_value: number;
  /** 所属库；gen-model-v1 源服务端直接给（DTX 分桶键），legacy 没有这一格、调用方按 refno 查 */
  dbnum?: number;
  /** 构件名称；索引未回填名称且模型库解析失败时缺省 */
  name?: string;
  aabb?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  distance?: number;
};

export type SpatialNearbyCenter = {
  x: number;
  y: number;
  z: number;
  source: string;
  refno?: string;
};

export type SpatialQueryFilterOptions = {
  nouns: {
    value: string;
    count: number;
    is_negative?: boolean;
  }[];
  spec_values: {
    value: number;
    count: number;
  }[];
  include_negative?: boolean;
};

/** 服务端排序方式，与前端 SpatialQuerySortBy 一一对应 */
export type SpatialQuerySortParam = 'distance' | 'name' | 'spec_distance';

export type SpatialQuerySpecGroup = {
  spec_value: number;
  count: number;
};

export type SpatialNearbyParams = {
  refno?: string;
  x?: number;
  y?: number;
  z?: number;
  radius: number;
  /**
   * 源几何。缺省按 refno 的包围盒 / 点量距；`bran_centerline` = 沿该 BRAN 的真实中心线（`tubi_relate` 各段）
   * 走廊量距，只对 `refno` 有效。legacy 后端只有 `/query?mode=bran_centerline` 会走中心线，
   * `queryNearbySpatial` / `queryNearbyRefnos` 见到它就改打 `/query`，`radius` 映射成走廊外扩 `distance`。
   */
  source_mode?: 'bran_centerline';
  /** 查询形状：sphere（默认）| cube */
  shape?: 'cube' | 'sphere';
  /** noun 过滤（逗号分隔，如 "EQUI,PIPE,TUBI"） */
  nouns?: string;
  /** 专业过滤（逗号分隔，如 "1,3"） */
  spec_values?: string;
  /**
   * 房间过滤（逗号分隔的房间 refno `a_b`，ADR 0067）：只保留房间归属含任一所选房间的候选。
   * 只有 gen-model-v1 源认它（`capabilities.rooms`）；legacy 后端没有这一格，`queryNearbySpatial` 不发。
   */
  rooms?: string;
  /** 关键字过滤：服务端对 refno / noun / name 做包含匹配，分页前生效 */
  keyword?: string;
  /** 排序方式：服务端在分页前排序，默认 distance */
  sort?: SpatialQuerySortParam;
  /** 是否包含自身（refno 模式有效） */
  include_self?: boolean;
  /** 是否包含负实体 */
  include_negative?: boolean;
  /** 分页页码，从 1 开始 */
  page?: number;
  /** 每页数量 */
  per_page?: number;
  /** 兼容旧参数：未传 per_page 时作为每页数量 */
  max_results?: number;
};

export type SpatialNearbyOptions = Omit<SpatialNearbyParams, 'refno' | 'x' | 'y' | 'z' | 'radius'>;

/** `rooms` 给了才有的房间过滤状态（gen-model-v1 `room_status`，spec §4.13）。 */
export type SpatialRoomStatus = {
  rooms: { refno: string; room_num: string }[];
  /** `memory` = 读透形态现算；`durable` = 读 `room_relate` 边 */
  source: string;
  matched: number;
  /** 候选里判不出归属、已从结果剔除的条数 */
  unresolved: number;
  definition_version: string | null;
  library_alignment_current: boolean | null;
};

/** `SpatialSource.rooms()` 的结果：在册房间清单 + 房间体制状态（gen-model-v1 `GET /api/v1/spatial/rooms`）。 */
export type SpatialRoomsStatus = 'ready' | 'degraded' | 'initializing' | 'disabled' | 'unsupported' | 'failed' | (string & {});

export type SpatialRoomOption = {
  /** `a_b` */
  refno: string;
  room_num: string;
  name: string | null;
  dbnum: number | null;
  panel_count: number;
};

export type SpatialRoomsResult = {
  success: boolean;
  status: SpatialRoomsStatus;
  /** 非 ready 时为什么 */
  reason?: string | null;
  definition_version?: string | null;
  rooms: SpatialRoomOption[];
  error?: string;
};

// ---- 房间层级树（ADR 0068；只有 gen-model-v1 源有，legacy 回 `success:false`）----

/** 树里的一个构件；`a_b`。`shared_rooms` 只在它属于 ≥ 2 间所选房间时出现。 */
export type SpatialTreeLeafNode = {
  refno: string;
  noun: string;
  distance: number;
  shared_rooms?: number;
};

/**
 * BRAN 单元下的一段直管（隐式管身；方案 B，2026-09-22）：身份 `(单元 refno, from, to, ordinal)`，没有自己的 refno、不计入任何 `count`。
 * `from` / `to` 是两端管件的 `a_b`（容器头 / 尾那一段的一端是 BRAN 自己，`*_noun` 为 `BRAN`）；`length` 直管长度 mm；`aabb` 世界盒 mm，定位用。
 */
export type SpatialTreeTubeNode = {
  ordinal: number;
  from: string;
  to: string;
  from_noun: string;
  to_noun: string;
  distance: number;
  length: number;
  aabb: { min: [number, number, number]; max: [number, number, number] };
  invalid: boolean;
  shared_rooms?: number;
};

/**
 * 一个最小交付单元；`elements` 缺 = 叶子未内联（超上限，按单元另取）。
 * `tube_count` / `tubes` 只有认 `tubes=1` 的服务端才给（老服务端两格都缺 = 没有直段信息）；`tubes` 与 `elements` 同一套内联规则。
 */
export type SpatialTreeUnitNode = {
  refno: string;
  noun: string;
  name: string | null;
  count: number;
  tube_count?: number;
  min_distance: number;
  elements?: SpatialTreeLeafNode[];
  tubes?: SpatialTreeTubeNode[];
};

export type SpatialTreeUnitTypeNode = {
  noun: string;
  count: number;
  tube_count?: number;
  units: SpatialTreeUnitNode[];
};

/** 「其他构件」里按 noun 的一组；`elements` 缺同上（按 noun 另取）。 */
export type SpatialTreeOtherNounNode = {
  noun: string;
  count: number;
  min_distance: number;
  elements?: SpatialTreeLeafNode[];
};

export type SpatialTreeSpecNode = {
  spec_value: number;
  count: number;
  tube_count?: number;
  unit_types: SpatialTreeUnitTypeNode[];
  others: { count: number; by_noun: SpatialTreeOtherNounNode[] };
};

export type SpatialTreeRoomNode = {
  refno: string;
  room_num: string;
  name: string | null;
  count: number;
  tube_count?: number;
  specs: SpatialTreeSpecNode[];
};

/** 叶子超上限后只取一组：单元 refno 或「其他构件」里的一个 noun。 */
export type SpatialTreeLeafSelector = { unit: string } | { otherNoun: string };

/**
 * `SpatialSource.tree()` 的结果：服务端一次聚合的 房间 → 专业 → 最小交付单元类型 → 单元 → 构件（ADR 0068）。
 * 所有 count 按 refno 去重；`total_count` 全树去重（跨房构件只算一次）；`leaves_inline=false` 时 `elements` 都缺、
 * 按 `SpatialTreeLeafSelector` 再取一组（那一次响应 `inlined` 说明是哪一组）。
 */
export type SpatialTreeResult = {
  success: boolean;
  error?: string;
  /** `success:false` 里「源 / 服务端构建没有这条路由」那一档：store 据此退回平铺分组，别的失败是真错误 */
  unsupported?: boolean;
  total_count: number;
  /** 全树按身份去重的直段数；缺 = 服务端不认 `tubes=1`，树里没有直段信息（计数句不画「N 段直管」） */
  total_tube_count?: number;
  /** BRAN 单元数超过服务端读根预算，只为最近的那些补了直段（`warnings` 里也有一句） */
  tubes_truncated?: boolean;
  candidate_count: number;
  truncated_candidates: boolean;
  candidate_cap: number;
  leaves_inline: boolean;
  leaf_cap: number;
  /** 叶子放置数；服务端认 `tubes=1` 时直段放置也算在里面（与 `leaf_cap` 共用） */
  leaf_count: number;
  inlined?: string | null;
  delivery_unit_types: string[];
  rooms: SpatialTreeRoomNode[];
  center?: SpatialNearbyCenter | null;
  radius?: number;
  shape?: string;
  room_status?: SpatialRoomStatus | null;
  warnings?: string[];
  coverage?: string;
  spatial_state?: string;
};

export type SpatialQueryResult = {
  success: boolean;
  results?: SpatialQueryResultItem[];
  /** nearby 响应的服务端权威中心；legacy /query 可能没有该字段 */
  center?: SpatialNearbyCenter;
  /** nearby 响应使用的半径 */
  radius?: number;
  /** nearby 响应使用的形状 */
  shape?: 'cube' | 'sphere' | string;
  /** 是否还有更多结果；兼容旧字段名 */
  truncated?: boolean;
  /** nearby 候选集是否被截断 */
  truncated_candidates?: boolean;
  /** nearby 结果集是否被截断 */
  truncated_results?: boolean;
  /** nearby 候选数量/上限与结果上限元数据 */
  candidate_count?: number;
  candidate_cap?: number;
  result_cap?: number;
  /** 本次查询完整命中数量 */
  total_count?: number;
  /** 当前页返回数量 */
  returned_count?: number;
  /** 当前页码 */
  page?: number;
  /** 当前每页数量 */
  per_page?: number;
  /** 是否还有下一页 */
  has_more?: boolean;
  /** 实际查询使用的 AABB */
  query_bbox?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /** 本次查询结果可用的过滤选项 */
  filter_options?: SpatialQueryFilterOptions;
  /** 完整命中集合按专业分组的计数，不受分页影响 */
  groups?: SpatialQuerySpecGroup[];
  /** 完整命中集合按库（dbnum）分组的计数，不受分页影响；gen-model-v1 源给（它没有专业维度），legacy 没有 */
  dbnum_groups?: SpatialQueryDbnumGroup[];
  /** gen-model-v1 源：结果只覆盖哪一层索引（第一版 `global-tree` = 已生成过模型的构件） */
  coverage?: string;
  /** gen-model-v1 源：服务端空间树状态字面值 */
  spatial_state?: string;
  /** gen-model-v1 源、给了 `rooms` 时：房间过滤的来源与缺口（ADR 0067）；legacy 没有 */
  room_status?: SpatialRoomStatus;
  /** 服务端非致命问题（`/query?mode=bran_centerline` 预取 BRAN 成员表、v1 房间过滤的缺口），查询照常完成 */
  warnings?: string[];
  error?: string;
};

export type SpatialQueryDbnumGroup = {
  dbnum: number;
  count: number;
};

export type SpatialNearbyResult = SpatialQueryResult;

export type SpatialQueryParams = {
  /** `bran_centerline`：以 `refno` 指定的 BRAN 各段中心线为走廊、外扩 `distance` 取候选，再按线段到候选盒的最小距离二次过滤 */
  mode?: 'bbox' | 'refno' | 'position' | 'bran_centerline';
  refno?: string;
  x?: number;
  y?: number;
  z?: number;
  radius?: number;
  /** 外扩距离（毫米） */
  distance?: number;
  minx?: number;
  miny?: number;
  minz?: number;
  maxx?: number;
  maxy?: number;
  maxz?: number;
  /** 兼容旧参数：未传 per_page 时作为每页数量 */
  max_results?: number;
  /** 分页页码，从 1 开始 */
  page?: number;
  /** 每页数量 */
  per_page?: number;
  /** noun 过滤（逗号分隔，如 "EQUI,PIPE,TUBI"） */
  nouns?: string;
  /** 专业过滤（逗号分隔，如 "1,3"） */
  spec_values?: string;
  /** 关键字过滤：服务端对 refno / noun / name 做包含匹配，分页前生效 */
  keyword?: string;
  /** 排序方式：服务端在分页前排序，默认 distance */
  sort?: SpatialQuerySortParam;
  /** 是否包含自身（mode=refno 时有效，默认 true） */
  include_self?: boolean;
  /** 是否包含负实体 */
  include_negative?: boolean;
  /** 查询形状：cube（立方体，默认）| sphere（球体） */
  shape?: 'cube' | 'sphere';
};

/** E3D 世界 mm 的一个点（净距候选的端点 / 包围盒角） */
export type SpaceComputePoint = {
  x: number;
  y: number;
  z: number;
};

export type SpaceComputeVector = {
  dx: number;
  dy: number;
  dz: number;
};

export type BranNearestClearanceTargetGroup = 'wall' | 'column' | string;

/**
 * 结果分桶方式：`target_groups`（默认，wall / column 这类预置组，一个 noun 白名单合成一桶 `target_nouns`）
 * 或 `noun`（半径内每个 NOUN 自成一桶，各桶按 `max_per_group` 截断；不给任何目标过滤 = 全部类型）。
 */
export type BranNearestClearanceGroupBy = 'target_groups' | 'noun';

export type BranNearestClearanceRequest = {
  source_refno: string;
  /**
   * 预置目标组。`group_by` 缺省 / `target_groups` 且 `target_groups` 与 `target_nouns` 都没给时回退 `wall,column`；
   * `group_by=noun` 下两者都是可选过滤，都不给就是半径内所有类型。
   */
  target_groups?: BranNearestClearanceTargetGroup[] | string;
  /** 直接点名的 NOUN 白名单（`EQUI,SUPPO,SCTN`），与 `target_groups` 可并用 */
  target_nouns?: string[] | string;
  group_by?: BranNearestClearanceGroupBy;
  /** 在目标过滤之后再剔掉的噪声类型（`WELD,ATTA`），两种分桶方式都生效 */
  exclude_nouns?: string[] | string;
  /** mm */
  radius?: number;
  scope?: 'same_dbnum' | 'all_loaded' | string;
  max_per_group?: number;
  /** 放行源自身（BRAN + TUBI 段 + 成员构件），默认 false */
  include_self?: boolean;
  debug?: boolean;
};

export type BranNearestClearanceAabb = {
  min: SpaceComputePoint;
  max: SpaceComputePoint;
};

export type BranNearestClearanceNearest = {
  source_segment_refno?: string | null;
  source_segment_order?: number | null;
  source_point: SpaceComputePoint;
  target_point: SpaceComputePoint;
  vector: SpaceComputeVector;
};

export type BranNearestClearanceAnnotation = {
  start_point: SpaceComputePoint;
  end_point: SpaceComputePoint;
  label_mm: number;
};

/**
 * 前端交互写进 BRAN 净距结果的「平行直段间距」候选独有的一格（服务端不发）：两条 BRAN 的直段配成的一对平行段的明细，
 * 表里的行标签与尺寸来源标签用它。`distance_mm` / `annotation.label_mm` 是中心距（两条轴线的垂距，不扣外径）。
 */
export type BranParallelSpacingDetail = {
  /** 源 BRAN（三维里先点的那一根） */
  source_bran_refno: string;
  /** 源 / 目标直段的首段 refno（隐式管身 `a_b~c_d`） */
  source_run_refno: string;
  target_run_refno: string;
  /** 沿源直段轴线的重叠长度（mm） */
  overlap_mm: number;
  /** 两条轴线夹角（度，锐角） */
  angle_deg: number;
  /** 中心距扣掉两侧半径后的净距（mm，可为负）；任一侧外径未知为 null */
  clearance_mm: number | null;
  source_outside_diameter_mm: number | null;
  target_outside_diameter_mm: number | null;
};

export type BranNearestClearanceCandidate = {
  refno: string;
  noun: string;
  spec_value?: number | null;
  distance_mm: number;
  intersects?: boolean;
  aabb?: BranNearestClearanceAabb;
  nearest?: BranNearestClearanceNearest | null;
  annotation?: BranNearestClearanceAnnotation | null;
  /**
   * 前端交互写入的候选独有（服务端不发）：同一目标 refno 在同一桶里可以有多条时用它区分（两条 BRAN 之间每对平行直段一条），
   * 进 `branCandidateKey`。服务端候选没有这一格 = 一目标一条。
   */
  variant?: string;
  /** 前端交互写入的「平行直段间距」候选独有（服务端不发） */
  parallel?: BranParallelSpacingDetail;
};

export type BranNearestClearanceGroupResult = {
  group: string;
  nouns?: string[];
  candidates: BranNearestClearanceCandidate[];
};

/** 两个后端都可能把答不出的格发成 `null`（gen-model-v1 的 `Option<T>` 序列化），所以这里 `?` 与 `| null` 并存。 */
export type BranNearestClearanceSource = {
  kind?: string;
  refno?: string;
  dbnum?: number | string | null;
  segment_count?: number | null;
  centerline_bbox?: BranNearestClearanceAabb | null;
};

export type BranNearestClearanceResolvedFilters = {
  /** 生效的 NOUN 白名单；空 = 不限 NOUN（只在 `group_by=noun` 且没给目标过滤时出现） */
  target_nouns?: string[];
  target_groups?: { name: string; nouns: string[] }[];
  group_by?: BranNearestClearanceGroupBy | string;
  exclude_nouns?: string[];
  scope?: string;
  dbnums?: number[] | null;
  radius?: number;
  max_per_group?: number;
  include_self?: boolean;
};

export type BranNearestClearanceDebug = {
  candidate_ids?: number;
  rows_examined?: number;
  rows_missing_items?: number;
  rows_missing_aabb?: number;
  scope_filtered?: number;
  noun_filtered?: number;
  distance_filtered?: number;
  /** 因属于源自身被剔掉的候选数，与顶层 `excluded_self_members` 同源 */
  self_filtered?: number;
  groups_with_hits?: number;
  returned_candidates?: number;
};

export type BranNearestClearanceResponse = {
  success: boolean;
  /** `group_by=noun` 时每桶 `group` 就是 NOUN 名；老响应是对象形态，`normalizeBranNearestGroups` 两种都收 */
  nearest_by_group?: Record<string, BranNearestClearanceCandidate[]> | BranNearestClearanceGroupResult[];
  /** 半径内、过完全部过滤的候选按 NOUN 计数（`max_per_group` 截断之前），可直接做类型 facet；两种分桶方式都带 */
  noun_counts?: Record<string, number>;
  /** 因属于源自身（源 refno、BRAN 的 TUBI 段与全部成员构件）而被排除的候选数 */
  excluded_self_members?: number;
  warnings?: string[];
  error?: string;
  message?: string;
  unit?: string;
  distance_method?: string;
  source?: BranNearestClearanceSource;
  query_bbox?: BranNearestClearanceAabb | null;
  resolved_filters?: BranNearestClearanceResolvedFilters | null;
  /** 仅 `debug=1` 时返回 */
  debug?: BranNearestClearanceDebug;
};

export type SpatialNearbyRefnosResult = {
  success: boolean;
  /** 完整命中集合（未分页） */
  refnos: string[];
  /** 按 dbnum 分组的命中集合 */
  by_dbnum: Record<string, string[]>;
  /** 按专业分组的命中集合 */
  by_spec_value: Record<string, string[]>;
  total_count: number;
  /** 是否因为超过服务端硬上限被截断 */
  truncated: boolean;
  cap: number;
  /** gen-model-v1 源、给了 `rooms` 时（ADR 0067）；legacy 没有 */
  room_status?: SpatialRoomStatus;
  warnings?: string[];
  error?: string;
};

export type NegativeNounsResult = {
  success: boolean;
  /** 全量负实体 noun 清单（大写、去重、排序） */
  nouns: string[];
};

// ============================================================================
// 可注入取数函数的类型（`useSpatialQuery` 的 `SpatialQueryStoreOptions`；缺省实现委托 `getModelSource().spatial`）
// ============================================================================

export type QuerySpatialIndexFn = (params: SpatialQueryParams) => Promise<SpatialQueryResult>;
export type QueryNearbyRefnosFn = (params: SpatialNearbyParams) => Promise<SpatialNearbyRefnosResult>;
export type QueryNearbyByRefnoFn = (refno: string, radius: number, options?: SpatialNearbyOptions) => Promise<SpatialNearbyResult>;
export type QueryNearbyByPositionFn = (x: number, y: number, z: number, radius: number, options?: SpatialNearbyOptions) => Promise<SpatialNearbyResult>;
export type FetchNegativeNounsFn = () => Promise<NegativeNounsResult>;

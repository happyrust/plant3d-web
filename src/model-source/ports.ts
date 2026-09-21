/**
 * 模型数据源端口（plan `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` §5 / P1-3）。
 *
 * 模型树与三维模型两条数据链的取数点，从「直接调某个 API 模块」改成「通过这四个接口」：
 * - `TreeSource`：根 / 子节点 / 祖先链 / 搜索 / 子树 refno 集 / 可见实例集（`usePdmsOwnerTree` 的 7 处取数）；
 * - `ModelRecordSource`：`refno → InstanceEntry[]`（`useDbnoInstancesDtxLoader` 喂给 DTX 层的形状）；
 * - `MeshSource`：`geo_hash → GLB URL`（`ensureGeometryForGeoHash` 的 URL 模板）；
 * - `AttributeSource`：属性面板 / BRAN-HANG 规则要的 `uiAttr` / `typeInfo`；
 * - `KeypointSource`：测量捕捉的 P-Point / 基本体关键点（2026-09-12 加入）；
 * - `SpatialSource`：抽屉「范围 / 距离查询」的邻近查询（2026-09-13 加入，见下）；
 * - `ModelVersionSource`：版本对比的「模型版本」列表 / 几何（2026-09-18 加入，ADR 0065；legacy 侧同日退役，只剩退役提示）。
 *
 * 接口形状沿用 legacy 时代的函数形状（`NodeResponse` / `ChildrenResponse` / `Map<string, InstanceEntry[]>` …），
 * `genModelV1` 适配器负责把 `EleTreeNode` / `GeomInstQuery` 映射成这些形状（P2 / P3）。
 * legacy 适配器（旧后端 `:3100` + parquet / DuckDB-WASM）已于 2026-09-20 退役，只剩 gen-model-v1 一种源。
 *
 * 这里只有类型，没有运行时代码。
 */
import type {
  AncestorsResponse,
  ChildrenResponse,
  NodeResponse,
  SearchRequest,
  SearchResponse,
  SubtreeRefnosResponse,
  VisibleInstsResponse,
} from '@/api/genModelE3dTypes';
import type {
  PdmsTypeInfoResponse,
  PdmsUiAttrResponse,
  PtsetChildrenResponse,
  PtsetResponse,
} from '@/api/genModelPdmsAttrApi';
import type {
  NegativeNounsResult,
  SpatialNearbyParams,
  SpatialNearbyRefnosResult,
  SpatialNearbyResult,
  SpatialRoomsResult,
  SpatialTreeLeafSelector,
  SpatialTreeResult,
} from '@/api/genModelSpatialApi';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

/**
 * 数据源种类。只剩 `gen-model-v1`（gen-model `/api/v1`）：`legacy`（旧后端 `:3100` + parquet / DuckDB-WASM）
 * 2026-09-20 随生产切换退役，`?model_source=` / `VITE_MODEL_SOURCE` 开关一并删除。
 */
export type ModelSourceKind = 'gen-model-v1';

export const MODEL_SOURCE_KINDS: readonly ModelSourceKind[] = ['gen-model-v1'];

/** 缺省（也是唯一）数据源。2026-09-09 翻到 `gen-model-v1`，2026-09-20 legacy 退役后不再有第二个值。 */
export const DEFAULT_MODEL_SOURCE_KIND: ModelSourceKind = 'gen-model-v1';

/**
 * 测量捕捉的基本体 / PLINE 语义关键点候选（世界坐标 mm，已按 world_transform × geo_local 折叠）。
 * 原先定义在 legacy 的 parquet loader 里（`primitive_keypoints.parquet` 的行形状），2026-09-20 随 legacy 退役挪到端口：
 * gen-model-v1 的 `element/plines` 起 / 终点也按这个形状给（`keypointSource.ts`），测量工具只认这一种。
 */
export type PrimitiveKeyPointCandidate = {
  id: string;
  refno: string;
  objectId: string;
  geoHash: string;
  geoIndex: number;
  keypointIndex: number;
  kind: string;
  source: string;
  label?: string;
  local: [number, number, number];
  world: [number, number, number];
  hasDir: boolean;
  dir: [number, number, number] | null;
  /**
   * PLINE 端点（`kind` `pline_start` / `pline_end`）：E3D `PLSTCUT / PLENCUT`——这一端按 `DRNS / DRNE`
   * 斜切后的位置（世界系，同 `world`）；平头端面没有。Pick Settings「Pline End Position = Cut」时用它当端点。
   */
  plineCut?: [number, number, number] | null;
  circle?: {
    center: [number, number, number];
    rim: [number, number, number];
    normal: [number, number, number];
  };
  arc?: {
    center: [number, number, number];
    rim: [number, number, number];
    normal: [number, number, number];
  };
};

export type SubtreeRefnosParams = {
  includeSelf?: boolean;
  maxDepth?: number;
  limit?: number;
};

/** 模型树取数。refno 一律本仓内部键 `dbno_seqno`（`a_b`），转换由适配器负责。 */
export type TreeSource = {
  /** 单根。gen-model 没有单一 WORL，适配器合成虚拟根（D4-A）。 */
  worldRoot(): Promise<NodeResponse>;
  node(refno: string): Promise<NodeResponse>;
  /** 直接成员，按存储顺序；`limit` 由适配器自己截（gen-model 服务端不截断）。 */
  children(refno: string, limit?: number): Promise<ChildrenResponse>;
  /** 祖先链；现有定位算法已声明不依赖顺序，只要求 `a_b` 归一。 */
  ancestors(refno: string): Promise<AncestorsResponse>;
  search(req: SearchRequest): Promise<SearchResponse>;
  /** 子树 refno 集；gen-model 源下改为「有几何的构件集 ∪ BFS children」（plan §3）。 */
  subtreeRefnos(refno: string, params?: SubtreeRefnosParams): Promise<SubtreeRefnosResponse>;
  /** 有几何的叶子 refno；gen-model 源下 = `ensure(force=false)` 的 `generation_roots` + `records`（D5-A）。 */
  visibleInsts(refno: string): Promise<VisibleInstsResponse>;
};

/** `queryInstanceEntriesByRefnos` 现有 options 的子集。 */
export type InstanceEntryQueryOptions = {
  debug?: boolean;
  forceRefresh?: boolean;
  includeOwnedTubings?: boolean;
  /** 调用方声明这批 refno 所属的最小交付单元根；两个适配器目前都不校验，透传保留（plan 2026-09-18 §7.2 第 2 组）。 */
  expectedRootRefno?: string;
  /** 人明确要求重生成（gen-model 源下 = `ensure(force=true)`）；legacy 源忽略 */
  forceRegenerate?: boolean;
};

/** 几何实例取数：`dbno` 是 DTX 缓存 / 可见性 / 选中的分桶键（D3），gen-model 源下由 `ref0s` 表解出。 */
export type ModelRecordSource = {
  instanceEntriesByRefnos(
    dbno: number,
    refnos: string[],
    options?: InstanceEntryQueryOptions,
  ): Promise<Map<string, InstanceEntry[]>>;
};

/** 网格 URL 模板。`1/2/3`、`tubi_*`、`t_*` 由调用方本地造几何，不会走到这里。 */
export type MeshSource = {
  /** `lodAssetKey`：legacy 的 LOD 档位（`L1`…）；gen-model 只有一档，适配器忽略它。 */
  meshUrl(geoHash: string, lodAssetKey: string): string;
};

/** 属性面板与类型查询。 */
export type AttributeSource = {
  uiAttr(refno: string): Promise<PdmsUiAttrResponse>;
  typeInfo(refno: string): Promise<PdmsTypeInfoResponse>;
};

export type KeypointQueryOptions = {
  forceRefresh?: boolean;
};

/**
 * SCTN 名下把 p-line 分段的成员（E3D Pick Settings「Significant Snap Points」：`EDGPLINE.snapLine` 收的
 * FITT / SJOI / SUBJ / SNOD）。`world` 与 `PrimitiveKeyPointCandidate.world` 同一坐标系（世界系 mm），
 * 测量工具按 E3D `LINE.near` 把它投到同一构件的每条 p-line 上。
 */
export type PlineSnapPointCandidate = {
  refno: string;
  /** `FITT` / `SJOI` / `SUBJ` / `SNOD` */
  noun: string;
  kind: 'fitting' | 'joint' | 'node';
  /** 沿轴离 `POSS` 的距离（mm） */
  zdis: number;
  world: [number, number, number];
  /** 例如 `SNOD 24381/177316` */
  label: string;
};

/** `primitiveKeypoints` 的结果：候选与「为什么少 / 没有」的原因并列，由测量工具决定怎么提示。 */
export type PrimitiveKeypointsResult = {
  items: PrimitiveKeyPointCandidate[];
  /** 每条来源各自的失败原因（parquet 表缺、接口不支持…）；有候选时也可能非空（部分来源失败） */
  errors: string[];
  /** 与 PLINE 候选同一构件的 Significant Snap 分段点（只有 gen-model-v1 的 SCTN 给；legacy 与 GENSEC 没有） */
  plineSnapPoints?: PlineSnapPointCandidate[];
};

/**
 * 测量捕捉的关键点取数（2026-09-12 起随 gen-model-v1 加入端口）。
 *
 * 返回形状**故意等于**旧后端 `/api/pdms/ptset` 的契约（`PtsetResponse` / `PtsetChildrenResponse`）：
 * `usePtsetSnap`、`usePtsetVisualizationThree`、`ptsetTransform` 全按它换算，两种源下测量工具一行不改。
 * - `legacy`：`ptsets.parquet` 优先、`:3100 /api/pdms/ptset` 兜底（`usePtsetRuntimeLookup` 原样）；
 *   基本体 / PLINE 关键点读 `primitive_keypoints.parquet` + 语义捕捉点表。
 * - `gen-model-v1`：`POST /api/v1/element/ptset`（直读 dabacon 的目录 P 点集，mm + 列主序世界矩阵）；
 *   成员点集用 `include_members`；PLINE 关键点走 `POST /api/v1/element/plines`（SCTN / GENSEC 的目录 p-line
 *   起 / 终点，世界系 mm，2026-09-14 起）；基本体显著点不给（E3D Element × Snap 回落元素原点，d-336）。
 */
export type KeypointSource = {
  /** 单构件 P-Point（E3D PTSET）。`dbno` 是 legacy parquet 分桶键，v1 源不需要。 */
  ptset(dbno: number, refno: string, options?: KeypointQueryOptions): Promise<PtsetResponse>;
  /** 直属成员的 P-Point（BRAN / EQUI 这类容器自身没有 P-Point 时悬停显示的是成员的点）。 */
  memberPtsets(dbno: number, ownerRefno: string, options?: KeypointQueryOptions): Promise<PtsetChildrenResponse>;
  /** 基本体 / PLINE 语义关键点候选（世界坐标已按 world_transform × geo_local 折叠）。 */
  primitiveKeypoints(dbno: number, refno: string, options?: KeypointQueryOptions): Promise<PrimitiveKeypointsResult>;
};

/** 空间查询源在两种后端下的能力差异，抽屉据此增减 UI。 */
export type SpatialSourceCapabilities = {
  /**
   * 结果带专业（`spec_value`）维度：legacy 有；gen-model-v1 自 2026-09-20 起也有（ADR 0067：服务端按属主链上 SITE 名的
   * 关键字派生，与 legacy 同一规则），此前 plan 2026-09-13 §5-1「v1 隐藏专业维度」作废。
   */
  readonly specValues: boolean;
  /**
   * 认不认 `rooms` 过滤、有没有 `rooms()` 清单（ADR 0067）：gen-model-v1 有（`/api/v1/spatial/rooms` + `nearby?rooms=`），
   * legacy 没有。这是「源会不会」；服务端此刻「能不能」（开关关 / 模型未就绪）看 `rooms()` 回来的 `status`。
   */
  readonly rooms: boolean;
  /**
   * `nearby / nearbyRefnos` 认不认 `source_mode: 'bran_centerline'`（沿 BRAN 真实中心线走廊量距）：
   * legacy 走 `/query?mode=bran_centerline`；gen-model-v1 的 `GLOBAL_AABB_TREE` 只有包围盒，没有这一档。
   */
  readonly branCenterline: boolean;
  /**
   * 服务端关键字匹不匹配构件**名称**：legacy 的 `/api/sqlite-spatial/*` 按 refno / noun / name 匹配；
   * gen-model-v1 只按 refno / noun（全集匹配名称要对全部候选读记录，大半径下会拖成秒级），抽屉据此切关键字文案。
   */
  readonly keywordMatchesName: boolean;
  /**
   * 服务端 `sort=name` 是不是真按名称排整个命中集合：legacy 是；gen-model-v1 只为本页补名字，全集按 noun / refno
   * 作近似序（spec §4.13：名称要回元素记录读 `NAME`，对全部候选做会拖成秒级），抽屉据此在「按名称」下给提示。
   */
  readonly nameSortExact: boolean;
  /**
   * 有没有房间层级树（ADR 0068）：gen-model-v1 有（`nearby/tree`，选了房间的查询以树代替平铺分组），legacy 没有。
   * 与 `rooms` 一样是「源会不会」；树态还要求本次请求带了房间（Q4：没选房间不建树）。
   */
  readonly tree: boolean;
};

/**
 * 抽屉「范围查询 / 距离查询」的邻近查询取数（plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md`
 * §3.4，P2 起随 gen-model-v1 加入端口）。
 *
 * 三个方法的形状**故意等于**`genModelSpatialApi.ts` 现有的 `queryNearbySpatial` / `queryNearbyRefnos` / `fetchNegativeNouns`，
 * `useSpatialQuery` 的合并 / 翻页 / 全部显示 / 隔离语义一行不改：
 * - `legacy`：零逻辑委托旧后端 `/api/sqlite-spatial/{nearby, nearby/refnos, negative-nouns}`；
 * - `gen-model-v1`：`GET /api/v1/spatial/{nearby, nearby/refnos, negative-nouns}`，候选来自服务进程内的 `GLOBAL_AABB_TREE`
 *   （只含已生成过模型的构件），refno 归一 `a_b`、`spec_value` 缺省 0、`groups` 直接透传 dbnum 分组（P3）。
 * 参数里 `refno` 与 `x,y,z` 二选一由调用方保证；`page / per_page` 对 `nearbyRefnos` 无意义，适配器负责忽略。
 */
export type SpatialSource = {
  /** 按 refno 或点 + 半径查周边构件，服务端分页前排序 / 过滤；`filter_options` / `groups` 是全集口径。 */
  nearby(params: SpatialNearbyParams): Promise<SpatialNearbyResult>;
  /** 同一组条件下的完整命中 refno 集（不分页）；「全部显示 / 隔离 / 加载全部」按它作用于整个结果集。 */
  nearbyRefnos(params: SpatialNearbyParams): Promise<SpatialNearbyRefnosResult>;
  /** 负实体 noun 全量清单；唯一事实源在服务端（`TOTAL_NEG_NOUN_NAMES`），前端不自带硬编码。 */
  negativeNouns(): Promise<NegativeNounsResult>;
  /**
   * 在册房间清单 + 房间体制此刻的状态（ADR 0067，Q4 / Q5）：抽屉打开时拉一次画可搜索下拉；`status` 不是 `ready` / `degraded`
   * 就整块收起并写 `reason`。不支持房间过滤的源（legacy）回 `{ success: true, status: 'unsupported', rooms: [] }`，不打后端。
   */
  rooms(): Promise<SpatialRoomsResult>;
  /**
   * 某构件所在房间的 refno（`a_b`，任一归属、按归属强弱序，去重）。两源都答得出：legacy 走旧后端 `room-tree/ancestors`
   * （房间 = `room-group:` 之前那一级），gen-model-v1 走 `POST /api/v1/query` 的 `e3d.room.lookup`。
   * 「当前选中所在房间」与结果区「房间列表」都吃它；解不出归属回空数组，取数失败才抛。
   */
  roomsOf(refno: string): Promise<string[]>;
  /**
   * 房间层级树（ADR 0068）：同 `nearby` 的一组条件（必须带 `rooms`）由服务端一次折成 房间 → 专业 → 最小交付单元类型 →
   * 单元 → 构件，覆盖全集、不分页、计数按 refno 去重；`page / per_page / sort` 被忽略。叶子超上限时 `leaves_inline=false`，
   * 用 `only` 再取一组。不支持的源（legacy）回 `{ success: false, rooms: [] , error }`，不打后端。
   */
  tree(params: SpatialNearbyParams, only?: SpatialTreeLeafSelector): Promise<SpatialTreeResult>;
  /**
   * 一间在册房间的房间层级树（ADR 0068，`GET /api/v1/spatial/rooms/{refno}/tree`，spec §4.13.6）：以房间自身的包围盒为范围、
   * `rooms=` 它自己、不算它自己的面板；响应同 `tree()`，`rooms[]` 恒一条。模型树「房间」页签展开一间房时吃它（plan
   * 2026-09-20-spatial-room-hierarchy-tree §4.5）。房间没生成过面板模型 → `success:false`（`error` 是原因）；房间体制不可用同 `tree()`。
   */
  roomTree(roomRefno: string, options?: SpatialRoomTreeOptions, only?: SpatialTreeLeafSelector): Promise<SpatialTreeResult>;
  readonly capabilities: SpatialSourceCapabilities;
};

/** `roomTree()` 的可选过滤：`margin` 是房间盒的外扩量（mm，缺省 0 = 与房间盒相交），其余同 `nearby` 的同名过滤。 */
export type SpatialRoomTreeOptions = {
  margin?: number;
  nouns?: string[];
  keyword?: string;
  includeNegative?: boolean;
  dbnums?: number[];
  specValues?: number[];
};

/** 一个模型版本对模型的影响；五态词表沿用 ADR 0045（前端与词汇表都在用），gen-model-v1 `model/versions` 按同一词表给。 */
export type ModelVersionImpactKind = 'mesh' | 'placement' | 'delivery' | 'noop' | 'tombstone';

/**
 * 一个「模型版本」（CONTEXT.md「模型版本查看」）：身份 = `(dbnum, unitRefno, sesno)`，其余是展示信息。
 * 由谁、怎么把它算出来（gen-model-v1 历史投影）不进入身份。
 */
export type ModelVersion = {
  dbnum: number;
  /** 最小交付单元根，本仓内部键 `a_b` */
  unitRefno: string;
  unitNoun: string;
  sesno: number;
  /** RFC3339 会话时刻；解不出为 null */
  sessionTime: string | null;
  impactKind: ModelVersionImpactKind;
  /**
   * 「几何相同」承诺键：两个版本的键相等 ⇒ 适配器保证几何逐条相同，调用方可以只加载一次。
   * gen-model-v1 目前不给（undefined）；以后可给 `noop` 版本填上一版的键，同样省一次加载。
   */
  geometryKey?: string;
  /** 适配器私有的取数句柄。调用方不得解读，只在事件里原样携带。 */
  handle?: unknown;
};

/** 一个模型版本的几何：`ModelRecordSource` 同型的实例表 + 有几何的 refno 集。 */
export type ModelVersionGeometry = {
  /** 该版本下单元子树里有几何的 refno（`a_b`）；「已删除单元版本」为空 */
  refnos: string[];
  /** 喂 `geometrySnapshotsFromInstanceEntries` / DTX 层（`instanceEntriesByRefno`）的形状 */
  entries: Map<string, InstanceEntry[]>;
  /**
   * 该版本下已知的直接属主（`a_b → a_b`），给模型树差异模式里「已删除节点回插到原父」用（`TreeDiffModel.ownerRefno`）。
   * gen-model-v1 从历史投影行的 `anc`（自身 → 顶层）拆出来，链上每一级都进表。
   * 尽力而为：查不到的 refno 不在表里，树会回落挂根。
   */
  ownerByRefno?: ReadonlyMap<string, string>;
  /** 适配器私有的取数句柄（gen-model-v1：`snapshot_key`；tombstone / 空几何没有）。调用方不得解读，只原样交回 `attributesAt`。 */
  handle?: unknown;
  /** 释放服务端资源：gen-model-v1 = `DELETE /api/v1/model/history/{snapshot_key}` */
  release(): Promise<void>;
};

export type ModelVersionLoadOptions = {
  signal?: AbortSignal;
};

/** 一个模型版本下某构件的一行属性；与属性面板吃的 `element/attributes` 行同型（同一个渲染器印同一个字）。 */
export type ModelVersionAttributeRow = {
  name: string;
  valueType: string;
  display: string;
  isUnset: boolean;
  isUda: boolean;
};

/**
 * 「属性历史对比」的一侧：某构件在某个模型版本下的属性（gen-model-refactor ADR-081 候选条，`history/query tool=attributes`）。
 * 该 refno 在那个版本不存在（还没建 / 已删）→ `exists: false`、`attributes: []`，是正常态而不是错误。
 */
export type ModelVersionAttributes = {
  sesno: number;
  exists: boolean;
  noun: string | null;
  attributes: ModelVersionAttributeRow[];
};

/** 构件版本时间线的一行：同一个会话上，构件自己一列、它所属单元一列（`null` = 那一侧没变）。 */
export type ModelElementVersion = {
  sesno: number;
  /** RFC3339 会话时刻；解不出为 null */
  sessionTime: string | null;
  /** 该构件自身记录在这一会话的变化；`null` = 它自己没变，这一版是单元里别的东西变的 */
  elementImpact: ModelVersionImpactKind | null;
  /** 所属单元在这一会话的折叠影响；`null` = 单元表里没有这一会话 */
  unitImpact: ModelVersionImpactKind | null;
};

/** 一个构件的版本时间线 + 它所属的最小交付单元（对比几何要按单元生成，所以这条必须带出来）。 */
export type ModelElementVersionTimeline = {
  dbnum: number;
  /** 本仓内部键 `a_b` */
  refno: string;
  noun: string;
  /** 所属最小交付单元根（`a_b`）；owner 链上没有单元（如 ZONE 自身）为 null，那种构件对不了几何 */
  unitRefno: string | null;
  unitNoun: string | null;
  versions: ModelElementVersion[];
  /**
   * 服务端还没有 `element/versions` 这条路由（旧构建）时为 true：此时 `versions` 里只有单元那一列，
   * 左列一律 `null`，面板据此说明「本构件那一列要新版服务端」，而不是假装它一次都没变过。
   */
  unitColumnOnly: boolean;
};

/** 对比范围（CONTEXT「对比范围」）：`self` 只看节点自身那一条记录；`subtree` 节点 + 其下整棵子树。 */
export type ModelNodeDiffScope = 'self' | 'subtree';

/** 一个属性在某一会话前后的两个字；`before` / `after` 为 null = 那一侧没有这一行（或 unset）。 */
export type ModelAttributeChange = {
  name: string;
  valueType: string;
  before: string | null;
  after: string | null;
  /** `CACHID` 一类编辑器的戳：标出来但不算业务变化 */
  stamp: boolean;
};

/** 属性变化时间线的一行：它自身记录被改过的一个会话（CONTEXT「属性变化时间线」）。 */
export type ModelAttributeHistoryEntry = {
  sesno: number;
  sessionTime: string | null;
  /** E3D 会话页记的保存人 */
  user: string;
  /** SAVEWORK 备注 */
  comment: string;
  kind: 'created' | 'modified' | 'deleted';
  /** 与版本表同一词表：created → delivery，deleted → tombstone，modified → mesh / placement / noop */
  impact: ModelVersionImpactKind;
  /** 属性行数 + 成员表变了算一项 + owner 改挂算一项 */
  changedCount: number;
  changes: ModelAttributeChange[];
  members: { added: string[]; removed: string[]; reordered: boolean } | null;
  /** owner 改挂 `[before, after]`（`a_b`） */
  owner: [string, string] | null;
  /** 属性行渲染不出来的原因（模板缺失等） */
  attributesUnavailable: string | null;
};

/** 某节点的属性变化时间线（gen-model-v1 `GET /api/v1/element/attribute-history`）。 */
export type ModelAttributeHistory = {
  dbnum: number;
  /** `a_b` */
  refno: string;
  noun: string;
  unitRefno: string | null;
  unitNoun: string | null;
  /** 按链序旧 → 新 */
  entries: ModelAttributeHistoryEntry[];
};

/**
 * 节点 A / B 两版之间的属性净差（CONTEXT「属性净差」，gen-model-v1 `GET /api/v1/element/attribute-diff`）：服务端两端各钉一个会话
 * 直接读终态、同一个渲染器两端各出一次字，不折时间线——改过又改回去的天然不算；成员 / owner 给的是两端的真差。
 */
export type ModelAttributeDiff = {
  dbnum: number;
  /** `a_b` */
  refno: string;
  noun: string;
  unitRefno: string | null;
  unitNoun: string | null;
  a: number;
  b: number;
  /** created = A 侧不存在；deleted = B 侧不存在；unchanged = 两端一字没差、影响也判不出（原样换页不是它的一版） */
  kind: 'created' | 'modified' | 'deleted' | 'unchanged';
  /** 与版本表同一词表：created → delivery，deleted → tombstone，modified → mesh / placement / noop；unchanged 为 null */
  impact: ModelVersionImpactKind | null;
  /** 属性行数 + 成员表有差算一项 + owner 改挂算一项 */
  changedCount: number;
  /** created 列 B 侧全部已设的属性（before 空）；deleted 列 A 侧全部已设的属性（after 空） */
  changes: ModelAttributeChange[];
  /** 成员表两端的真差（`a_b`）；没差为 null */
  members: { added: string[]; removed: string[]; reordered: boolean } | null;
  /** owner 改挂 `[A 侧, B 侧]`（`a_b`）；没改为 null */
  owner: [string, string] | null;
  /** 某一端属性行渲染不出来的原因（模板缺失等）；此时 `changes` 可能为空但 `kind` / `impact` 仍成立 */
  attributesUnavailable: string | null;
  warnings: string[];
};

/** 节点版本表的一行（CONTEXT「节点版本表」）：范围内折出来的一档影响 + 动了几个单元 + 节点自身那一格。 */
export type ModelNodeVersion = {
  sesno: number;
  sessionTime: string | null;
  /** 范围内折出来的影响：节点自身出现 / 被删压过一切，否则子树里最重的一档 */
  impact: ModelVersionImpactKind;
  /** 节点自身记录在这一会话的变化；null = 它自己没变（只有子树变了） */
  selfImpact: ModelVersionImpactKind | null;
  /** 这一会话有几何要重算的最小交付单元数 */
  unitsChanged: number;
  /** 这一会话记录被动过的最小交付单元数（含 noop） */
  unitsTouched: number;
};

/** 某节点按范围折叠的版本表（gen-model-v1 `GET /api/v1/node/versions`）；容器「所有子节点」下的时间线只有它能列。 */
export type ModelNodeVersionTimeline = {
  dbnum: number;
  /** `a_b` */
  refno: string;
  noun: string;
  scope: ModelNodeDiffScope;
  /** 节点自己所属的最小交付单元根（`a_b`）；容器为 null */
  unitRefno: string | null;
  unitNoun: string | null;
  /** 按链序旧 → 新 */
  versions: ModelNodeVersion[];
};

export type ModelNodeDiffStatus = 'added' | 'deleted' | 'modified' | 'noop';

export type ModelNodeDiffRow = {
  /** `a_b` */
  refno: string;
  noun: string | null;
  status: ModelNodeDiffStatus;
  impact: ModelVersionImpactKind;
  /** 就是被查询的那个节点 */
  isNode: boolean;
};

export type ModelNodeDiffCounts = { added: number; deleted: number; modified: number; noop: number };

/** 差异摘要里按最小交付单元分的一组；`unitRefno` 为 null = 这些行不在任何单元下（ZONE 自身之类）。 */
export type ModelNodeDiffGroup = {
  unitRefno: string | null;
  unitNoun: string | null;
  unitName: string | null;
  counts: ModelNodeDiffCounts;
  /** 这一组有没有几何要重算（决定它算不算「变了的单元」） */
  geometryChanged: boolean;
  rows: ModelNodeDiffRow[];
  rowsTruncated: number;
};

/**
 * 节点 A→B 的差异摘要（CONTEXT「差异摘要」，gen-model-v1 `GET /api/v1/node/diff-summary`）：不生成几何的一张账，
 * 前端拿「变了的单元」去逐个 `loadVersion`，未变的一份都不算；`needsConfirm` 由服务端成本策略给。
 */
export type ModelNodeDiffSummary = {
  dbnum: number;
  /** `a_b` */
  refno: string;
  noun: string | null;
  scope: ModelNodeDiffScope;
  a: number;
  b: number;
  units: { changed: number; unchanged: number; total: number; complete: boolean };
  elements: ModelNodeDiffCounts;
  groups: ModelNodeDiffGroup[];
  needsConfirm: boolean;
  estimatedProjections: number;
  confirmThresholdUnits: number;
  warnings: string[];
};

/**
 * 版本对比取数（ADR 0065，plan `docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §2）。
 *
 * - `gen-model-v1`：`GET /api/v1/model/versions` + `model/history/generate | query`（`genModelV1/versionSource.ts`）。
 * 面板与 ViewerPanel 只认 `ModelVersion` / `ModelVersionGeometry`。「最新环境模型」= 打开对比时视口里已加载的该 dbnum
 * 模型（CONTEXT，Q12），刷新环境走页面级开关下的 records + forceRefresh，不经这里。
 */
export type ModelVersionSource = {
  /** 该最小交付单元的全部模型版本，按 sesno 升序。 */
  listVersions(dbnum: number, unitRefno: string): Promise<ModelVersion[]>;
  /**
   * 某个**构件**的版本时间线（「查看某个构件的所有历史版本」）：每一行两列，左列是它自己这条记录变没变、
   * 右列是它所属单元在同一会话的折叠影响。只给左列会漏——抬一根管子会让邻居的派生管身跟着变、改目录也能
   * 在不碰构件记录的前提下换它的形状，那些版本左列为空、右列有值。
   *
   * 传单元根进来同样成立（左列 = 单元根这条记录自己变了）。对比几何仍按 `unitRefno` 走 `listVersions` /
   * `loadVersion`：几何只按单元生成，构件级对比是在单元结果上收窄。
   */
  listElementVersions(dbnum: number, refno: string): Promise<ModelElementVersionTimeline>;
  /** 一个版本的几何；`impactKind === 'tombstone'` 返回空集而不是抛错（「已删除单元版本」）。 */
  loadVersion(version: ModelVersion, options?: ModelVersionLoadOptions): Promise<ModelVersionGeometry>;
  /**
   * 某构件在 `geometry` 所属版本下的属性（属性历史对比）。`geometry` 必须是本源 `loadVersion` 给出、尚未 `release()` 的那份；
   * 没有句柄的几何（tombstone / 空几何）直接回 `exists: false`。
   */
  attributesAt(geometry: ModelVersionGeometry, refno: string, options?: ModelVersionLoadOptions): Promise<ModelVersionAttributes>;
  /**
   * 某节点的属性变化时间线（ADR 0066）：谁在哪一版改了什么，带会话 user / comment 与逐属性 before / after。
   * 服务端没有这条路由（旧构建）→ 抛 `ModelVersionRouteUnavailableError`，面板据此只给版本表那一半。
   */
  attributeHistory(dbnum: number, refno: string, options?: ModelVersionLoadOptions): Promise<ModelAttributeHistory>;
  /**
   * 某节点 A / B 两版之间的属性净差（ADR 0066 / CONTEXT「属性净差」）：服务端两端各钉一个会话直接读终态，不折时间线、不要快照；
   * 成员增删 / 重排与 owner 改挂给的是两端的真差。「仅自身」的属性对比与「所有子节点」下点开一个构件都吃它。
   * 服务端没有这条路由（旧构建）→ 抛 `ModelVersionRouteUnavailableError`，面板据此回落到把属性变化时间线在 (A, B] 里折。
   */
  attributeDiff(
    dbnum: number,
    refno: string,
    a: number,
    b: number,
    options?: ModelVersionLoadOptions,
  ): Promise<ModelAttributeDiff>;
  /**
   * 某节点按范围折叠的版本表（ADR 0066 / CONTEXT「节点版本表」）：`subtree` 下容器也列得出子树的时间线，每版附动了几个单元。
   * 服务端没有这条路由 → 抛 `ModelVersionRouteUnavailableError`，面板据此退回「手填会话号」。
   */
  listNodeVersions(
    dbnum: number,
    refno: string,
    scope: ModelNodeDiffScope,
    options?: ModelVersionLoadOptions,
  ): Promise<ModelNodeVersionTimeline>;
  /**
   * 节点 A→B 的差异摘要（ADR 0066）：按范围过滤、按单元分组、不生成几何。
   * 服务端没有这条路由 → 抛 `ModelVersionRouteUnavailableError`。
   */
  diffSummary(
    dbnum: number,
    refno: string,
    a: number,
    b: number,
    scope: ModelNodeDiffScope,
    options?: ModelVersionLoadOptions,
  ): Promise<ModelNodeDiffSummary>;
};

export type ModelSource = {
  readonly kind: ModelSourceKind;
  readonly tree: TreeSource;
  readonly records: ModelRecordSource;
  readonly meshes: MeshSource;
  readonly attributes: AttributeSource;
  readonly keypoints: KeypointSource;
  readonly spatial: SpatialSource;
  readonly versions: ModelVersionSource;
};

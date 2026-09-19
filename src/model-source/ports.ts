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
 * 接口形状**故意等于**现有 legacy 函数的形状（`NodeResponse` / `ChildrenResponse` / `Map<string, InstanceEntry[]>` …），
 * 这样 `legacy` 适配器是零逻辑的委托，大量 `*.test.ts` 依赖的旧函数签名一个都不动；`genModelV1` 适配器
 * 负责把 `EleTreeNode` / `GeomInstQuery` 映射成这些形状（P2 / P3）。
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
} from '@/api/genModelSpatialApi';
import type { PrimitiveKeyPointCandidate } from '@/composables/useDbnoInstancesParquetLoader';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

/** 数据源种类。`legacy` = 旧后端 `:3100` + parquet / DuckDB-WASM；`gen-model-v1` = gen-model `/api/v1`。 */
export type ModelSourceKind = 'legacy' | 'gen-model-v1';

export const MODEL_SOURCE_KINDS: readonly ModelSourceKind[] = ['legacy', 'gen-model-v1'];

/**
 * 缺省数据源。2026-09-09 起为 `gen-model-v1`（收口计划 2026-09-09 D8：数据级对拍 v1 ⊇ legacy + 浏览器 / records
 * 三类节点逐条相等，母计划 §8.13）；`legacy` 经 `?model_source=legacy` / `VITE_MODEL_SOURCE=legacy` 仍可切回，
 * 开关保留一个发布周期。
 */
export const DEFAULT_MODEL_SOURCE_KIND: ModelSourceKind = 'gen-model-v1';

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
  /** 结果带专业（`spec_value`）维度：legacy 有；gen-model-v1 的几何投影里没有这一列（plan §5-1 按 (a)：隐藏专业筛选 / 分组，改按 dbnum）。 */
  readonly specValues: boolean;
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
  readonly capabilities: SpatialSourceCapabilities;
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
 * - `gen-model-v1`：`GET /api/v1/model/versions` + `model/history/generate | query`（`genModelV1/versionSource.ts`）；
 * - `legacy`：已退役（2026-09-18，plan §7），两个方法都抛 `LegacyModelVersionsRetiredError`。
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

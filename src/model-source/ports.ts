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
 * - `ModelVersionSource`：版本对比的「模型版本」列表 / 几何 / 最新环境模型（2026-09-18 加入，ADR 0065）。
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
import type { ParquetManifest, PrimitiveKeyPointCandidate } from '@/composables/useDbnoInstancesParquetLoader';
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

/** `queryInstanceEntriesByRefnos` 现有 options 的子集；parquet 专有项（`pinnedManifest`）留在 legacy 内部。 */
export type InstanceEntryQueryOptions = {
  debug?: boolean;
  forceRefresh?: boolean;
  includeOwnedTubings?: boolean;
  manifestUrl?: string;
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

/** 一个模型版本对模型的影响；与 legacy `impact_kind` 同一词表（ADR 0045 起前端与词汇表都在用）。 */
export type ModelVersionImpactKind = 'mesh' | 'placement' | 'delivery' | 'noop' | 'tombstone';

/**
 * 一个「模型版本」（CONTEXT.md「模型版本查看」）：身份 = `(dbnum, unitRefno, sesno)`，其余是展示信息。
 * 由谁、怎么把它算出来（legacy 不可变 manifest / gen-model-v1 历史投影）不进入身份。
 */
export type ModelVersion = {
  dbnum: number;
  /** 最小交付单元根，本仓内部键 `a_b` */
  unitRefno: string;
  unitNoun: string;
  sesno: number;
  /** RFC3339；legacy 给模型提交的 `generated_at`，gen-model-v1 给会话时刻；解不出为 null */
  sessionTime: string | null;
  impactKind: ModelVersionImpactKind;
  /**
   * 这一版实际使用的模型资产来自哪个 sesno：等于自身 = 自己生成；早于自身 = 无几何变化提交复用较早资产
   * （legacy `artifact_sesno`）。gen-model-v1 没有资产复用的概念，不给。
   */
  assetSesno?: number;
  /**
   * 「几何相同」承诺键：两个版本的键相等 ⇒ 适配器保证几何逐条相同，调用方可以只加载一次。
   * legacy = `${dbnum}:${unitRefno}:${artifact_sesno}`；gen-model-v1 不给（undefined）。
   */
  geometryKey?: string;
  /** 适配器私有的取数句柄（legacy：manifest URL）。调用方不得解读，只在事件里原样携带。 */
  handle?: unknown;
};

/** 一个模型版本的几何：`ModelRecordSource` 同型的实例表 + 有几何的 refno 集。 */
export type ModelVersionGeometry = {
  /** 该版本下单元子树里有几何的 refno（`a_b`）；「已删除单元版本」为空 */
  refnos: string[];
  /** 喂 `geometrySnapshotsFromInstanceEntries` / DTX 层（`instanceEntriesByRefno`）的形状 */
  entries: Map<string, InstanceEntry[]>;
  /** 释放服务端资源：gen-model-v1 = `DELETE /api/v1/model/history/{snapshot_key}`；legacy 空操作 */
  release(): Promise<void>;
};

/**
 * 把已加载的环境 refno 重钉到「最新环境模型」时要传给 DTX 加载器的取数选项：
 * legacy = 钉住的最新 manifest（与 2026-09-18 之前 `refreshModelUnitCompareEnvironment` 逐字相同）；
 * gen-model-v1 = 空（加载器按页面级开关走 records + forceRefresh，CONTEXT「最新环境模型」按 Q12 改口）。
 */
export type ModelVersionEnvironmentLoaderOptions = {
  dataSource?: 'parquet' | 'gen-model-v1';
  parquetManifestUrl?: string;
  parquetManifest?: ParquetManifest;
};

export type ModelVersionEnvironmentPin = {
  /** 环境模型的时间戳（legacy = 最新 manifest 的 `generated_at`；gen-model-v1 = null，常驻投影没有单一时间戳） */
  generatedAt: string | null;
  loaderOptions: ModelVersionEnvironmentLoaderOptions;
};

export type ModelVersionLoadOptions = {
  signal?: AbortSignal;
};

/**
 * 版本对比取数（ADR 0065，plan `docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §2）。
 *
 * 形状**故意贴着** 2026-09-18 之前 `ModelUnitVersionComparePanel` 内联的取数：
 * - `legacy`：`listModelUnitCommits` + 两句 parquet 查询原样委托（`legacy/versionSource.ts`）；
 * - `gen-model-v1`：`GET /api/v1/model/versions` + `model/history/generate | query`（A2 / A3 接入前抛「尚未接入」）。
 * 面板与 ViewerPanel 只认 `ModelVersion` / `ModelVersionGeometry`，不再知道 manifest。
 */
export type ModelVersionSource = {
  /** 该最小交付单元的全部模型版本，按 sesno 升序。 */
  listVersions(dbnum: number, unitRefno: string): Promise<ModelVersion[]>;
  /** 一个版本的几何；`impactKind === 'tombstone'` 返回空集而不是抛错（「已删除单元版本」）。 */
  loadVersion(version: ModelVersion, options?: ModelVersionLoadOptions): Promise<ModelVersionGeometry>;
  /** 打开对比 / 显式刷新环境时，把「最新环境模型」钉下来。 */
  pinLatestEnvironment(dbnum: number): Promise<ModelVersionEnvironmentPin>;
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

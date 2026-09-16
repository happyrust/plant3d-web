/**
 * 模型数据源端口（plan `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` §5 / P1-3）。
 *
 * 模型树与三维模型两条数据链的取数点，从「直接调某个 API 模块」改成「通过这四个接口」：
 * - `TreeSource`：根 / 子节点 / 祖先链 / 搜索 / 子树 refno 集 / 可见实例集（`usePdmsOwnerTree` 的 7 处取数）；
 * - `ModelRecordSource`：`refno → InstanceEntry[]`（`useDbnoInstancesDtxLoader` 喂给 DTX 层的形状）；
 * - `MeshSource`：`geo_hash → GLB URL`（`ensureGeometryForGeoHash` 的 URL 模板）；
 * - `AttributeSource`：属性面板 / BRAN-HANG 规则要的 `uiAttr` / `typeInfo`；
 * - `KeypointSource`：测量捕捉的 P-Point / 基本体关键点（2026-09-12 加入）；
 * - `SpatialSource`：抽屉「范围 / 距离查询」的邻近查询（2026-09-13 加入，见下）。
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

export type ModelSource = {
  readonly kind: ModelSourceKind;
  readonly tree: TreeSource;
  readonly records: ModelRecordSource;
  readonly meshes: MeshSource;
  readonly attributes: AttributeSource;
  readonly keypoints: KeypointSource;
  readonly spatial: SpatialSource;
};

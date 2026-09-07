/**
 * 模型数据源端口（plan `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` §5 / P1-3）。
 *
 * 模型树与三维模型两条数据链的取数点，从「直接调某个 API 模块」改成「通过这四个接口」：
 * - `TreeSource`：根 / 子节点 / 祖先链 / 搜索 / 子树 refno 集 / 可见实例集（`usePdmsOwnerTree` 的 7 处取数）；
 * - `ModelRecordSource`：`refno → InstanceEntry[]`（`useDbnoInstancesDtxLoader` 喂给 DTX 层的形状）；
 * - `MeshSource`：`geo_hash → GLB URL`（`ensureGeometryForGeoHash` 的 URL 模板）；
 * - `AttributeSource`：属性面板 / BRAN-HANG 规则要的 `uiAttr` / `typeInfo`。
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
import type { PdmsTypeInfoResponse, PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

/** 数据源种类。`legacy` = 旧后端 `:3100` + parquet / DuckDB-WASM；`gen-model-v1` = gen-model `/api/v1`。 */
export type ModelSourceKind = 'legacy' | 'gen-model-v1';

export const MODEL_SOURCE_KINDS: readonly ModelSourceKind[] = ['legacy', 'gen-model-v1'];

export const DEFAULT_MODEL_SOURCE_KIND: ModelSourceKind = 'legacy';

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

export type ModelSource = {
  readonly kind: ModelSourceKind;
  readonly tree: TreeSource;
  readonly records: ModelRecordSource;
  readonly meshes: MeshSource;
  readonly attributes: AttributeSource;
};

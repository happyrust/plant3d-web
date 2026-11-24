/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * - `tree`：`treeSource.ts`（P2，含 D5-A 的 `visibleInsts`）；
 * - `records`：`modelRecordSource.ts`（按祖先查 records → `InstanceEntry`，按根收、按构件缓存；生成走 `generateThenCollect`——
 *   右键显式重新生成，或显示路径「库无模型 / 节点查空 → 默认重新生成」）；
 * - `meshes`：`/api/v1/meshes/{hash}.mesh`（rkyv 原样直连，`parseMeshGeometry` 解；
 *   2026-09-09 拍板替代 P0-1 的服务端转 GLB，`.glb` 口径留一个发布周期）；原网格另有打包取
 *   `meshBatch.ts`（`POST /api/v1/meshes/batch`，2026-11-10 方案 A4；旧后端没有这条路由时自动退回逐个取）；
 * - `attributes`：`attributeSource.ts`（P4：`uiAttr` → `element/attributes`，`typeInfo` → 树节点两跳）；
 * - `keypoints`：`keypointSource.ts`（2026-09-12：测量 P-Point → `element/ptset`，成员点集 `include_members`；
 *   基本体关键点服务端无接口，回空带原因）；
 * - `spatial`：`spatialSource.ts`（2026-09-13 空间范围查询 P3：抽屉范围 / 距离查询 → `/api/v1/spatial/{nearby, nearby/refnos,
 *   negative-nouns}`，候选来自服务进程内 `GLOBAL_AABB_TREE`；无专业维度，`capabilities.specValues = false`）。
 */

import { createGenModelV1AttributeSource } from './attributeSource';
import {
  collectDbnumRefnos,
  resetDbnumServerEntrySupport,
  type CollectDbnumOptions,
  type CollectDbnumResult,
} from './collectDbnum';
import { createGenModelV1KeypointSource } from './keypointSource';
import { createGenModelV1MeshBatcher } from './meshBatch';
import { recordsMemberBatchSize } from './modelRecords';
import { createGenModelV1ModelRecordSource, type GenModelV1ModelRecordSource } from './modelRecordSource';
import { createGenModelV1SpatialSource } from './spatialSource';
import { createGenModelV1TreeSource } from './treeSource';
import { createGenModelV1ModelVersionSource } from './versionSource';

import type { MeshSource, ModelSource } from '../ports';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';
import { invalidateGenModelV1DbMetaInfo } from '@/composables/useDbMetaInfo';
import { invalidateGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import {
  ensureGenModelV1Freshness,
  noteGenModelV1RequestFailure,
  useGenModelV1Health,
} from '@/composables/useGenModelV1Health';
import { subscribeModelTreeDataSourceChange } from '@/composables/useModelTreeSourceStore';
import {
  createGenModelV1GenerationGuard,
  subscribeGenModelV1GenerationChange,
} from '@/model-source/genModelV1/serviceLifecycle';
import { buildGenModelV1Url } from '@/utils/apiBase';

// 原网格的打包取。可不可用由它自己探测：`/health` 的 capabilities 里有没有那两格，发出去的请求回没回 405。
const meshBatcher = createGenModelV1MeshBatcher({
  url: () => buildGenModelV1Url('/api/v1/meshes/batch'),
  capabilities: () => useGenModelV1Health().state.capabilities,
});

/**
 * 页面地址上的 `gm_records_batch`：顶层 SITE 拆成 ZONE 查记录时一发带几个 ZONE。`0` / `1` 关掉打包（一个 ZONE 一发），
 * 别的正整数改个数；不给就用缺省（`recordsMemberBatchSize`）。量前后对照、出了问题临时关掉用。
 */
function recordsBatchOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('gm_records_batch');
  } catch {
    return null;
  }
}

const meshes: MeshSource = {
  // legacy 的 LOD 键在这里没有意义；粗网格是同一个键加 ?lod=1（生成时开 AIOS_MESH_LOD1 才有）。
  // URL 以 .mesh 收尾，DTX 加载链据此选 parseMeshGeometry（legacy 的 .glb 仍走 parseGlbGeometry）。
  meshUrl: (geoHash) => genModelV1MeshUrl(geoHash),
  lod1MeshUrl: (geoHash) => genModelV1MeshUrl(geoHash, undefined, 1),
  batch: meshBatcher,
};

/** v1 源在四个端口之外多出来的能力：记录源的缓存 / 进度，以及 `show_dbnum` 整库收集（P3-c）。 */
export type GenModelV1ModelSource = ModelSource & {
  readonly kind: 'gen-model-v1';
  readonly records: GenModelV1ModelRecordSource;
  /** 该库全部 SITE 逐个按祖先查 records（进记录源缓存），回构件 refno 集；调用方再分批装进 DTX */
  collectDbnum(dbnum: number, options?: CollectDbnumOptions): Promise<CollectDbnumResult>;
  /** 由模型数据源注册表调用；启动 health owner 与服务代次失效订阅。 */
  activate(): void;
  dispose(): void;
};

export function createGenModelV1ModelSource(): GenModelV1ModelSource {
  const records = createGenModelV1ModelRecordSource({
    ensureFreshness: () => ensureGenModelV1Freshness(),
    noteRequestFailure: noteGenModelV1RequestFailure,
    // 顶层 SITE 按它的 ZONE 并行查（SITE 只是容器，生成根都在 ZONE 之下）
    expandAncestor: (refno, signal) => tree.topLevelSiteMembers(refno, signal),
    // ZONE 多的 SITE 十几个 ZONE 打包成一发（后端在 /health 的 capabilities 里声明了批量形才打包；8 万件的 SITE 531 发 → 约 50 发）
    memberBatchSize: (members) => recordsMemberBatchSize(useGenModelV1Health().state.capabilities, recordsBatchOverride(), members),
  });
  // 树的 visibleInsts 与几何加载共用一份按祖先查询的缓存：一次显示只打一次 records
  const tree = createGenModelV1TreeSource({
    collectByAncestor: (refno, options) => records.collectByAncestor(refno, options),
    ensureFreshness: () => ensureGenModelV1Freshness(),
    noteRequestFailure: noteGenModelV1RequestFailure,
  });
  let releaseHealth: (() => void) | null = null;
  let unsubscribeGeneration: (() => void) | null = null;
  let unsubscribeTreeSource: (() => void) | null = null;

  function activate(): void {
    if (releaseHealth) return;
    unsubscribeGeneration = subscribeGenModelV1GenerationChange(() => {
      records.invalidate();
      tree.invalidate();
      // 后端换了一代：上一代试出来的「没有打包路由」作废（部署新后端之后不用刷新页面就用得上）
      meshBatcher.reset();
      invalidateGenModelV1Dbnums();
      invalidateGenModelV1DbMetaInfo();
      resetDbnumServerEntrySupport();
    });
    unsubscribeTreeSource = subscribeModelTreeDataSourceChange(() => {
      tree.invalidate();
    });
    releaseHealth = useGenModelV1Health().activateDataSource();
  }

  function dispose(): void {
    unsubscribeTreeSource?.();
    unsubscribeTreeSource = null;
    unsubscribeGeneration?.();
    unsubscribeGeneration = null;
    releaseHealth?.();
    releaseHealth = null;
  }

  async function collectDbnum(dbnum: number, options: CollectDbnumOptions = {}): Promise<CollectDbnumResult> {
    await ensureGenModelV1Freshness();
    const guard = createGenModelV1GenerationGuard(options.signal);
    try {
      const result = await collectDbnumRefnos(tree, records, dbnum, {
        ...options,
        signal: guard.signal,
      });
      guard.assertCurrent();
      return result;
    } catch (error) {
      noteGenModelV1RequestFailure(error);
      // 调用方取消 / 服务换代盖过途中先抛出来的那个错（sleep 的裸 Error、某一发请求的 network…），分型统一
      guard.assertCurrent();
      throw error;
    } finally {
      guard.dispose();
    }
  }

  return {
    kind: 'gen-model-v1',
    tree,
    meshes,
    records,
    attributes: createGenModelV1AttributeSource({ tree }),
    keypoints: createGenModelV1KeypointSource(),
    spatial: createGenModelV1SpatialSource(),
    versions: createGenModelV1ModelVersionSource(),
    collectDbnum,
    activate,
    dispose,
  };
}

export * from './collectDbnum';
export * from './treeSource';
export * from './meshBatch';
export * from './modelRecords';
export * from './modelRecordSource';
export * from './instanceMapping';
export * from './attributeSource';
export * from './keypointSource';
export * from './spatialSource';
export * from './versionSource';

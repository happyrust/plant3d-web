/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * - `tree`：`treeSource.ts`（P2，含 D5-A 的 `visibleInsts`）；
 * - `records`：`modelRecordSource.ts`（P3：ensure → records → `InstanceEntry`，按根收、按构件缓存）；
 * - `meshes`：`/api/v1/meshes/{hash}.mesh`（rkyv 原样直连，`parseMeshGeometry` 解；
 *   2026-09-09 拍板替代 P0-1 的服务端转 GLB，`.glb` 口径留一个发布周期）；
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
  type CollectDbnumLifecycle,
  type CollectDbnumOptions,
  type CollectDbnumResult,
} from './collectDbnum';
import { createGenModelV1KeypointSource } from './keypointSource';
import { resetBatchRecordsSupport } from './modelRecords';
import { createGenModelV1ModelRecordSource, type GenModelV1ModelRecordSource } from './modelRecordSource';
import { createGenModelV1SpatialSource } from './spatialSource';
import { createGenModelV1TreeSource } from './treeSource';
import { createGenModelV1ModelVersionSource } from './versionSource';

import type { MeshSource, ModelSource } from '../ports';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';
import { invalidateGenModelV1DbMetaInfo } from '@/composables/useDbMetaInfo';
import { invalidateGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import {
  currentDbnumModelCapability,
  ensureGenModelV1Freshness,
  noteGenModelV1RequestFailure,
  refreshGenModelV1AfterTaskNotFound,
  useGenModelV1Health,
} from '@/composables/useGenModelV1Health';
import {
  assertGenModelV1ServiceGeneration,
  createGenModelV1GenerationGuard,
  getGenModelV1ServiceGeneration,
  subscribeGenModelV1GenerationChange,
} from '@/model-source/genModelV1/serviceLifecycle';

const meshes: MeshSource = {
  // gen-model 只有一档网格，legacy 的 LOD 键在这里没有意义。
  // URL 以 .mesh 收尾，DTX 加载链据此选 parseMeshGeometry（legacy 的 .glb 仍走 parseGlbGeometry）。
  meshUrl: (geoHash) => genModelV1MeshUrl(geoHash),
};

/** v1 源在四个端口之外多出来的能力：记录源的缓存 / 进度，以及 `show_dbnum` 整库收集（P3-c）。 */
export type GenModelV1ModelSource = ModelSource & {
  readonly kind: 'gen-model-v1';
  readonly records: GenModelV1ModelRecordSource;
  /** 该库全部 SITE 逐个 ensure → records（进记录源缓存），回构件 refno 集；调用方再分批装进 DTX */
  collectDbnum(dbnum: number, options?: CollectDbnumOptions): Promise<CollectDbnumResult>;
  /** 由模型数据源注册表调用；启动 health owner 与服务代次失效订阅。 */
  activate(): void;
  dispose(): void;
};

export function createGenModelV1ModelSource(): GenModelV1ModelSource {
  const records = createGenModelV1ModelRecordSource({
    ensureFreshness: () => ensureGenModelV1Freshness(),
    noteRequestFailure: noteGenModelV1RequestFailure,
  });
  // 树的 visibleInsts 与几何加载共用一份 ensure → records 缓存：一次显示只打一次 ensure + 一次 records
  const tree = createGenModelV1TreeSource({
    ensureAndCollect: (refno, options) => records.ensureAndCollect(refno, options),
    ensureFreshness: () => ensureGenModelV1Freshness(),
    noteRequestFailure: noteGenModelV1RequestFailure,
  });
  const collectLifecycle: CollectDbnumLifecycle = {
    capability: currentDbnumModelCapability,
    generation: getGenModelV1ServiceGeneration,
    assertGeneration: assertGenModelV1ServiceGeneration,
    refreshAfterTaskNotFound: async () => (await refreshGenModelV1AfterTaskNotFound()).generation,
    noteRequestFailure: noteGenModelV1RequestFailure,
  };
  let releaseHealth: (() => void) | null = null;
  let unsubscribeGeneration: (() => void) | null = null;

  function activate(): void {
    if (releaseHealth) return;
    unsubscribeGeneration = subscribeGenModelV1GenerationChange(() => {
      records.invalidate();
      tree.invalidate();
      invalidateGenModelV1Dbnums();
      invalidateGenModelV1DbMetaInfo();
      resetDbnumServerEntrySupport();
      resetBatchRecordsSupport();
    });
    releaseHealth = useGenModelV1Health().activateDataSource();
  }

  function dispose(): void {
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
        lifecycle: collectLifecycle,
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
export * from './modelRecords';
export * from './modelRecordSource';
export * from './instanceMapping';
export * from './attributeSource';
export * from './keypointSource';
export * from './spatialSource';
export * from './versionSource';

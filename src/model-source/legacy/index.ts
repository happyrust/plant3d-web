/**
 * `legacy` 数据源适配器：原样委托现有函数，零逻辑（plan P1-3）。
 *
 * 这一层存在的意义是让 `usePdmsOwnerTree` / `useDbnoInstancesDtxLoader` 在 P2 / P3 改成通过端口取数时，
 * `model_source=legacy` 下的行为与今天**逐字节相同**——每个方法就是一次转发，不加缓存、不改参数、不吞错误。
 */
import { legacySpatialSource } from './spatialSource';
import { legacyModelVersionSource } from './versionSource';

import type {
  AttributeSource,
  KeypointSource,
  MeshSource,
  ModelRecordSource,
  ModelSource,
  PrimitiveKeypointsResult,
  TreeSource,
} from '../ports';

import {
  e3dGetAncestors,
  e3dGetChildren,
  e3dGetNode,
  e3dGetSubtreeRefnos,
  e3dGetVisibleInsts,
  e3dGetWorldRoot,
  e3dSearch,
} from '@/api/genModelE3dApi';
import { pdmsGetPtsetChildrenWithContext, pdmsGetTypeInfo, pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { queryPtsetWithRuntimeFallback } from '@/composables/usePtsetRuntimeLookup';
import { buildBackendUrl } from '@/utils/apiBase';

const tree: TreeSource = {
  worldRoot: () => e3dGetWorldRoot(),
  node: (refno) => e3dGetNode(refno),
  children: (refno, limit) => e3dGetChildren(refno, limit),
  ancestors: (refno) => e3dGetAncestors(refno),
  search: (req) => e3dSearch(req),
  subtreeRefnos: (refno, params) => e3dGetSubtreeRefnos(refno, params),
  visibleInsts: (refno) => e3dGetVisibleInsts(refno),
};

/**
 * parquet loader 是个带内部 ref 的 composable；`useDbnoInstancesDtxLoader` 也是每次调用时 `useDbnoInstancesParquetLoader()`
 * 拿一份，这里照抄同一形态（不在模块顶层持有实例，避免测试里 `vi.mock` 之后拿到的是 mock 之前的那份）。
 */
const records: ModelRecordSource = {
  instanceEntriesByRefnos: (dbno, refnos, options) =>
    useDbnoInstancesParquetLoader().queryInstanceEntriesByRefnos(dbno, refnos, options),
};

/** 与 `useDbnoInstancesDtxLoader.ensureGeometryForGeoHash` 现有模板逐字相同。 */
export function legacyMeshUrl(geoHash: string, lodAssetKey: string): string {
  return buildBackendUrl(`/files/meshes/lod_${lodAssetKey}/${geoHash}_${lodAssetKey}.glb`);
}

const meshes: MeshSource = {
  meshUrl: legacyMeshUrl,
};

const attributes: AttributeSource = {
  uiAttr: (refno) => pdmsGetUiAttr(refno),
  typeInfo: (refno) => pdmsGetTypeInfo(refno),
};

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * 与 2026-09-12 之前 `useXeokitMeasurementTools` 内联的取数逐字相同：
 * P-Point 走 `queryPtsetWithRuntimeFallback`（parquet 优先、`:3100` API 兜底）；成员点集直连
 * `/api/pdms/ptset/children`；基本体 + PLINE 语义关键点两张 parquet 表 `allSettled` 后平铺，
 * 失败原因逐条保留给工具拼提示。
 */
const keypoints: KeypointSource = {
  ptset: (dbno, refno, options) =>
    queryPtsetWithRuntimeFallback(useDbnoInstancesParquetLoader(), dbno, refno, {
      forceRefresh: options?.forceRefresh,
    }),
  memberPtsets: (dbno, ownerRefno) => pdmsGetPtsetChildrenWithContext(ownerRefno, { dbno }),
  async primitiveKeypoints(dbno, refno, options): Promise<PrimitiveKeypointsResult> {
    const loader = useDbnoInstancesParquetLoader();
    const results = await Promise.allSettled([
      loader.queryPrimitiveKeypointsByRefnoFromParquet(dbno, refno, options),
      loader.querySemanticSnapPointsByRefnoFromParquet(dbno, refno, options),
    ]);
    return {
      items: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      errors: results.flatMap((result) => (result.status === 'rejected' ? [errorText(result.reason)] : [])),
    };
  },
};

export function createLegacyModelSource(): ModelSource {
  return {
    kind: 'legacy',
    tree,
    records,
    meshes,
    attributes,
    keypoints,
    spatial: legacySpatialSource,
    versions: legacyModelVersionSource,
  };
}

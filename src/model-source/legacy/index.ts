/**
 * `legacy` 数据源适配器：原样委托现有函数，零逻辑（plan P1-3）。
 *
 * 这一层存在的意义是让 `usePdmsOwnerTree` / `useDbnoInstancesDtxLoader` 在 P2 / P3 改成通过端口取数时，
 * `model_source=legacy` 下的行为与今天**逐字节相同**——每个方法就是一次转发，不加缓存、不改参数、不吞错误。
 */
import type { AttributeSource, MeshSource, ModelRecordSource, ModelSource, TreeSource } from '../ports';

import {
  e3dGetAncestors,
  e3dGetChildren,
  e3dGetNode,
  e3dGetSubtreeRefnos,
  e3dGetVisibleInsts,
  e3dGetWorldRoot,
  e3dSearch,
} from '@/api/genModelE3dApi';
import { pdmsGetTypeInfo, pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
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

export function createLegacyModelSource(): ModelSource {
  return { kind: 'legacy', tree, records, meshes, attributes };
}

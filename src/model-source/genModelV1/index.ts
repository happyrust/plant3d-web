/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * - `tree`：`treeSource.ts`（P2，含 D5-A 的 `visibleInsts`）；
 * - `records`：`modelRecordSource.ts`（P3：ensure → records → `InstanceEntry`，按根收、按构件缓存）；
 * - `meshes`：`/api/v1/meshes/{hash}.mesh`（rkyv 原样直连，`parseMeshGeometry` 解；
 *   2026-09-09 拍板替代 P0-1 的服务端转 GLB，`.glb` 口径留一个发布周期）；
 * - `attributes`：`attributeSource.ts`（P4：`uiAttr` → `element/attributes`，`typeInfo` → 树节点两跳）。
 */

import { createGenModelV1AttributeSource } from './attributeSource';
import { collectDbnumRefnos, type CollectDbnumOptions, type CollectDbnumResult } from './collectDbnum';
import { createGenModelV1ModelRecordSource, type GenModelV1ModelRecordSource } from './modelRecordSource';
import { createGenModelV1TreeSource } from './treeSource';

import type { MeshSource, ModelSource } from '../ports';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';

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
};

export function createGenModelV1ModelSource(): GenModelV1ModelSource {
  const records = createGenModelV1ModelRecordSource();
  // 树的 visibleInsts 与几何加载共用一份 ensure → records 缓存：一次显示只打一次 ensure + 一次 records
  const tree = createGenModelV1TreeSource({ ensureAndCollect: (refno, options) => records.ensureAndCollect(refno, options) });
  return {
    kind: 'gen-model-v1',
    tree,
    meshes,
    records,
    attributes: createGenModelV1AttributeSource({ tree }),
    collectDbnum: (dbnum, options) => collectDbnumRefnos(tree, records, dbnum, options),
  };
}

export * from './collectDbnum';
export * from './treeSource';
export * from './modelRecords';
export * from './modelRecordSource';
export * from './instanceMapping';
export * from './attributeSource';

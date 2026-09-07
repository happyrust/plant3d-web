/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * - `tree`：`treeSource.ts`（P2，含 D5-A 的 `visibleInsts`）；
 * - `records`：`modelRecordSource.ts`（P3：ensure → records → `InstanceEntry`，按根收、按构件缓存）；
 * - `meshes`：`/api/v1/meshes/{hash}.glb`（P0-1）；
 * - `attributes`：`attributeSource.ts`（P4：`uiAttr` → `element/attributes`，`typeInfo` → 树节点两跳）。
 */

import { createGenModelV1AttributeSource } from './attributeSource';
import { createGenModelV1ModelRecordSource } from './modelRecordSource';
import { createGenModelV1TreeSource } from './treeSource';

import type { MeshSource, ModelSource } from '../ports';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';

const meshes: MeshSource = {
  // gen-model 只有一档网格，legacy 的 LOD 键在这里没有意义
  meshUrl: (geoHash) => genModelV1MeshUrl(geoHash),
};

export function createGenModelV1ModelSource(): ModelSource {
  const tree = createGenModelV1TreeSource();
  return {
    kind: 'gen-model-v1',
    tree,
    meshes,
    records: createGenModelV1ModelRecordSource(),
    attributes: createGenModelV1AttributeSource({ tree }),
  };
}

export * from './treeSource';
export * from './modelRecords';
export * from './modelRecordSource';
export * from './instanceMapping';
export * from './attributeSource';

/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * P2 接线：`tree` 走 `treeSource.ts`（含 D5-A 的 `visibleInsts`），`meshes` 走 `/api/v1/meshes/{hash}.glb`（P0-1 已 live）。
 * `records`（P3-b：`GeomInstQuery → InstanceEntry`）与 `attributes`（P4：`element/attributes`）**暂时仍委托 legacy**——
 * 这两条链的调用方（`useDbnoInstancesDtxLoader` / 属性面板）还没改成通过端口取数，先换掉也没人读。
 */

import { createLegacyModelSource } from '../legacy';

import { createGenModelV1TreeSource } from './treeSource';

import type { MeshSource, ModelSource } from '../ports';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';

const meshes: MeshSource = {
  // gen-model 只有一档网格，legacy 的 LOD 键在这里没有意义
  meshUrl: (geoHash) => genModelV1MeshUrl(geoHash),
};

export function createGenModelV1ModelSource(): ModelSource {
  const legacy = createLegacyModelSource();
  return {
    kind: 'gen-model-v1',
    tree: createGenModelV1TreeSource(),
    meshes,
    records: legacy.records,
    attributes: legacy.attributes,
  };
}

export * from './treeSource';
export * from './modelRecords';

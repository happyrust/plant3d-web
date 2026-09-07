/**
 * `gen-model-v1` 数据源适配器的组装点。
 *
 * - `tree`：`treeSource.ts`（P2，含 D5-A 的 `visibleInsts`）；
 * - `records`：`modelRecordSource.ts`（P3：ensure → records → `InstanceEntry`，按根收、按构件缓存）；
 * - `meshes`：`/api/v1/meshes/{hash}.glb`（P0-1）；
 * - `attributes`：`typeInfo` 用树的 `node()` 答（noun / owner 都在节点上，P4-2）；`uiAttr` 在 P4-1 接
 *   `element/attributes` 之前**仍委托 legacy**——属性面板还没改成经端口取数，先换掉也没人读。
 */

import { createLegacyModelSource } from '../legacy';

import { createGenModelV1ModelRecordSource } from './modelRecordSource';
import { createGenModelV1TreeSource } from './treeSource';

import type { AttributeSource, MeshSource, ModelSource, TreeSource } from '../ports';
import type { PdmsTypeInfoResponse } from '@/api/genModelPdmsAttrApi';

import { genModelV1MeshUrl } from '@/api/genModelV1Api';

const meshes: MeshSource = {
  // gen-model 只有一档网格，legacy 的 LOD 键在这里没有意义
  meshUrl: (geoHash) => genModelV1MeshUrl(geoHash),
};

/** `pdmsGetTypeInfo` 的 v1 版：noun 与属主都在树节点上，两跳 `node()` 就够，不另开端点。 */
export async function typeInfoFromTree(tree: TreeSource, refno: string): Promise<PdmsTypeInfoResponse> {
  const resp = await tree.node(refno);
  if (!resp.success || !resp.node) {
    return { success: false, refno, error_message: resp.error_message ?? `找不到节点 ${refno}` };
  }
  const owner = resp.node.owner ?? null;
  let ownerNoun: string | null = null;
  if (owner) {
    const ownerResp = await tree.node(owner);
    ownerNoun = ownerResp.success && ownerResp.node ? ownerResp.node.noun : null;
  }
  return { success: true, refno: resp.node.refno, noun: resp.node.noun, owner_refno: owner, owner_noun: ownerNoun };
}

export function createGenModelV1ModelSource(): ModelSource {
  const legacy = createLegacyModelSource();
  const tree = createGenModelV1TreeSource();
  const attributes: AttributeSource = {
    uiAttr: legacy.attributes.uiAttr,
    typeInfo: (refno) => typeInfoFromTree(tree, refno),
  };
  return {
    kind: 'gen-model-v1',
    tree,
    meshes,
    records: createGenModelV1ModelRecordSource(),
    attributes,
  };
}

export * from './treeSource';
export * from './modelRecords';
export * from './modelRecordSource';
export * from './instanceMapping';

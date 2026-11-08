/**
 * 坏槽的端到端：GPREF 指向不存在的元素（`target_missing`）从 gen-model 的回执一路走到 GPSET 那一行的徽标。
 * 回执照抄 gen-model 的分组契约快照 `gen-model/tests/fixtures/group-contract/tree-children-resolved-gpset.json`：
 * 三个解析出的成员、三个坏槽（`gpref_missing` / `db_not_in_mdb` / `target_missing`）。treeSource（v1 → E3D 形状）、
 * usePdmsOwnerTree（坏槽条数记到父节点、展平到行）、ModelTreeRow 都是真的；只换掉 HTTP（树接口、dbnum 状态探测）与三维场景。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, nextTick } from 'vue';

import { usePdmsOwnerTree } from './usePdmsOwnerTree';

import type { FlatRow } from './useModelTree';
import type { GenModelV1TreeSource } from '@/model-source/genModelV1/treeSource';

import { toV1Refno, type TreeChildrenResponse } from '@/api/genModelV1Api';
import ModelTreeRow from '@/components/model-tree/ModelTreeRow.vue';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';
import { createGenModelV1TreeSource, type GenModelV1TreeApi } from '@/model-source/genModelV1/treeSource';

const harness = vi.hoisted(() => ({ tree: undefined as GenModelV1TreeSource | undefined }));

vi.mock('@/model-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/model-source')>()),
  getModelSource: () => ({ tree: harness.tree }),
}));

vi.mock('@/composables/useSceneGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSceneGraph')>()),
  useSceneGraphOps: () => ({ setVisible() {}, setSelected() {}, isolate() {}, clearIsolation() {} }),
}));

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({ view: () => null, acquire: () => () => {}, refresh() {} }),
}));

const GPSET_CHILDREN: TreeChildrenResponse = {
  source: 'direct',
  parent: '2/11',
  view: 'resolved',
  nodes: [
    { refno: '1_4', noun: 'BRAN', name: '/PIPE-100/B1', owner: '1_3', order: 0, children_count: 1, op: 0, mod_cnt: null, children_updated: null, status_code: null, dbnum: 7001, via: '2_12', secondary: true, rule: false },
    { refno: '3_5', noun: 'EQUI', name: '/P-201', owner: '3_2', order: 1, children_count: 0, op: 0, mod_cnt: null, children_updated: null, status_code: null, dbnum: 7003, via: '2_13', secondary: true, rule: false },
    { refno: '1_6', noun: 'VALV', name: '/PIPE-100/B1/V1', owner: '1_4', order: 2, children_count: 0, op: 0, mod_cnt: null, children_updated: null, status_code: null, dbnum: 7001, via: '2_14', secondary: true, rule: false },
  ],
  unresolved: [
    { via: '2_15', target: null, reason: 'gpref_missing' },
    { via: '2_16', target: '9_1', reason: 'db_not_in_mdb' },
    { via: '2_17', target: '1_99', reason: 'target_missing' },
  ],
};

function fakeApi(): GenModelV1TreeApi {
  return {
    roots: vi.fn(async () => { throw new Error('用例不打 tree/roots'); }),
    children: vi.fn(async (refno: string) => {
      const parent = toV1Refno(refno);
      return parent === '2/11' ? GPSET_CHILDREN : { source: 'direct', parent, nodes: [] };
    }),
    ancestors: vi.fn(async () => { throw new Error('用例不打 tree/ancestors'); }),
    search: vi.fn(async () => { throw new Error('用例不打 search'); }),
  };
}

async function mountRow(row: FlatRow) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelTreeRow, { row, index: 0, expanded: false, selected: false, checkState: 'checked' });
  app.mount(host);
  await nextTick();
  return { host, unmount: () => { app.unmount(); host.remove(); } };
}

describe('坏槽端到端：gen-model 回执 → 模型树 GPSET 行', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('GPREF 指向不存在的元素：GPSET 行挂「3 个成员不可解析」，成员行不挂', async () => {
    const api = fakeApi();
    harness.tree = createGenModelV1TreeSource({ api });
    const scope = effectScope();
    const tree = scope.run(() => usePdmsOwnerTree({ value: null }))!;
    try {
      tree.nodesById.value = { '2_11': { id: '2_11', name: '/GROUP-PUMPS', type: 'GPSET', parentId: null, childrenIds: [] } };
      tree.rootIds.value = ['2_11'];
      tree.toggleExpand('2_11');
      await vi.waitFor(() => expect(tree.flatRows.value).toHaveLength(4));

      const gpsetCall = vi.mocked(api.children).mock.calls.find(([refno]) => toV1Refno(refno) === '2/11');
      expect(gpsetCall?.[1]).toMatchObject({ resolved: true });
      const rows = tree.flatRows.value;
      expect(rows.map((row) => [row.type, row.via ?? null, row.unresolvedCount ?? 0])).toEqual([
        ['GPSET', null, 3],
        ['BRAN', '2_12', 0],
        ['EQUI', '2_13', 0],
        ['VALV', '2_14', 0],
      ]);

      const gpset = await mountRow(rows[0]!);
      try {
        const badge = gpset.host.querySelector('[data-testid="model-tree-unresolved-badge"]');
        expect(badge?.textContent?.trim()).toBe('3 个成员不可解析');
      } finally {
        gpset.unmount();
      }
      const member = await mountRow(rows[1]!);
      try {
        expect(member.host.querySelector('[data-testid="model-tree-unresolved-badge"]')).toBeNull();
      } finally {
        member.unmount();
      }
    } finally {
      scope.stop();
    }
  });
});

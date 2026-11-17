/**
 * `hasAncestorWhere`：沿树往上找上级。模型树行上的眼睛用它认「跟着上一级装进来的中间节点」
 * （`ModelTreePanel.eye.test.ts`）。主位置的父链和解析视图下收录它的分组都算上级；只看取进树里的层；节点自己不算。
 * treeSource（v1 → E3D 形状）和 usePdmsOwnerTree 是真的；只换掉 HTTP（树接口）与三维场景。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { usePdmsOwnerTree } from './usePdmsOwnerTree';

import type { TreeNode } from './useModelTree';
import type { GenModelV1TreeSource } from '@/model-source/genModelV1/treeSource';

import { toV1Refno, type EleTreeNodeDto, type TreeChildrenResponse } from '@/api/genModelV1Api';
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

function child(refno: string, noun: string, owner: string, childrenCount: number, extra: Partial<EleTreeNodeDto> = {}): EleTreeNodeDto {
  return { refno, noun, name: `/${noun}-${refno}`, owner, order: 0, children_count: childrenCount, dbnum: 7001, ...extra };
}

/**
 * 主位置：ZONE 1_1 › PIPE 1_2 › BRAN 1_3 › ELBO 1_4；另有一个不相干的 ZONE 1_9。
 * 分组：GPSET 2_11 收录了 BRAN 1_3（二级成员）。
 * 两个互相收录的分组：GPSET 2_20 收录 2_21，2_21 又收录 2_20。
 */
const CHILDREN: Record<string, TreeChildrenResponse> = {
  '1/1': { source: 'direct', parent: '1/1', nodes: [child('1_2', 'PIPE', '1_1', 1)] },
  '1/2': { source: 'direct', parent: '1/2', nodes: [child('1_3', 'BRAN', '1_2', 1)] },
  '1/3': { source: 'direct', parent: '1/3', nodes: [child('1_4', 'ELBO', '1_3', 0)] },
  '2/11': {
    source: 'direct', parent: '2/11', view: 'resolved',
    nodes: [child('1_3', 'BRAN', '1_2', 1, { via: '2_12', secondary: true, rule: false })],
  },
  '2/20': {
    source: 'direct', parent: '2/20', view: 'resolved',
    nodes: [child('2_21', 'GPSET', '2_1', 1, { via: '2_30', secondary: true, rule: false })],
  },
  '2/21': {
    source: 'direct', parent: '2/21', view: 'resolved',
    nodes: [child('2_20', 'GPSET', '2_1', 1, { via: '2_31', secondary: true, rule: false })],
  },
};

function fakeApi(): GenModelV1TreeApi {
  return {
    roots: vi.fn(async () => { throw new Error('用例不打 tree/roots'); }),
    children: vi.fn(async (refno: string) => {
      const parent = toV1Refno(refno);
      return CHILDREN[parent] ?? { source: 'direct', parent, nodes: [] };
    }),
    ancestors: vi.fn(async () => { throw new Error('用例不打 tree/ancestors'); }),
    search: vi.fn(async () => { throw new Error('用例不打 search'); }),
  };
}

function root(id: string, type: string): TreeNode {
  return { id, name: `/${type}-${id}`, type, parentId: null, childrenIds: [] };
}

const is = (target: string) => (id: string): boolean => id === target;

/** 起一棵树，把给的节点按顺序展开（展开 = 把它的子节点取进树里），等到树上有 `rowCount` 行 */
async function mountTree(roots: TreeNode[], expand: string[], rowCount: number) {
  harness.tree = createGenModelV1TreeSource({ api: fakeApi() });
  const scope = effectScope();
  const tree = scope.run(() => usePdmsOwnerTree({ value: null }))!;
  tree.nodesById.value = Object.fromEntries(roots.map((node) => [node.id, node]));
  tree.rootIds.value = roots.map((node) => node.id);
  for (const id of expand) {
    tree.toggleExpand(id);
    await vi.waitFor(() => expect(tree.nodesById.value[id]?.childrenIds.length).toBeGreaterThan(0));
  }
  await vi.waitFor(() => expect(tree.flatRows.value).toHaveLength(rowCount));
  return { tree, stop: () => scope.stop() };
}

describe('usePdmsOwnerTree.hasAncestorWhere：沿树往上找上级', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('主位置的父链：直接的上级和隔着几层的上级都算；自己、下级、不相干的节点不算', async () => {
    // ZONE › PIPE › BRAN › ELBO 四行，加上不相干的 ZONE 一行
    const { tree, stop } = await mountTree([root('1_1', 'ZONE'), root('1_9', 'ZONE')], ['1_1', '1_2', '1_3'], 5);
    try {
      expect(tree.hasAncestorWhere('1_4', is('1_3'))).toBe(true);
      expect(tree.hasAncestorWhere('1_4', is('1_1'))).toBe(true);
      expect(tree.hasAncestorWhere('1_2', is('1_1'))).toBe(true);

      expect(tree.hasAncestorWhere('1_3', is('1_3'))).toBe(false);
      expect(tree.hasAncestorWhere('1_3', is('1_4'))).toBe(false);
      expect(tree.hasAncestorWhere('1_4', is('1_9'))).toBe(false);
      expect(tree.hasAncestorWhere('1_1', () => true)).toBe(false);
      // 树里没有的节点：没有上级可找
      expect(tree.hasAncestorWhere('9_9', () => true)).toBe(false);
      // refno 写成 a/b 也认
      expect(tree.hasAncestorWhere('1/4', is('1_1'))).toBe(true);
    } finally {
      stop();
    }
  });

  it('解析视图下收录它的分组也算上级，收录的节点下面的也跟着算；没被收录的不算', async () => {
    // ZONE › PIPE › BRAN › ELBO，GPSET › BRAN › ELBO（BRAN 在两处都展开着）
    const { tree, stop } = await mountTree(
      [root('1_1', 'ZONE'), root('2_11', 'GPSET')],
      ['1_1', '1_2', '1_3', '2_11'],
      7,
    );
    try {
      expect(tree.hasAncestorWhere('1_3', is('2_11'))).toBe(true);
      expect(tree.hasAncestorWhere('1_4', is('2_11'))).toBe(true);
      // 主位置那条线照样找得到
      expect(tree.hasAncestorWhere('1_3', is('1_1'))).toBe(true);
      // 分组收录的是 BRAN，不是它上面的 PIPE
      expect(tree.hasAncestorWhere('1_2', is('2_11'))).toBe(false);

      // 每个上级只问一次，节点自己不问
      const asked: string[] = [];
      expect(tree.hasAncestorWhere('1_3', (id) => { asked.push(id); return false; })).toBe(false);
      expect([...asked].sort()).toEqual(['1_1', '1_2', '2_11']);
    } finally {
      stop();
    }
  });

  it('收录关系成环（两个分组互相收录）：找得到的照样找到，找不到的能停下来', async () => {
    // GPSET 2_20 › GPSET 2_21 › GPSET 2_20（画到这里为止：同一条祖先链上不重复出行）
    const { tree, stop } = await mountTree([root('2_20', 'GPSET')], ['2_20', '2_21'], 2);
    try {
      expect(tree.hasAncestorWhere('2_20', is('2_21'))).toBe(true);
      expect(tree.hasAncestorWhere('2_21', is('2_20'))).toBe(true);

      const asked: string[] = [];
      expect(tree.hasAncestorWhere('2_20', (id) => { asked.push(id); return false; })).toBe(false);
      expect(asked).toEqual(['2_21']);
    } finally {
      stop();
    }
  });
});

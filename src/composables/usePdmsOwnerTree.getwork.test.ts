/**
 * 「取最新」里模型树的这一半，连着真的 `usePdmsOwnerTree` 和真的 gen-model-v1 树数据源，只把 HTTP 换成假的。
 *
 * 两套假后端：
 * - 一棵小树的前后两版（改名、删除、新增、挪位置各一处）——2026-11-12 分析时用它证明过「取过的层从不重取」；
 * - 8000 库 2026-11-11 那几个真实批次的形状：ZONE `24384_26548` 下先新增 EQUI `24384_26716`（带 BOX
 *   `24384_26717`，任务 `db-20261111-123321-000006`），再删掉（`…-124322-000008`）。节点字段照现网
 *   `tree/children?refno=24384/26548&resolved=1` 的回执，已删节点的 404 照现网原话。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import type { GenModelV1TreeSource } from '@/model-source/genModelV1/treeSource';

import { GenModelV1ApiError, toV1Refno, type EleTreeNodeDto, type TreeChildrenResponse } from '@/api/genModelV1Api';
import { usePdmsOwnerTree } from '@/composables/usePdmsOwnerTree';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';
import { createGenModelV1TreeSource, type GenModelV1TreeApi } from '@/model-source/genModelV1/treeSource';

const harness = vi.hoisted(() => ({ tree: undefined as GenModelV1TreeSource | undefined }));
const setVisibleMock = vi.hoisted(() => vi.fn());

vi.mock('@/model-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/model-source')>()),
  getModelSource: () => ({ tree: harness.tree }),
}));

vi.mock('@/composables/useSceneGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSceneGraph')>()),
  useSceneGraphOps: () => ({ setVisible: setVisibleMock, setSelected() {}, isolate() {}, clearIsolation() {} }),
}));

function node(refno: string, noun: string, name: string, owner: string, order: number, childrenCount: number, dbnum = 8000): EleTreeNodeDto {
  return { refno, noun, name, owner, order, children_count: childrenCount, op: 0, mod_cnt: null, children_updated: null, status_code: null, dbnum } as EleTreeNodeDto;
}

function notFound(path: string, refno: string): GenModelV1ApiError {
  // 现网对已删节点的原话（2026-11-12，`tree/children?refno=24384/26716`）
  return new GenModelV1ApiError({ code: 'not_found', status: 404, path, message: `dbnum 8000 会话 Some(1155) 的索引里没有 ${refno}` });
}

type Backend = {
  roots: () => EleTreeNodeDto[];
  /** 回 `null` = 这个节点不存在（404） */
  children: (parent: string) => EleTreeNodeDto[] | null;
  /** 祖先链（自己在前）；回 `null` = 不存在 */
  ancestors?: (refno: string) => string[] | null;
  /** 这些层取子节点时断网 */
  broken?: Set<string>;
};

function fakeApi(backend: () => Backend): GenModelV1TreeApi {
  return {
    roots: vi.fn(async () => ({ source: 'direct', project: 'P', mdb: '/ALL', nodes: backend().roots() })),
    children: vi.fn(async (refno: string): Promise<TreeChildrenResponse> => {
      const parent = toV1Refno(refno);
      if (backend().broken?.has(parent)) {
        throw new GenModelV1ApiError({ code: 'network', status: 0, path: '/api/v1/tree/children', message: 'Failed to fetch' });
      }
      const nodes = backend().children(parent);
      if (!nodes) throw notFound('/api/v1/tree/children', parent);
      return { source: 'direct', parent, view: 'stored', nodes };
    }),
    ancestors: vi.fn(async (refno: string) => {
      const key = toV1Refno(refno);
      const chain = backend().ancestors?.(key) ?? null;
      if (!chain) throw notFound('/api/v1/tree/ancestors', key);
      return { source: 'direct', refnos: chain };
    }),
    search: vi.fn(async () => { throw new Error('用例不打 search'); }),
  } as unknown as GenModelV1TreeApi;
}

/** 「这个节点下有哪些带几何的构件」：用例里一律答没有（隐藏 / 显示只动树上的勾选态），不许走到真的记录接口 */
const collectNothing = vi.fn(async () => ({
  items: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
}));

/** 用例里任何真的网络请求都是错：直接炸，不许碰到本机在跑的后端 */
const fetchGuard = vi.fn(async (input: unknown) => {
  throw new Error(`用例不许发真的请求：${String(input)}`);
});

/** 挂一棵树：根是数据源合成的虚拟根（与页面里一样），等根那一层取完 */
async function mountTree(api: GenModelV1TreeApi) {
  harness.tree = createGenModelV1TreeSource({ api, collectByAncestor: collectNothing as never });
  const scope = effectScope();
  const viewer = {
    scene: { setObjectsVisible: vi.fn(), setObjectsSelected: vi.fn(), ensureRefnos: vi.fn(), objects: {}, selectedObjectIds: [] },
  };
  const tree = scope.run(() => usePdmsOwnerTree({ value: viewer as never }))!;
  await vi.waitFor(() => expect(tree.flatRows.value.length).toBeGreaterThan(1));
  return { tree, stop: () => scope.stop() };
}

const names = (tree: ReturnType<typeof usePdmsOwnerTree>) => tree.flatRows.value.slice(1).map((row) => `${row.id} ${row.name}`);
const childrenCalls = (api: GenModelV1TreeApi, parent: string) =>
  vi.mocked(api.children).mock.calls.filter(([refno]) => toV1Refno(refno) === parent).length;

beforeEach(() => {
  __resetGenModelV1ServiceLifecycleForTests();
  setVisibleMock.mockClear();
  fetchGuard.mockClear();
  vi.stubGlobal('fetch', fetchGuard);
});

afterEach(() => {
  // 整个文件里一发真的请求都不该有
  expect(fetchGuard).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 一棵小树的前后两版
// ---------------------------------------------------------------------------

function smallTree(version: () => 1 | 2): Backend {
  const v1 = () => version() === 1;
  return {
    roots: () => [node('1_1', 'SITE', '/SITE-A', '9_0', 0, 2)],
    children: (parent) => {
      if (parent === '1/1') return [node('1_2', 'ZONE', '/ZONE-A', '1_1', 0, v1() ? 3 : 2), node('1_6', 'ZONE', '/ZONE-B', '1_1', 1, v1() ? 0 : 1)];
      if (parent === '1/2') {
        return v1()
          ? [node('1_3', 'EQUI', '/OLD-NAME', '1_2', 0, 1), node('1_4', 'EQUI', '/TO-DELETE', '1_2', 1, 1), node('1_8', 'EQUI', '/MOVED', '1_2', 2, 0)]
          : [node('1_3', 'EQUI', '/NEW-NAME', '1_2', 0, 1), node('1_5', 'EQUI', '/ADDED', '1_2', 1, 1)];
      }
      if (parent === '1/6') return v1() ? [] : [node('1_8', 'EQUI', '/MOVED', '1_6', 0, 0)];
      if (parent === '1/4') return v1() ? [node('1_41', 'BOX', '/BOX-OF-4', '1_4', 0, 0)] : null;
      if (parent === '1/3') return [node('1_31', 'BOX', '/BOX-OF-3', '1_3', 0, 0)];
      return [];
    },
    ancestors: (refno) => {
      if (refno === '1/4') return v1() ? ['1_4', '1_2', '1_1', '9_0'] : null;
      if (refno === '1/41') return v1() ? ['1_41', '1_4', '1_2', '1_1', '9_0'] : null;
      if (refno === '1/8') return ['1_8', v1() ? '1_2' : '1_6', '1_1', '9_0'];
      return [refno.replace('/', '_'), '1_2', '1_1', '9_0'];
    },
  };
}

const V1_ROWS = ['1_1 /SITE-A', '1_2 /ZONE-A', '1_3 /OLD-NAME', '1_4 /TO-DELETE', '1_8 /MOVED', '1_6 /ZONE-B'];
const V2_ROWS = ['1_1 /SITE-A', '1_2 /ZONE-A', '1_3 /NEW-NAME', '1_5 /ADDED', '1_6 /ZONE-B', '1_8 /MOVED'];

describe('usePdmsOwnerTree.refreshLoadedLayers（取最新）', () => {
  it('别人保存之后点取最新：新增的出现、删掉的消失、改名生效、挪位置到新父节点下；展开、勾选、选中留着', async () => {
    let version: 1 | 2 = 1;
    const api = fakeApi(() => smallTree(() => version));
    const { tree, stop } = await mountTree(api);
    try {
      // 用定位把路径上的层装进来（这条路不做「下一层」预取）
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      tree.expandedIds.value = new Set([...tree.expandedIds.value, '1_6']);
      await tree.expandPathToNode('1_41');
      await vi.waitFor(() => expect(tree.nodesById.value['1_41']).toBeDefined());
      // ZONE-B 是空的，也取过一次
      tree.toggleExpand('1_6');
      tree.toggleExpand('1_6');
      await vi.waitFor(() => expect(childrenCalls(api, '1/6')).toBe(1));
      expect(names(tree)).toEqual(['1_1 /SITE-A', '1_2 /ZONE-A', '1_3 /OLD-NAME', '1_4 /TO-DELETE', '1_41 /BOX-OF-4', '1_8 /MOVED', '1_6 /ZONE-B']);

      // 页面上的状态：1_3 隐藏、选中 1_8 和 1_41、1_4 展开着
      await tree.setVisible('1_3', false);
      tree.selectedIds.value = new Set(['1_8', '1_41']);
      expect(tree.getCheckState('1_3')).toBe('unchecked');
      expect(tree.getCheckState('1_2')).toBe('indeterminate');
      const callsBefore = { zoneA: childrenCalls(api, '1/2'), zoneB: childrenCalls(api, '1/6'), site: childrenCalls(api, '1/1'), equi3: childrenCalls(api, '1/3') };
      expect(callsBefore.equi3).toBe(1); // 隐藏 1_3 时把它的子节点取过一次
      expect(childrenCalls(api, '1/8')).toBe(0); // 1_8 的子节点从没取过
      setVisibleMock.mockClear();

      version = 2; // 别人保存了：后台的树已经是新的
      const report = await tree.refreshLoadedLayers();

      expect(names(tree)).toEqual(V2_ROWS);
      expect(tree.nodesById.value['1_8']?.parentId).toBe('1_6');
      // 状态保得住
      expect(tree.getCheckState('1_3')).toBe('unchecked');
      expect(tree.getCheckState('1_2')).toBe('indeterminate');
      expect(tree.expandedIds.value.has('1_2')).toBe(true);
      expect(tree.expandedIds.value.has('1_6')).toBe(true);
      // 选中：挪了位置的 1_8 还选着；被删的 1_41 清掉
      expect([...tree.selectedIds.value]).toEqual(['1_8']);
      // 被删节点的记录清掉
      expect(tree.nodesById.value['1_4']).toBeUndefined();
      expect(tree.nodesById.value['1_41']).toBeUndefined();
      expect(tree.expandedIds.value.has('1_4')).toBe(false);
      // 新节点继承父节点的可见性，回放到场景
      expect(tree.getCheckState('1_5')).toBe('checked');
      expect(setVisibleMock).toHaveBeenCalledWith(['1_5'], true);

      // 取过的层各重取一次；没取过的层（1_8 的子节点、新来的 1_5 的子节点）不取
      expect(childrenCalls(api, '1/2')).toBe(callsBefore.zoneA + 1);
      expect(childrenCalls(api, '1/6')).toBe(callsBefore.zoneB + 1);
      expect(childrenCalls(api, '1/1')).toBe(callsBefore.site + 1);
      expect(childrenCalls(api, '1/3')).toBe(callsBefore.equi3 + 1);
      expect(childrenCalls(api, '1/8')).toBe(0);
      expect(childrenCalls(api, '1/5')).toBe(0);

      expect(report.added.map((item) => item.id)).toEqual(['1_5']);
      expect(report.renamed.map((item) => [item.id, item.previousName, item.name])).toEqual([['1_3', '/OLD-NAME', '/NEW-NAME']]);
      expect(report.moved.map((item) => [item.id, item.from, item.to])).toEqual([['1_8', '1_2', '1_6']]);
      // 被删的 1_4：它自己那一层回了 404，直接定为已删除，不用再去问祖先链
      expect(report.removed).toEqual([expect.objectContaining({ id: '1_4', name: '/TO-DELETE', fate: 'deleted' })]);
      expect(report.removedNodeCount).toBe(2);
      expect(report.droppedSelection).toEqual(['1_41']);
      expect(report.layersFailed).toEqual([]);
      expect(vi.mocked(api.ancestors).mock.calls.filter(([refno]) => toV1Refno(refno) === '1/4')).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it('后台没变：点取最新树上一行不动，回执说没有变化', async () => {
    const api = fakeApi(() => smallTree(() => 1));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      const before = names(tree);
      const report = await tree.refreshLoadedLayers();
      expect(names(tree)).toEqual(before);
      expect(report).toMatchObject({ changed: false, added: [], removed: [], renamed: [], moved: [], layersFailed: [] });
      expect(report.layersRefreshed).toBe(report.layersRequested);
      expect(report.layersRequested).toBe(tree.loadedLayerCount());
    } finally {
      stop();
    }
  });

  it('消失的节点自己那一层没取过：去问一次祖先链——库里没有了是已删除，还在是挪到了没展开的位置', async () => {
    let version: 1 | 2 = 1;
    const api = fakeApi(() => smallTree(() => version));
    const { tree, stop } = await mountTree(api);
    try {
      // 只装到 ZONE-A 这一层：1_4 的子节点没取过、ZONE-B 的子节点没取过
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      expect(childrenCalls(api, '1/4')).toBe(0);
      expect(childrenCalls(api, '1/6')).toBe(0);
      expect(names(tree)).toEqual(V1_ROWS);

      version = 2;
      const report = await tree.refreshLoadedLayers();

      // 1_8 挪到了 ZONE-B，而 ZONE-B 没展开过：从树上撤掉，ZONE-B 行上多出展开箭头
      expect(names(tree)).toEqual(['1_1 /SITE-A', '1_2 /ZONE-A', '1_3 /NEW-NAME', '1_5 /ADDED', '1_6 /ZONE-B']);
      expect(tree.flatRows.value.find((row) => row.id === '1_6')?.hasChildren).toBe(true);
      expect(report.removed.map((item) => [item.id, item.fate])).toEqual([['1_4', 'deleted'], ['1_8', 'relocated']]);
      expect(childrenCalls(api, '1/6')).toBe(0); // 没取过的层照旧不取
      // 展开 ZONE-B：挪过去的那台在那里
      tree.toggleExpand('1_6');
      await vi.waitFor(() => expect(names(tree)).toEqual(V2_ROWS));
    } finally {
      stop();
    }
  });

  it('一层断网没取到：那一层保持原样、记进回执，别的层照常对账', async () => {
    let version: 1 | 2 = 1;
    const broken = new Set<string>();
    const api = fakeApi(() => ({ ...smallTree(() => version), broken }));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      tree.toggleExpand('1_6');
      await vi.waitFor(() => expect(childrenCalls(api, '1/6')).toBe(1));

      version = 2;
      broken.add('1/2');
      const report = await tree.refreshLoadedLayers();

      expect(report.layersFailed).toEqual([{ id: '1_2', name: '/ZONE-A', error: expect.stringContaining('network') }]);
      // ZONE-A 那一层没动：旧名字、被删的都还在
      expect(tree.nodesById.value['1_3']?.name).toBe('/OLD-NAME');
      expect(tree.nodesById.value['1_4']).toBeDefined();
      // ZONE-B 那一层对上了：挪过来的那台只在新位置出现
      expect(tree.nodesById.value['1_6']?.childrenIds).toEqual(['1_8']);
      expect(tree.nodesById.value['1_2']?.childrenIds).toEqual(['1_3', '1_4']);

      // 网络好了再点一次：补上
      broken.clear();
      const second = await tree.refreshLoadedLayers();
      expect(second.layersFailed).toEqual([]);
      expect(names(tree)).toEqual(V2_ROWS);
    } finally {
      stop();
    }
  });

  it('根那一层：新增的 SITE 出现、删掉的 SITE 消失（根名单有 60 秒缓存，取最新要绕开它）', async () => {
    let sites = [node('1_1', 'SITE', '/SITE-A', '9_0', 0, 2), node('2_1', 'SITE', '/SITE-GONE', '9_0', 1, 0, 7997)];
    const api = fakeApi(() => ({ roots: () => sites, children: () => [] }));
    const { tree, stop } = await mountTree(api);
    try {
      expect(names(tree)).toEqual(['1_1 /SITE-A', '2_1 /SITE-GONE']);
      const rootsBefore = vi.mocked(api.roots).mock.calls.length;

      sites = [node('1_1', 'SITE', '/SITE-A', '9_0', 0, 2), node('3_1', 'SITE', '/SITE-NEW', '9_0', 1, 5, 8000)];
      const report = await tree.refreshLoadedLayers();

      expect(names(tree)).toEqual(['1_1 /SITE-A', '3_1 /SITE-NEW']);
      expect(vi.mocked(api.roots).mock.calls.length).toBeGreaterThan(rootsBefore);
      expect(report.added.map((item) => [item.id, item.dbnum])).toEqual([['3_1', 8000]]);
      expect(report.removed.map((item) => [item.id, item.dbnum])).toEqual([['2_1', 7997]]);
    } finally {
      stop();
    }
  });

  it('父节点是隐藏的：新来的子节点也隐藏，回放到场景', async () => {
    let version: 1 | 2 = 1;
    const api = fakeApi(() => smallTree(() => version));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      await tree.setVisible('1_2', false);
      expect(tree.getCheckState('1_2')).toBe('unchecked');
      setVisibleMock.mockClear();

      version = 2;
      await tree.refreshLoadedLayers();

      expect(tree.getCheckState('1_5')).toBe('unchecked');
      expect(setVisibleMock).toHaveBeenCalledWith(['1_5'], false);
      expect(setVisibleMock).not.toHaveBeenCalledWith(['1_5'], true);
      expect(tree.getCheckState('1_2')).toBe('unchecked');
    } finally {
      stop();
    }
  });

  it('「这个节点下有哪些带几何的构件」的缓存跟着清掉：取最新之后再选中没展开的节点会重新问', async () => {
    const api = fakeApi(() => smallTree(() => 1));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      // 1_3 有一个子节点、没展开过：选中它时要问「它下面有哪些带几何的构件」
      collectNothing.mockClear();
      collectNothing.mockResolvedValue({
        items: [{ refno: '1/31' }], generationRoots: ['1_3'], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
      } as never);
      const rowIndex = () => tree.flatRows.value.findIndex((row) => row.id === '1_3');
      const click = () => tree.selectByRowIndex(rowIndex(), new MouseEvent('click'));
      const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
      click();
      await settle();
      const asked = collectNothing.mock.calls.length;
      expect(asked).toBeGreaterThanOrEqual(1);
      click();
      await settle();
      expect(collectNothing).toHaveBeenCalledTimes(asked); // 再选中吃的是缓存，不再问

      await tree.refreshLoadedLayers();
      click();
      await settle();
      expect(collectNothing.mock.calls.length).toBeGreaterThan(asked);
    } finally {
      collectNothing.mockReset();
      collectNothing.mockResolvedValue({ items: [], generationRoots: [], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {} } as never);
      stop();
    }
  });

  it('分组新收录了一个已在树上的元素：取最新之后隐藏这个元素，分组的勾选态跟着变（两处父节点都记上了）', async () => {
    let collected = false;
    const base = smallTree(() => 1);
    const api = fakeApi(() => ({
      ...base,
      children: (parent) => {
        if (parent === '1/1') return [...base.children('1/1')!, node('9_1', 'GPSET', '/GPSET-1', '1_1', 2, collected ? 1 : 0)];
        if (parent === '9/1') {
          return collected ? [{ ...node('1_3', 'EQUI', '/OLD-NAME', '1_2', 0, 1), secondary: true, via: '9/2' } as EleTreeNodeDto] : [];
        }
        return base.children(parent);
      },
    }));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      tree.toggleExpand('9_1');
      await vi.waitFor(() => expect(childrenCalls(api, '9/1')).toBe(1));

      collected = true;
      const report = await tree.refreshLoadedLayers();
      expect(tree.nodesById.value['9_1']?.childrenIds).toEqual(['1_3']);
      expect(tree.nodesById.value['1_3']?.parentId).toBe('1_2'); // 主位置没变
      expect(report.moved).toEqual([]);
      expect(report.added).toEqual([]);

      await tree.setVisible('1_3', false);
      expect(tree.getCheckState('9_1')).toBe('unchecked'); // 分组下只有它一个
      expect(tree.getCheckState('1_2')).toBe('indeterminate');
    } finally {
      stop();
    }
  });

  it('loadedLayerDbnums：只算展开过的节点自己的库；根下列着别的库的 SITE 不算碰过那些库', async () => {
    const api = fakeApi(() => ({
      roots: () => [node('1_1', 'SITE', '/SITE-A', '9_0', 0, 2, 8000), node('2_1', 'SITE', '/SITE-OTHER', '9_0', 1, 1, 7997)],
      children: (parent) => (parent === '1/1' ? [node('1_2', 'ZONE', '/ZONE-A', '1_1', 0, 0, 8000)] : []),
    }));
    const { tree, stop } = await mountTree(api);
    try {
      // 只取过根那一层：虚拟根没有库号，一个库都不算碰过
      expect(tree.loadedLayerDbnums()).toEqual([]);
      tree.toggleExpand('1_1');
      await vi.waitFor(() => expect(tree.nodesById.value['1_2']).toBeDefined());
      expect(tree.loadedLayerDbnums()).toEqual([8000]);
    } finally {
      stop();
    }
  });

  it('同时点两下：只跑一轮，两次拿到同一份回执', async () => {
    const api = fakeApi(() => smallTree(() => 1));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('1_3')).toBe(true);
      const before = childrenCalls(api, '1/2');
      const first = tree.refreshLoadedLayers();
      const second = tree.refreshLoadedLayers();
      expect(second).toBe(first);
      await first;
      expect(childrenCalls(api, '1/2')).toBe(before + 1);
      // 跑完之后再点是新的一轮
      await tree.refreshLoadedLayers();
      expect(childrenCalls(api, '1/2')).toBe(before + 2);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 8000 库 2026-11-11 的真实批次
// ---------------------------------------------------------------------------

describe('usePdmsOwnerTree.refreshLoadedLayers：8000 库 2026-11-11 的真实增量', () => {
  const SITE = '24384_26547';
  const ZONE = '24384_26548';
  const BASE_EQUI = node('24384_26549', 'EQUI', '/AIOS-INC-20261029-p79-rvm3-P79-BASE', ZONE, 0, 1);
  const NEW_EQUI = node('24384_26716', 'EQUI', '/AIOS-INC-20261111-ADD', ZONE, 1, 1);

  /** `stage`：0 = 批次之前（会话 1143）；1 = 新增之后（1146）；2 = 删除之后（1149） */
  function library(stage: () => 0 | 1 | 2): Backend {
    return {
      roots: () => [node(SITE, 'SITE', '/AIOS-INC-SITE', '16192_0', 0, 1)],
      children: (parent) => {
        if (parent === '24384/26547') return [node(ZONE, 'ZONE', '/AIOS-INC-ZONE', SITE, 0, stage() === 1 ? 2 : 1)];
        if (parent === '24384/26548') return stage() === 1 ? [BASE_EQUI, NEW_EQUI] : [BASE_EQUI];
        if (parent === '24384/26549') return [node('24384_26550', 'BOX', 'BOX 1', '24384_26549', 0, 0)];
        if (parent === '24384/26716') return stage() === 1 ? [node('24384_26717', 'BOX', 'BOX 1', '24384_26716', 0, 0)] : null;
        return [];
      },
      ancestors: (refno) => {
        if (refno === '24384/26716' || refno === '24384/26717') {
          return stage() === 1 ? [refno.replace('/', '_'), ...(refno === '24384/26717' ? ['24384_26716'] : []), ZONE, SITE, '16192_0'] : null;
        }
        return [refno.replace('/', '_'), ZONE, SITE, '16192_0'];
      },
    };
  }

  it('先新增一台设备（任务 …-123321-000006），再删掉（…-124322-000008）：每次点取最新树都跟上', async () => {
    let stage: 0 | 1 | 2 = 0;
    const api = fakeApi(() => library(() => stage));
    const { tree, stop } = await mountTree(api);
    try {
      expect(await tree.expandPathToNode('24384_26549')).toBe(true);
      expect(names(tree)).toEqual([`${SITE} /AIOS-INC-SITE`, `${ZONE} /AIOS-INC-ZONE`, '24384_26549 /AIOS-INC-20261029-p79-rvm3-P79-BASE']);

      stage = 1; // ZONE 的成员表多了一台，EQUI 24384_26716、BOX 24384_26717 新增
      const added = await tree.refreshLoadedLayers();
      expect(added.added.map((item) => `${item.type} ${item.id}`)).toEqual(['EQUI 24384_26716']);
      expect(added.removed).toEqual([]);
      expect(names(tree)).toContain('24384_26716 /AIOS-INC-20261111-ADD');
      // 新设备能定位了（取最新之前沿已加载的层找不到它）
      expect(await tree.expandPathToNode('24384_26717')).toBe(true);
      expect(tree.nodesById.value['24384_26717']?.parentId).toBe('24384_26716');
      tree.selectedIds.value = new Set(['24384_26717']);

      stage = 2; // 这台设备连同它的 BOX 被删
      const removed = await tree.refreshLoadedLayers();
      expect(removed.removed).toEqual([expect.objectContaining({ id: '24384_26716', type: 'EQUI', fate: 'deleted', dbnum: 8000 })]);
      expect(removed.removedNodeCount).toBe(2);
      expect(removed.removedUnder['24384_26717']).toBe('24384_26716');
      expect(removed.droppedSelection).toEqual(['24384_26717']);
      expect(names(tree)).toEqual([`${SITE} /AIOS-INC-SITE`, `${ZONE} /AIOS-INC-ZONE`, '24384_26549 /AIOS-INC-20261029-p79-rvm3-P79-BASE']);
      expect(tree.selectedIds.value.size).toBe(0);
    } finally {
      stop();
    }
  });
});

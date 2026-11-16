/**
 * 树是按需加载的：没展开过的子孙不在树里。这里盯两件事——
 *
 * 1. 点眼睛（setVisible）只动树里已经加载的节点，不为了勾选状态去逐层取 children；没展开过的子孙等到被展开时
 *    （ensureChildrenLoaded）再继承父节点的状态。三维那一侧也用不着这棵树——要切换哪些构件由数据源一次给出
 *    （visibleInsts）。
 * 2. 选中高亮、X-ray 隔离、定位不能只认树里已有的节点：子树没取全时再并上数据源按祖先给出的有几何的构件，
 *    否则「显示过、只展开了一层」的节点一个构件都亮不起来。
 *
 * 背景（2026-11-16）：以前 setVisible 先把整棵子树逐个节点取一遍子节点，一个接一个地发 tree/children。
 * 五千来个构件的 SITE 就是上万次请求、两分多钟，这期间行尾一直在转、这一行的眼睛点不了。第 2 条原先正是靠它
 * 顺带把子树装全才成立的。
 *
 * 树数据源按端口（TreeSource）的形状写了一份假的；三维场景只留记账用的几个方法。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { usePdmsOwnerTree } from './usePdmsOwnerTree';

import type { ChildrenResponse, NodeResponse, TreeNodeDto, VisibleInstsResponse } from '@/api/genModelE3dTypes';
import type { TreeSource } from '@/model-source/ports';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

const harness = vi.hoisted(() => ({
  tree: undefined as TreeSource | undefined,
  sceneGraphSetVisible: vi.fn<(refnos: string[], visible: boolean) => void>(),
  sceneGraphSetSelected: vi.fn<(refnos: string[], selected: boolean) => void>(),
  sceneGraphIsolate: vi.fn<(refnos: string[]) => void>(),
}));

vi.mock('@/model-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/model-source')>()),
  getModelSource: () => ({ tree: harness.tree }),
}));

vi.mock('@/composables/useSceneGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSceneGraph')>()),
  useSceneGraphOps: () => ({
    setVisible: harness.sceneGraphSetVisible,
    setSelected: harness.sceneGraphSetSelected,
    isolate: harness.sceneGraphIsolate,
    clearIsolation() {},
  }),
}));

/**
 * 世界根 1_0 → 2 个 SITE → 各 3 个 ZONE → 各 2 个 EQUI → 各 2 个 BOX（叶子，有几何）。
 * 编号：子节点 = 父节点的序号后面接一位。SITE 1_1 下是 ZONE 1_11..1_13、EQUI 1_111..、BOX 1_1111..，
 * 一共 3 + 6 + 12 = 21 个子孙；连 SITE 自己，有子节点的是 1 + 3 + 6 = 10 个。
 */
const ROOT = '1_0';
const LEVELS = [
  { noun: 'SITE', fanout: 2 },
  { noun: 'ZONE', fanout: 3 },
  { noun: 'EQUI', fanout: 2 },
  { noun: 'BOX', fanout: 2 },
] as const;

const CHILDREN = new Map<string, string[]>();
const NOUN = new Map<string, string>([[ROOT, 'WORL']]);

(function build(parent: string, depth: number) {
  const level = LEVELS[depth];
  if (!level) {
    CHILDREN.set(parent, []);
    return;
  }
  const seq = parent === ROOT ? '' : parent.slice(2);
  const ids = Array.from({ length: level.fanout }, (_, i) => `1_${seq}${i + 1}`);
  CHILDREN.set(parent, ids);
  for (const id of ids) {
    NOUN.set(id, level.noun);
    build(id, depth + 1);
  }
})(ROOT, 0);

function dto(id: string, owner: string | null): TreeNodeDto {
  const noun = NOUN.get(id) ?? '';
  return { refno: id, name: `/${noun}-${id}`, noun, owner, children_count: CHILDREN.get(id)?.length ?? 0 };
}

function isLeaf(id: string): boolean {
  return CHILDREN.get(id)?.length === 0;
}

/** 节点名下有几何的构件（叶子）。 */
function leavesUnder(id: string): string[] {
  const kids = CHILDREN.get(id) ?? [];
  return kids.length === 0 ? [id] : kids.flatMap(leavesUnder);
}

/** 节点的全部子孙，不含自己。 */
function descendantsOf(id: string): string[] {
  return (CHILDREN.get(id) ?? []).flatMap((kid) => [kid, ...descendantsOf(kid)]);
}

function fakeTreeSource() {
  const unused = (name: string) => vi.fn(async (): Promise<never> => {
    throw new Error(`用例不打 ${name}`);
  });
  return {
    worldRoot: vi.fn(async (): Promise<NodeResponse> => ({ success: true, node: dto(ROOT, null) })),
    node: unused('node'),
    children: vi.fn(async (refno: string): Promise<ChildrenResponse> => ({
      success: true,
      parent_refno: refno,
      children: (CHILDREN.get(refno) ?? []).map((id) => dto(id, refno)),
      truncated: false,
    })),
    ancestors: unused('ancestors'),
    search: unused('search'),
    subtreeRefnos: unused('subtreeRefnos'),
    visibleInsts: vi.fn(async (refno: string): Promise<VisibleInstsResponse> => ({
      success: true,
      refno,
      refnos: leavesUnder(refno),
    })),
  } satisfies TreeSource;
}

type OwnerTree = ReturnType<typeof usePdmsOwnerTree>;

async function mountTree() {
  const source = fakeTreeSource();
  harness.tree = source;
  const scene = {
    setObjectsVisible: vi.fn<(refnos: string[], visible: boolean) => void>(),
    // 选中同步先清掉场景里已选中的；这个假场景里一直没有
    selectedObjectIds: [] as string[],
    // 假包围盒：边长 = 并进来的 BOX 个数，一个 BOX 都没有就是没几何
    getAABB: vi.fn((refnos: string[]): number[] | null => {
      const boxes = refnos.filter(isLeaf).length;
      return boxes > 0 ? [0, 0, 0, boxes, boxes, boxes] : null;
    }),
    // 查看器的本地子树索引：缺省答不了（真机上 SITE / PIPE 这两层就查不到）
    getSubtreeAABB: vi.fn((): number[] | null => null),
  };
  const cameraFlyTo = vi.fn<(target: { aabb: number[] }) => void>();
  const viewer = { scene, cameraFlight: { flyTo: cameraFlyTo } } as unknown as DtxCompatViewer;
  const scope = effectScope();
  const tree = scope.run(() => usePdmsOwnerTree({ value: viewer }))!;
  // 有三维视图就自己初始化：世界根 + 它的直接成员（两个 SITE）；SITE 以下都还没取。
  await vi.waitFor(() => expect(loadedIds(tree)).toEqual(['1_0', '1_1', '1_2']));
  return { tree, source, scene, setObjectsVisible: scene.setObjectsVisible, cameraFlyTo, stop: () => scope.stop() };
}

function loadedIds(tree: OwnerTree): string[] {
  return Object.keys(tree.nodesById.value).sort();
}

/** 树里已经有的、这个节点名下的子孙。 */
function loadedUnder(tree: OwnerTree, id: string): string[] {
  return descendantsOf(id).filter((kid) => tree.nodesById.value[kid]).sort();
}

function statesOf(tree: OwnerTree, ids: string[]): string[] {
  return [...new Set(ids.map((id) => tree.getCheckState(id)))];
}

/** 发过 children 请求的父节点，按发出的先后。 */
function childrenRequests(source: ReturnType<typeof fakeTreeSource>): string[] {
  return source.children.mock.calls.map(([refno]) => refno);
}

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** 节点自己 + 树里已有的子孙 + 名下全部有几何的构件：子树没取全时该交给场景的那一批。 */
function loadedPlusGeometry(tree: OwnerTree, id: string): string[] {
  return sorted([id, ...loadedUnder(tree, id), ...leavesUnder(id)]);
}

/** 像在面板里点一下这一行（行得是展开出来的）。 */
function selectRow(tree: OwnerTree, id: string) {
  const index = tree.flatRows.value.findIndex((row) => row.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  tree.selectByRowIndex(index, new MouseEvent('mousedown'));
}

/** 展开 SITE 一层：取回 3 个 ZONE，顺带预取下一层的 6 个 EQUI；有几何的 12 个 BOX 一个都不在树里。 */
async function expandOneLevel(tree: OwnerTree, site: string) {
  tree.toggleExpand(site);
  await vi.waitFor(() => expect(loadedUnder(tree, site)).toHaveLength(9));
}

/** 再把 SITE 的第一个 ZONE 取到底：它下面 2 个 EQUI 的 4 个 BOX 进树，另外两个 ZONE 的 8 个 BOX 仍不在。 */
async function expandFirstZoneToLeaves(tree: OwnerTree, site: string) {
  await expandOneLevel(tree, site);
  const zone = `${site}1`;
  tree.toggleExpand(zone);
  await vi.waitFor(() => expect(loadedUnder(tree, zone)).toHaveLength(6));
  expect(loadedUnder(tree, site).filter(isLeaf)).toHaveLength(4);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 让已经就绪的回调都跑完。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  harness.sceneGraphSetVisible.mockClear();
  harness.sceneGraphSetSelected.mockClear();
  harness.sceneGraphIsolate.mockClear();
});

describe('模型树点眼睛：不为勾选状态逐层取子树', () => {
  it('SITE 下 21 个子孙都没展开过：点它的眼睛一次 children 都不发', async () => {
    const { tree, source, setObjectsVisible, stop } = await mountTree();
    try {
      expect(childrenRequests(source)).toEqual(['1_0']);

      await tree.setVisible('1_1', false);

      // 以前这里会多出 10 次：SITE、3 个 ZONE、6 个 EQUI 各取一遍子节点，一个接一个。
      expect(childrenRequests(source)).toEqual(['1_0']);
      expect(loadedIds(tree)).toEqual(['1_0', '1_1', '1_2']);

      // 树上：这一行灭，兄弟不动，父节点半选。
      expect(tree.getCheckState('1_1')).toBe('unchecked');
      expect(tree.getCheckState('1_2')).toBe('checked');
      expect(tree.getCheckState('1_0')).toBe('indeterminate');

      // 三维：要切换的构件由数据源一次给出（12 个 BOX），连同节点自己。
      expect(source.visibleInsts.mock.calls).toEqual([['1_1']]);
      const applied = setObjectsVisible.mock.calls;
      expect(applied.map(([, visible]) => visible)).not.toContain(true);
      expect(applied.flatMap(([refnos]) => refnos).sort()).toEqual(['1_1', ...leavesUnder('1_1')].sort());
    } finally {
      stop();
    }
  });

  it('之后才展开的子孙继承父节点的状态，树里已有的当场跟着变', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      await tree.setVisible('1_1', false);

      // 展开被隐藏的 SITE：取回来的 3 个 ZONE 是隐藏的；展开顺带预取的下一层（6 个 EQUI）也是。
      tree.toggleExpand('1_1');
      await vi.waitFor(() => expect(loadedUnder(tree, '1_1')).toHaveLength(9));
      expect(statesOf(tree, loadedUnder(tree, '1_1'))).toEqual(['unchecked']);
      // 继承来的显隐同时交给场景回放：构件之后才装进场景时照这个状态显示。
      expect(harness.sceneGraphSetVisible).toHaveBeenCalledWith(['1_11', '1_12', '1_13'], false);

      // 再显示：树里已有的 9 个子孙当场变回显示，还是一次 children 都不为它发（以前会去取 6 个 EQUI 的子节点）。
      const requestsBefore = childrenRequests(source);
      await tree.setVisible('1_1', true);
      expect(childrenRequests(source)).toEqual(requestsBefore);
      expect(statesOf(tree, ['1_0', '1_1', ...loadedUnder(tree, '1_1')])).toEqual(['checked']);

      // 还没取过的那一层（EQUI 下面的 BOX）等展开时继承「显示」。
      tree.toggleExpand('1_111');
      await vi.waitFor(() => expect(loadedUnder(tree, '1_111')).toEqual(['1_1111', '1_1112']));
      expect(statesOf(tree, ['1_1111', '1_1112'])).toEqual(['checked']);
      expect(harness.sceneGraphSetVisible).toHaveBeenLastCalledWith(['1_1111', '1_1112'], true);
    } finally {
      stop();
    }
  });
});

describe('模型树选中 / 隔离 / 定位：树里这棵子树没取全时不漏构件', () => {
  it('显示过的 SITE 只展开了一层：选中它，名下 12 个 BOX 都高亮', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      await tree.setVisible('1_1', true);
      await expandOneLevel(tree, '1_1');
      const requestsBefore = childrenRequests(source);

      selectRow(tree, '1_1');
      await vi.waitFor(() => expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(1));

      // 只认树里已有的节点的话，这里只有 SITE、3 个 ZONE、6 个 EQUI，一个有几何的都没有。
      expect(sorted(harness.sceneGraphSetSelected.mock.lastCall?.[0] ?? [])).toEqual(loadedPlusGeometry(tree, '1_1'));
      // 显示时已经按祖先查过一次：选中直接用那一份，不再查，更不去取子节点。
      expect(source.visibleInsts.mock.calls).toEqual([['1_1']]);
      expect(childrenRequests(source)).toEqual(requestsBefore);
    } finally {
      stop();
    }
  });

  it('没显示过、只展开了一层的 SITE：选中时按祖先查一次，查询在途或已有结果都不重复发', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      await expandOneLevel(tree, '1_2');
      const gate = deferred<VisibleInstsResponse>();
      source.visibleInsts.mockImplementationOnce(() => gate.promise);

      selectRow(tree, '1_2');
      // 查询还没回来，又点了一次同一行
      selectRow(tree, '1_2');
      expect(source.visibleInsts.mock.calls).toEqual([['1_2']]);

      gate.resolve({ success: true, refno: '1_2', refnos: leavesUnder('1_2') });
      await vi.waitFor(() => expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(1));
      expect(sorted(harness.sceneGraphSetSelected.mock.lastCall?.[0] ?? [])).toEqual(loadedPlusGeometry(tree, '1_2'));

      selectRow(tree, '1_2');
      await vi.waitFor(() => expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(2));
      expect(sorted(harness.sceneGraphSetSelected.mock.lastCall?.[0] ?? [])).toEqual(loadedPlusGeometry(tree, '1_2'));
      expect(source.visibleInsts.mock.calls).toEqual([['1_2']]);
    } finally {
      stop();
    }
  });

  it('查询还没回来就改选了别的行：只高亮后选的，慢的那次回来不再盖上去', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      // EQUI 1_111 这一支取到底（它的两个 BOX 都在树里）；SITE 1_2 没展开过。
      await expandFirstZoneToLeaves(tree, '1_1');
      const gate = deferred<VisibleInstsResponse>();
      source.visibleInsts.mockImplementationOnce(() => gate.promise);

      selectRow(tree, '1_2');
      selectRow(tree, '1_111');
      expect(harness.sceneGraphSetSelected.mock.calls).toEqual([[['1_111', '1_1111', '1_1112'], true]]);

      gate.resolve({ success: true, refno: '1_2', refnos: leavesUnder('1_2') });
      await settle();
      expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('显示之后，以前查到的清单作废：再选中用的是显示时新查的那一份', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      selectRow(tree, '1_2');
      await vi.waitFor(() => expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(1));

      // 显示之前后端刚生成了新的模型：同一个节点名下多出一个构件。
      source.visibleInsts.mockImplementation(async (refno) => ({
        success: true,
        refno,
        refnos: [...leavesUnder(refno), '1_9999'],
      }));
      await tree.setVisible('1_2', true);

      selectRow(tree, '1_2');
      await vi.waitFor(() => expect(harness.sceneGraphSetSelected).toHaveBeenCalledTimes(2));
      expect(harness.sceneGraphSetSelected.mock.lastCall?.[0]).toContain('1_9999');
      // 两次：第一次选中、显示；第二次选中没有再查。
      expect(source.visibleInsts.mock.calls).toEqual([['1_2'], ['1_2']]);
    } finally {
      stop();
    }
  });

  it('X-ray 隔离：没取全的 SITE 保留名下全部有几何的构件；取全了的一支用树里的节点，不发查询', async () => {
    const { tree, source, stop } = await mountTree();
    try {
      await expandFirstZoneToLeaves(tree, '1_2');

      await tree.isolateXray('1_2');
      expect(harness.sceneGraphIsolate).toHaveBeenCalledTimes(1);
      expect(sorted(harness.sceneGraphIsolate.mock.lastCall?.[0] ?? [])).toEqual(loadedPlusGeometry(tree, '1_2'));
      expect(source.visibleInsts.mock.calls).toEqual([['1_2']]);

      await tree.isolateXray('1_211');
      expect(harness.sceneGraphIsolate).toHaveBeenLastCalledWith(['1_211', '1_2111', '1_2112']);
      expect(source.visibleInsts.mock.calls).toEqual([['1_2']]);
    } finally {
      stop();
    }
  });

  it('定位只取了一支的 SITE：范围是名下全部 12 个 BOX，不是树里已有的那 4 个', async () => {
    const { tree, source, cameraFlyTo, stop } = await mountTree();
    try {
      await expandFirstZoneToLeaves(tree, '1_2');
      const requestsBefore = childrenRequests(source);

      await expect(tree.flyTo('1_2')).resolves.toBe(true);

      expect(cameraFlyTo).toHaveBeenCalledTimes(1);
      expect(cameraFlyTo.mock.calls[0]?.[0]).toMatchObject({ aabb: [0, 0, 0, 12, 12, 12] });
      // 本地索引答不了这一层：按祖先查一次，不逐层查子树清单，也不取子节点。
      expect(source.visibleInsts.mock.calls).toEqual([['1_2']]);
      expect(source.subtreeRefnos).not.toHaveBeenCalled();
      expect(childrenRequests(source)).toEqual(requestsBefore);
    } finally {
      stop();
    }
  });

  it('定位没取全的节点：查看器的本地子树索引答得了就用它，一次请求都不发', async () => {
    const { tree, source, scene, cameraFlyTo, stop } = await mountTree();
    try {
      await expandFirstZoneToLeaves(tree, '1_2');
      scene.getSubtreeAABB.mockReturnValueOnce([0, 0, 0, 99, 99, 99]);

      await expect(tree.flyTo('1_2')).resolves.toBe(true);

      expect(scene.getSubtreeAABB).toHaveBeenCalledWith(['1_2']);
      expect(cameraFlyTo.mock.calls[0]?.[0]).toMatchObject({ aabb: [0, 0, 0, 99, 99, 99] });
      expect(source.visibleInsts).not.toHaveBeenCalled();
      expect(source.subtreeRefnos).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

/**
 * 重载（取最新、「重载」）定新增的构件显不显示时，装载流程要问树：这个节点下面藏着的那些节点，名下现在各有哪些构件
 * （`hiddenScopeUnder`，经 `treeHiddenScope` 传话）。这里盯树怎么答：
 *
 * - 只有「部分藏着」（半选）的节点才有答案；整个显示着、整个藏着、不在树里的都回 `null`，不发请求；
 * - 只问最上一层藏着的节点（它下面的都跟着它），按祖先现查——藏着的节点下面那一层从没取进树里也答得出，
 *   这次数据批次新增的构件也在答案里（不用以前记下的清单）；
 * - 一个节点没查到记进 `failed`，别的照常；同时最多问 4 个；被叫停后不再问剩下的；
 * - 同一个藏着的节点经两个父节点都到得了（分组在解析视图下把别处的节点收成成员）时只问一次。
 *
 * 树数据源按端口（TreeSource）的形状写了一份假的（同 `usePdmsOwnerTree.unloadedSubtree.test.ts`）；三维场景只留记账用的几个方法。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { usePdmsOwnerTree } from './usePdmsOwnerTree';

import type { ChildrenResponse, NodeResponse, TreeNodeDto, VisibleInstsResponse } from '@/api/genModelE3dTypes';
import type { TreeSource } from '@/model-source/ports';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

const harness = vi.hoisted(() => ({
  tree: undefined as TreeSource | undefined,
}));

vi.mock('@/model-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/model-source')>()),
  getModelSource: () => ({ tree: harness.tree }),
}));

vi.mock('@/composables/useSceneGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSceneGraph')>()),
  useSceneGraphOps: () => ({
    setVisible() {},
    setSelected() {},
    isolate() {},
    clearIsolation() {},
  }),
}));

/**
 * 世界根 1_0 → SITE 1_1 → ZONE A（1_10，7 根 PIPE）和 ZONE B（1_20，2 根 PIPE）；每根 PIPE 下一个 BRAN，
 * BRAN 下两个 ELBO（叶子，有几何）。编号：BRAN = PIPE 后面接 1，ELBO = BRAN 后面接 1 / 2。
 */
const ROOT = '1_0';
const SITE = '1_1';
const ZONE_A = '1_10';
const ZONE_B = '1_20';
const PIPES_A = ['1_11', '1_12', '1_13', '1_14', '1_15', '1_16', '1_17'] as const;
const PIPES_B = ['1_21', '1_22'] as const;
/** 有的用例在 SITE 下面加的分组：成员是 ZONE A 的管线（它们的主位置还在 ZONE A 下面） */
const GROUP = '1_30';

const NOUN = new Map<string, string>([[ROOT, 'WORL'], [SITE, 'SITE'], [ZONE_A, 'ZONE'], [ZONE_B, 'ZONE'], [GROUP, 'GPSET']]);
const BASE_CHILDREN = new Map<string, string[]>([
  [ROOT, [SITE]],
  [SITE, [ZONE_A, ZONE_B]],
  [ZONE_A, [...PIPES_A]],
  [ZONE_B, [...PIPES_B]],
]);
for (const pipe of [...PIPES_A, ...PIPES_B]) {
  const bran = branOf(pipe);
  const elbows = [`${bran}1`, `${bran}2`];
  BASE_CHILDREN.set(pipe, [bran]);
  BASE_CHILDREN.set(bran, elbows);
  NOUN.set(pipe, 'PIPE');
  NOUN.set(bran, 'BRAN');
  for (const elbow of elbows) {
    BASE_CHILDREN.set(elbow, []);
    NOUN.set(elbow, 'ELBO');
  }
}

function branOf(pipe: string): string {
  return `${pipe}1`;
}

/** 这一条用例里的数据（每条用例从基线拷一份，用例里加的新构件不带到下一条） */
let children = new Map<string, string[]>();
/** 这一条用例里的分组：它在 `children` 里列的是解析视图下收录的成员，回执里按二级成员给（`secondary`） */
let groups = new Set<string>();

/** 数据批次在一个节点下新增一个有几何的构件 */
function addElbow(parent: string, id: string): void {
  children.set(parent, [...(children.get(parent) ?? []), id]);
  children.set(id, []);
  NOUN.set(id, 'ELBO');
}

/** 节点名下有几何的构件（叶子） */
function leavesUnder(id: string): string[] {
  const kids = children.get(id) ?? [];
  return kids.length === 0 ? [id] : kids.flatMap(leavesUnder);
}

function dto(id: string, owner: string | null): TreeNodeDto {
  const noun = NOUN.get(id) ?? '';
  return { refno: id, name: `/${noun}-${id}`, noun, owner, children_count: children.get(id)?.length ?? 0 };
}

/** 分组收录的成员：属主是它的主位置（不是分组），另带经由的 GPITEM */
function memberDto(id: string, group: string): TreeNodeDto {
  const owner = [...children].find(([parent, kids]) => !groups.has(parent) && kids.includes(id))?.[0] ?? null;
  return { ...dto(id, owner), secondary: true, via: `${group}9${id.split('_')[1]}` };
}

function visibleInstsOf(refno: string): VisibleInstsResponse {
  return { success: true, refno, refnos: leavesUnder(refno) };
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
      children: (children.get(refno) ?? []).map((id) => (groups.has(refno) ? memberDto(id, refno) : dto(id, refno))),
      truncated: false,
    })),
    ancestors: unused('ancestors'),
    search: unused('search'),
    subtreeRefnos: unused('subtreeRefnos'),
    visibleInsts: vi.fn(async (refno: string): Promise<VisibleInstsResponse> => visibleInstsOf(refno)),
  } satisfies TreeSource;
}

const scopes: { stop: () => void }[] = [];

/**
 * 树展开到管线一层：SITE 展开（两个 ZONE，顺带预取它们的 PIPE），ZONE A 展开（顺带预取 7 根 PIPE 的 BRAN）。
 * ZONE B 没展开过：它的 PIPE 在树里，PIPE 下面的 BRAN / ELBO 一层都没取进来。
 * `prepare` 在树取数之前改这一条用例的数据（比如在 SITE 下面加一个分组）。
 */
async function mountTree(prepare?: () => void) {
  children = new Map([...BASE_CHILDREN].map(([id, kids]) => [id, [...kids]]));
  groups = new Set();
  prepare?.();
  const source = fakeTreeSource();
  harness.tree = source;
  const scene = {
    setObjectsVisible: vi.fn<(refnos: string[], visible: boolean) => void>(),
    selectedObjectIds: [] as string[],
    getAABB: vi.fn((): number[] | null => null),
    getSubtreeAABB: vi.fn((): number[] | null => null),
  };
  const viewer = { scene, cameraFlight: { flyTo: vi.fn() } } as unknown as DtxCompatViewer;
  const scope = effectScope();
  scopes.push(scope);
  const tree = scope.run(() => usePdmsOwnerTree({ value: viewer }))!;
  const inTree = (id: string): boolean => Boolean(tree.nodesById.value[id]);
  await vi.waitFor(() => expect(inTree(SITE)).toBe(true));
  tree.toggleExpand(SITE);
  await vi.waitFor(() => expect([...PIPES_A, ...PIPES_B].every(inTree)).toBe(true));
  tree.toggleExpand(ZONE_A);
  await vi.waitFor(() => expect(PIPES_A.map(branOf).every(inTree)).toBe(true));
  expect(PIPES_B.map(branOf).some(inTree)).toBe(false);
  return { tree, source };
}

type Mounted = Awaited<ReturnType<typeof mountTree>>;

/** 像在面板里点这几行的眼睛把它们藏起来；藏完把「查过谁」清零（藏的时候树自己也查） */
async function hide({ tree, source }: Mounted, ...ids: string[]): Promise<void> {
  for (const id of ids) await tree.setVisible(id, false);
  source.visibleInsts.mockClear();
}

function asked(source: Mounted['source']): string[] {
  return source.visibleInsts.mock.calls.map(([refno]) => refno);
}

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** 藏着的节点自己 + 它名下有几何的构件 */
function withLeaves(...nodes: string[]): string[] {
  return sorted(nodes.flatMap((node) => [node, ...leavesUnder(node)]));
}

/** 让已经就绪的回调都跑完 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 查询都先挂着，由用例一个个放行 */
function gateVisibleInsts(source: Mounted['source']) {
  const waiting = new Map<string, () => void>();
  source.visibleInsts.mockImplementation((refno: string) => new Promise<VisibleInstsResponse>((resolve) => {
    waiting.set(refno, () => resolve(visibleInstsOf(refno)));
  }));
  return {
    waiting,
    release(refno: string): void {
      waiting.get(refno)?.();
      waiting.delete(refno);
    },
    releaseAll(): void {
      for (const refno of [...waiting.keys()]) this.release(refno);
    },
  };
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.restoreAllMocks();
});

describe('树上藏着的那部分名下现在有哪些构件（hiddenScopeUnder）', () => {
  it('节点下面没有藏着的、节点自己整个藏着、节点不在树里：回 null，不发请求', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;

    expect(await tree.hiddenScopeUnder(SITE)).toBeNull();
    expect(await tree.hiddenScopeUnder('9_9')).toBeNull();

    await hide(mounted, ZONE_B);
    expect(tree.getCheckState(ZONE_B)).toBe('unchecked');
    expect(tree.getCheckState(ZONE_A)).toBe('checked');
    // 整个藏着的不归这里管（重载按场景里的可见态定）；旁边整个显示着的下面没有藏着的
    expect(await tree.hiddenScopeUnder(ZONE_B)).toBeNull();
    expect(await tree.hiddenScopeUnder(ZONE_A)).toBeNull();

    expect(asked(source)).toEqual([]);
  });

  it('藏了一根管线、它下面那一层从没取进树里：答得出它名下现在的构件，连同数据批次新增的（现查，不用以前记下的清单）', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;
    const pipe = PIPES_B[0];
    await hide(mounted, pipe);
    expect(tree.nodesById.value[branOf(pipe)]).toBeUndefined();
    expect(tree.getCheckState(ZONE_B)).toBe('indeterminate');
    expect(tree.getCheckState(SITE)).toBe('indeterminate');
    const before = withLeaves(pipe);
    // 数据变了：这根管线的 BRAN 下面多了一个构件
    const added = `${branOf(pipe)}9`;
    addElbow(branOf(pipe), added);

    const scope = await tree.hiddenScopeUnder(SITE);

    expect(sorted(scope!.refnos)).toEqual(sorted([...before, added]));
    expect(scope!.failed).toEqual([]);
    expect(asked(source)).toEqual([pipe]);
  });

  it('藏了好几处、有的隔着半选的上级：只问最上一层藏着的节点，它下面跟着藏的不重复问', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;
    const pipe = PIPES_A[1];
    await hide(mounted, pipe, ZONE_B);
    // 跟着藏的下级：PIPE 下面已经在树里的 BRAN、ZONE B 下面的两根 PIPE
    expect(tree.getCheckState(branOf(pipe))).toBe('unchecked');
    expect(PIPES_B.map((id) => tree.getCheckState(id))).toEqual(['unchecked', 'unchecked']);
    expect(tree.getCheckState(ZONE_A)).toBe('indeterminate');

    const underSite = await tree.hiddenScopeUnder(SITE);
    expect(sorted(asked(source))).toEqual(sorted([pipe, ZONE_B]));
    expect(sorted(underSite!.refnos)).toEqual(withLeaves(pipe, ZONE_B));
    expect(underSite!.failed).toEqual([]);

    // 从世界根问（穿过半选的 SITE）答案一样；从半选的 ZONE A 问只管它自己下面；编号写成 a/b 也认
    expect(sorted((await tree.hiddenScopeUnder(ROOT))!.refnos)).toEqual(withLeaves(pipe, ZONE_B));
    source.visibleInsts.mockClear();
    const underZoneA = await tree.hiddenScopeUnder(ZONE_A.replace('_', '/'));
    expect(asked(source)).toEqual([pipe]);
    expect(sorted(underZoneA!.refnos)).toEqual(withLeaves(pipe));
  });

  it('同一个藏着的节点经两个父节点都到得了（分组把别处的管线收成成员）：只问一次', async () => {
    const [, hiddenPipe, shownPipe] = PIPES_A;
    const mounted = await mountTree(() => {
      children.set(SITE, [ZONE_A, ZONE_B, GROUP]);
      children.set(GROUP, [hiddenPipe, shownPipe]);
      groups.add(GROUP);
    });
    const { tree, source } = mounted;
    tree.toggleExpand(GROUP);
    await vi.waitFor(() => expect(tree.nodesById.value[GROUP]?.childrenIds).toEqual([hiddenPipe, shownPipe]));
    // 被分组收录不改主位置
    expect(tree.nodesById.value[hiddenPipe]?.parentId).toBe(ZONE_A);
    await hide(mounted, hiddenPipe);
    // 藏着的那根管线上面有两个半选的父节点：ZONE A（主位置）和分组（成员一藏一显）
    expect(tree.getCheckState(ZONE_A)).toBe('indeterminate');
    expect(tree.getCheckState(GROUP)).toBe('indeterminate');

    const scope = await tree.hiddenScopeUnder(SITE);

    expect(asked(source)).toEqual([hiddenPipe]);
    expect(sorted(scope!.refnos)).toEqual(withLeaves(hiddenPipe));
    expect(scope!.failed).toEqual([]);
  });

  it('有的藏着的节点没查到（后端说失败 / 请求抛错）：记进 failed，别的照常；查到了、名下是空的不算没查到', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;
    const [refused, thrown, empty, fine] = PIPES_A;
    await hide(mounted, refused, thrown, empty, fine);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.visibleInsts.mockImplementation(async (refno: string) => {
      if (refno === refused) return { success: false, refno, refnos: [], error_message: '后端不通' };
      if (refno === thrown) throw new Error('网络断了');
      if (refno === empty) return { success: true, refno, refnos: [] };
      return visibleInstsOf(refno);
    });

    const scope = await tree.hiddenScopeUnder(SITE);

    expect(sorted(scope!.failed)).toEqual(sorted([refused, thrown]));
    expect(sorted(scope!.refnos)).toEqual(sorted([empty, ...withLeaves(fine)]));
  });

  it('藏着的节点多：同时最多问 4 个，答回来一个再问下一个，最后一个不落', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;
    const hiddenPipes = PIPES_A.slice(0, 6);
    await hide(mounted, ...hiddenPipes);
    const gate = gateVisibleInsts(source);

    const pending = tree.hiddenScopeUnder(SITE);
    await settle();
    expect(asked(source)).toHaveLength(4);

    gate.release(asked(source)[0]!);
    await settle();
    expect(asked(source)).toHaveLength(5);

    gate.releaseAll();
    await settle();
    expect(sorted(asked(source))).toEqual(sorted(hiddenPipes));
    gate.releaseAll();

    const scope = await pending;
    expect(sorted(scope!.refnos)).toEqual(withLeaves(...hiddenPipes));
    expect(scope!.failed).toEqual([]);
  });

  it('问到一半被叫停：不再问剩下的，没轮到的记进 failed', async () => {
    const mounted = await mountTree();
    const { tree, source } = mounted;
    const hiddenPipes = PIPES_A.slice(0, 6);
    await hide(mounted, ...hiddenPipes);
    const gate = gateVisibleInsts(source);
    const controller = new AbortController();

    const pending = tree.hiddenScopeUnder(SITE, controller.signal);
    await settle();
    const firstFour = asked(source);
    expect(firstFour).toHaveLength(4);

    controller.abort();
    gate.releaseAll();
    const scope = await pending;

    expect(asked(source)).toEqual(firstFour);
    expect(sorted(scope!.refnos)).toEqual(withLeaves(...firstFour));
    expect(sorted(scope!.failed)).toEqual(sorted(hiddenPipes.filter((pipe) => !firstFour.includes(pipe))));
  });
});

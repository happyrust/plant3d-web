import { describe, expect, it, vi } from 'vitest';

import type { FlatRow, TreeNode } from '@/composables/useModelTree';

import {
  useTreeVersionDiff,
  type DiffFlatRow,
  type TreeDiffContext,
  type TreeDiffModel,
} from '@/composables/useTreeVersionDiff';

// -----------------------------------------------------------------------------------------------
// T015（US2）：树内差异回归测试。为可测性直接针对 useTreeVersionDiff 组织用例（不 mount 整个
// ModelTreePanel）；deps 用纯对象 fake 构造，与 ModelTreePanel 注入的 pdmsTree 形状一致。
// 覆盖：徽章数据（diffStatus/diffCount/counts）、幽灵节点回插（含原父也被删 → 挂最近存活祖先）、
// 筛选保留祖先路径、退出清理（FR-010/011/013/014）。
// -----------------------------------------------------------------------------------------------

type SpecNode = { id: string; type?: string; children?: SpecNode[] };

function buildTreeDeps(roots: SpecNode[], expanded: string[]) {
  const nodesById: Record<string, TreeNode> = {};
  const flatRows: FlatRow[] = [];
  const expandedIds = new Set(expanded);

  const visit = (spec: SpecNode, parentId: string | null, depth: number, visible: boolean) => {
    const children = spec.children ?? [];
    nodesById[spec.id] = {
      id: spec.id,
      refno: spec.id,
      name: spec.id,
      type: spec.type ?? 'ZONE',
      parentId,
      childrenIds: children.map((c) => c.id),
    };
    if (visible) {
      flatRows.push({
        id: spec.id,
        refno: spec.id,
        name: spec.id,
        type: spec.type ?? 'ZONE',
        depth,
        hasChildren: children.length > 0,
      });
    }
    const childVisible = visible && expandedIds.has(spec.id);
    for (const child of children) visit(child, spec.id, depth + 1, childVisible);
  };
  for (const root of roots) visit(root, null, 0, true);

  const expandPathToNode = vi.fn(async (_refno: string) => true);
  return {
    nodesById: { value: nodesById },
    rootIds: { value: roots.map((r) => r.id) },
    expandedIds: { value: expandedIds },
    flatRows: { value: flatRows },
    expandPathToNode,
  };
}

/**
 * 固定树：
 *   site
 *   ├─ zoneA ── pipeA1 / pipeA2
 *   └─ zoneB ── pipeB1
 */
function makeDefaultDeps(expanded: string[] = ['site', 'zoneA', 'zoneB']) {
  return buildTreeDeps(
    [
      {
        id: 'site',
        type: 'SITE',
        children: [
          { id: 'zoneA', children: [{ id: 'pipeA1', type: 'PIPE' }, { id: 'pipeA2', type: 'PIPE' }] },
          { id: 'zoneB', children: [{ id: 'pipeB1', type: 'PIPE' }] },
        ],
      },
    ],
    expanded,
  );
}

/** 变更集：增/改各 1，删 4（含"原父也被删"链与完全无法定位的孤儿） */
const MODELS: TreeDiffModel[] = [
  { refno: 'pipeA1', status: 'modified', category: 'PIPE' },
  { refno: 'pipeA2', status: 'added', category: 'PIPE' },
  { refno: 'del-parent', status: 'deleted', ownerRefno: 'zoneA', sourceNouns: 'bran, pipe' },
  { refno: 'del-child', status: 'deleted', ownerRefno: 'del-parent', category: 'BRAN' },
  { refno: 'del-b', status: 'deleted', ownerRefno: 'zoneB' },
  { refno: 'del-orphan', status: 'deleted', ownerRefno: 'gone-forever' },
];

function makeContext(models: TreeDiffModel[] = MODELS): TreeDiffContext {
  return {
    project: 'AvevaMarineSample',
    dbnum: 1112,
    fromSesno: 791,
    toSesno: 897,
    mode: 'incremental',
    refnos: models.map((m) => m.refno),
    models,
  };
}

function rowById(rows: DiffFlatRow[], id: string): DiffFlatRow {
  const row = rows.find((r) => r.id === id);
  expect(row, `期望差异行中存在 ${id}`).toBeTruthy();
  return row!;
}

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function untilResolveSettled(resolving: { value: boolean }) {
  for (let i = 0; i < 50 && resolving.value; i += 1) await flushAsync();
  expect(resolving.value).toBe(false);
}

describe('useTreeVersionDiff（T015 树内差异回归）', () => {
  it('apply 后 counts 与 rows 携带正确的 diffStatus/diffCount 徽章数据', async () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);

    expect(diff.isActive.value).toBe(false);
    diff.apply(makeContext());

    expect(diff.isActive.value).toBe(true);
    expect(diff.counts.value).toEqual({ all: 6, added: 1, modified: 1, deleted: 4 });
    expect(diff.versionPairLabel.value).toBe('791 → 897');
    // 默认选中第一个变更模型（属性差异面板初始焦点）
    expect(diff.selectedRefno.value).toBe('pipeA1');

    const rows = diff.rows.value;
    // 变更节点 + 祖先路径 + 幽灵节点；未变更且非祖先的 pipeB1 不出现
    expect(rows.map((r) => r.id)).toEqual([
      'site', 'zoneA', 'pipeA1', 'pipeA2', 'del-parent', 'del-child', 'zoneB', 'del-b', 'del-orphan',
    ]);

    // 祖先容器：无 diffStatus，只有后代变更汇总 diffCount
    expect(rowById(rows, 'site')).toMatchObject({ diffStatus: undefined, diffCount: 6 });
    expect(rowById(rows, 'zoneA')).toMatchObject({ diffStatus: undefined, diffCount: 4 });
    expect(rowById(rows, 'zoneB')).toMatchObject({ diffStatus: undefined, diffCount: 1 });

    // 变更节点自身：diffStatus 徽章、无 diffCount、非幽灵
    expect(rowById(rows, 'pipeA1')).toMatchObject({ diffStatus: 'modified', diffCount: undefined });
    expect(rowById(rows, 'pipeA1').ghost).toBeFalsy();
    expect(rowById(rows, 'pipeA2')).toMatchObject({ diffStatus: 'added', diffCount: undefined });

    // 路径解析：非删除节点解析自身，删除节点解析其 ownerRefno（去重）
    await untilResolveSettled(diff.resolving);
    const targets = deps.expandPathToNode.mock.calls.map((c) => c[0]).sort();
    expect(targets).toEqual(['del-parent', 'gone-forever', 'pipeA1', 'pipeA2', 'zoneA', 'zoneB'].sort());
    expect(diff.resolveTotal.value).toBe(6);
    expect(diff.resolveDone.value).toBe(6);
  });

  it('幽灵节点回插：原父存在挂原父末尾；原父也被删挂最近存活祖先；均不可得挂根并标记 ghostUnplaced', () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext());

    const rows = diff.rows.value;

    // del-b：原父 zoneB 仍存活 → 挂 zoneB 子块末尾（紧随其后），非 unplaced
    const zoneBIndex = rows.findIndex((r) => r.id === 'zoneB');
    expect(rows[zoneBIndex + 1]).toMatchObject({
      id: 'del-b', ghost: true, ghostUnplaced: false, diffStatus: 'deleted', depth: 2,
    });

    // del-child：原父 del-parent 也被删除 → 沿 ownerRefno 链上溯，挂最近存活祖先 zoneA（data-model 幽灵挂载规则）
    const delChild = rowById(rows, 'del-child');
    expect(delChild).toMatchObject({ ghost: true, ghostUnplaced: false, depth: 2 });
    const zoneAIndex = rows.findIndex((r) => r.id === 'zoneA');
    const delChildIndex = rows.findIndex((r) => r.id === 'del-child');
    const zoneBIdx = rows.findIndex((r) => r.id === 'zoneB');
    expect(delChildIndex).toBeGreaterThan(zoneAIndex);
    expect(delChildIndex).toBeLessThan(zoneBIdx);
    // 祖先汇总把链上幽灵也计入：zoneA = pipeA1 + pipeA2 + del-parent + del-child
    expect(rowById(rows, 'zoneA').diffCount).toBe(4);

    // del-orphan：ownerRefno 完全无法定位 → 回退根节点 + ghostUnplaced
    expect(rowById(rows, 'del-orphan')).toMatchObject({ ghost: true, ghostUnplaced: true, depth: 1 });
    // 已回插到根，不计入"未定位"计数（该计数只针对无法回插的情形）
    expect(diff.unplacedCount.value).toBe(0);

    // 幽灵行展示形态：type 取 sourceNouns 首词（大写），无名词时回退 category
    expect(rowById(rows, 'del-parent').type).toBe('BRAN');
    expect(rowById(rows, 'del-child').type).toBe('BRAN');
    expect(rowById(rows, 'del-b').type).toBe('');
    expect(rowById(rows, 'del-b').hasChildren).toBe(false);

    // 幽灵节点可被选中联动属性差异面板，且识别为 ghost
    diff.select('del-child');
    expect(diff.selectedRefno.value).toBe('del-child');
    expect(diff.selectedIsGhost.value).toBe(true);
    diff.select('not-a-change');
    expect(diff.selectedRefno.value).toBe('del-child');
  });

  it('幽灵节点仅在父节点展开时插入行，收起父节点不渲染但计数保留', () => {
    const deps = makeDefaultDeps(['site', 'zoneA']); // zoneB 收起
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext());

    const ids = diff.rows.value.map((r) => r.id);
    expect(ids).not.toContain('del-b');
    expect(rowById(diff.rows.value, 'zoneB').diffCount).toBe(1);
  });

  it('ownerRefno 链成环时安全回退根节点，不死循环', () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext([
      { refno: 'del-x', status: 'deleted', ownerRefno: 'del-y' },
      { refno: 'del-y', status: 'deleted', ownerRefno: 'del-x' },
    ]));

    const rows = diff.rows.value;
    expect(rowById(rows, 'del-x')).toMatchObject({ ghost: true, ghostUnplaced: true, depth: 1 });
    expect(rowById(rows, 'del-y')).toMatchObject({ ghost: true, ghostUnplaced: true, depth: 1 });
  });

  it('新增/修改节点不在树中时计入 unplacedCount（路径未解析/超上限）', () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext([
      { refno: 'not-loaded-yet', status: 'added' },
      { refno: 'pipeA1', status: 'modified' },
    ]));

    expect(diff.unplacedCount.value).toBe(1);
    expect(diff.rows.value.map((r) => r.id)).toEqual(['site', 'zoneA', 'pipeA1']);
  });

  it('筛选 chips：按类别过滤仍保留祖先路径且祖先 diffCount 只统计命中类别', () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext());

    diff.setFilter('added');
    expect(diff.rows.value.map((r) => r.id)).toEqual(['site', 'zoneA', 'pipeA2']);
    expect(rowById(diff.rows.value, 'site').diffCount).toBe(1);
    expect(rowById(diff.rows.value, 'zoneA').diffCount).toBe(1);
    expect(rowById(diff.rows.value, 'pipeA2').diffStatus).toBe('added');

    diff.setFilter('modified');
    expect(diff.rows.value.map((r) => r.id)).toEqual(['site', 'zoneA', 'pipeA1']);

    diff.setFilter('deleted');
    expect(diff.rows.value.map((r) => r.id)).toEqual([
      'site', 'zoneA', 'del-parent', 'del-child', 'zoneB', 'del-b', 'del-orphan',
    ]);
    expect(rowById(diff.rows.value, 'site').diffCount).toBe(4);
    expect(rowById(diff.rows.value, 'zoneA').diffCount).toBe(2);

    // chips 计数来自全量 counts，不随筛选变化
    expect(diff.counts.value).toEqual({ all: 6, added: 1, modified: 1, deleted: 4 });

    diff.setFilter('all');
    expect(diff.rows.value).toHaveLength(9);
  });

  it('筛选时自身变更被过滤掉的祖先节点降级显示 diffCount 而非 diffStatus', () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    // zoneB 自身被修改，同时其子块下有删除幽灵
    diff.apply(makeContext([
      { refno: 'zoneB', status: 'modified' },
      { refno: 'del-b', status: 'deleted', ownerRefno: 'zoneB' },
    ]));

    // all：zoneB 自身徽章优先
    expect(rowById(diff.rows.value, 'zoneB')).toMatchObject({ diffStatus: 'modified', diffCount: undefined });

    // deleted：zoneB 自身不命中筛选，但作为幽灵祖先保留并显示汇总
    diff.setFilter('deleted');
    expect(rowById(diff.rows.value, 'zoneB')).toMatchObject({ diffStatus: undefined, diffCount: 1 });
    expect(diff.rows.value.map((r) => r.id)).toEqual(['site', 'zoneB', 'del-b']);
  });

  it('重复 apply 相同上下文不重置筛选/选中，也不重复解析路径', async () => {
    const deps = makeDefaultDeps();
    const diff = useTreeVersionDiff(deps);
    diff.apply(makeContext());
    await untilResolveSettled(diff.resolving);
    const callsAfterFirst = deps.expandPathToNode.mock.calls.length;

    diff.setFilter('deleted');
    diff.select('del-b');
    diff.apply(makeContext());

    expect(diff.filter.value).toBe('deleted');
    expect(diff.selectedRefno.value).toBe('del-b');
    expect(deps.expandPathToNode.mock.calls.length).toBe(callsAfterFirst);
  });

  it('路径解析上限 MAX_PATH_RESOLVE=500：超量变更不再逐个解析（FR-014）', async () => {
    const deps = buildTreeDeps([{ id: 'site', type: 'SITE' }], ['site']);
    const diff = useTreeVersionDiff(deps);
    const many = Array.from({ length: 505 }, (_, i): TreeDiffModel => ({ refno: `m${i}`, status: 'added' }));
    diff.apply(makeContext(many));

    expect(diff.resolveTotal.value).toBe(500);
    await untilResolveSettled(diff.resolving);
    expect(deps.expandPathToNode.mock.calls.length).toBe(500);
    expect(diff.counts.value.all).toBe(505);
  });

  it('clear 退出差异模式：rows/counts/selectedRefno/resolving 全部复位（FR-013）', async () => {
    const deps = makeDefaultDeps();
    // 手动控制的挂起解析，模拟"定位进行中即退出"
    const pending: (() => void)[] = [];
    deps.expandPathToNode.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(() => resolve(true))),
    );
    const diff = useTreeVersionDiff(deps);

    diff.apply(makeContext());
    diff.setFilter('deleted');
    diff.select('del-b');
    expect(diff.resolving.value).toBe(true);
    expect(diff.rows.value.length).toBeGreaterThan(0);

    diff.clear();

    expect(diff.isActive.value).toBe(false);
    expect(diff.context.value).toBeNull();
    expect(diff.rows.value).toEqual([]);
    expect(diff.counts.value).toEqual({ all: 0, added: 0, modified: 0, deleted: 0 });
    expect(diff.selectedRefno.value).toBeNull();
    expect(diff.selectedModel.value).toBeNull();
    expect(diff.selectedIsGhost.value).toBe(false);
    expect(diff.filter.value).toBe('all');
    expect(diff.resolving.value).toBe(false);
    expect(diff.resolveDone.value).toBe(0);
    expect(diff.resolveTotal.value).toBe(0);
    expect(diff.unplacedCount.value).toBe(0);
    expect(diff.versionPairLabel.value).toBe('');

    // 退出后迟到的解析完成不得污染已复位的状态（陈旧序列被丢弃）
    pending.forEach((resolve) => resolve());
    await flushAsync();
    expect(diff.resolving.value).toBe(false);
    expect(diff.resolveDone.value).toBe(0);

    // 退出后再次进入是全新会话：筛选/选中恢复默认
    diff.apply(makeContext());
    expect(diff.filter.value).toBe('all');
    expect(diff.selectedRefno.value).toBe('pipeA1');
  });
});

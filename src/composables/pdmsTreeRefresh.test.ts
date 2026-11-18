/**
 * 「取最新」里模型树的对账（`pdmsTreeRefresh`）：纯函数这一层。连着真的 `usePdmsOwnerTree` 与树数据源的用例在
 * `usePdmsOwnerTree.getwork.test.ts`。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  classifyDisappearedNodes,
  fetchTreeLayerAnswers,
  isTreeNodeGoneMessage,
  reconcileTreeLayers,
  type TreeLayerAnswer,
  type TreeRefreshState,
} from './pdmsTreeRefresh';

import type { TreeNodeDto } from '@/api/genModelE3dTypes';
import type { CheckState, TreeNode } from '@/composables/useModelTree';

const deps = {
  normalizeId: (refno: string) => String(refno).replace('/', '_'),
  toNode: (dto: TreeNodeDto, parentId: string | null): TreeNode => {
    const node: TreeNode = { id: String(dto.refno).replace('/', '_'), name: dto.name, type: dto.noun, parentId, childrenIds: [] };
    if (typeof dto.dbnum === 'number') node.dbnum = dto.dbnum;
    return node;
  },
};

function dto(refno: string, noun: string, name: string, extra: Partial<TreeNodeDto> = {}): TreeNodeDto {
  return { refno, noun, name, owner: '', children_count: 0, dbnum: 8000, ...extra } as TreeNodeDto;
}

function ok(...children: TreeNodeDto[]): TreeLayerAnswer {
  return { ok: true, children, unresolvedCount: 0 };
}

/** 一棵小树：SITE 1_1 › ZONE-A 1_2（EQUI 1_3、1_4、1_8）、ZONE-B 1_6（空）。三层都取过子节点。 */
function baseState(overrides: Partial<TreeRefreshState> = {}): TreeRefreshState {
  const node = (id: string, name: string, type: string, parentId: string | null, childrenIds: string[]): TreeNode => (
    { id, name, type, parentId, childrenIds, dbnum: 8000 }
  );
  return {
    nodesById: {
      '1_1': node('1_1', '/SITE-A', 'SITE', null, ['1_2', '1_6']),
      '1_2': node('1_2', '/ZONE-A', 'ZONE', '1_1', ['1_3', '1_4', '1_8']),
      '1_3': node('1_3', '/OLD-NAME', 'EQUI', '1_2', []),
      '1_4': node('1_4', '/TO-DELETE', 'EQUI', '1_2', []),
      '1_8': node('1_8', '/MOVED', 'EQUI', '1_2', []),
      '1_6': node('1_6', '/ZONE-B', 'ZONE', '1_1', []),
    },
    rootIds: ['1_1'],
    loadedLayers: new Set(['1_1', '1_2', '1_6']),
    expandedIds: new Set(['1_1', '1_2', '1_6']),
    selectedIds: new Set<string>(),
    checkStateById: new Map<string, CheckState>([
      ['1_1', 'checked'], ['1_2', 'checked'], ['1_3', 'checked'], ['1_4', 'checked'], ['1_8', 'checked'], ['1_6', 'checked'],
    ]),
    childrenCountById: new Map<string, number | null>([['1_2', 3], ['1_6', 0], ['1_3', 1], ['1_4', 1], ['1_8', 0]]),
    viewParentsById: new Map([
      ['1_2', new Set(['1_1'])], ['1_6', new Set(['1_1'])],
      ['1_3', new Set(['1_2'])], ['1_4', new Set(['1_2'])], ['1_8', new Set(['1_2'])],
    ]),
    ...overrides,
  };
}

/** 别人保存之后：1_3 改名、1_4 被删、新增 1_5、1_8 从 ZONE-A 挪到 ZONE-B */
function answersAfterSave(): Map<string, TreeLayerAnswer> {
  return new Map<string, TreeLayerAnswer>([
    ['1_1', ok(dto('1_2', 'ZONE', '/ZONE-A', { children_count: 2 }), dto('1_6', 'ZONE', '/ZONE-B', { children_count: 1 }))],
    ['1_2', ok(dto('1_3', 'EQUI', '/NEW-NAME', { children_count: 1 }), dto('1_5', 'EQUI', '/ADDED', { children_count: 1 }))],
    ['1_6', ok(dto('1_8', 'EQUI', '/MOVED'))],
  ]);
}

describe('reconcileTreeLayers：新增、删除、改名、挪位置', () => {
  it('一轮对完：新增的进树、删掉的撤掉、改名的换名字、挪位置的到新父节点下，回执逐项说清', () => {
    const result = reconcileTreeLayers(baseState(), answersAfterSave(), deps);

    expect(result.nodesById['1_2']!.childrenIds).toEqual(['1_3', '1_5']);
    expect(result.nodesById['1_6']!.childrenIds).toEqual(['1_8']);
    expect(result.nodesById['1_3']!.name).toBe('/NEW-NAME');
    expect(result.nodesById['1_5']).toMatchObject({ name: '/ADDED', type: 'EQUI', parentId: '1_2', dbnum: 8000 });
    expect(result.nodesById['1_4']).toBeUndefined();
    expect(result.nodesById['1_8']!.parentId).toBe('1_6');
    // 子节点数跟着服务端
    expect(result.childrenCountById.get('1_2')).toBe(2);
    expect(result.childrenCountById.get('1_6')).toBe(1);
    expect(result.childrenCountById.get('1_5')).toBe(1);

    const { report } = result;
    expect(report.layersRequested).toBe(3);
    expect(report.layersRefreshed).toBe(3);
    expect(report.layersFailed).toEqual([]);
    expect(report.added.map((item) => item.id)).toEqual(['1_5']);
    expect(report.removed).toEqual([{ id: '1_4', name: '/TO-DELETE', type: 'EQUI', dbnum: 8000, fate: 'unknown' }]);
    expect(report.removedNodeCount).toBe(1);
    expect(report.renamed).toEqual([{ id: '1_3', name: '/NEW-NAME', type: 'EQUI', dbnum: 8000, previousName: '/OLD-NAME', previousType: 'EQUI' }]);
    expect(report.moved).toEqual([{ id: '1_8', name: '/MOVED', type: 'EQUI', dbnum: 8000, from: '1_2', to: '1_6' }]);
    expect(report.changed).toBe(true);
  });

  it('什么都没变：树原样，回执说没有变化', () => {
    const state = baseState();
    const same = new Map<string, TreeLayerAnswer>([
      ['1_1', ok(dto('1_2', 'ZONE', '/ZONE-A', { children_count: 3 }), dto('1_6', 'ZONE', '/ZONE-B'))],
      ['1_2', ok(dto('1_3', 'EQUI', '/OLD-NAME', { children_count: 1 }), dto('1_4', 'EQUI', '/TO-DELETE', { children_count: 1 }), dto('1_8', 'EQUI', '/MOVED'))],
      ['1_6', ok()],
    ]);
    const result = reconcileTreeLayers(state, same, deps);
    expect(result.report).toMatchObject({ changed: false, added: [], removed: [], renamed: [], moved: [], removedNodeCount: 0 });
    expect(Object.keys(result.nodesById).sort()).toEqual(Object.keys(state.nodesById).sort());
    expect([...result.expandedIds].sort()).toEqual(['1_1', '1_2', '1_6']);
  });

  it('同一层里只是顺序变了：按服务端的顺序排，算有变化', () => {
    const answers = new Map<string, TreeLayerAnswer>([
      ['1_2', ok(dto('1_8', 'EQUI', '/MOVED'), dto('1_3', 'EQUI', '/OLD-NAME'), dto('1_4', 'EQUI', '/TO-DELETE'))],
    ]);
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_2']!.childrenIds).toEqual(['1_8', '1_3', '1_4']);
    expect(result.report.changed).toBe(true);
    expect(result.report.moved).toEqual([]);
  });

  it('类型变了（同一个 refno 换了 noun）也算改名那一类', () => {
    const answers = new Map<string, TreeLayerAnswer>([
      ['1_2', ok(dto('1_3', 'STRU', '/OLD-NAME'), dto('1_4', 'EQUI', '/TO-DELETE'), dto('1_8', 'EQUI', '/MOVED'))],
    ]);
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_3']!.type).toBe('STRU');
    expect(result.report.renamed).toEqual([expect.objectContaining({ id: '1_3', type: 'STRU', previousType: 'EQUI' })]);
  });
});

describe('reconcileTreeLayers：状态保得住，指向已删节点的记录清掉', () => {
  it('展开、勾选、选中：还在的节点原样留着；被删节点的展开、选中、勾选、子节点数、取过子节点的标记都清掉', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '1_4': { id: '1_4', name: '/TO-DELETE', type: 'EQUI', parentId: '1_2', childrenIds: ['1_41'], dbnum: 8000 },
        '1_41': { id: '1_41', name: '/BOX', type: 'BOX', parentId: '1_4', childrenIds: [], dbnum: 8000 },
      },
      loadedLayers: new Set(['1_1', '1_2', '1_6', '1_4']),
      expandedIds: new Set(['1_1', '1_2', '1_6', '1_4']),
      selectedIds: new Set(['1_3', '1_41']),
      checkStateById: new Map<string, CheckState>([
        ['1_1', 'indeterminate'], ['1_2', 'indeterminate'], ['1_3', 'unchecked'], ['1_4', 'checked'], ['1_41', 'checked'],
        ['1_8', 'checked'], ['1_6', 'checked'],
      ]),
      childrenCountById: new Map<string, number | null>([['1_2', 3], ['1_6', 0], ['1_3', 1], ['1_4', 1], ['1_41', 0], ['1_8', 0]]),
      viewParentsById: new Map([
        ['1_2', new Set(['1_1'])], ['1_6', new Set(['1_1'])],
        ['1_3', new Set(['1_2'])], ['1_4', new Set(['1_2'])], ['1_8', new Set(['1_2'])], ['1_41', new Set(['1_4'])],
      ]),
    });
    const answers = answersAfterSave();
    // 被删节点自己那一层：后端回 404
    answers.set('1_4', { ok: false, gone: true, error: 'not_found (404): dbnum 8000 会话 Some(1155) 的索引里没有 1/4' });

    const result = reconcileTreeLayers(state, answers, deps);

    // 还在的：1_3 的「未勾选」和选中都留着；展开的三层都还展开
    expect(result.checkStateById.get('1_3')).toBe('unchecked');
    expect([...result.selectedIds]).toEqual(['1_3']);
    expect([...result.expandedIds].sort()).toEqual(['1_1', '1_2', '1_6']);
    // 被删的 1_4 和它名下的 1_41：什么记录都不剩
    for (const gone of ['1_4', '1_41']) {
      expect(result.nodesById[gone]).toBeUndefined();
      expect(result.checkStateById.has(gone)).toBe(false);
      expect(result.childrenCountById.has(gone)).toBe(false);
      expect(result.viewParentsById.has(gone)).toBe(false);
      expect(result.expandedIds.has(gone)).toBe(false);
      expect(result.loadedLayers.has(gone)).toBe(false);
    }
    expect(result.report.droppedSelection).toEqual(['1_41']);
    // 回执里只列最上面那个；它自己那一层回了 404，下落直接定为「已删除」；失败清单里不算它
    expect(result.report.removed).toEqual([expect.objectContaining({ id: '1_4', fate: 'deleted' })]);
    expect(result.report.removedNodeCount).toBe(2);
    expect(result.report.removedUnder).toEqual({ '1_4': '1_4', '1_41': '1_4' });
    expect(result.report.layersFailed).toEqual([]);
    expect(result.goneLayers.has('1_4')).toBe(true);
  });

  it('新节点的勾选态继承父节点：父节点未勾选 → 未勾选并回放隐藏；否则勾选并回放显示', () => {
    const hidden = baseState();
    (hidden.checkStateById as Map<string, CheckState>).set('1_2', 'unchecked');
    const underHidden = reconcileTreeLayers(hidden, answersAfterSave(), deps);
    expect(underHidden.checkStateById.get('1_5')).toBe('unchecked');
    expect(underHidden.hide).toEqual(['1_5']);
    expect(underHidden.show).toEqual([]);

    const underShown = reconcileTreeLayers(baseState(), answersAfterSave(), deps);
    expect(underShown.checkStateById.get('1_5')).toBe('checked');
    expect(underShown.show).toEqual(['1_5']);
    expect(underShown.hide).toEqual([]);

    const half = baseState();
    (half.checkStateById as Map<string, CheckState>).set('1_2', 'indeterminate');
    expect(reconcileTreeLayers(half, answersAfterSave(), deps).checkStateById.get('1_5')).toBe('checked');
  });

  it('删掉唯一没勾的子节点：父节点从半选回到勾选，并沿祖先上推', () => {
    const state = baseState();
    const checks = state.checkStateById as Map<string, CheckState>;
    checks.set('1_4', 'unchecked');
    checks.set('1_2', 'indeterminate');
    checks.set('1_1', 'indeterminate');
    const answers = new Map<string, TreeLayerAnswer>([
      ['1_2', ok(dto('1_3', 'EQUI', '/OLD-NAME'), dto('1_8', 'EQUI', '/MOVED'))],
    ]);
    const result = reconcileTreeLayers(state, answers, deps);
    expect(result.checkStateById.get('1_2')).toBe('checked');
    expect(result.checkStateById.get('1_1')).toBe('checked');
  });

  it('一层的子节点删光了：父节点自己的勾选态留着（不被空表聚合成半选）', () => {
    const state = baseState();
    (state.checkStateById as Map<string, CheckState>).set('1_2', 'unchecked');
    for (const id of ['1_3', '1_4', '1_8']) (state.checkStateById as Map<string, CheckState>).set(id, 'unchecked');
    (state.checkStateById as Map<string, CheckState>).set('1_1', 'indeterminate');
    const result = reconcileTreeLayers(state, new Map<string, TreeLayerAnswer>([['1_2', ok()]]), deps);
    expect(result.nodesById['1_2']!.childrenIds).toEqual([]);
    expect(result.checkStateById.get('1_2')).toBe('unchecked');
    expect(result.report.removedNodeCount).toBe(3);
  });
});

describe('reconcileTreeLayers：没取到的层、没取过的层', () => {
  it('一层没取到（网络错）：这一层保持原样，记进回执，不当成子节点都没了', () => {
    const answers = answersAfterSave();
    answers.set('1_2', { ok: false, gone: false, error: 'network: 连接被重置' });
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_2']!.childrenIds).toEqual(['1_3', '1_4']);
    expect(result.nodesById['1_3']!.name).toBe('/OLD-NAME');
    expect(result.nodesById['1_4']).toBeDefined();
    expect(result.report.layersRefreshed).toBe(2);
    expect(result.report.layersFailed).toEqual([{ id: '1_2', name: '/ZONE-A', error: 'network: 连接被重置' }]);
    expect(result.report.removed).toEqual([]);
  });

  it('挪走了、而旧位置那一层这一轮没取到：从旧位置的子节点表里拿掉，不在两处都出行', () => {
    const answers = answersAfterSave();
    answers.set('1_2', { ok: false, gone: false, error: 'timeout' });
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_8']!.parentId).toBe('1_6');
    expect(result.nodesById['1_6']!.childrenIds).toEqual(['1_8']);
    expect(result.nodesById['1_2']!.childrenIds).not.toContain('1_8');
    expect(result.report.moved).toEqual([expect.objectContaining({ id: '1_8', from: '1_2', to: '1_6' })]);
  });

  it('子节点没取过的层不对账：给了答复也不理（没取过的层不白取）', () => {
    const answers = new Map<string, TreeLayerAnswer>([
      ['1_3', ok(dto('1_31', 'BOX', '/BOX'))],
    ]);
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_31']).toBeUndefined();
    expect(result.nodesById['1_3']!.childrenIds).toEqual([]);
    expect(result.loadedLayers.has('1_3')).toBe(false);
    expect(result.report.layersRequested).toBe(0);
    expect(result.report.changed).toBe(false);
  });

  it('挪到了树上还没展开的位置：从树上撤掉（下落先记不知道，等着去问）；它的状态一起清', () => {
    // ZONE-B 这一层没取过：1_8 挪过去之后树上没有地方挂它
    const state = baseState({ loadedLayers: new Set(['1_1', '1_2']), expandedIds: new Set(['1_1', '1_2']), selectedIds: new Set(['1_8']) });
    const answers = answersAfterSave();
    answers.delete('1_6');
    const result = reconcileTreeLayers(state, answers, deps);
    expect(result.nodesById['1_8']).toBeUndefined();
    expect(result.report.removed.map((item) => [item.id, item.fate])).toEqual([['1_4', 'unknown'], ['1_8', 'unknown']]);
    expect(result.report.moved).toEqual([]);
    expect(result.report.droppedSelection).toEqual(['1_8']);
    // ZONE-B 的子节点数从 0 变成 1：行上的展开箭头跟着出现
    expect(result.childrenCountById.get('1_6')).toBe(1);
  });

  it('对账之前就挂不到根上的节点（历史遗留的孤儿）：悄悄清掉，不算这一轮删的', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '7_7': { id: '7_7', name: '/ORPHAN', type: 'EQUI', parentId: '7_0', childrenIds: [], dbnum: 8000 },
      },
      // 它还留着一条指向 ZONE-A 的视图父节点记录（ZONE-A 的子节点表里早就没有它了）
      viewParentsById: new Map([...baseState().viewParentsById, ['7_7', new Set(['1_2'])]]),
    });
    const result = reconcileTreeLayers(state, new Map<string, TreeLayerAnswer>([['1_6', ok()]]), deps);
    expect(result.nodesById['7_7']).toBeUndefined();
    expect(result.viewParentsById.has('7_7')).toBe(false);
    expect(result.report.removed).toEqual([]);
    expect(result.report.removedNodeCount).toBe(0);
    expect(result.report.changed).toBe(false);
  });

  it('后端把父节点自己也列进子节点：忽略，不造环', () => {
    const answers = new Map<string, TreeLayerAnswer>([
      ['1_2', ok(dto('1_2', 'ZONE', '/ZONE-A'), dto('1_3', 'EQUI', '/OLD-NAME'), dto('1_3', 'EQUI', '/OLD-NAME'))],
    ]);
    const result = reconcileTreeLayers(baseState(), answers, deps);
    expect(result.nodesById['1_2']!.childrenIds).toEqual(['1_3']);
  });
});

describe('reconcileTreeLayers：分组（解析视图下的二级成员）', () => {
  it('分组新收录一个已在主位置的元素：不改它的主位置，经由的 GPITEM 记在分组上；撤出收录时主位置那一行还在', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '1_1': { id: '1_1', name: '/SITE-A', type: 'SITE', parentId: null, childrenIds: ['1_2', '1_6', '9_1'], dbnum: 8000 },
        '9_1': { id: '9_1', name: '/GPSET-1', type: 'GPSET', parentId: '1_1', childrenIds: [], dbnum: 8000 },
      },
      loadedLayers: new Set(['1_1', '1_2', '1_6', '9_1']),
    });
    const collected = new Map<string, TreeLayerAnswer>([
      ['9_1', ok(dto('1_3', 'EQUI', '/OLD-NAME', { secondary: true, via: '9/2' } as Partial<TreeNodeDto>))],
    ]);
    const withMember = reconcileTreeLayers(state, collected, deps);
    expect(withMember.nodesById['9_1']!.childrenIds).toEqual(['1_3']);
    expect(withMember.nodesById['9_1']!.groupMemberVia).toEqual({ '1_3': '9_2' });
    expect(withMember.nodesById['1_3']!.parentId).toBe('1_2');
    expect(withMember.report.moved).toEqual([]);
    expect([...withMember.viewParentsById.get('1_3')!].sort()).toEqual(['1_2', '9_1']);

    // 再对一次账：分组不再收录它
    const next: TreeRefreshState = {
      ...state,
      nodesById: withMember.nodesById,
      checkStateById: withMember.checkStateById,
      childrenCountById: withMember.childrenCountById,
      viewParentsById: withMember.viewParentsById,
    };
    const released = reconcileTreeLayers(next, new Map<string, TreeLayerAnswer>([['9_1', ok()]]), deps);
    expect(released.nodesById['9_1']!.childrenIds).toEqual([]);
    expect(released.nodesById['9_1']!.groupMemberVia).toBeUndefined();
    expect(released.nodesById['1_3']).toBeDefined();
    expect([...released.viewParentsById.get('1_3')!]).toEqual(['1_2']);
    expect(released.report.removed).toEqual([]);
  });

  it('分组新收录一个树上还没有的元素：进树、挂在分组下，但分组不是它的主位置', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '1_6': { id: '1_6', name: '/GPSET-B', type: 'GPSET', parentId: '1_1', childrenIds: [], dbnum: 8000 },
      },
    });
    const result = reconcileTreeLayers(state, new Map<string, TreeLayerAnswer>([
      ['1_6', ok(dto('5_5', 'EQUI', '/FROM-ELSEWHERE', { secondary: true, via: null } as Partial<TreeNodeDto>))],
    ]), deps);
    expect(result.nodesById['5_5']).toMatchObject({ name: '/FROM-ELSEWHERE', parentId: null });
    expect(result.nodesById['1_6']!.childrenIds).toEqual(['5_5']);
    expect(result.nodesById['1_6']!.groupMemberVia).toEqual({ '5_5': null });
    expect(result.report.added.map((item) => item.id)).toEqual(['5_5']);
  });

  it('新元素同一轮里先在分组下出现、再在主位置出现：只算新增一次，不算挪位置，主位置是真正的父节点', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '1_6': { id: '1_6', name: '/GPSET-B', type: 'GPSET', parentId: '1_1', childrenIds: [], dbnum: 8000 },
      },
    });
    const result = reconcileTreeLayers(state, new Map<string, TreeLayerAnswer>([
      ['1_6', ok(dto('1_5', 'EQUI', '/ADDED', { secondary: true, via: '9/9' } as Partial<TreeNodeDto>))],
      ['1_2', ok(dto('1_3', 'EQUI', '/OLD-NAME'), dto('1_4', 'EQUI', '/TO-DELETE'), dto('1_8', 'EQUI', '/MOVED'), dto('1_5', 'EQUI', '/ADDED'))],
    ]), deps);
    expect(result.nodesById['1_5']!.parentId).toBe('1_2');
    expect(result.report.added.map((item) => item.id)).toEqual(['1_5']);
    expect(result.report.moved).toEqual([]);
    expect([...result.viewParentsById.get('1_5')!].sort()).toEqual(['1_2', '1_6']);
  });

  it('解析不到的成员数、存储视图的提示跟着这一次的答复走', () => {
    const state = baseState({
      nodesById: {
        ...baseState().nodesById,
        '1_6': { id: '1_6', name: '/GPSET-B', type: 'GPSET', parentId: '1_1', childrenIds: [], dbnum: 8000, unresolvedCount: 3 },
      },
    });
    const result = reconcileTreeLayers(state, new Map<string, TreeLayerAnswer>([
      ['1_6', { ok: true, children: [], unresolvedCount: 1, view: 'stored' }],
    ]), deps);
    expect(result.nodesById['1_6']!.unresolvedCount).toBe(1);
    expect(result.nodesById['1_6']!.groupViewUnsupported).toBe(true);
  });
});

describe('isTreeNodeGoneMessage', () => {
  it('认得 gen-model 对已删节点的 404（2026-11-12 现网原话），别的失败不算', () => {
    expect(isTreeNodeGoneMessage('not_found (404): dbnum 8000 会话 Some(1155) 的索引里没有 24384/26716')).toBe(true);
    expect(isTreeNodeGoneMessage('network: Failed to fetch')).toBe(false);
    expect(isTreeNodeGoneMessage('timeout: 请求超时')).toBe(false);
    expect(isTreeNodeGoneMessage('internal (500): boom')).toBe(false);
    expect(isTreeNodeGoneMessage('')).toBe(false);
    expect(isTreeNodeGoneMessage(undefined)).toBe(false);
  });
});

describe('fetchTreeLayerAnswers', () => {
  it('同时在飞的请求不超过上限；重复的层只取一次；抛错的层按没取到记', async () => {
    let inflight = 0;
    let peak = 0;
    const fetchLayer = vi.fn(async (layerId: string): Promise<TreeLayerAnswer> => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inflight -= 1;
      if (layerId === 'L3') throw new Error('炸了');
      return ok();
    });
    const ids = Array.from({ length: 10 }, (_, index) => `L${index}`);
    const answers = await fetchTreeLayerAnswers([...ids, 'L1'], fetchLayer, 3);
    expect(fetchLayer).toHaveBeenCalledTimes(10);
    expect(peak).toBe(3);
    expect(answers.size).toBe(10);
    expect(answers.get('L3')).toEqual({ ok: false, gone: false, error: '炸了' });
    expect(answers.get('L4')).toEqual(ok());
  });
});

describe('classifyDisappearedNodes', () => {
  it('没定下落的去问：还在 = 挪到了没展开的位置，没有了 = 已删除，没问到 = 不知道；已经定了的不再问', async () => {
    const probe = vi.fn(async (id: string) => (id === 'a' ? 'exists' as const : id === 'b' ? 'gone' as const : 'unknown' as const));
    const out = await classifyDisappearedNodes([
      { id: 'a', fate: 'unknown' as const },
      { id: 'b', fate: 'unknown' as const },
      { id: 'c', fate: 'unknown' as const },
      { id: 'd', fate: 'deleted' as const },
    ], probe);
    expect(out.map((item) => item.fate)).toEqual(['relocated', 'deleted', 'unknown', 'deleted']);
    expect(probe.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('超过上限的不问、留着不知道；问的时候抛错也是不知道', async () => {
    const probe = vi.fn(async (id: string) => {
      if (id === 'n0') throw new Error('断了');
      return 'gone' as const;
    });
    const removed = Array.from({ length: 5 }, (_, index) => ({ id: `n${index}`, fate: 'unknown' as const }));
    const out = await classifyDisappearedNodes(removed, probe, { limit: 3 });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(out.map((item) => item.fate)).toEqual(['unknown', 'deleted', 'deleted', 'unknown', 'unknown']);
  });
});

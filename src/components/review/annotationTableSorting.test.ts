import { describe, expect, it } from 'vitest';

import {
  applyAnnotationTablePipeline,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  filterByStatus,
  filterBySeverity,
  matchesSearchQuery,
  normalizeSearchQuery,
  searchAnnotationTableRows,
  sortAnnotationTableRows,
} from './annotationTableSorting';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

function createItem(overrides: Partial<AnnotationWorkspaceItem> = {}): AnnotationWorkspaceItem {
  return {
    id: 'ann-1',
    type: 'text',
    title: '未命名批注',
    description: '暂无描述',
    createdAt: 1_700_000_000_000,
    activityAt: 1_700_000_000_000,
    visible: true,
    refnos: [],
    commentCount: 0,
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700 border-slate-200',
    priority: 'medium',
    priorityLabel: '中',
    priorityTone: 'bg-blue-100 text-blue-700 border-blue-200',
    ...overrides,
  };
}

describe('normalizeSearchQuery', () => {
  it('去掉首尾空白并转小写', () => {
    expect(normalizeSearchQuery('  DN800  ')).toBe('dn800');
  });

  it('折叠多个空白为单空格', () => {
    expect(normalizeSearchQuery('管段    与  梁')).toBe('管段 与 梁');
  });

  it('空串返回空串', () => {
    expect(normalizeSearchQuery('')).toBe('');
    expect(normalizeSearchQuery('   ')).toBe('');
  });
});

describe('matchesSearchQuery', () => {
  const item = createItem({
    id: 'ann-abc',
    title: 'DN800 管段与梁冲突',
    description: '管中心线偏左 60mm',
    refnos: ['24381_145018', '24381_200101'],
    statusLabel: '待处理',
    priorityLabel: '高',
  });

  it('空 query 一律匹配', () => {
    expect(matchesSearchQuery(item, '')).toBe(true);
    expect(matchesSearchQuery(item, '   ')).toBe(true);
  });

  it('大小写不敏感匹配 title', () => {
    expect(matchesSearchQuery(item, 'dn800')).toBe(true);
    expect(matchesSearchQuery(item, 'DN800')).toBe(true);
  });

  it('匹配中文 title', () => {
    expect(matchesSearchQuery(item, '管段')).toBe(true);
    expect(matchesSearchQuery(item, '管段与梁')).toBe(true);
  });

  it('匹配 description', () => {
    expect(matchesSearchQuery(item, '60mm')).toBe(true);
  });

  it('refno 支持 slash 和 underscore 双形式', () => {
    expect(matchesSearchQuery(item, '24381_145018')).toBe(true);
    expect(matchesSearchQuery(item, '24381/145018')).toBe(true);
  });

  it('refno 部分匹配', () => {
    expect(matchesSearchQuery(item, '24381')).toBe(true);
    expect(matchesSearchQuery(item, '145018')).toBe(true);
  });

  it('匹配 statusLabel / priorityLabel', () => {
    expect(matchesSearchQuery(item, '待处理')).toBe(true);
    expect(matchesSearchQuery(item, '高')).toBe(true);
  });

  it('未命中返回 false', () => {
    expect(matchesSearchQuery(item, '不存在的字串xyz')).toBe(false);
  });

  it('匹配 id 便于调试', () => {
    expect(matchesSearchQuery(item, 'abc')).toBe(true);
  });
});

describe('searchAnnotationTableRows', () => {
  const items = [
    createItem({ id: 'a', title: 'DN800 管段' }),
    createItem({ id: 'b', title: 'DN150 支路' }),
    createItem({ id: 'c', title: '电缆桥架' }),
  ];

  it('空查询返回原数组（不改引用内容）', () => {
    const result = searchAnnotationTableRows(items, '');
    expect(result).toHaveLength(3);
  });

  it('按 title 过滤', () => {
    const result = searchAnnotationTableRows(items, 'DN');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('无匹配返回空数组', () => {
    const result = searchAnnotationTableRows(items, '不存在');
    expect(result).toEqual([]);
  });

  it('不修改原数组', () => {
    const snapshot = items.map((i) => i.id);
    searchAnnotationTableRows(items, 'DN');
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });
});

describe('filterByStatus', () => {
  const items = [
    createItem({ id: 'p1', statusKey: 'pending', statusLabel: '待处理' }),
    createItem({ id: 'p2', statusKey: 'pending', statusLabel: '待处理' }),
    createItem({ id: 'f1', statusKey: 'fixed', statusLabel: '已修改' }),
    createItem({ id: 'r1', statusKey: 'rejected', statusLabel: '已驳回' }),
    createItem({ id: 'a1', statusKey: 'approved', statusLabel: '已通过' }),
  ];

  it('all 返回全部', () => {
    expect(filterByStatus(items, 'all')).toHaveLength(5);
  });

  it('pending 只保留待处理', () => {
    expect(filterByStatus(items, 'pending').map((i) => i.id)).toEqual(['p1', 'p2']);
  });

  it('fixed / rejected / approved 各自过滤', () => {
    expect(filterByStatus(items, 'fixed').map((i) => i.id)).toEqual(['f1']);
    expect(filterByStatus(items, 'rejected').map((i) => i.id)).toEqual(['r1']);
    expect(filterByStatus(items, 'approved').map((i) => i.id)).toEqual(['a1']);
  });
});

describe('filterBySeverity', () => {
  const items = [
    createItem({ id: 'c', severity: 'critical' }),
    createItem({ id: 's', severity: 'severe' }),
    createItem({ id: 'n', severity: 'normal' }),
    createItem({ id: 'u', severity: undefined }),
  ];

  it('all 返回全部', () => {
    expect(filterBySeverity(items, 'all')).toHaveLength(4);
  });

  it('critical 只保留 critical', () => {
    expect(filterBySeverity(items, 'critical').map((i) => i.id)).toEqual(['c']);
  });

  it('severe 只保留 severe', () => {
    expect(filterBySeverity(items, 'severe').map((i) => i.id)).toEqual(['s']);
  });

  it('未设置严重度时不会匹配任何具体严重度', () => {
    expect(filterBySeverity(items, 'normal').map((i) => i.id)).toEqual(['n']);
  });
});

describe('sortAnnotationTableRows', () => {
  it('按严重度降序：critical 在最前', () => {
    const items = [
      createItem({ id: 'n', severity: 'normal' }),
      createItem({ id: 'c', severity: 'critical' }),
      createItem({ id: 's', severity: 'severe' }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'severity', direction: 'desc' });
    expect(sorted.map((i) => i.id)).toEqual(['c', 's', 'n']);
  });

  it('按严重度升序：suggestion 在最前（未设置视为 0）', () => {
    const items = [
      createItem({ id: 'n', severity: 'normal' }),
      createItem({ id: 'u', severity: undefined }),
      createItem({ id: 'c', severity: 'critical' }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'severity', direction: 'asc' });
    expect(sorted.map((i) => i.id)).toEqual(['u', 'n', 'c']);
  });

  it('按 status 降序：pending 最前 · approved 最后', () => {
    const items = [
      createItem({ id: 'a', statusKey: 'approved' }),
      createItem({ id: 'p', statusKey: 'pending' }),
      createItem({ id: 'r', statusKey: 'rejected' }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'status', direction: 'desc' });
    expect(sorted.map((i) => i.id)).toEqual(['p', 'r', 'a']);
  });

  it('按 activity 降序：最近更新在前', () => {
    const items = [
      createItem({ id: 'old', activityAt: 1_000 }),
      createItem({ id: 'new', activityAt: 2_000 }),
      createItem({ id: 'mid', activityAt: 1_500 }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'activity', direction: 'desc' });
    expect(sorted.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('按 index 升序 = 输入顺序', () => {
    const items = [
      createItem({ id: 'x' }),
      createItem({ id: 'y' }),
      createItem({ id: 'z' }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'index', direction: 'asc' });
    expect(sorted.map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('按 refno 升序（localeCompare）', () => {
    const items = [
      createItem({ id: 'a', refnos: ['24381_200101'] }),
      createItem({ id: 'b', refnos: ['24381_145018'] }),
      createItem({ id: 'c', refnos: [] }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'refno', direction: 'asc' });
    // 空字符串排最前，然后 145018 < 200101
    expect(sorted.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('key 值相同时用 activityAt 降序作 tiebreaker', () => {
    const items = [
      createItem({ id: 'p-old', statusKey: 'pending', activityAt: 1_000 }),
      createItem({ id: 'p-new', statusKey: 'pending', activityAt: 3_000 }),
      createItem({ id: 'p-mid', statusKey: 'pending', activityAt: 2_000 }),
    ];
    const sorted = sortAnnotationTableRows(items, { key: 'status', direction: 'desc' });
    expect(sorted.map((i) => i.id)).toEqual(['p-new', 'p-mid', 'p-old']);
  });

  it('不修改原数组', () => {
    const items = [
      createItem({ id: 'n', severity: 'normal' }),
      createItem({ id: 'c', severity: 'critical' }),
    ];
    const snapshot = items.map((i) => i.id);
    sortAnnotationTableRows(items, { key: 'severity', direction: 'desc' });
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });

  it('空数组返回空数组', () => {
    expect(sortAnnotationTableRows([], DEFAULT_SORT)).toEqual([]);
  });
});

describe('applyAnnotationTablePipeline', () => {
  const items = [
    createItem({
      id: 'p-crit',
      title: 'DN800 管段',
      statusKey: 'pending',
      severity: 'critical',
      activityAt: 1_000,
    }),
    createItem({
      id: 'f-sev',
      title: 'DN150 开口',
      statusKey: 'fixed',
      severity: 'severe',
      activityAt: 2_000,
    }),
    createItem({
      id: 'a-normal',
      title: '电缆桥架',
      statusKey: 'approved',
      severity: 'normal',
      activityAt: 3_000,
    }),
  ];

  it('默认参数 · 返回全部按 status desc 排序', () => {
    const result = applyAnnotationTablePipeline(items, DEFAULT_FILTERS, DEFAULT_SORT);
    expect(result.map((i) => i.id)).toEqual(['p-crit', 'f-sev', 'a-normal']);
  });

  it('filter + search + sort 链式生效', () => {
    const result = applyAnnotationTablePipeline(
      items,
      { status: 'all', severity: 'all', search: 'DN' },
      { key: 'severity', direction: 'desc' },
    );
    // 过滤后剩 'DN800' 和 'DN150'，按严重度降：critical > severe
    expect(result.map((i) => i.id)).toEqual(['p-crit', 'f-sev']);
  });

  it('status 过滤 + 严重度过滤复合条件', () => {
    const result = applyAnnotationTablePipeline(
      items,
      { status: 'pending', severity: 'critical', search: '' },
      DEFAULT_SORT,
    );
    expect(result.map((i) => i.id)).toEqual(['p-crit']);
  });

  it('无匹配返回空数组', () => {
    const result = applyAnnotationTablePipeline(
      items,
      { status: 'rejected', severity: 'all', search: '' },
      DEFAULT_SORT,
    );
    expect(result).toEqual([]);
  });
});

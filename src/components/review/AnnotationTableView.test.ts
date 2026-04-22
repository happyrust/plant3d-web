import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import AnnotationTableView from './AnnotationTableView.vue';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

const downloadCsvMock = vi.fn();
const toAnnotationTableCsvMock = vi.fn(() => 'mock,csv\nrow1,data1');

vi.mock('./annotationTableExport', async () => {
  const actual = await vi.importActual<typeof import('./annotationTableExport')>('./annotationTableExport');
  return {
    ...actual,
    downloadCsv: (...args: unknown[]) => downloadCsvMock(...args),
    toAnnotationTableCsv: (...args: unknown[]) => toAnnotationTableCsvMock(...(args as [AnnotationWorkspaceItem[]])),
  };
});

function createItem(overrides: Partial<AnnotationWorkspaceItem> = {}): AnnotationWorkspaceItem {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 8)}`,
    type: 'text',
    title: 'DN800 管段',
    description: '管中心线偏左',
    createdAt: 1_700_000_000_000,
    activityAt: 1_700_000_000_000,
    visible: true,
    refnos: ['24381_145018'],
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

function mountTable(setup: {
  items: AnnotationWorkspaceItem[];
  currentAnnotationId?: string | null;
  currentAnnotationType?: 'text' | 'cloud' | 'rect' | 'obb' | null;
  taskKey?: string | null;
  pageSize?: number;
} & Record<string, unknown>): {
  host: HTMLElement;
  selectSpy: ReturnType<typeof vi.fn>;
  openSpy: ReturnType<typeof vi.fn>;
  locateSpy: ReturnType<typeof vi.fn>;
  itemsRef: ReturnType<typeof ref<AnnotationWorkspaceItem[]>>;
  destroy: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const itemsRef = ref<AnnotationWorkspaceItem[]>(setup.items);
  const selectSpy = vi.fn();
  const openSpy = vi.fn();
  const locateSpy = vi.fn();

  const app = createApp({
    render: () => h(AnnotationTableView, {
      items: itemsRef.value,
      currentAnnotationId: setup.currentAnnotationId ?? null,
      currentAnnotationType: setup.currentAnnotationType ?? null,
      taskKey: setup.taskKey ?? null,
      pageSize: setup.pageSize ?? 10,
      onSelectAnnotation: selectSpy,
      onOpenAnnotation: openSpy,
      onLocateAnnotation: locateSpy,
    }),
  });
  app.mount(host);

  return {
    host,
    selectSpy,
    openSpy,
    locateSpy,
    itemsRef,
    destroy: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('AnnotationTableView', () => {
  beforeEach(() => {
    downloadCsvMock.mockClear();
    toAnnotationTableCsvMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. 渲染 3 行批注 + 表头', async () => {
    const { host, destroy } = mountTable({
      items: [
        createItem({ id: 'a', title: 'DN800 管段' }),
        createItem({ id: 'b', title: 'DN150 支路' }),
        createItem({ id: 'c', title: '电缆桥架' }),
      ],
    });
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[role="row"]');
    expect(rows).toHaveLength(3);

    const html = host.innerHTML;
    expect(html).toContain('DN800 管段');
    expect(html).toContain('DN150 支路');
    expect(html).toContain('电缆桥架');
    expect(html).toContain('序号');
    expect(html).toContain('错误标记');
    expect(html).toContain('校核发现问题');
    expect(html).toContain('处理情况');
    expect(html).toContain('操作');

    destroy();
  });

  it('2. 空数组显示 empty state · 不显示表头和行', async () => {
    const { host, destroy } = mountTable({ items: [] });
    await nextTick();

    const empty = host.querySelector('[data-testid="annotation-table-empty"]');
    expect(empty).not.toBeNull();
    expect(host.innerHTML).toContain('当前范围内还没有可处理的批注');

    const rows = host.querySelectorAll('[role="row"]');
    expect(rows).toHaveLength(0);

    destroy();
  });

  it('3. 单击行 · 延迟 220ms 后 emit select-annotation', async () => {
    vi.useFakeTimers();
    const { host, selectSpy, openSpy, destroy } = mountTable({
      items: [createItem({ id: 'click-target', title: 'DN800' })],
    });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.click();

    // 单击刚触发，定时器还没跑
    expect(selectSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    await nextTick();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy.mock.calls[0][0].id).toBe('click-target');
    expect(openSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('4. 双击行 · emit open-annotation · 不 emit select', async () => {
    vi.useFakeTimers();
    const { host, selectSpy, openSpy, destroy } = mountTable({
      items: [createItem({ id: 'dbl-target', title: 'DN800' })],
    });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.click();
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    vi.advanceTimersByTime(300);
    await nextTick();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0].id).toBe('dbl-target');
    expect(selectSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('5. 点击"错误标记"表头 · 触发排序 · 行顺序变化', async () => {
    const items = [
      createItem({ id: 's1', title: '中度', severity: 'normal' }),
      createItem({ id: 's2', title: '紧急', severity: 'critical' }),
      createItem({ id: 's3', title: '严重', severity: 'severe' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const sortBtn = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-sort-severity"]');
    expect(sortBtn).not.toBeNull();
    sortBtn?.click();
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[role="row"]');
    // 按严重度 desc 后：critical · severe · normal
    const titles = Array.from(rows).map((r) => r.textContent || '');
    expect(titles[0]).toContain('紧急');
    expect(titles[1]).toContain('严重');
    expect(titles[2]).toContain('中度');

    destroy();
  });

  it('6. 搜索输入 · 300ms debounce 后过滤行数', async () => {
    vi.useFakeTimers();
    const items = [
      createItem({ id: '1', title: 'DN800 管段' }),
      createItem({ id: '2', title: 'DN150 支路' }),
      createItem({ id: '3', title: '电缆桥架' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const input = host.querySelector<HTMLInputElement>('[data-testid="annotation-table-search"]');
    input!.value = 'DN800';
    input!.dispatchEvent(new Event('input'));
    await nextTick();

    // 还在 debounce 窗口内
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(3);

    vi.advanceTimersByTime(350);
    await nextTick();

    const rows = host.querySelectorAll('[role="row"]');
    expect(rows).toHaveLength(1);
    expect(host.innerHTML).toContain('DN800 管段');

    destroy();
  });

  it('7. 严重度筛选 · select 变更后行数变化', async () => {
    const items = [
      createItem({ id: 'c', severity: 'critical' }),
      createItem({ id: 's', severity: 'severe' }),
      createItem({ id: 'n', severity: 'normal' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const select = host.querySelector<HTMLSelectElement>('[data-testid="annotation-table-severity-filter"]');
    select!.value = 'critical';
    select!.dispatchEvent(new Event('change'));
    await nextTick();

    expect(host.querySelectorAll('[role="row"]')).toHaveLength(1);

    destroy();
  });

  it('8. 状态筛选 · 只保留 pending', async () => {
    const items = [
      createItem({ id: 'p', statusKey: 'pending' }),
      createItem({ id: 'f', statusKey: 'fixed' }),
      createItem({ id: 'a', statusKey: 'approved' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const select = host.querySelector<HTMLSelectElement>('[data-testid="annotation-table-status-filter"]');
    select!.value = 'pending';
    select!.dispatchEvent(new Event('change'));
    await nextTick();

    expect(host.querySelectorAll('[role="row"]')).toHaveLength(1);

    destroy();
  });

  it('9. 操作列 locate · emit locate-annotation · 不冒泡到行 click', async () => {
    vi.useFakeTimers();
    const item = createItem({ id: 'loc-target' });
    const { host, selectSpy, locateSpy, destroy } = mountTable({ items: [item] });
    await nextTick();

    const locBtn = host.querySelector<HTMLButtonElement>(`[data-testid="annotation-table-locate-${item.id}"]`);
    locBtn?.click();

    vi.advanceTimersByTime(300);
    await nextTick();

    expect(locateSpy).toHaveBeenCalledTimes(1);
    expect(locateSpy.mock.calls[0][0].id).toBe('loc-target');
    expect(selectSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('10. currentAnnotationId 匹配时行高亮（aria-selected=true）', async () => {
    const active = createItem({ id: 'active-1', title: '被选中' });
    const other = createItem({ id: 'other-1', title: '未选中' });
    const { host, destroy } = mountTable({
      items: [active, other],
      currentAnnotationId: 'active-1',
      currentAnnotationType: 'text',
    });
    await nextTick();

    const activeRow = host.querySelector('[data-testid="annotation-table-row-active-1"]');
    const otherRow = host.querySelector('[data-testid="annotation-table-row-other-1"]');

    expect(activeRow?.getAttribute('aria-selected')).toBe('true');
    expect(otherRow?.getAttribute('aria-selected')).toBe('false');
    expect(activeRow?.className).toContain('bg-amber-50');
    expect(activeRow?.className).toContain('ring-1');

    destroy();
  });

  it('11. > pageSize 时显示分页 footer · 点 next 跳下一页', async () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      createItem({ id: `p-${i}`, title: `批注 ${i + 1}` }),
    );
    const { host, destroy } = mountTable({ items, pageSize: 5 });
    await nextTick();

    // 第一页 5 行
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(5);
    expect(host.innerHTML).toContain('当前 1-5');
    expect(host.innerHTML).toContain('共 12 条');

    const nextBtn = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-next"]');
    nextBtn?.click();
    await nextTick();

    expect(host.innerHTML).toContain('当前 6-10');

    destroy();
  });

  it('12. 点击导出 CSV · 调用 toAnnotationTableCsv + downloadCsv', async () => {
    const items = [createItem({ id: 'exp-1', title: 'DN800' })];
    const { host, destroy } = mountTable({ items, taskKey: 'SJ-0418' });
    await nextTick();

    const btn = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-export"]');
    btn?.click();
    await nextTick();

    expect(toAnnotationTableCsvMock).toHaveBeenCalledTimes(1);
    expect(downloadCsvMock).toHaveBeenCalledTimes(1);
    const [filename, content] = downloadCsvMock.mock.calls[0];
    expect(String(filename)).toMatch(/^plant3d-annotations-SJ-0418-\d{8}\.csv$/);
    expect(content).toBe('mock,csv\nrow1,data1');

    destroy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import AnnotationTableView from './AnnotationTableView.vue';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';
import type { AnnotationSeverity } from '@/types/auth';

// ------------------------------------------------------------
// ResizeObserver mock · 用于响应式断点测试
// ------------------------------------------------------------
type RoRecord = { callback: ResizeObserverCallback; elements: Element[] };
let roRegistry: RoRecord[] = [];

class MockResizeObserver {
  private record: RoRecord;
  constructor(cb: ResizeObserverCallback) {
    this.record = { callback: cb, elements: [] };
    roRegistry.push(this.record);
  }
  observe(el: Element) { this.record.elements.push(el); }
  disconnect() {
    this.record.elements = [];
    roRegistry = roRegistry.filter((r) => r !== this.record);
  }
  unobserve(el: Element) {
    this.record.elements = this.record.elements.filter((x) => x !== el);
  }
}

function fireContainerResize(target: Element, width: number) {
  for (const r of roRegistry) {
    if (!r.elements.includes(target)) continue;
    r.callback(
      [{
        target,
        contentRect: { width, height: 500, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 500, toJSON() { return {}; } },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }
}

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
  canEditItem?: (item: AnnotationWorkspaceItem) => boolean;
  savingSeverityKeys?: string[];
  savingTitleKeys?: string[];
  isItemActionable?: (item: AnnotationWorkspaceItem) => boolean;
  renderExpandedRow?: boolean;
} & Record<string, unknown>): {
  host: HTMLElement;
  selectSpy: ReturnType<typeof vi.fn>;
  openSpy: ReturnType<typeof vi.fn>;
  locateSpy: ReturnType<typeof vi.fn>;
  copySpy: ReturnType<typeof vi.fn>;
  updateSeveritySpy: ReturnType<typeof vi.fn>;
  updateTitleSpy: ReturnType<typeof vi.fn>;
  reviewActionCompletedSpy: ReturnType<typeof vi.fn>;
  queueCompletedSpy: ReturnType<typeof vi.fn>;
  itemsRef: ReturnType<typeof ref<AnnotationWorkspaceItem[]>>;
  destroy: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const itemsRef = ref<AnnotationWorkspaceItem[]>(setup.items);
  const selectSpy = vi.fn();
  const openSpy = vi.fn();
  const locateSpy = vi.fn();
  const copySpy = vi.fn();
  const updateSeveritySpy = vi.fn();
  const updateTitleSpy = vi.fn();
  const reviewActionCompletedSpy = vi.fn();
  const queueCompletedSpy = vi.fn();

  const app = createApp({
    render: () => h(
      AnnotationTableView,
      {
        items: itemsRef.value,
        currentAnnotationId: setup.currentAnnotationId ?? null,
        currentAnnotationType: setup.currentAnnotationType ?? null,
        taskKey: setup.taskKey ?? null,
        pageSize: setup.pageSize ?? 10,
        canEditItem: setup.canEditItem ?? (() => false),
        isItemActionable: setup.isItemActionable ?? (() => false),
        savingSeverityKeys: setup.savingSeverityKeys ?? [],
        savingTitleKeys: setup.savingTitleKeys ?? [],
        onSelectAnnotation: selectSpy,
        onOpenAnnotation: openSpy,
        onLocateAnnotation: locateSpy,
        onCopyFeedback: copySpy,
        onUpdateSeverity: updateSeveritySpy,
        onUpdateTitle: updateTitleSpy,
        onReviewActionCompleted: reviewActionCompletedSpy,
        onQueueCompleted: queueCompletedSpy,
      },
      setup.renderExpandedRow
        ? {
          'expanded-row': ({
            item,
            onReviewActionCompleted,
          }: {
              item: AnnotationWorkspaceItem;
              onReviewActionCompleted: (result: unknown) => void;
            }) => h('div', {
            'data-testid': `expanded-slot-${item.id}`,
          }, [
            h('button', {
              'data-testid': `complete-${item.id}`,
              onClick: () => onReviewActionCompleted({ action: 'fixed' }),
            }, '完成处理'),
          ]),
        }
        : undefined,
    ),
  });
  app.mount(host);

  return {
    host,
    selectSpy,
    openSpy,
    locateSpy,
    copySpy,
    updateSeveritySpy,
    updateTitleSpy,
    reviewActionCompletedSpy,
    queueCompletedSpy,
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
    roRegistry = [];
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('显示批注截图缩略图入口', async () => {
    const { host, destroy } = mountTable({
      items: [
        createItem({
          id: 'with-shot',
          thumbnailUrl: 'https://example.com/shot.png',
          screenshot: {
            url: 'https://example.com/shot.png',
            attachmentId: 'att-shot',
          },
        }),
      ],
    });
    await nextTick();

    const thumbnail = host.querySelector<HTMLImageElement>('[data-testid="annotation-table-thumbnail-with-shot"]');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.getAttribute('src')).toBe('https://example.com/shot.png');

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

  it('3. 单击行立即 emit select-annotation', async () => {
    const { host, selectSpy, openSpy, destroy } = mountTable({
      items: [createItem({ id: 'click-target', title: 'DN800' })],
    });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.click();
    await nextTick();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy.mock.calls[0][0].id).toBe('click-target');
    expect(openSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('4. 快速双击行只按第一次 click 展开，不会再次收起或触发旧详情事件', async () => {
    const { host, selectSpy, openSpy, destroy } = mountTable({
      items: [createItem({ id: 'dbl-target', title: 'DN800' })],
    });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy.mock.calls[0][0].id).toBe('dbl-target');
    expect(openSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('5. 点击"错误标记"表头 · 触发排序 · 行顺序变化', async () => {
    const items = [
      createItem({ id: 's1', title: '图面', severity: 'drawing' }),
      createItem({ id: 's2', title: '原则', severity: 'principle' }),
      createItem({ id: 's3', title: '一般', severity: 'general' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const sortBtn = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-sort-severity"]');
    expect(sortBtn).not.toBeNull();
    sortBtn?.click();
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[role="row"]');
    // 按错误类型 desc 后：principle · general · drawing
    const titles = Array.from(rows).map((r) => r.textContent || '');
    expect(titles[0]).toContain('原则');
    expect(titles[1]).toContain('一般');
    expect(titles[2]).toContain('图面');

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
    // 命中行的 title 应被 <mark> 包裹高亮
    expect(host.innerHTML).toContain('<mark');
    expect(host.innerHTML).toContain('>DN800</mark>');
    // 非 mark 部分保留原文
    expect(host.innerHTML).toContain('管段');

    destroy();
  });

  it('7. 错误类型筛选 · select 变更后行数变化', async () => {
    const items = [
      createItem({ id: 'p', severity: 'principle' }),
      createItem({ id: 'g', severity: 'general' }),
      createItem({ id: 'd', severity: 'drawing' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const select = host.querySelector<HTMLSelectElement>('[data-testid="annotation-table-severity-filter"]');
    select!.value = 'principle';
    select!.dispatchEvent(new Event('change'));
    await nextTick();

    expect(host.querySelectorAll('[role="row"]')).toHaveLength(1);

    destroy();
  });

  it('7b. 行内错误标记可选择并发出 update-severity，不触发行选择', async () => {
    vi.useFakeTimers();
    const item = createItem({ id: 'sev-edit', severity: undefined });
    const { host, selectSpy, updateSeveritySpy, destroy } = mountTable({
      items: [item],
      canEditItem: () => true,
    });
    await nextTick();

    const select = host.querySelector<HTMLSelectElement>('[data-testid="annotation-table-severity-editor-sev-edit"]');
    expect(select).not.toBeNull();
    select!.value = 'drawing';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    vi.advanceTimersByTime(300);
    await nextTick();

    expect(updateSeveritySpy).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'sev-edit' }),
      severity: 'drawing' satisfies AnnotationSeverity,
    });
    expect(selectSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('7c. 无权限时错误标记只读', async () => {
    const item = createItem({ id: 'sev-readonly', severity: 'general' });
    const { host, destroy } = mountTable({
      items: [item],
      canEditItem: () => false,
    });
    await nextTick();

    expect(host.querySelector('[data-testid="annotation-table-severity-editor-sev-readonly"]')).toBeNull();
    expect(host.querySelector('[data-testid="annotation-table-severity-pill-sev-readonly"]')).not.toBeNull();

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

  it('9b. 操作列详情按钮直接选择并展开当前行', async () => {
    const item = createItem({ id: 'comment-open-target' });
    const { host, selectSpy, openSpy, destroy } = mountTable({ items: [item] });
    await nextTick();

    const commentBtn = host.querySelector<HTMLButtonElement>(`[data-testid="annotation-table-comment-${item.id}"]`);
    commentBtn?.click();
    await nextTick();

    expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'comment-open-target' }));
    expect(openSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('9c. 操作列复制按钮触发 copy-feedback，不触发行选择', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const item = createItem({ id: 'copy-target', title: '复制目标' });
    const { host, selectSpy, copySpy, destroy } = mountTable({ items: [item] });
    await nextTick();

    const copyBtn = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-copy-copy-target"]');
    copyBtn?.click();
    await vi.runAllTimersAsync();
    await nextTick();

    expect(writeText).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'row',
      result: 'copied',
      item: expect.objectContaining({ id: 'copy-target' }),
    }));
    expect(selectSpy).not.toHaveBeenCalled();

    destroy();
  });

  it('9d. 双击标题进入编辑，Enter 保存标题', async () => {
    const item = createItem({ id: 'title-enter', title: '旧标题' });
    const { host, updateTitleSpy, destroy } = mountTable({
      items: [item],
      canEditItem: () => true,
    });
    await nextTick();

    const titleButton = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-title-title-enter"]');
    titleButton?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();

    const input = host.querySelector<HTMLInputElement>('[data-testid="annotation-table-title-input-title-enter"]');
    expect(input).not.toBeNull();
    input!.value = '新标题';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();

    expect(updateTitleSpy).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'title-enter' }),
      title: '新标题',
    });

    destroy();
  });

  it('9e. 标题编辑 Esc 取消，空标题不保存', async () => {
    const item = createItem({ id: 'title-cancel', title: '原标题' });
    const { host, updateTitleSpy, destroy } = mountTable({
      items: [item],
      canEditItem: () => true,
    });
    await nextTick();

    const titleButton = host.querySelector<HTMLButtonElement>('[data-testid="annotation-table-title-title-cancel"]');
    titleButton?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();
    let input = host.querySelector<HTMLInputElement>('[data-testid="annotation-table-title-input-title-cancel"]');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(updateTitleSpy).not.toHaveBeenCalled();

    titleButton?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();
    input = host.querySelector<HTMLInputElement>('[data-testid="annotation-table-title-input-title-cancel"]');
    input!.value = '   ';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();

    expect(updateTitleSpy).not.toHaveBeenCalled();

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
    expect(activeRow?.className).toContain('bg-brand-subtle');
    expect(activeRow?.className).toContain('ring-1');

    destroy();
  });

  it('10b. 只在当前选中行下挂载 expanded-row，重复单击当前行会收起', async () => {
    const { host, selectSpy, destroy } = mountTable({
      items: [
        createItem({ id: 'expanded-a' }),
        createItem({ id: 'expanded-b' }),
      ],
      currentAnnotationId: 'expanded-a',
      currentAnnotationType: 'text',
      renderExpandedRow: true,
    });
    await nextTick();

    expect(host.querySelector('[data-testid="expanded-slot-expanded-a"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="expanded-slot-expanded-b"]')).toBeNull();
    host.querySelector<HTMLElement>('[data-testid="annotation-table-row-expanded-a"]')?.click();
    await nextTick();

    expect(selectSpy).toHaveBeenCalledWith(null);

    destroy();
  });

  it('10c. Enter 展开或收起，Esc 仅收起当前行', async () => {
    const { host, selectSpy, destroy } = mountTable({
      items: [createItem({ id: 'keyboard-expand' })],
      currentAnnotationId: 'keyboard-expand',
      currentAnnotationType: 'text',
      renderExpandedRow: true,
    });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();

    expect(selectSpy).toHaveBeenNthCalledWith(1, null);
    expect(selectSpy).toHaveBeenNthCalledWith(2, null);

    destroy();
  });

  it('10d. 处理成功后按筛选排序结果自动跨页选择下一条', async () => {
    const items = Array.from({ length: 6 }, (_, index) => createItem({
      id: `advance-${index}`,
      statusKey: 'pending',
    }));
    const {
      host,
      selectSpy,
      reviewActionCompletedSpy,
      queueCompletedSpy,
      destroy,
    } = mountTable({
      items,
      pageSize: 5,
      currentAnnotationId: 'advance-4',
      currentAnnotationType: 'text',
      isItemActionable: (item: AnnotationWorkspaceItem) => item.statusKey === 'pending',
      renderExpandedRow: true,
    });
    await nextTick();

    host.querySelector<HTMLButtonElement>('[data-testid="complete-advance-4"]')?.click();
    await nextTick();

    expect(reviewActionCompletedSpy).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'advance-4' }),
      result: { action: 'fixed' },
    });
    expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'advance-5' }));
    expect(queueCompletedSpy).not.toHaveBeenCalled();
    expect(host.textContent).toContain('当前 6-6');

    destroy();
  });

  it('10e. 队列没有其他可处理批注时收起并发出 queue-completed', async () => {
    const {
      host,
      selectSpy,
      reviewActionCompletedSpy,
      queueCompletedSpy,
      destroy,
    } = mountTable({
      items: [
        createItem({ id: 'queue-current', statusKey: 'pending' }),
        createItem({ id: 'queue-done', statusKey: 'approved' }),
      ],
      currentAnnotationId: 'queue-current',
      currentAnnotationType: 'text',
      isItemActionable: (item: AnnotationWorkspaceItem) => item.statusKey === 'pending',
      renderExpandedRow: true,
    });
    await nextTick();

    host.querySelector<HTMLButtonElement>('[data-testid="complete-queue-current"]')?.click();
    await nextTick();

    expect(reviewActionCompletedSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledWith(null);
    expect(queueCompletedSpy).toHaveBeenCalledTimes(1);

    destroy();
  });

  it('10f. 筛选排除当前展开项时自动收起', async () => {
    const { host, selectSpy, destroy } = mountTable({
      items: [
        createItem({ id: 'filter-current', statusKey: 'fixed' }),
        createItem({ id: 'filter-pending', statusKey: 'pending' }),
      ],
      currentAnnotationId: 'filter-current',
      currentAnnotationType: 'text',
      renderExpandedRow: true,
    });
    await nextTick();

    const status = host.querySelector<HTMLSelectElement>('[data-testid="annotation-table-status-filter"]');
    status!.value = 'pending';
    status!.dispatchEvent(new Event('change'));
    await nextTick();

    expect(selectSpy).toHaveBeenCalledWith(null);
    expect(host.querySelector('[data-testid="expanded-slot-filter-current"]')).toBeNull();

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

  it('13. Compact 模式（<640px）· 表格变卡片 role="listitem" · 表头消失', async () => {
    const items = [
      createItem({ id: 'c1', title: 'DN800 管段' }),
      createItem({ id: 'c2', title: 'DN150 支路' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const root = host.querySelector<HTMLElement>('[data-testid="annotation-table-view"]');
    expect(root).not.toBeNull();

    // 默认 wide 模式：role="row" 行 + 没有 compact list
    expect(host.querySelectorAll('[role="row"]').length).toBe(2);
    expect(host.querySelector('[data-testid="annotation-table-compact-list"]')).toBeNull();

    // 触发响应式：shrink 到 400px → compact
    fireContainerResize(root!, 400);
    await nextTick();

    expect(root!.getAttribute('data-layout-mode')).toBe('compact');
    expect(host.querySelector('[data-testid="annotation-table-compact-list"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="listitem"]').length).toBe(2);

    // 表头应消失（无 annotation-table-sort-index 按钮）
    expect(host.querySelector('[data-testid="annotation-table-sort-index"]')).toBeNull();

    // Table 行不应再存在（compact 模式下无 role="row"）
    expect(host.querySelectorAll('[role="row"]').length).toBe(0);

    destroy();
  });

  it('13b. Compact 模式在当前卡片内部挂载 expanded-row', async () => {
    const { host, destroy } = mountTable({
      items: [createItem({ id: 'compact-expanded' })],
      currentAnnotationId: 'compact-expanded',
      currentAnnotationType: 'text',
      renderExpandedRow: true,
    });
    await nextTick();

    const root = host.querySelector<HTMLElement>('[data-testid="annotation-table-view"]');
    fireContainerResize(root!, 400);
    await nextTick();

    const card = host.querySelector<HTMLElement>('[data-testid="annotation-table-row-compact-expanded"]');
    expect(card?.querySelector('[data-testid="expanded-slot-compact-expanded"]')).not.toBeNull();

    destroy();
  });

  it('14. Medium 模式（640–960px）· 隐藏 description · 保留表头', async () => {
    const items = [createItem({ id: 'm1', title: 'DN800 管段', description: '偏左 60mm 关键描述' })];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const root = host.querySelector<HTMLElement>('[data-testid="annotation-table-view"]');
    fireContainerResize(root!, 800);
    await nextTick();

    expect(root!.getAttribute('data-layout-mode')).toBe('medium');
    // 表头还在（Medium 保留表格结构）
    expect(host.querySelector('[data-testid="annotation-table-sort-index"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="row"]').length).toBe(1);
    // description 文本不出现（只保留 title）
    expect(host.innerHTML).not.toContain('关键描述');
    expect(host.innerHTML).toContain('DN800 管段');

    destroy();
  });

  it('15. ↑ ↓ 键在行间移动焦点', async () => {
    const items = [
      createItem({ id: 'k1', title: '第一行' }),
      createItem({ id: 'k2', title: '第二行' }),
      createItem({ id: 'k3', title: '第三行' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[role="row"]');
    expect(rows.length).toBe(3);

    // 聚焦第一行 → 按 ↓ 应到第二行
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[1]);

    // 在第二行按 ↓ 到第三行
    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[2]);

    // 在第三行按 ↓ 被夹紧（保持最后一行）
    rows[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[2]);

    // 按 ↑ 返回第二行
    rows[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[1]);

    destroy();
  });

  it('16. Home / End 跳首尾行', async () => {
    const items = [
      createItem({ id: 'h1', title: '一' }),
      createItem({ id: 'h2', title: '二' }),
      createItem({ id: 'h3', title: '三' }),
    ];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[role="row"]');

    rows[1].focus();
    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[2]);

    rows[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(rows[0]);

    destroy();
  });

  it('17. title 含 <script> 时被 escape 后再高亮 · 不会执行脚本', async () => {
    const items = [createItem({ id: 'xss-1', title: '<script>alert(1)</script>危险' })];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    // innerHTML 中不应出现可执行的 <script> 标签；应为转义后的 &lt;script&gt;
    expect(host.innerHTML).toContain('&lt;script&gt;');
    expect(host.innerHTML).toContain('危险');

    destroy();
  });

  it('18. 右键行弹出 contextMenu · 按 Esc 关闭', async () => {
    const items = [createItem({ id: 'ctx-1', title: 'DN800', refnos: ['24381_145018'] })];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    expect(row).not.toBeNull();

    // 菜单初始不存在
    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).toBeNull();

    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await nextTick();

    const menu = document.querySelector('[data-testid="annotation-table-context-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('role')).toBe('menu');

    // 按 Esc 关闭
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).toBeNull();

    destroy();
  });

  it('19. 菜单"定位"项 emit locate-annotation · 菜单关闭', async () => {
    vi.useFakeTimers();
    const items = [createItem({ id: 'ctx-2', title: 'DN800' })];
    const { host, locateSpy, destroy } = mountTable({ items });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await nextTick();

    const locateBtn = document.querySelector<HTMLButtonElement>('[data-testid="annotation-table-ctx-locate"]');
    expect(locateBtn).not.toBeNull();
    locateBtn?.click();
    // 等异步操作 flush
    await vi.runAllTimersAsync();
    await nextTick();

    expect(locateSpy).toHaveBeenCalledTimes(1);
    expect(locateSpy.mock.calls[0][0].id).toBe('ctx-2');
    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).toBeNull();

    destroy();
  });

  it('20. 菜单"打开处理详情"选择当前行并关闭菜单', async () => {
    const items = [createItem({ id: 'ctx-open', title: 'DN800' })];
    const { host, selectSpy, openSpy, destroy } = mountTable({ items });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await nextTick();

    const openBtn = document.querySelector<HTMLButtonElement>('[data-testid="annotation-table-ctx-open"]');
    expect(openBtn).not.toBeNull();
    expect(openBtn?.textContent).toContain('打开处理详情');
    expect(openBtn?.textContent).not.toContain('drawer');

    openBtn?.click();
    await nextTick();

    expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'ctx-open' }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).toBeNull();

    destroy();
  });

  it('21. 菜单外点击关闭 contextMenu · 不影响行 click', async () => {
    const items = [createItem({ id: 'ctx-3', title: 'DN800' })];
    const { host, destroy } = mountTable({ items });
    await nextTick();

    const row = host.querySelector<HTMLElement>('[role="row"]');
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await nextTick();
    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).not.toBeNull();

    // 在 body 其他位置 mousedown（注意 capture=true，所以需要 bubbles 触发）
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    expect(document.querySelector('[data-testid="annotation-table-context-menu"]')).toBeNull();

    outside.remove();
    destroy();
  });
});

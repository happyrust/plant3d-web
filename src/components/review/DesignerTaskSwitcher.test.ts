import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import DesignerTaskSwitcher from './DesignerTaskSwitcher.vue';

import type { ReviewTask } from '@/types/auth';

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    formId: 'FORM-1',
    title: 'E2E-PMS-SEND-0924-1415',
    description: '',
    modelName: 'E2E-PMS-SEND-0924-1415',
    status: 'draft',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: '设计甲',
    reviewerId: 'checker-1',
    reviewerName: '校核甲',
    components: [],
    createdAt: new Date('2026-09-24T10:00:00+08:00').getTime(),
    updatedAt: new Date('2026-09-24T14:15:00+08:00').getTime(),
    currentNode: 'sj',
    returnReason: '请处理批注后重提',
    workflowHistory: [
      {
        node: 'jd',
        action: 'return',
        operatorId: 'checker-1',
        operatorName: '校核甲',
        comment: '校对驳回：请处理批注后重提',
        timestamp: new Date('2026-09-24T14:15:00+08:00').getTime(),
      },
    ],
    ...overrides,
  };
}

const mounted: (() => void)[] = [];

function mountSwitcher(props: {
  tasks: ReviewTask[];
  currentTask?: ReviewTask | null;
  loading?: boolean;
  error?: string | null;
}) {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(DesignerTaskSwitcher, { ...props, onSelect, onRetry }),
  });
  app.mount(host);
  mounted.push(() => {
    app.unmount();
    host.remove();
  });
  return { onSelect, onRetry };
}

function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.querySelector<T>(`[data-testid="${testId}"]`);
}

describe('DesignerTaskSwitcher', () => {
  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount());
    document.body.innerHTML = '';
  });

  it('触发按钮显示当前序号、其余待处理张数和当前单号；展开后列出全部并标出当前单', async () => {
    const task1 = createTask();
    const task2 = createTask({ id: 'task-2', title: 'ACCEPT-20260928-152353-TC2', workflowHistory: [] });
    mountSwitcher({ tasks: [task1, task2], currentTask: task1 });

    const trigger = query<HTMLButtonElement>('designer-task-switcher-trigger');
    expect(trigger?.textContent).toContain('退回单据 1 / 2 · 其余 1 张待处理');
    expect(trigger?.textContent).toContain('E2E-PMS-SEND-0924-1415');

    trigger!.click();
    await nextTick();

    const option1 = query('designer-task-switcher-option-task-1');
    const option2 = query('designer-task-switcher-option-task-2');
    expect(option1?.getAttribute('aria-selected')).toBe('true');
    expect(option2?.getAttribute('aria-selected')).toBe('false');
    expect(option1?.textContent).toContain('校对驳回：请处理批注后重提');
    expect(option1?.textContent).toContain('退回于');
    expect(option1?.textContent).not.toContain('约');
    expect(option2?.textContent).toContain('请处理批注后重提');
    expect(option2?.textContent).toContain('退回于 约');
  });

  it('选中另一张发 select 并收起；选中当前单只收起不发事件', async () => {
    const task1 = createTask();
    const task2 = createTask({ id: 'task-2', title: 'ACCEPT-20260928-152353-TC2' });
    const { onSelect } = mountSwitcher({ tasks: [task1, task2], currentTask: task1 });

    query<HTMLButtonElement>('designer-task-switcher-trigger')!.click();
    await nextTick();
    query<HTMLButtonElement>('designer-task-switcher-option-task-1')!.click();
    await nextTick();
    expect(onSelect).not.toHaveBeenCalled();
    expect(query('designer-task-switcher-list')).toBeNull();

    query<HTMLButtonElement>('designer-task-switcher-trigger')!.click();
    await nextTick();
    query<HTMLButtonElement>('designer-task-switcher-option-task-2')!.click();
    await nextTick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(task2);
    expect(query('designer-task-switcher-list')).toBeNull();
  });

  it('触发按钮按 ↓ 打开列表，列表里 ↓ 移动焦点、Esc 收起', async () => {
    const task1 = createTask();
    const task2 = createTask({ id: 'task-2', title: 'ACCEPT-20260928-152353-TC2' });
    mountSwitcher({ tasks: [task1, task2], currentTask: task1 });

    const trigger = query<HTMLButtonElement>('designer-task-switcher-trigger')!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(query('designer-task-switcher-list')).toBeTruthy();
    expect(document.activeElement).toBe(query('designer-task-switcher-option-task-1'));

    query('designer-task-switcher-list')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(query('designer-task-switcher-option-task-2'));

    query('designer-task-switcher-list')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(query('designer-task-switcher-list')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('点击外部收起列表', async () => {
    mountSwitcher({ tasks: [createTask()], currentTask: null });

    query<HTMLButtonElement>('designer-task-switcher-trigger')!.click();
    await nextTick();
    expect(query('designer-task-switcher-list')).toBeTruthy();
    expect(query('designer-task-switcher-trigger')?.textContent).toContain('退回单据 1 张');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(query('designer-task-switcher-list')).toBeNull();
  });

  it('没有单据时区分加载中、加载失败和确实为空，失败可重试', async () => {
    mountSwitcher({ tasks: [], loading: true });
    expect(query('designer-task-switcher-summary')?.textContent).toContain('正在加载退回单据');
    expect(query<HTMLButtonElement>('designer-task-switcher-trigger')?.disabled).toBe(true);
    mounted.splice(0).forEach((unmount) => unmount());

    const { onRetry } = mountSwitcher({ tasks: [], error: '网络错误' });
    expect(query('designer-task-switcher-summary')?.textContent).toContain('退回单据加载失败');
    query<HTMLButtonElement>('designer-task-switcher-retry')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    mounted.splice(0).forEach((unmount) => unmount());

    mountSwitcher({ tasks: [] });
    expect(query('designer-task-switcher-summary')?.textContent).toContain('暂无退回单据');
    expect(query('designer-task-switcher-retry')).toBeNull();
  });
});

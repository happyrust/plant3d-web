import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

vi.mock('./AnnotationInlineDetailCard.vue', () => ({
  default: {
    name: 'AnnotationInlineDetailCardStub',
    props: [
      'item',
      'linkedMeasurements',
      'currentUserRole',
      'formId',
      'taskId',
      'density',
      'allowReviewActions',
    ],
    emits: [
      'locate',
      'start-measurement',
      'locate-measurement',
      'close',
      'review-action-completed',
    ],
    template: `
      <div :data-testid="'inline-card-' + item.id">
        <span data-testid="inline-linked-count">{{ linkedMeasurements.length }}</span>
        <button data-testid="inline-locate" @click="$emit('locate', item)">定位</button>
        <button data-testid="inline-start" @click="$emit('start-measurement', 'distance', item)">测量</button>
        <button v-if="linkedMeasurements[0]" data-testid="inline-locate-measurement" @click="$emit('locate-measurement', linkedMeasurements[0])">定位测量</button>
        <button data-testid="inline-complete" @click="$emit('review-action-completed', { action: 'fixed', annotationId: item.id, annotationType: item.type, state: { resolutionStatus: 'fixed' } })">完成</button>
        <button data-testid="inline-close" @click="$emit('close')">收起</button>
      </div>
    `,
  },
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function createItem(
  id: string,
  statusKey: AnnotationWorkspaceItem['statusKey'],
): AnnotationWorkspaceItem {
  return {
    id,
    type: 'text',
    title: id,
    description: `${id} description`,
    createdAt: 1710000000000,
    activityAt: 1710000000000,
    visible: true,
    refnos: [],
    commentCount: 0,
    statusKey,
    statusLabel: statusKey,
    statusTone: '',
    priority: 'low',
    priorityLabel: '低',
    priorityTone: '',
  };
}

async function mountWorkspace(options: {
  items?: AnnotationWorkspaceItem[];
  currentId?: string | null;
  role?: UserRole;
}) {
  const { default: AnnotationSheetWorkspace } = await import('./AnnotationSheetWorkspace.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const taskKey = ref('task-1');
  const selectSpy = vi.fn();
  const locateSpy = vi.fn();
  const startMeasurementSpy = vi.fn();
  const locateMeasurementSpy = vi.fn();
  const queueCompletedSpy = vi.fn();
  const reviewActionCompletedSpy = vi.fn();
  const linkedMeasurement = {
    id: 'measurement-1',
    kind: 'distance' as const,
    createdAt: 1710000000001,
    visible: true,
    sourceAnnotationId: options.currentId ?? 'pending',
    sourceAnnotationType: 'text' as const,
    start: [0, 0, 0] as [number, number, number],
    end: [1, 0, 0] as [number, number, number],
    distance: 1,
  };
  const app = createApp({
    render: () => h(AnnotationSheetWorkspace, {
      items: options.items ?? [
        createItem('pending', 'pending'),
        createItem('rejected', 'rejected'),
        createItem('fixed', 'fixed'),
      ],
      currentAnnotationId: options.currentId ?? 'pending',
      currentAnnotationType: 'text',
      currentUserRole: options.role ?? UserRole.DESIGNER,
      taskKey: taskKey.value,
      formId: 'FORM-1',
      taskId: 'task-1',
      measurements: [linkedMeasurement],
      xeokitMeasurements: [],
      onSelectAnnotation: selectSpy,
      onLocateAnnotation: locateSpy,
      onStartMeasurement: startMeasurementSpy,
      onLocateMeasurement: locateMeasurementSpy,
      onQueueCompleted: queueCompletedSpy,
      onReviewActionCompleted: reviewActionCompletedSpy,
    }),
  });
  app.mount(host);
  await nextTick();
  return {
    host,
    taskKey,
    selectSpy,
    locateSpy,
    startMeasurementSpy,
    locateMeasurementSpy,
    queueCompletedSpy,
    reviewActionCompletedSpy,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('AnnotationSheetWorkspace', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  it('只挂载当前展开项的完整处理卡并注入关联测量', async () => {
    const mounted = await mountWorkspace({ currentId: 'pending' });

    expect(mounted.host.querySelectorAll('[data-testid^="inline-card-"]')).toHaveLength(1);
    expect(mounted.host.querySelector('[data-testid="inline-card-pending"]')).not.toBeNull();
    expect(mounted.host.querySelector('[data-testid="inline-linked-count"]')?.textContent).toBe('1');

    mounted.unmount();
  });

  it('设计角色处理成功后转发事件并自动选择下一条待设计处理批注', async () => {
    const mounted = await mountWorkspace({ currentId: 'pending', role: UserRole.DESIGNER });

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-complete"]')?.click();
    await nextTick();

    expect(mounted.reviewActionCompletedSpy).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ id: 'pending' }),
      result: expect.objectContaining({ action: 'fixed' }),
    }));
    expect(mounted.selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'rejected' }));
    expect(mounted.queueCompletedSpy).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it('校审角色在 fixed/wont_fix 队列中自动前进', async () => {
    const mounted = await mountWorkspace({
      items: [
        createItem('fixed-1', 'fixed'),
        createItem('wont-fix-1', 'wont_fix'),
        createItem('pending-1', 'pending'),
      ],
      currentId: 'fixed-1',
      role: UserRole.PROOFREADER,
    });

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-complete"]')?.click();
    await nextTick();

    expect(mounted.selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'wont-fix-1' }));

    mounted.unmount();
  });

  it('统一转发定位、测量和收起事件', async () => {
    const mounted = await mountWorkspace({ currentId: 'pending' });

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-locate"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-start"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-locate-measurement"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="inline-close"]')?.click();
    await nextTick();

    expect(mounted.locateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending' }));
    expect(mounted.startMeasurementSpy).toHaveBeenCalledWith('distance', expect.objectContaining({ id: 'pending' }));
    expect(mounted.locateMeasurementSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'measurement-1' }));
    expect(mounted.selectSpy).toHaveBeenCalledWith(null);

    mounted.unmount();
  });

  it('任务切换时清空当前选择', async () => {
    const mounted = await mountWorkspace({ currentId: 'pending' });

    mounted.taskKey.value = 'task-2';
    await nextTick();

    expect(mounted.selectSpy).toHaveBeenCalledWith(null);

    mounted.unmount();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import type {
  AnnotationWorkspaceItem,
  LinkedMeasurementItem,
} from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

vi.mock('./ReviewCommentsTimeline.vue', () => ({
  default: {
    name: 'ReviewCommentsTimelineStub',
    props: [
      'annotationType',
      'annotationId',
      'annotationLabel',
      'contextFormId',
      'contextTaskId',
      'designerOnly',
      'allowReviewActions',
      'density',
    ],
    emits: ['close', 'review-action-completed'],
    template: `
      <div
        data-testid="timeline-stub"
        :data-annotation-id="annotationId"
        :data-form-id="contextFormId"
        :data-task-id="contextTaskId"
        :data-designer-only="String(designerOnly)"
        :data-density="density"
      >
        <button data-testid="timeline-complete" @click="$emit('review-action-completed', { action: 'fixed', annotationId, annotationType, state: { resolutionStatus: 'fixed' } })">完成</button>
      </div>
    `,
  },
}));

function createItem(overrides: Partial<AnnotationWorkspaceItem> = {}): AnnotationWorkspaceItem {
  return {
    id: 'annot-1',
    type: 'text',
    title: '管线碰撞',
    description: '请调整管线标高并补充说明。',
    createdAt: 1710000000000,
    activityAt: 1710000000000,
    visible: true,
    refnos: ['24381_145018'],
    commentCount: 2,
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700',
    priority: 'urgent',
    priorityLabel: '原则错误',
    priorityTone: 'bg-red-100 text-red-700',
    screenshot: {
      url: 'data:image/png;base64,abc',
      capturedAt: 1710000000000,
    },
    ...overrides,
  };
}

const measurement: LinkedMeasurementItem = {
  id: 'm-1',
  engine: 'xeokit',
  kind: 'distance',
  createdAt: 1710000001000,
  visible: true,
  summary: '距离 · 1.250 m',
};

async function mountCard(props: Record<string, unknown> = {}) {
  const { default: AnnotationInlineDetailCard } = await import('./AnnotationInlineDetailCard.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const locateSpy = vi.fn();
  const locateElementsSpy = vi.fn();
  const startMeasurementSpy = vi.fn();
  const locateMeasurementSpy = vi.fn();
  const closeSpy = vi.fn();
  const completedSpy = vi.fn();
  const app = createApp({
    render: () => h(AnnotationInlineDetailCard, {
      item: createItem(),
      linkedMeasurements: [measurement],
      currentUserRole: UserRole.DESIGNER,
      formId: 'FORM-1',
      taskId: 'task-1',
      onLocate: locateSpy,
      onLocateElements: locateElementsSpy,
      onStartMeasurement: startMeasurementSpy,
      onLocateMeasurement: locateMeasurementSpy,
      onClose: closeSpy,
      onReviewActionCompleted: completedSpy,
      ...props,
    }),
  });
  app.mount(host);
  await nextTick();
  return {
    host,
    locateSpy,
    locateElementsSpy,
    startMeasurementSpy,
    locateMeasurementSpy,
    closeSpy,
    completedSpy,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('AnnotationInlineDetailCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('展示完整问题详情、截图、状态与角色处理时间线', async () => {
    const mounted = await mountCard();

    expect(mounted.host.textContent).toContain('管线碰撞');
    expect(mounted.host.textContent).toContain('请调整管线标高并补充说明。');
    expect(mounted.host.textContent).toContain('待处理');
    expect(mounted.host.textContent).toContain('原则错误');
    expect(mounted.host.textContent).toContain('24381_145018');
    expect(mounted.host.querySelector<HTMLImageElement>('[data-testid="annotation-detail-screenshot"]')?.src)
      .toContain('data:image/png;base64,abc');
    const timeline = mounted.host.querySelector<HTMLElement>('[data-testid="timeline-stub"]');
    expect(timeline?.dataset.annotationId).toBe('annot-1');
    expect(timeline?.dataset.formId).toBe('FORM-1');
    expect(timeline?.dataset.taskId).toBe('task-1');
    expect(timeline?.dataset.designerOnly).toBe('true');

    mounted.unmount();
  });

  it('展示关联测量并转发定位与新增测量事件', async () => {
    const mounted = await mountCard();

    expect(mounted.host.textContent).toContain('距离 · 1.250 m');
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-locate"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-add-distance"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-locate-measurement-m-1"]')?.click();
    await nextTick();

    expect(mounted.locateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'annot-1' }));
    expect(mounted.startMeasurementSpy).toHaveBeenCalledWith('distance', expect.objectContaining({ id: 'annot-1' }));
    expect(mounted.locateMeasurementSpy).toHaveBeenCalledWith(measurement);

    mounted.unmount();
  });

  it('云线详情区分目标与锚点，并转发单项和批量定位高亮', async () => {
    const item = createItem({
      type: 'cloud',
      refnos: ['REF/A', 'REF/B'],
      cloudBindings: [
        { refno: 'REF/A', role: 'anchor', noun: 'PIPE', createdAt: 1 },
        { refno: 'REF/A', role: 'member', noun: 'PIPE', createdAt: 1 },
        { refno: 'REF/B', role: 'member', noun: 'VALV', createdAt: 1 },
      ],
    });
    const mounted = await mountCard({ item });

    expect(mounted.host.textContent).toContain('关联元素 2');
    expect(mounted.host.textContent).toContain('云线锚点');
    expect(mounted.host.textContent).toContain('VALV');

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-cloud-locate-all"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-cloud-locate-REF/B"]')?.click();
    await nextTick();

    expect(mounted.locateElementsSpy).toHaveBeenNthCalledWith(1, {
      item: expect.objectContaining({ id: 'annot-1' }),
      refnos: ['REF/A', 'REF/B'],
    });
    expect(mounted.locateElementsSpy).toHaveBeenNthCalledWith(2, {
      item: expect.objectContaining({ id: 'annot-1' }),
      refnos: ['REF/B'],
    });

    mounted.unmount();
  });

  it('历史无绑定云线显示明确空态', async () => {
    const mounted = await mountCard({
      item: createItem({ type: 'cloud', refnos: [], cloudBindings: [] }),
    });

    expect(mounted.host.textContent).toContain('历史批注未关联元素');
    mounted.unmount();
  });

  it('测量为空时显示空态并支持紧凑密度', async () => {
    const mounted = await mountCard({
      linkedMeasurements: [],
      density: 'dock',
    });

    expect(mounted.host.textContent).toContain('当前批注还没有关联的测量证据');
    expect(mounted.host.querySelector('[data-testid="annotation-inline-detail-card"]')?.getAttribute('data-density')).toBe('dock');
    expect(mounted.host.querySelector<HTMLElement>('[data-testid="timeline-stub"]')?.dataset.density).toBe('dock');

    mounted.unmount();
  });

  it('透传处理完成事件并支持收起', async () => {
    const mounted = await mountCard();

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="timeline-complete"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-close"]')?.click();
    await nextTick();

    expect(mounted.completedSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'fixed',
      annotationId: 'annot-1',
      annotationType: 'text',
    }));
    expect(mounted.closeSpy).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });
});

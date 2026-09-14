import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import type {
  AnnotationWorkspaceItem,
  LinkedMeasurementItem,
} from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

/** 关联元素的编辑权限取自当前用户，逐例改写 */
const { currentUser } = vi.hoisted(() => ({
  currentUser: { value: null as null | { id: string; role: string; name: string } },
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser }),
}));

/** 关联失效解析（ADR-0050）的运行时索引探针换成可控集合，默认全部「未加载」 */
const loaderMock = vi.hoisted(() => ({
  loaded: new Set<string>(),
  known: new Set<string>(),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', async () => {
  const { ref } = await import('vue');
  return {
    dtxLoaderRevision: ref(0),
    isDtxRefnoLoadedAcrossAllDbnos: (refno: string) => loaderMock.loaded.has(refno),
    isDtxRefnoKnownAcrossAllDbnos: (refno: string) => loaderMock.known.has(refno),
    findNounByRefnoAcrossAllDbnos: () => null,
  };
});

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
  const pickElementsSpy = vi.fn();
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
      onPickElements: pickElementsSpy,
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
    pickElementsSpy,
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
    currentUser.value = null;
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

  it('从批注单据预览并关闭问题截图', async () => {
    const mounted = await mountCard();

    mounted.host
      .querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-preview-button"]')
      ?.click();
    await nextTick();

    const preview = document.body.querySelector<HTMLElement>(
      '[data-testid="annotation-detail-screenshot-preview"]'
    );
    expect(preview).not.toBeNull();
    expect(preview?.querySelector<HTMLImageElement>(
      '[data-testid="annotation-detail-screenshot-preview-image"]'
    )?.src).toContain('data:image/png;base64,abc');

    preview
      ?.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-preview-close"]')
      ?.click();
    await nextTick();
    expect(document.body.querySelector('[data-testid="annotation-detail-screenshot-preview"]'))
      .toBeNull();

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
    // 无登录用户时只读，不出现编辑入口
    expect(mounted.host.querySelector('[data-testid="annotation-cloud-add-members"]')).toBeNull();
    expect(mounted.host.querySelector('[data-testid="annotation-cloud-remove-REF/B"]')).toBeNull();

    mounted.unmount();
  });

  it('有权限时可移除关联元素、发起添加拾取，锚点没有改绑入口', async () => {
    currentUser.value = { id: 'author-1', role: UserRole.DESIGNER, name: '张设计' };
    const { useToolStore } = await import('@/composables/useToolStore');
    const store = useToolStore();
    store.clearAll();
    store.addCloudAnnotation({
      id: 'annot-1',
      objectIds: [],
      anchorWorldPos: [0, 0, 0],
      visible: true,
      title: '云线批注',
      description: '',
      createdAt: 1,
      authorId: 'author-1',
      bindings: [
        { refno: 'REF/A', role: 'anchor', createdAt: 1 },
        { refno: 'REF/B', role: 'member', createdAt: 1 },
      ],
    });

    const mounted = await mountCard({
      item: createItem({
        type: 'cloud',
        authorId: 'author-1',
        refnos: ['REF/B'],
        cloudBindings: [
          { refno: 'REF/A', role: 'anchor', createdAt: 1 },
          { refno: 'REF/B', role: 'member', createdAt: 1 },
        ],
      }),
    });

    expect(mounted.host.textContent).toContain('不可更换');
    expect(mounted.host.querySelector('[data-testid="annotation-cloud-remove-REF/A"]')).toBeNull();

    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-cloud-add-members"]')?.click();
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-cloud-remove-REF/B"]')?.click();
    await nextTick();

    expect(mounted.pickElementsSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'annot-1' }));
    const record = store.cloudAnnotations.value.find((c) => c.id === 'annot-1');
    expect(record?.refnos).toEqual([]);
    expect(record?.anchorRefno).toBe('REF/A');

    store.clearAll();
    mounted.unmount();
  });

  it('关联失效降级（ADR-0050）：未加载 / 不存在 / STALE 各出徽标，不存在的构件不可定位并从「定位高亮全部」剔除', async () => {
    const { useToolStore } = await import('@/composables/useToolStore');
    const { useAnnotationBindingResolve } = await import('@/composables/useAnnotationBindingResolve');
    const { useViewerContext } = await import('@/composables/useViewerContext');
    const store = useToolStore();
    const bindingResolve = useAnnotationBindingResolve();
    const viewerContext = useViewerContext();
    store.clearAll();
    bindingResolve.resetForTests();
    loaderMock.loaded.clear();
    loaderMock.known.clear();
    loaderMock.loaded.add('REF/A');
    loaderMock.loaded.add('REF/B');
    loaderMock.known.add('REF/C');
    // 锚点在 [5000,0,0]，构件包围盒只到 10 → 锚点漂离 → STALE
    viewerContext.viewerRef.value = {
      scene: { getAABB: () => [0, 0, 0, 10, 10, 10] },
    } as unknown as typeof viewerContext.viewerRef.value;
    store.addCloudAnnotation({
      id: 'annot-1',
      objectIds: ['REF/A', 'REF/B', 'REF/C'],
      anchorRefno: 'REF/A',
      anchorWorldPos: [5000, 0, 0],
      visible: true,
      title: '云线批注',
      description: '',
      createdAt: 1,
    });
    const bindings = [
      { refno: 'REF/A', role: 'anchor' as const, noun: 'PIPE', createdAt: 1 },
      { refno: 'REF/A', role: 'member' as const, noun: 'PIPE', createdAt: 1 },
      { refno: 'REF/B', role: 'member' as const, noun: 'VALV', createdAt: 1 },
      { refno: 'REF/C', role: 'member' as const, noun: 'ELBO', createdAt: 1 },
    ];

    const mounted = await mountCard({
      item: createItem({ type: 'cloud', refnos: ['REF/A', 'REF/B', 'REF/C'], bindings }),
    });
    const q = (selector: string) => mounted.host.querySelector<HTMLElement>(selector);

    // 挂载即按记录解析：锚点 STALE 带原因；已加载 member 不出徽标；未加载 member 出徽标但仍可定位
    expect(q('[data-testid="annotation-anchor-state"]')?.textContent).toContain('STALE');
    expect(mounted.host.textContent).toContain('锚点坐标已不在该构件包围盒附近');
    expect(q('[data-testid="annotation-binding-state-REF/A"]')).toBeNull();
    expect(q('[data-testid="annotation-binding-state-REF/B"]')).toBeNull();
    expect(q('[data-testid="annotation-binding-state-REF/C"]')?.textContent).toContain('未加载');
    expect(q('[data-testid="annotation-cloud-locate-REF/C"]')).not.toBeNull();
    // 有 STALE → 标题旁提示可用数：resolved 2 + unloaded 1 = 3 / 4
    expect(q('[data-testid="annotation-binding-resolve-summary"]')?.textContent).toContain('可用 3/4');

    // 一次定位回执说 REF/B 加载失败 → 权威 missing：徽标带错误文本、隐藏单项定位、从「定位高亮全部」剔除
    bindingResolve.markLoadResult({ ok: [], fail: [{ refno: 'REF/B', error: 'HTTP 404' }] });
    await nextTick();
    expect(q('[data-testid="annotation-binding-state-REF/B"]')?.textContent).toContain('元素不存在');
    expect(q('[data-testid="annotation-binding-state-REF/B"]')?.getAttribute('title')).toContain('HTTP 404');
    expect(q('[data-testid="annotation-cloud-locate-REF/B"]')).toBeNull();
    expect(q('[data-testid="annotation-binding-resolve-summary"]')?.textContent).toContain('可用 2/4');

    q('[data-testid="annotation-cloud-locate-all"]')?.click();
    await nextTick();
    expect(mounted.locateElementsSpy).toHaveBeenLastCalledWith({
      item: expect.objectContaining({ id: 'annot-1' }),
      refnos: ['REF/A', 'REF/C'],
    });

    // 之后一次定位成功 → 撤销 missing，徽标消失、定位按钮回来
    bindingResolve.markLoadResult({ ok: ['REF/B'], fail: [] });
    await nextTick();
    expect(q('[data-testid="annotation-binding-state-REF/B"]')).toBeNull();
    expect(q('[data-testid="annotation-cloud-locate-REF/B"]')).not.toBeNull();

    viewerContext.viewerRef.value = null;
    bindingResolve.resetForTests();
    store.clearAll();
    mounted.unmount();
  });

  it('全部关联正常时不出任何失效徽标，也不出可用数提示', async () => {
    const { useToolStore } = await import('@/composables/useToolStore');
    const { useAnnotationBindingResolve } = await import('@/composables/useAnnotationBindingResolve');
    const store = useToolStore();
    const bindingResolve = useAnnotationBindingResolve();
    store.clearAll();
    bindingResolve.resetForTests();
    loaderMock.loaded.clear();
    loaderMock.known.clear();
    loaderMock.loaded.add('REF/A');
    store.addRectAnnotation({
      id: 'annot-1',
      objectIds: ['REF/A'],
      refnos: ['REF/A'],
      obb: {
        center: [0, 0, 0],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [
          [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
          [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ],
      },
      anchorWorldPos: [0, 0, 0],
      visible: true,
      title: '矩形批注',
      description: '',
      createdAt: 1,
    });

    const mounted = await mountCard({
      item: createItem({
        type: 'rect',
        refnos: ['REF/A'],
        bindings: [{ refno: 'REF/A', role: 'member', createdAt: 1 }],
      }),
    });

    expect(mounted.host.querySelector('[data-testid="annotation-binding-state-REF/A"]')).toBeNull();
    expect(mounted.host.querySelector('[data-testid="annotation-binding-resolve-summary"]')).toBeNull();
    expect(mounted.host.querySelector('[data-testid="annotation-cloud-locate-REF/A"]')).not.toBeNull();

    bindingResolve.resetForTests();
    store.clearAll();
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

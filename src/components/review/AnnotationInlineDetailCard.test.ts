import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import type {
  AnnotationWorkspaceItem,
  LinkedMeasurementItem,
} from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

/** 本测试环境没有 localStorage / sessionStorage 全局；U0 截图回执要写别的 scope 的本机容器，先给内存实现 */
vi.hoisted(() => {
  const createMemoryStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() { return map.size; },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => { map.delete(key); },
      setItem: (key: string, value: string) => { map.set(key, String(value)); },
    } as Storage;
  };
  if (typeof globalThis.localStorage === 'undefined') vi.stubGlobal('localStorage', createMemoryStorage());
  if (typeof globalThis.sessionStorage === 'undefined') vi.stubGlobal('sessionStorage', createMemoryStorage());
});

/** 关联元素的编辑权限取自当前用户，逐例改写 */
const { currentUser } = vi.hoisted(() => ({
  currentUser: { value: null as null | { id: string; role: string; name: string } },
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser }),
}));

/** 截图上传与提示可控：captureAndUpload 由用例逐次给实现（可挂起），emitToast 只记不画 */
const receiptMocks = vi.hoisted(() => ({
  captureAndUpload: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  emitToast: vi.fn(),
  reviewAttachmentDelete: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/composables/useScreenshot', async () => {
  const { ref } = await import('vue');
  return {
    useScreenshot: () => ({
      captureAndUpload: receiptMocks.captureAndUpload,
      isCapturing: ref(false),
      uploadProgress: ref(0),
    }),
  };
});

vi.mock('@/ribbon/toastBus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ribbon/toastBus')>()),
  emitToast: receiptMocks.emitToast,
}));

vi.mock('@/api/reviewApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/reviewApi')>()),
  reviewAttachmentDelete: receiptMocks.reviewAttachmentDelete,
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

  it('dock 档：关联元素排成芯片、锚点折进标题行、操作按钮用短标签但事件与 testid 不变', async () => {
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
        { refno: 'REF/A', role: 'anchor', noun: 'PIPE', createdAt: 1 },
        { refno: 'REF/B', role: 'member', noun: 'VALV', createdAt: 1 },
        { refno: 'REF/C', role: 'member', createdAt: 1 },
      ],
    });

    const mounted = await mountCard({
      density: 'dock',
      item: createItem({
        type: 'cloud',
        authorId: 'author-1',
        refnos: ['REF/B', 'REF/C'],
        cloudBindings: [
          { refno: 'REF/A', role: 'anchor', noun: 'PIPE', createdAt: 1 },
          { refno: 'REF/B', role: 'member', noun: 'VALV', createdAt: 1 },
          { refno: 'REF/C', role: 'member', createdAt: 1 },
        ],
      }),
    });
    const q = <T extends Element>(selector: string) => mounted.host.querySelector<T>(selector);

    // 芯片列表替代逐行列表；每枚芯片带定位 / 移除两个入口，testid 与 normal 档一致
    const chips = q<HTMLElement>('[data-testid="annotation-cloud-member-chips"]');
    expect(chips).not.toBeNull();
    expect(chips?.children.length).toBe(2);
    expect(chips?.textContent).toContain('VALV');
    expect(chips?.textContent).toContain('REF/C');

    // 锚点不再单开一块，折进「关联元素」标题行
    expect(mounted.host.textContent).toContain('云线锚点');
    expect(mounted.host.textContent).toContain('PIPE');
    expect(mounted.host.textContent).not.toContain('（不可更换）');
    expect(q('[data-testid="annotation-cloud-remove-REF/A"]')).toBeNull();

    // 短标签：可见文字缩短，完整名留在 aria-label
    const addButton = q<HTMLButtonElement>('[data-testid="annotation-cloud-add-members"]');
    expect(addButton?.textContent?.trim()).toBe('添加');
    expect(addButton?.getAttribute('aria-label')).toBe('添加元素');
    expect(q<HTMLButtonElement>('[data-testid="annotation-cloud-locate-all"]')?.textContent?.trim()).toBe('高亮全部');
    const addDistance = q<HTMLButtonElement>('[data-testid="annotation-detail-add-distance"]');
    expect(addDistance?.textContent?.trim()).toBe('距离');
    expect(addDistance?.getAttribute('aria-label')).toBe('新增距离');
    expect(q('[data-testid="annotation-detail-add-elevation-delta"]')).not.toBeNull();
    // 图标化按钮：文字进 aria-label
    expect(q<HTMLButtonElement>('[data-testid="annotation-detail-close"]')?.textContent?.trim()).toBe('');
    expect(q<HTMLButtonElement>('[data-testid="annotation-detail-close"]')?.getAttribute('aria-label')).toBe('收起详情');
    expect(q<HTMLButtonElement>('[data-testid="annotation-detail-locate-measurement-m-1"]')?.textContent?.trim()).toBe('');

    // 证据行：问题截图与测量证据并排（flex），两块都是它的直接子元素
    const evidenceRow = q<HTMLElement>('[data-testid="annotation-detail-evidence-row"]');
    expect(evidenceRow?.classList.contains('flex')).toBe(true);
    expect(evidenceRow?.children.length).toBe(2);
    expect(evidenceRow?.children[0]?.tagName).toBe('FIGURE');
    expect(evidenceRow?.children[0]?.classList.contains('flex-1')).toBe(true);
    expect(evidenceRow?.children[1]?.textContent).toContain('测量证据');
    expect(evidenceRow?.children[1]?.classList.contains('flex-1')).toBe(true);
    expect(q<HTMLImageElement>('[data-testid="annotation-detail-screenshot"]')?.classList.contains('h-24')).toBe(true);

    // 事件照旧：点芯片本体 = 单项定位高亮；× = 移除；新增距离 / 定位到模型照常转发
    q<HTMLButtonElement>('[data-testid="annotation-cloud-locate-REF/B"]')?.click();
    q<HTMLButtonElement>('[data-testid="annotation-cloud-locate-all"]')?.click();
    q<HTMLButtonElement>('[data-testid="annotation-detail-add-distance"]')?.click();
    q<HTMLButtonElement>('[data-testid="annotation-detail-locate"]')?.click();
    q<HTMLButtonElement>('[data-testid="annotation-cloud-remove-REF/C"]')?.click();
    await nextTick();

    expect(mounted.locateElementsSpy).toHaveBeenNthCalledWith(1, {
      item: expect.objectContaining({ id: 'annot-1' }),
      refnos: ['REF/B'],
    });
    expect(mounted.locateElementsSpy).toHaveBeenNthCalledWith(2, {
      item: expect.objectContaining({ id: 'annot-1' }),
      refnos: ['REF/B', 'REF/C'],
    });
    expect(mounted.startMeasurementSpy).toHaveBeenCalledWith('distance', expect.objectContaining({ id: 'annot-1' }));
    expect(mounted.locateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'annot-1' }));
    const record = store.cloudAnnotations.value.find((c) => c.id === 'annot-1');
    expect(record?.refnos).toEqual(['REF/B']);

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

  it('normal 档证据区仍是上下堆叠，dock 档没截图时拍摄按钮与测量证据并排', async () => {
    const normal = await mountCard();
    const normalRow = normal.host.querySelector<HTMLElement>('[data-testid="annotation-detail-evidence-row"]');
    expect(normalRow?.classList.contains('flex')).toBe(false);
    expect(normalRow?.classList.contains('space-y-3')).toBe(true);
    expect(normal.host.querySelector<HTMLImageElement>('[data-testid="annotation-detail-screenshot"]')?.classList.contains('max-h-64')).toBe(true);
    normal.unmount();

    const dock = await mountCard({ density: 'dock', item: createItem({ screenshot: undefined, thumbnailUrl: undefined }) });
    const dockRow = dock.host.querySelector<HTMLElement>('[data-testid="annotation-detail-evidence-row"]');
    expect(dockRow?.children.length).toBe(2);
    const capture = dock.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-capture"]');
    expect(capture?.textContent?.trim()).toBe('拍摄截图');
    expect(capture?.classList.contains('flex-1')).toBe(true);
    dock.unmount();
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

  describe('U0 截图回执守卫（方案 §3.6：A 任务截图上传返回时用户已在 B，只能归属 A）', () => {
    async function flushStore() {
      await nextTick();
      await nextTick();
    }

    /** 回到无 scope、内存与所有本机容器全空（上一例切回 A 时载回的截图不能漏到下一例） */
    async function resetStore(store: { setAnnotationDraftScope: (scope: null) => boolean; clearAll: () => void }) {
      store.setAnnotationDraftScope(null);
      store.clearAll();
      await flushStore();
      localStorage.clear();
    }

    const textAnnotation = {
      id: 'annot-1',
      entityId: 'o:annot-1',
      worldPos: [0, 0, 0] as [number, number, number],
      visible: true,
      glyph: '!',
      title: '管线碰撞',
      description: '',
      createdAt: 1,
    };

    const lateAttachment = {
      id: 'att-late',
      url: '/uploads/late.png',
      name: 'late.png',
      mimeType: 'image/png',
      size: 1,
      width: 1,
      height: 1,
      capturedAt: 9,
      uploadedAt: 10,
    };

    beforeEach(() => {
      receiptMocks.captureAndUpload.mockReset();
      receiptMocks.emitToast.mockReset();
      receiptMocks.reviewAttachmentDelete.mockClear();
    });

    it('上传期间切了任务：截图写进出发时那个 scope 的本机容器，不碰当前任务内存，不弹提示；切回来跟着容器载回', async () => {
      const { useToolStore } = await import('@/composables/useToolStore');
      const { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } = await import('@/composables/useAnnotationDraftSession');
      const { annotationScopeKey, buildAnnotationScope } = await import('@/review/domain/annotationScope');
      const store = useToolStore();
      resetAnnotationDraftSessionForTests();
      const session = useAnnotationDraftSession();
      const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'task-A', userId: 'JH' });
      const scopeB = buildAnnotationScope({ projectId: 'p', taskId: 'task-B', userId: 'JH' });
      const keyA = `plant3d-web-tools-v7:${annotationScopeKey(scopeA)}`;

      await resetStore(store);
      expect(store.setAnnotationDraftScope(scopeA)).toBe(true);
      session.enterScope(scopeA);
      store.addAnnotation(textAnnotation);
      await flushStore();
      expect((JSON.parse(localStorage.getItem(keyA) ?? '{}') as { annotations: { id: string }[] }).annotations.map((a) => a.id)).toEqual(['annot-1']);

      let resolveUpload: (value: unknown) => void = () => {};
      receiptMocks.captureAndUpload.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));

      const mounted = await mountCard({ item: createItem({ screenshot: undefined }), taskId: 'task-A' });
      mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-capture"]')?.click();
      await nextTick();
      expect(receiptMocks.captureAndUpload).toHaveBeenCalledWith('task-A', expect.objectContaining({ sourceAnnotationId: 'annot-1' }));

      // 上传还在飞：用户切到 B（容器与会话都切过去）
      expect(store.setAnnotationDraftScope(scopeB)).toBe(true);
      session.enterScope(scopeB);
      await flushStore();
      expect(store.annotations.value).toEqual([]);

      resolveUpload(lateAttachment);
      await flushStore();
      await flushStore();

      // B 的内存一条都没多；A 的容器里 annot-1 挂上了迟到的截图；一句提示都不弹
      expect(store.annotations.value).toEqual([]);
      const rawA = JSON.parse(localStorage.getItem(keyA) ?? '{}') as { annotations: { id: string; screenshot?: { attachmentId?: string } }[] };
      expect(rawA.annotations.map((a) => [a.id, a.screenshot?.attachmentId])).toEqual([['annot-1', 'att-late']]);
      expect(receiptMocks.emitToast).not.toHaveBeenCalled();
      expect(receiptMocks.reviewAttachmentDelete).not.toHaveBeenCalled();

      // 切回 A：截图跟着容器一起回来
      expect(store.setAnnotationDraftScope(scopeA)).toBe(true);
      expect(store.getAnnotationScreenshot('text', 'annot-1')?.attachmentId).toBe('att-late');

      session.leaveScope();
      await resetStore(store);
      mounted.unmount();
    });

    it('还在同一任务里：照旧写内存并提示「截图已添加」', async () => {
      const { useToolStore } = await import('@/composables/useToolStore');
      const { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } = await import('@/composables/useAnnotationDraftSession');
      const { buildAnnotationScope } = await import('@/review/domain/annotationScope');
      const store = useToolStore();
      resetAnnotationDraftSessionForTests();
      const session = useAnnotationDraftSession();
      const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'task-A', userId: 'JH' });

      await resetStore(store);
      expect(store.setAnnotationDraftScope(scopeA)).toBe(true);
      session.enterScope(scopeA);
      store.addAnnotation(textAnnotation);
      await flushStore();
      receiptMocks.captureAndUpload.mockResolvedValueOnce(lateAttachment);

      const mounted = await mountCard({ item: createItem({ screenshot: undefined }), taskId: 'task-A' });
      mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-capture"]')?.click();
      await flushStore();
      await flushStore();

      expect(store.getAnnotationScreenshot('text', 'annot-1')?.attachmentId).toBe('att-late');
      expect(receiptMocks.emitToast).toHaveBeenCalledWith(expect.objectContaining({ message: '截图已添加', level: 'success' }));

      session.leaveScope();
      await resetStore(store);
      mounted.unmount();
    });

    it('回来时批注已不在（内存 / 出发时容器里都找不到）：删掉刚上传的附件，不留孤儿', async () => {
      const { useToolStore } = await import('@/composables/useToolStore');
      const { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } = await import('@/composables/useAnnotationDraftSession');
      const store = useToolStore();
      resetAnnotationDraftSessionForTests();
      useAnnotationDraftSession().leaveScope();
      await resetStore(store);
      receiptMocks.captureAndUpload.mockResolvedValueOnce(lateAttachment);

      // 卡片指向的 annot-1 根本不在 store 里（比如等待期间被删）
      const mounted = await mountCard({ item: createItem({ screenshot: undefined }), taskId: 'task-A' });
      mounted.host.querySelector<HTMLButtonElement>('[data-testid="annotation-detail-screenshot-capture"]')?.click();
      await flushStore();
      await flushStore();

      expect(receiptMocks.reviewAttachmentDelete).toHaveBeenCalledWith('att-late');
      expect(receiptMocks.emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
      expect(receiptMocks.emitToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: '截图已添加' }));

      await resetStore(store);
      mounted.unmount();
    });
  });
});

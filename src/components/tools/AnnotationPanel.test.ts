import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

import { UserRole, type AnnotationComment } from '@/types/auth';

const reviewCommentGetByAnnotationMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  comments: [],
})));

vi.mock('@/api/reviewApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/reviewApi')>();
  return {
    ...actual,
    reviewCommentGetByAnnotation: (...args: unknown[]) => reviewCommentGetByAnnotationMock(...args),
  };
});

function makeComment(id: string, annotationId: string, content: string): AnnotationComment {
  return {
    id,
    annotationId,
    annotationType: 'text',
    authorId: 'designer-1',
    authorName: '设计甲',
    authorRole: UserRole.DESIGNER,
    content,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
  };
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('AnnotationPanel', () => {
  beforeEach(() => {
    reviewCommentGetByAnnotationMock.mockReset();
    reviewCommentGetByAnnotationMock.mockImplementation(async () => ({
      success: true,
      comments: [],
    }));
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    vi.resetModules();
  });

  it('reviewer path hides legacy OBB affordances and terminology', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }] = await Promise.all([
      import('./AnnotationPanel.vue'),
    ]);

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).not.toContain('OBB');
    expect(host.textContent).not.toContain('框选');
    expect(host.textContent).toContain('文字');
    expect(host.textContent).toContain('云线');
    expect(host.textContent).toContain('矩形');

    app.unmount();
    host.remove();
    host = null;
  });

  it('不应再为矩形和云线批注弹出编辑框', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addCloudAnnotation({
      id: 'cloud-1',
      objectIds: ['demo:1'],
      anchorWorldPos: [1, 2, 3],
      leaderEndWorldPos: [2, 3, 4],
      screenOffset: { x: 20, y: -10 },
      cloudSize: { width: 100, height: 60 },
      visible: true,
      title: '云线批注 1',
      description: '',
      createdAt: 1,
      refnos: ['demo:1'],
    });
    store.addRectAnnotation({
      id: 'rect-1',
      objectIds: ['demo:2'],
      obb: {
        center: [3, 4, 5],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [
          [2, 3, 4], [4, 3, 4], [4, 5, 4], [2, 5, 4],
          [2, 3, 6], [4, 3, 6], [4, 5, 6], [2, 5, 6],
        ],
      },
      anchorWorldPos: [3, 4, 5],
      leaderEndWorldPos: [5, 6, 7],
      visible: true,
      title: '矩形批注 1',
      description: '',
      createdAt: 2,
      refnos: ['demo:2'],
    });
    store.pendingRectAnnotationEditId.value = 'rect-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect(host.textContent).not.toContain('编辑云线批注');
    expect(host.textContent).not.toContain('编辑矩形批注');

    app.unmount();
    host.remove();
    host = null;
  });

  it('应展示当前类型与当前选中批注摘要，并高亮对应类型卡片', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.setToolMode('annotation_cloud');
    store.addCloudAnnotation({
      id: 'cloud-focus-1',
      objectIds: ['demo:cloud:1'],
      anchorWorldPos: [1, 2, 3],
      visible: true,
      title: '云线焦点批注',
      description: '用于验证当前摘要',
      createdAt: 1,
      refnos: ['demo:cloud:1'],
    });
    store.activeCloudAnnotationId.value = 'cloud-focus-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('云线批注模式'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('[data-testid="annotation-panel-current-type-label"]') as HTMLElement | null)?.textContent).toContain('云线批注');
    expect((host.querySelector('[data-testid="annotation-panel-current-selection-label"]') as HTMLElement | null)?.textContent).toContain('云线焦点批注');
    expect((host.querySelector('[data-testid="annotation-panel-section-cloud"]') as HTMLElement | null)?.getAttribute('data-active')).toBe('true');
    expect((host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null)?.getAttribute('data-active')).toBe('false');

    app.unmount();
    host.remove();
    host = null;
  });

  it('选中文字批注后，应提供最小化与恢复展开入口', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: {
        template: '<div data-testid="review-comments-panel-stub" />',
      },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({
        currentUser: ref(null),
      }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 'text-min-1',
      entityId: 'entity-min-1',
      worldPos: [1, 2, 3],
      labelWorldPos: [3, 4, 5],
      collapsed: false,
      visible: true,
      glyph: 'A1',
      title: '可最小化文字批注',
      description: '测试入口',
      createdAt: 1,
    });
    store.activeAnnotationId.value = 'text-min-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('文字批注模式'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const toggleButton = host.querySelector('[data-testid="annotation-panel-text-collapse-toggle"]') as HTMLButtonElement | null;
    expect(toggleButton?.textContent).toContain('最小化');

    toggleButton?.click();
    await nextTick();
    expect(store.annotations.value[0]!.collapsed).toBe(true);

    const expandButton = host.querySelector('[data-testid="annotation-panel-text-collapse-toggle"]') as HTMLButtonElement | null;
    expect(expandButton?.textContent).toContain('恢复展开');

    expandButton?.click();
    await nextTick();
    expect(store.annotations.value[0]!.collapsed).toBe(false);

    app.unmount();
    host.remove();
    host = null;
  });

  it('严重度概览条应按桶展示数量，并支持点击筛选列表', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref(null) }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 't-crit', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: 'A', title: '致命文字', description: '', createdAt: 10,
    });
    store.addAnnotation({
      id: 't-normal', entityId: 'e2', worldPos: [0, 0, 0],
      visible: true, glyph: 'B', title: '一般文字', description: '', createdAt: 20,
    });
    store.addAnnotation({
      id: 't-unset', entityId: 'e3', worldPos: [0, 0, 0],
      visible: true, glyph: 'C', title: '未设置文字', description: '', createdAt: 30,
    });
    store.updateAnnotationSeverity('text', 't-crit', 'principle');
    store.updateAnnotationSeverity('text', 't-normal', 'drawing');

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true), statusText: ref('ready'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const principleBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-principle"]') as HTMLButtonElement | null;
    const drawingBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-drawing"]') as HTMLButtonElement | null;
    const unsetBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-unset"]') as HTMLButtonElement | null;
    const clearBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-clear"]') as HTMLButtonElement | null;
    expect(principleBtn?.textContent).toContain('1');
    expect(drawingBtn?.textContent).toContain('1');
    expect(unsetBtn?.textContent).toContain('1');
    expect(clearBtn?.textContent).toContain('3');

    principleBtn?.click();
    await nextTick();
    const textSection = host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null;
    expect(textSection?.textContent).toContain('致命文字');
    expect(textSection?.textContent).not.toContain('一般文字');
    expect(textSection?.textContent).not.toContain('未设置文字');

    principleBtn?.click();
    await nextTick();
    const textSectionAfter = host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null;
    expect(textSectionAfter?.textContent).toContain('致命文字');
    expect(textSectionAfter?.textContent).toContain('一般文字');
    expect(textSectionAfter?.textContent).toContain('未设置文字');

    app.unmount();
    host.remove();
    host = null;
  });

  it('严重度为 0 的桶禁用点击，且点击不会改变筛选', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref(null) }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 't-1', entityId: 'e1', worldPos: [0, 0, 0],
      visible: true, glyph: '1', title: 'T', description: '', createdAt: 1,
    });
    store.updateAnnotationSeverity('text', 't-1', 'general');

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true), statusText: ref('ready'),
        flyToAnnotation: vi.fn(), removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(), flyToRectAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(), removeRectAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const principleBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-principle"]') as HTMLButtonElement | null;
    expect(principleBtn?.hasAttribute('disabled')).toBe(true);
    expect(principleBtn?.textContent).toContain('0');

    app.unmount();
    host.remove();
    host = null;
  });

  it('severity counts ignore legacy OBB annotations to stay consistent with hidden OBB list', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref(null) }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();

    // 1 条可见的 text 批注（critical），对比基线
    store.addAnnotation({
      id: 't-visible',
      entityId: 'e-visible',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: 'T',
      title: '可见文字',
      description: '',
      createdAt: 1,
    });
    store.updateAnnotationSeverity('text', 't-visible', 'principle');

    // 2 条 OBB 批注（在 reviewer 面板里被隐藏），不应计入顶部筛选条数量
    const sampleObb = {
      center: [0, 0, 0] as [number, number, number],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
      halfSize: [1, 1, 1] as [number, number, number],
      corners: [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
      ] as [
        [number, number, number], [number, number, number], [number, number, number], [number, number, number],
        [number, number, number], [number, number, number], [number, number, number], [number, number, number]
      ],
    };
    store.addObbAnnotation({
      id: 'obb-hidden-1',
      objectIds: ['obj:1'],
      obb: sampleObb,
      labelWorldPos: [0, 0, 1],
      anchor: { kind: 'top_center' },
      visible: true,
      title: 'OBB hidden 1',
      description: '',
      createdAt: 2,
    });
    store.addObbAnnotation({
      id: 'obb-hidden-2',
      objectIds: ['obj:2'],
      obb: sampleObb,
      labelWorldPos: [0, 0, 2],
      anchor: { kind: 'top_center' },
      visible: true,
      title: 'OBB hidden 2',
      description: '',
      createdAt: 3,
    });
    store.updateAnnotationSeverity('obb', 'obb-hidden-1', 'general');
    store.updateAnnotationSeverity('obb', 'obb-hidden-2', 'drawing');

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const clearBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-clear"]') as HTMLButtonElement | null;
    const principleBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-principle"]') as HTMLButtonElement | null;
    const generalBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-general"]') as HTMLButtonElement | null;
    const drawingBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-drawing"]') as HTMLButtonElement | null;

    // "全部 (N)" 只应反映面板里能看到的批注数（即 text/cloud/rect），OBB 不计入
    expect(clearBtn?.textContent).toContain('1');
    expect(principleBtn?.textContent).toContain('1');
    // 不能因为 obb 上有 general/drawing 就把它们计入
    expect(generalBtn?.textContent).toContain('0');
    expect(drawingBtn?.textContent).toContain('0');
    // general/drawing 桶应因为计数为 0 而被禁用，避免用户点击后发现列表空
    expect(generalBtn?.hasAttribute('disabled')).toBe(true);
    expect(drawingBtn?.hasAttribute('disabled')).toBe(true);

    // 页面文本不应出现 OBB 相关字样（维持 hide legacy OBB 协议）
    expect(host.textContent).not.toContain('OBB hidden 1');
    expect(host.textContent).not.toContain('OBB hidden 2');

    app.unmount();
    host.remove();
    host = null;
  });

  it('flyText dispatches showModelByRefnos derived from refno/refnos (P0-B Phase 2)', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref(null) }),
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();

    // 仅提供 legacy refno，verify normalize 后 refnos=[refno] 且 fly 的事件 payload 正确
    store.addAnnotation({
      id: 't-refno-only',
      entityId: 'e-refno-only',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: '仅 refno',
      description: '',
      createdAt: 1,
      refno: 'BRAN:legacy',
    });

    const flySpy = vi.fn();
    const captured: { refnos?: string[]; regenModel?: boolean }[] = [];
    const listener = (event: Event) => {
      captured.push(((event as CustomEvent).detail ?? {}) as { refnos?: string[]; regenModel?: boolean });
    };
    window.addEventListener('showModelByRefnos', listener);

    try {
      const app = createApp(AnnotationPanel, {
        tools: {
          ready: ref(true),
          statusText: ref('ready'),
          flyToAnnotation: flySpy,
          removeAnnotation: vi.fn(),
          flyToCloudAnnotation: vi.fn(),
          flyToRectAnnotation: vi.fn(),
          flyToObbAnnotation: vi.fn(),
          removeCloudAnnotation: vi.fn(),
          removeRectAnnotation: vi.fn(),
          removeObbAnnotation: vi.fn(),
        },
      });
      app.mount(host);
      await nextTick();

      // 找到「定位」按钮并触发
      const textSection = host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null;
      const locateButton = Array.from(
        textSection?.querySelectorAll('button') ?? [],
      ).find((b) => (b.textContent || '').trim() === '定位') as HTMLButtonElement | undefined;
      expect(locateButton).toBeTruthy();
      locateButton?.click();
      await nextTick();

      expect(flySpy).toHaveBeenCalledWith('t-refno-only');
      expect(captured).toHaveLength(1);
      // 关键：legacy 的 `refno` 会被 normalize 成 `refnos=[refno]`，fly 事件拿到统一结构
      expect(captured[0]?.refnos).toEqual(['BRAN:legacy']);
      expect(captured[0]?.regenModel).toBe(false);

      app.unmount();
    } finally {
      window.removeEventListener('showModelByRefnos', listener);
    }

    host.remove();
    host = null;
  });

  it('列表页切换批注时只显示当前批注评论，不残留旧线程或重复评论', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref({ id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER }) }),
    }));

    reviewCommentGetByAnnotationMock.mockImplementation(async (annotationId: string) => ({
      success: true,
      comments: annotationId === 'text-thread-1'
        ? [
          makeComment('c-1', 'text-thread-1', '列表页批注一评论'),
          makeComment('c-1', 'text-thread-1', '列表页批注一评论'),
        ]
        : [makeComment('c-2', 'text-thread-2', '列表页批注二评论')],
    }));

    const [{ default: AnnotationPanel }, { useToolStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 'text-thread-1',
      entityId: 'entity-thread-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: '批注一',
      description: '',
      createdAt: 1,
    });
    store.addAnnotation({
      id: 'text-thread-2',
      entityId: 'entity-thread-2',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '2',
      title: '批注二',
      description: '',
      createdAt: 2,
    });
    store.activeAnnotationId.value = 'text-thread-1';

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await flushUi();

    const listButton = host.querySelector('button[title="列表视图"]') as HTMLButtonElement | null;
    expect(listButton).toBeTruthy();
    listButton?.click();
    await flushUi();

    expect(host.textContent).toContain('列表页批注一评论');
    expect((host.textContent?.match(/列表页批注一评论/g) ?? []).length).toBe(1);
    expect(host.textContent).not.toContain('列表页批注二评论');

    store.activeAnnotationId.value = 'text-thread-2';
    await flushUi();

    expect(host.textContent).toContain('列表页批注二评论');
    expect(host.textContent).not.toContain('列表页批注一评论');

    app.unmount();
    host.remove();
    host = null;
  });

  it('按当前校审面板卡片设计为可见批注提供包含覆盖层的截图预览，并上传用户确认的同一张图', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const capturedViewport = {
      blob: new Blob(['viewer-with-annotation-and-measurement-overlay'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,PREVIEW_WITH_ANNOTATION_AND_MEASUREMENT',
      width: 800,
      height: 600,
      capturedAt: 1777041600000,
    };
    const captureViewport = vi.fn(async () => capturedViewport);
    const uploadCapturedScreenshot = vi.fn(async () => ({
      id: 'att-text-shot',
      url: 'https://example.com/text-shot.png',
      name: 'text-shot.png',
      uploadedAt: 1777041600000,
      capturedAt: 1777041600000,
      width: 800,
      height: 600,
    }));
    const saveAnnotationScreenshot = vi.fn(async (type, id, screenshot) => {
      const { useToolStore } = await import('@/composables/useToolStore');
      useToolStore().setAnnotationScreenshot(type, id, screenshot);
      return true;
    });

    vi.doMock('@/components/review/ReviewCommentsPanel.vue', () => ({
      default: { template: '<div />' },
    }));
    vi.doMock('@/components/review/ReviewCommentsTimeline.vue', () => ({
      default: { template: '<div data-testid="review-comments-timeline-stub" />' },
    }));
    vi.doMock('@/composables/useUserStore', () => ({
      useUserStore: () => ({ currentUser: ref({ id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER }) }),
    }));
    vi.doMock('@/composables/useScreenshot', () => ({
      useScreenshot: () => ({
        captureViewport,
        uploadCapturedScreenshot,
        isCapturing: ref(false),
        uploadProgress: ref(0),
      }),
    }));
    vi.doMock('@/composables/useAnnotationSeveritySync', () => ({
      saveAnnotationScreenshot,
    }));

    const [{ default: AnnotationPanel }, { useToolStore }, { useReviewStore }] = await Promise.all([
      import('./AnnotationPanel.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useReviewStore'),
    ]);

    const reviewStore = useReviewStore() as any;
    reviewStore.currentTask.value = {
      id: 'task-shot',
      formId: 'FORM-SHOT',
      title: '截图任务',
      description: '',
      modelName: '',
      status: 'draft',
      priority: 'medium',
      requesterId: 'designer-1',
      requesterName: '设计甲',
      currentNode: 'sj',
      createdAt: 1,
      updatedAt: 1,
    };

    const store = useToolStore() as any;
    store.clearAll();
    store.addAnnotation({
      id: 'text-shot-1',
      entityId: 'entity-text-shot-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: '文字截图批注',
      description: '',
      createdAt: 3,
    });
    store.addCloudAnnotation({
      id: 'cloud-shot-1',
      objectIds: ['demo:cloud'],
      anchorWorldPos: [1, 2, 3],
      visible: true,
      title: '云线截图批注',
      description: '',
      createdAt: 2,
      refnos: ['demo:cloud'],
    });
    store.addRectAnnotation({
      id: 'rect-shot-1',
      objectIds: ['demo:rect'],
      obb: {
        center: [3, 4, 5],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [
          [2, 3, 4], [4, 3, 4], [4, 5, 4], [2, 5, 4],
          [2, 3, 6], [4, 3, 6], [4, 5, 6], [2, 5, 6],
        ],
      },
      anchorWorldPos: [3, 4, 5],
      leaderEndWorldPos: [5, 6, 7],
      visible: true,
      title: '矩形截图批注',
      description: '',
      createdAt: 1,
      refnos: ['demo:rect'],
    });
    store.addObbAnnotation({
      id: 'obb-shot-1',
      objectIds: ['demo:obb'],
      obb: {
        center: [6, 7, 8],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 2, 3],
        corners: [
          [5, 5, 5], [7, 5, 5], [7, 9, 5], [5, 9, 5],
          [5, 5, 11], [7, 5, 11], [7, 9, 11], [5, 9, 11],
        ],
      },
      labelWorldPos: [6, 7, 11],
      anchor: { kind: 'top_center' },
      visible: true,
      title: '框选截图批注',
      description: '',
      createdAt: 4,
      refnos: ['demo:obb'],
    });
    store.activeAnnotationId.value = null;
    store.activeCloudAnnotationId.value = null;
    store.activeRectAnnotationId.value = null;
    store.activeObbAnnotationId.value = 'obb-shot-1';
    store.setToolMode('annotation_obb');

    const app = createApp(AnnotationPanel, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        flyToAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        flyToCloudAnnotation: vi.fn(),
        flyToRectAnnotation: vi.fn(),
        flyToObbAnnotation: vi.fn(),
        removeCloudAnnotation: vi.fn(),
        removeRectAnnotation: vi.fn(),
        removeObbAnnotation: vi.fn(),
      },
    });
    app.mount(host);
    await flushUi();

    const textTrigger = host.querySelector('[data-testid="annotation-screenshot-trigger-text-text-shot-1"]') as HTMLButtonElement | null;
    const cloudTrigger = host.querySelector('[data-testid="annotation-screenshot-trigger-cloud-cloud-shot-1"]') as HTMLButtonElement | null;
    const rectTrigger = host.querySelector('[data-testid="annotation-screenshot-trigger-rect-rect-shot-1"]') as HTMLButtonElement | null;
    expect(textTrigger).toBeTruthy();
    expect(cloudTrigger).toBeTruthy();
    expect(rectTrigger).toBeTruthy();

    textTrigger?.click();
    await flushUi();

    expect(captureViewport).toHaveBeenCalledWith(expect.objectContaining({
      format: 'image/png',
      includeOverlays: true,
    }));
    expect(uploadCapturedScreenshot).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('保存批注截图');
    expect(document.body.querySelector('[data-testid="annotation-screenshot-preview-image"]')?.getAttribute('src')).toBe('data:image/png;base64,PREVIEW_WITH_ANNOTATION_AND_MEASUREMENT');

    const confirmButton = document.body.querySelector('[data-testid="annotation-screenshot-confirm-save"]') as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    confirmButton?.click();
    await flushUi();

    expect(captureViewport).toHaveBeenCalledTimes(1);
    expect(uploadCapturedScreenshot).toHaveBeenCalledWith('task-shot', capturedViewport, expect.objectContaining({
      kind: 'annotation_shot',
      sourceAnnotationId: 'text-shot-1',
      sourceAnnotationType: 'text',
      formId: 'FORM-SHOT',
    }));
    expect(saveAnnotationScreenshot).toHaveBeenCalledWith('text', 'text-shot-1', expect.objectContaining({
      url: 'https://example.com/text-shot.png',
      attachmentId: 'att-text-shot',
    }), {
      formId: 'FORM-SHOT',
      taskId: 'task-shot',
      persist: false,
    });
    expect(store.getAnnotationScreenshot('text', 'text-shot-1')).toMatchObject({
      url: 'https://example.com/text-shot.png',
      attachmentId: 'att-text-shot',
      name: 'text-shot.png',
      capturedAt: 1777041600000,
    });

    uploadCapturedScreenshot.mockResolvedValueOnce({
      id: 'att-obb-shot',
      url: 'https://example.com/obb-shot.png',
      name: 'obb-shot.png',
      uploadedAt: 1777041600001,
      capturedAt: 1777041600001,
      width: 800,
      height: 600,
    });

    const obbActiveTrigger = host.querySelector('[data-testid="annotation-screenshot-trigger-active-obb-obb-shot-1"]') as HTMLButtonElement | null;
    expect(obbActiveTrigger).toBeTruthy();
    obbActiveTrigger?.click();
    await flushUi();

    const obbConfirmButton = document.body.querySelector('[data-testid="annotation-screenshot-confirm-save"]') as HTMLButtonElement | null;
    expect(obbConfirmButton).toBeTruthy();
    obbConfirmButton?.click();
    await flushUi();

    expect(captureViewport).toHaveBeenCalledTimes(2);
    expect(uploadCapturedScreenshot).toHaveBeenLastCalledWith('task-shot', capturedViewport, expect.objectContaining({
      kind: 'annotation_shot',
      sourceAnnotationId: 'obb-shot-1',
      sourceAnnotationType: 'obb',
      formId: 'FORM-SHOT',
    }));
    expect(saveAnnotationScreenshot).toHaveBeenLastCalledWith('obb', 'obb-shot-1', expect.objectContaining({
      url: 'https://example.com/obb-shot.png',
      attachmentId: 'att-obb-shot',
    }), {
      formId: 'FORM-SHOT',
      taskId: 'task-shot',
      persist: false,
    });
    expect(store.getAnnotationScreenshot('obb', 'obb-shot-1')).toMatchObject({
      url: 'https://example.com/obb-shot.png',
      attachmentId: 'att-obb-shot',
      name: 'obb-shot.png',
      capturedAt: 1777041600001,
    });

    app.unmount();
    host.remove();
    host = null;
  });
});

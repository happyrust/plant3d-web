import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

describe('AnnotationPanel', () => {
  beforeEach(() => {
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
    expect(store.annotations.value[0].collapsed).toBe(true);

    const expandButton = host.querySelector('[data-testid="annotation-panel-text-collapse-toggle"]') as HTMLButtonElement | null;
    expect(expandButton?.textContent).toContain('恢复展开');

    expandButton?.click();
    await nextTick();
    expect(store.annotations.value[0].collapsed).toBe(false);

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
    store.updateAnnotationSeverity('text', 't-crit', 'critical');
    store.updateAnnotationSeverity('text', 't-normal', 'normal');

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

    const critBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-critical"]') as HTMLButtonElement | null;
    const normalBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-normal"]') as HTMLButtonElement | null;
    const unsetBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-unset"]') as HTMLButtonElement | null;
    const clearBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-clear"]') as HTMLButtonElement | null;
    expect(critBtn?.textContent).toContain('1');
    expect(normalBtn?.textContent).toContain('1');
    expect(unsetBtn?.textContent).toContain('1');
    expect(clearBtn?.textContent).toContain('3');

    critBtn?.click();
    await nextTick();
    const textSection = host.querySelector('[data-testid="annotation-panel-section-text"]') as HTMLElement | null;
    expect(textSection?.textContent).toContain('致命文字');
    expect(textSection?.textContent).not.toContain('一般文字');
    expect(textSection?.textContent).not.toContain('未设置文字');

    critBtn?.click();
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
    store.updateAnnotationSeverity('text', 't-1', 'severe');

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

    const critBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-critical"]') as HTMLButtonElement | null;
    expect(critBtn?.hasAttribute('disabled')).toBe(true);
    expect(critBtn?.textContent).toContain('0');

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
    store.updateAnnotationSeverity('text', 't-visible', 'critical');

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
    store.updateAnnotationSeverity('obb', 'obb-hidden-1', 'severe');
    store.updateAnnotationSeverity('obb', 'obb-hidden-2', 'normal');

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
    const critBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-critical"]') as HTMLButtonElement | null;
    const severeBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-severe"]') as HTMLButtonElement | null;
    const normalBtn = host.querySelector('[data-testid="annotation-panel-severity-filter-normal"]') as HTMLButtonElement | null;

    // "全部 (N)" 只应反映面板里能看到的批注数（即 text/cloud/rect），OBB 不计入
    expect(clearBtn?.textContent).toContain('1');
    expect(critBtn?.textContent).toContain('1');
    // 不能因为 obb 上有 severe/normal 就把它们计入
    expect(severeBtn?.textContent).toContain('0');
    expect(normalBtn?.textContent).toContain('0');
    // severe/normal 桶应因为计数为 0 而被禁用，避免用户点击后发现列表空
    expect(severeBtn?.hasAttribute('disabled')).toBe(true);
    expect(normalBtn?.hasAttribute('disabled')).toBe(true);

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
});

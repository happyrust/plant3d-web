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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import { BoxGeometry, Matrix4, Vector3 } from 'three';

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: ref<string | null>(null),
    selectedRefnos: ref<string[]>([]),
    propertiesLoading: ref(false),
    propertiesError: ref(null),
    propertiesData: ref(null),
    fullName: ref(null),
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnos: vi.fn(),
  }),
}));

import { useDtxTools } from './useDtxTools';
import { useToolStore } from './useToolStore';

import { DTXLayer } from '@/utils/three/dtx';

function createLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject('o:24381_1001:0', 'box', new Matrix4().makeTranslation(0, 0, 0));
  return layer;
}

function createCanvasStub(): HTMLCanvasElement {
  return {
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function pointerAt(x: number, y: number): PointerEvent {
  return { button: 0, clientX: x, clientY: y, pointerId: 1 } as PointerEvent;
}

/** 光标下总能拾到同一个构件的工具实例，工具模式是 none */
function createTools() {
  const store = useToolStore();
  const setObjectsSelected = vi.fn();

  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true },
      camera: null,
    } as any),
    dtxLayerRef: shallowRef<DTXLayer | null>(createLayer()),
    selectionRef: ref({
      pickPoint: vi.fn(() => ({
        objectId: 'o:24381_1001:0',
        distance: 5,
        point: new Vector3(),
      })),
    } as any),
    overlayContainerRef: ref(null),
    store,
    compatViewerRef: ref({
      scene: {
        getAABB: vi.fn(() => [0, 0, 0, 1, 1, 1]),
        ensureRefnos: vi.fn(),
        setObjectsSelected,
        selectedObjectIds: [] as string[],
      },
    } as any),
    requestRender: null,
  });

  tools.refreshReadyState();
  return { tools, setObjectsSelected };
}

describe('导航态（none）单击选中构件', () => {
  const canvas = createCanvasStub();

  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('none');
    vi.clearAllMocks();
  });

  it('单击命中构件：选中它', async () => {
    const { tools, setObjectsSelected } = createTools();
    const event = pointerAt(100, 100);

    tools.onCanvasPointerDown(canvas, event);
    tools.onCanvasPointerUp(canvas, event);
    await nextTick();

    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_1001'], true);
  });

  it('#205 这次单击已被尺寸层认领：不拾场景、不改选中；下一次没被认领的单击照常', async () => {
    const { tools, setObjectsSelected } = createTools();
    const event = pointerAt(100, 100);

    tools.onCanvasPointerDown(canvas, event);
    tools.onCanvasPointerUp(canvas, event, { clickTaken: true });
    await nextTick();
    expect(setObjectsSelected).not.toHaveBeenCalled();

    tools.onCanvasPointerDown(canvas, event);
    tools.onCanvasPointerUp(canvas, event);
    await nextTick();
    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_1001'], true);
  });
});

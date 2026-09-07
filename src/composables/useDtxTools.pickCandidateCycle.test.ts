import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

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

type RayHit = { objectId: string; distance: number };

/** 三个沿射线前后排开的构件，用于模拟「点一下命中一串重叠管件」。 */
function createLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject('o:24381_1001:0', 'box', new Matrix4().makeTranslation(0, 0, 0));
  layer.addObject('o:24381_1002:0', 'box', new Matrix4().makeTranslation(3, 0, 0));
  layer.addObject('o:24381_1003:0', 'box', new Matrix4().makeTranslation(6, 0, 0));
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

function createTools(rayHits: { current: RayHit[] }) {
  const store = useToolStore();
  const setObjectsSelected = vi.fn();

  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true },
      camera: null,
    } as any),
    dtxLayerRef: ref(createLayer()),
    selectionRef: ref({
      pickPoints: vi.fn(() => rayHits.current.map((hit) => ({
        objectId: hit.objectId,
        distance: hit.distance,
        point: new Vector3(),
        triangle: [new Vector3(), new Vector3(), new Vector3()],
      }))),
    } as any),
    overlayContainerRef: ref(null),
    store,
    compatViewerRef: ref({
      scene: {
        getAABB: vi.fn(() => [0, 0, 0, 1, 1, 1]),
        setObjectsSelected,
        selectedObjectIds: [] as string[],
      },
    } as any),
    requestRender: null,
  });

  tools.refreshReadyState();
  return { tools, store, setObjectsSelected };
}

async function clickAt(
  tools: ReturnType<typeof createTools>['tools'],
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): Promise<void> {
  const event = pointerAt(x, y);
  tools.onCanvasPointerDown(canvas, event);
  tools.onCanvasPointerUp(canvas, event);
  await nextTick();
}

describe('pick_refno 候选轮换（重叠构件）', () => {
  const canvas = createCanvasStub();

  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('none');
    vi.clearAllMocks();
  });

  it('点击先拾取最靠近相机的构件', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1003:0', distance: 30 },
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);

    expect(store.pickedRefnos.value).toEqual(['24381_1001']);
    expect(tools.pickCandidates.value.map((c) => c.refno)).toEqual([
      '24381_1001', '24381_1002', '24381_1003',
    ]);
  });

  it('轮换替换当前候选而不是追加，绕一圈后回到起点', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
        { objectId: 'o:24381_1003:0', distance: 30 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);

    expect(tools.cyclePickCandidate(1)).toBe(true);
    await nextTick();
    expect(store.pickedRefnos.value).toEqual(['24381_1002']);

    tools.cyclePickCandidate(1);
    await nextTick();
    expect(store.pickedRefnos.value).toEqual(['24381_1003']);

    tools.cyclePickCandidate(1);
    await nextTick();
    expect(store.pickedRefnos.value).toEqual(['24381_1001']);
  });

  it('Shift+Tab 反向轮换直接跳到最远的那个', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
        { objectId: 'o:24381_1003:0', distance: 30 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);

    tools.cyclePickCandidate(-1);
    await nextTick();

    expect(store.pickedRefnos.value).toEqual(['24381_1003']);
  });

  it('原地再点一次等同于轮换，不会把同一处重复计入', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);
    await clickAt(tools, canvas, 102, 103);

    expect(store.pickedRefnos.value).toEqual(['24381_1002']);
  });

  it('换个位置点击是新的一次拾取，累加到已选集合', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);

    rayHits.current = [{ objectId: 'o:24381_1003:0', distance: 7 }];
    await clickAt(tools, canvas, 400, 300);

    expect(store.pickedRefnos.value).toEqual(['24381_1001', '24381_1003']);
  });

  it('光标下只有一个构件时无从轮换', async () => {
    const rayHits = { current: [{ objectId: 'o:24381_1001:0', distance: 5 }] };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);

    expect(tools.cyclePickCandidate(1)).toBe(false);
    expect(store.pickedRefnos.value).toEqual(['24381_1001']);
  });

  it('退出拾取模式后候选会话被清空，不会残留可轮换状态', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
      ],
    };
    const { tools, store } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);
    expect(tools.pickCandidates.value).toHaveLength(2);

    store.confirmPickRefno();
    await nextTick();

    expect(tools.pickCandidates.value).toHaveLength(0);
    expect(tools.cyclePickCandidate(1)).toBe(false);
  });

  it('轮换会把被替换掉的构件取消高亮，只保留当前候选', async () => {
    const rayHits = {
      current: [
        { objectId: 'o:24381_1001:0', distance: 5 },
        { objectId: 'o:24381_1002:0', distance: 12 },
      ],
    };
    const { tools, store, setObjectsSelected } = createTools(rayHits);

    store.startPickRefno([]);
    await nextTick();
    await clickAt(tools, canvas, 100, 100);
    setObjectsSelected.mockClear();

    tools.cyclePickCandidate(1);
    await nextTick();

    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_1001'], false);
    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_1002'], true);
  });
});

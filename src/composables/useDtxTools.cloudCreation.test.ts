import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { BoxGeometry, Matrix4, PerspectiveCamera } from 'three';

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: ref<string | null>(null),
    selectedRefnos: ref<string[]>([]),
    propertiesLoading: ref(false),
    propertiesError: ref<string | null>(null),
    propertiesData: ref(null),
    fullName: ref(null),
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    clearSelectedRefnos: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnos: vi.fn(),
    isSelected: vi.fn(() => false),
    toggleSelectedRefno: vi.fn(),
  }),
}));

import { CLOUD_TARGET_BBOX_TTL_MS, useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

import { DTXLayer } from '@/utils/three/dtx';

const TARGET_REFNO = '24381_145019';
const ANCHOR_REFNO = '24381_145018';

/** 编译过的最小 DTXLayer，只为让 `ready` 成立（拖框闸门要求交互就绪）。 */
function createReadyLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject(`o:${TARGET_REFNO}:0`, 'box', new Matrix4());
  return layer;
}

function createCanvasStub(): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
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

/** compat viewer 的 getAABB 由测试逐例接管，用来模拟「目标已加载 / 未加载」。 */
function createTools(
  getAABB: (refnos: string[]) => number[] | null = () => null,
  sceneExtras: Record<string, unknown> = {},
) {
  const store = useToolStore();
  const canvas = createCanvasStub();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const overlay = document.createElement('div');
  document.body.appendChild(overlay);

  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true },
      camera,
      canvas,
    } as any),
    dtxLayerRef: ref(createReadyLayer()),
    selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene: { getAABB: vi.fn(getAABB), ...sceneExtras } } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay };
}

function makeCloud(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: '云线批注 1',
    description: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('云线创建的分级 Esc 回退', () => {
  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
    store.clearCloudTargetRefnos();
    store.setToolMode('none');
  });

  it('拖框中回退只丢预览，锚点与目标集合都保留', async () => {
    const { tools, store, canvas } = createTools();
    store.setCloudTargetRefnos([TARGET_REFNO]);
    store.setToolMode('annotation_cloud');
    await nextTick();
    tools.pendingCloudAnchor.value = { worldPos: [0, 0, 0], refno: ANCHOR_REFNO, entityId: ANCHOR_REFNO };

    tools.onCanvasPointerDown(canvas, pointerAt(100, 100));
    tools.onCanvasPointerMove(canvas, pointerAt(240, 220));

    expect(tools.rollbackCloudCreationStep()).toBe(true);
    expect(tools.pendingCloudAnchor.value).not.toBeNull();
    expect(store.cloudTargetRefnos.value).toEqual([TARGET_REFNO]);
  });

  it('无拖框时先退锚点，再退才交还给调用方退出工具；目标集合始终保留', async () => {
    const { tools, store } = createTools();
    store.setCloudTargetRefnos([TARGET_REFNO]);
    store.setToolMode('annotation_cloud');
    await nextTick();
    tools.pendingCloudAnchor.value = { worldPos: [0, 0, 0], refno: ANCHOR_REFNO, entityId: ANCHOR_REFNO };

    expect(tools.rollbackCloudCreationStep()).toBe(true);
    expect(tools.pendingCloudAnchor.value).toBeNull();
    expect(store.cloudTargetRefnos.value).toEqual([TARGET_REFNO]);

    expect(tools.rollbackCloudCreationStep()).toBe(false);
    expect(store.cloudTargetRefnos.value).toEqual([TARGET_REFNO]);
  });

  it('退出云线工具到 none 保留目标集合，切到别的工具才清空', async () => {
    const { store } = createTools();
    store.setCloudTargetRefnos([TARGET_REFNO]);
    store.setToolMode('annotation_cloud');
    await nextTick();

    store.setToolMode('none');
    await nextTick();
    expect(store.cloudTargetRefnos.value).toEqual([TARGET_REFNO]);

    store.setToolMode('annotation_cloud');
    await nextTick();
    store.setToolMode('annotation_rect');
    await nextTick();
    expect(store.cloudTargetRefnos.value).toEqual([]);
  });

  it('非云线模式下不消费 Esc', () => {
    const { tools, store } = createTools();
    store.setToolMode('annotation_rect');
    expect(tools.rollbackCloudCreationStep()).toBe(false);
  });
});

describe('云线绘制与框内构件解耦', () => {
  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
    store.clearCloudTargetRefnos();
    store.setToolMode('none');
  });

  it('拖框只决定轮廓：不遍历框内构件，关联全部来自目标集合', async () => {
    const getLoadedRefnos = vi.fn(() => [`${TARGET_REFNO}`, 'other-1', 'other-2']);
    const { tools, store, canvas } = createTools(() => [0, 0, 0, 2, 2, 2], { getLoadedRefnos });
    store.setCloudTargetRefnos([TARGET_REFNO]);
    store.setToolMode('annotation_cloud');
    await nextTick();
    tools.pendingCloudAnchor.value = { worldPos: [0, 0, 0], refno: ANCHOR_REFNO, entityId: ANCHOR_REFNO };

    tools.onCanvasPointerDown(canvas, pointerAt(100, 100));
    tools.onCanvasPointerMove(canvas, pointerAt(300, 260));
    tools.onCanvasPointerUp(canvas, pointerAt(300, 260));

    expect(getLoadedRefnos).not.toHaveBeenCalled();
    expect(store.cloudAnnotations.value).toHaveLength(1);
    const created = store.cloudAnnotations.value[0]!;
    expect(created.refnos).toEqual([TARGET_REFNO]);
    expect(created.anchorRefno).toBe(ANCHOR_REFNO);
    expect(created.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual([
      `anchor:${ANCHOR_REFNO}`,
      `member:${TARGET_REFNO}`,
    ]);
    // 画完清空本次目标与锚点，工具留在云线模式便于继续画下一条
    expect(store.cloudTargetRefnos.value).toEqual([]);
    expect(tools.pendingCloudAnchor.value).toBeNull();
    expect(store.toolMode.value).toBe('annotation_cloud');
  });
});

describe('云线贴合所用的目标 AABB', () => {
  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('none');
  });

  it('创建时目标未加载（记录无快照），加载后按目标 refnos 现算补上', () => {
    let loaded = false;
    const { tools, store } = createTools(() => (loaded ? [1, 2, 3, 4, 5, 6] : null));
    store.addCloudAnnotation(makeCloud({ selectionBbox: undefined }));
    tools.syncFromStore();

    expect(tools.debugCloudOutlines()[0]?.selectionBbox).toBeNull();

    vi.useFakeTimers();
    try {
      loaded = true;
      vi.advanceTimersByTime(CLOUD_TARGET_BBOX_TTL_MS + 1);
      expect(tools.debugCloudOutlines()[0]?.selectionBbox).toEqual({ min: [1, 2, 3], max: [4, 5, 6] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('解析失败同样按 TTL 冷却，不会每帧重查一次 AABB', () => {
    const getAABB = vi.fn(() => null);
    const { tools, store } = createTools(getAABB);
    store.addCloudAnnotation(makeCloud({ selectionBbox: undefined }));
    tools.syncFromStore();

    const afterSync = getAABB.mock.calls.length;
    tools.debugCloudOutlines();
    tools.debugCloudOutlines();

    expect(getAABB.mock.calls.length).toBe(afterSync);
  });

  it('目标可解析时用实时 AABB，而不是创建时的旧快照', () => {
    const { tools, store } = createTools(() => [10, 10, 10, 12, 12, 12]);
    store.addCloudAnnotation(makeCloud({
      selectionBbox: { min: [0, 0, 0], max: [1, 1, 1] },
    }));
    tools.syncFromStore();

    expect(tools.debugCloudOutlines()[0]?.selectionBbox).toEqual({ min: [10, 10, 10], max: [12, 12, 12] });
  });

  it('目标解析不到时退回记录里的快照，不倒退成无框', () => {
    const { tools, store } = createTools(() => null);
    store.addCloudAnnotation(makeCloud({
      selectionBbox: { min: [0, 0, 0], max: [1, 1, 1] },
    }));
    tools.syncFromStore();

    expect(tools.debugCloudOutlines()[0]?.selectionBbox).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });
});

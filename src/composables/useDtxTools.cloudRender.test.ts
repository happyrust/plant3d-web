import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';

import { BoxGeometry, Matrix4, PerspectiveCamera, Vector3 } from 'three';

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

import { resetCloudRenderFlagCache, setCloudRenderFlag } from './useCloudRenderFlags';
import { createDefaultCloudLabelLayoutV1, useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

import { DTXLayer } from '@/utils/three/dtx';

/**
 * P1 验收（2026-09-14 方案 §11 / §12.1）：
 * - `cloudDirtyCache`：全部依赖静止时，投影 / 轮廓构建 / setPoints / 文字框排版计数零增量；相机一动才重建；开关关掉恢复每帧重建。
 * - `cloudLabelLayoutV1`：带 `labelLayoutV1` 的记录按屏幕像素意图定位文字框、引线取最近点对；旧记录仍走世界点布局；拖动提交意图偏移并双写 leaderEndWorldPos。
 */

const TARGET_REFNO = '24381_145019';
const TARGET_AABB = [-2, -1, -1, 2, 1, 1];

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

function createTools() {
  const store = useToolStore();
  const canvas = createCanvasStub();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(overlay);

  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true },
      camera,
      canvas,
    } as any),
    dtxLayerRef: shallowRef<DTXLayer | null>(createReadyLayer()),
    selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene: { getAABB: vi.fn(() => TARGET_AABB) } } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay, camera };
}

function makeCloud(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorWorldPos: [0, 0, 0],
    leaderEndWorldPos: [3, 3, 0],
    visible: true,
    title: '云线批注 1',
    description: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function pointerAt(x: number, y: number): PointerEvent {
  return { button: 0, clientX: x, clientY: y, pointerId: 1 } as PointerEvent;
}

/** 本测试环境没有 localStorage 全局；开关的 localStorage 覆盖走一个内存实现 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
  resetCloudRenderFlagCache();
  const store = useToolStore();
  store.clearAll();
  store.setToolMode('none');
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  document.body.innerHTML = '';
});

describe('cloudDirtyCache · 静止零重建', () => {
  it('相机 / 视口 / 目标 / 样式都不变时，120 帧内轮廓构建、setPoints、文字框排版计数为零；相机一动才重建一次', () => {
    const { tools, store, camera } = createTools();
    store.addCloudAnnotation(makeCloud({ labelLayoutV1: createDefaultCloudLabelLayoutV1() }));
    store.addCloudAnnotation(makeCloud({ id: 'cloud-legacy', title: '旧布局' }));
    tools.syncFromStore();

    tools.updateOverlayPositions(); // 预热帧：首帧全脏
    const warm = tools.debugCloudRenderStats();
    expect(warm.contourBuilds).toBe(2);
    expect(warm.setPoints).toBe(2);
    expect(warm.labelLayouts).toBe(1);
    expect(warm.paintUpdates).toBe(2);

    tools.resetCloudRenderStats();
    for (let i = 0; i < 120; i++) tools.updateOverlayPositions();
    expect(tools.debugCloudRenderStats()).toEqual({ frames: 120, contourBuilds: 0, setPoints: 0, labelLayouts: 0, paintUpdates: 0, lodPlans: 0, inspectionRays: 0 });

    camera.position.x += 0.5;
    camera.updateMatrixWorld(true);
    tools.resetCloudRenderStats();
    tools.updateOverlayPositions();
    tools.updateOverlayPositions();
    const moved = tools.debugCloudRenderStats();
    expect(moved.contourBuilds).toBe(2);
    expect(moved.setPoints).toBe(2);
    expect(moved.labelLayouts).toBe(1);
    expect(moved.paintUpdates).toBe(0);
  });

  it('关掉 cloudDirtyCache 回到每帧重建', () => {
    setCloudRenderFlag('cloudDirtyCache', false);
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeCloud());
    tools.syncFromStore();

    tools.updateOverlayPositions();
    tools.resetCloudRenderStats();
    for (let i = 0; i < 10; i++) tools.updateOverlayPositions();
    const stats = tools.debugCloudRenderStats();
    expect(stats.contourBuilds).toBe(10);
    expect(stats.setPoints).toBe(10);
    expect(stats.paintUpdates).toBe(10);
  });

  it('记录变化（标题编辑）只重排文字框，不重建轮廓；样式颜色变化只更新材质', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeCloud({ labelLayoutV1: createDefaultCloudLabelLayoutV1() }));
    tools.syncFromStore();
    tools.updateOverlayPositions();

    // 直接改 cloudShapes 里的 record 引用等价于 store 更新后 syncFromStore 前的状态：这里用 store 更新 + 再同步
    store.updateCloudAnnotation('cloud-1', { labelLayoutV1: { ...createDefaultCloudLabelLayoutV1(), offsetPx: { x: 40, y: 10 } } });
    tools.syncFromStore();
    tools.updateOverlayPositions(); // 重建后的首帧全脏（新 cloudShapes 实例）
    tools.resetCloudRenderStats();
    for (let i = 0; i < 5; i++) tools.updateOverlayPositions();
    expect(tools.debugCloudRenderStats().contourBuilds).toBe(0);
    expect(tools.debugCloudLabelLayouts()[0]?.layout?.rect.x).toBeCloseTo(
      tools.debugCloudLabelLayouts()[0]!.frame!.referenceBounds.x + tools.debugCloudLabelLayouts()[0]!.frame!.referenceBounds.width + 40,
      6,
    );
  });
});

describe('cloudLabelLayoutV1 · 文字框与引线', () => {
  it('带 labelLayoutV1 的记录：文字框左上角 = 参考框右上角 + 意图偏移，DOM 直接定位（transform none），引线从参考框右边到文字框左边', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeCloud({ labelLayoutV1: createDefaultCloudLabelLayoutV1() }));
    tools.syncFromStore();
    tools.updateOverlayPositions();

    const [info] = tools.debugCloudLabelLayouts();
    expect(info?.layoutMode).toBe('v1');
    const bounds = info!.frame!.referenceBounds;
    expect(info!.layout!.rect.x).toBeCloseTo(bounds.x + bounds.width + 18, 6);
    expect(info!.layout!.rect.y).toBeCloseTo(bounds.y, 6);
    // DOM 直接按布局结果定位（happy-dom 会把 CSS 长度四舍五入到 6 位小数，按数值比）
    expect(Number.parseFloat(info!.labelLeft)).toBeCloseTo(info!.layout!.rect.x, 4);
    expect(Number.parseFloat(info!.labelTop)).toBeCloseTo(info!.layout!.rect.y, 4);
    expect(info!.layout!.leader).toEqual({
      start: { x: bounds.x + bounds.width, y: bounds.y },
      end: { x: info!.layout!.rect.x, y: bounds.y },
    });
    expect(info!.leaderVisible).toBe(true);
  });

  it('没有 labelLayoutV1 的旧记录仍按 leaderEndWorldPos 世界点投影定位', () => {
    const { tools, store, camera } = createTools();
    store.addCloudAnnotation(makeCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();

    const [info] = tools.debugCloudLabelLayouts();
    expect(info?.layoutMode).toBe('legacy');
    expect(info?.layout).toBeNull();
    // 旧布局：文字框 DOM 由通用循环按 leaderEndWorldPos 投影定位
    const projected = new Vector3(3, 3, 0).project(camera);
    expect(Number.parseFloat(info!.labelLeft)).toBeCloseTo((projected.x * 0.5 + 0.5) * 800, 4);
    expect(Number.parseFloat(info!.labelTop)).toBeCloseTo((-projected.y * 0.5 + 0.5) * 600, 4);
  });

  it('关掉 cloudLabelLayoutV1：带 labelLayoutV1 的记录也回到旧布局', () => {
    setCloudRenderFlag('cloudLabelLayoutV1', false);
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeCloud({ labelLayoutV1: createDefaultCloudLabelLayoutV1() }));
    tools.syncFromStore();
    tools.updateOverlayPositions();
    expect(tools.debugCloudLabelLayouts()[0]?.layoutMode).toBe('legacy');
  });

  it('拖动文字框松手：提交相对参考框锚点的意图偏移到 labelLayoutV1，并双写 leaderEndWorldPos；旧记录第一次拖动即升级', () => {
    const { tools, store, overlay } = createTools();
    store.addCloudAnnotation(makeCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const before = store.cloudAnnotations.value[0]!;
    expect(before.labelLayoutV1).toBeNull();

    const label = overlay.querySelector('[data-role="annotation-drag-handle"]')?.parentElement as HTMLElement;
    label.getBoundingClientRect = () => ({ left: 500, top: 100, width: 240, height: 96, right: 740, bottom: 196, x: 500, y: 100, toJSON: () => ({}) }) as DOMRect;

    tools.beginInlineOverlayAnnotationDrag('cloud', 'cloud-1', pointerAt(510, 110), new Vector3(3, 3, 0), new Vector3(0, 0, 0));
    tools.continueInlineOverlayAnnotationDrag(pointerAt(610, 160));
    const dragging = tools.debugCloudLabelLayouts()[0]!;
    expect(dragging.layoutMode).toBe('v1');
    tools.endInlineOverlayAnnotationDrag(pointerAt(610, 160));

    const after = store.cloudAnnotations.value[0]!;
    expect(after.labelLayoutV1).toMatchObject({ version: 1, anchor: { kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left' } });
    // 松手位置 = 拖动中布局出来的矩形左上角 (600, 150) 相对参考框右上角的偏移
    const bounds = dragging.frame!.referenceBounds;
    expect(after.labelLayoutV1!.offsetPx.x).toBeCloseTo(dragging.layout!.rect.x - (bounds.x + bounds.width), 2);
    expect(after.labelLayoutV1!.offsetPx.y).toBeCloseTo(dragging.layout!.rect.y - bounds.y, 2);
    expect(after.leaderEndWorldPos).not.toEqual(before.leaderEndWorldPos);
    expect(after.leaderEndWorldPos?.every((v) => Number.isFinite(v))).toBe(true);
  });
});

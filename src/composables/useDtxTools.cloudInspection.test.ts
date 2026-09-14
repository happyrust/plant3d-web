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

import { useAnnotationStyleStore } from './useAnnotationStyleStore';
import { resetCloudRenderFlagCache, setCloudRenderFlag } from './useCloudRenderFlags';
import { buildAnnotationLeaderStyle, createDefaultCloudLabelLayoutV1, useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

import { SOLVESPACE_DIMENSION_THEME } from '@/dimension';
import { createRegionCloudPresentationV1, type RegionV1 } from '@/review/domain/cloudRegion';
import { DTXLayer } from '@/utils/three/dtx';

/**
 * P4 inspection 遮挡淡化验收（2026-09-14 方案 §10，开关 `cloudInspectionFade`）：
 * - 默认置顶：一条射线都不打、因子 1、材质透明度 = 样式值。
 * - 检视模式（与尺寸面板同一口径 `mbd_mode=inspection`，测试用覆盖）：相机 → 成员表面之间有别的可见几何 → 全部样本 blocked →
 *   轮廓 / 盒边 / 小针 / 引线淡到 `theme.inspection.occludedAlpha`（0.35）；文字框 DOM 不动。挡板不在 → clear → 1；
 *   射线打不到成员 → unknown → 1（不冒充「被挡住」）；激活 / 悬停 → 不探、不淡。
 * - 相机 / 模型没变不再打射线；相机动了、停下（settle 120 ms）后再探一遍；回到置顶因子立刻回 1。
 */

const TARGET_REFNO = '24381_145019';
const BLOCKER_REFNO = '24381_777';
const IDENTITY = new Matrix4().elements.slice();

function createLayer(options: { blocker?: 'front' | 'aside' | 'none' } = {}): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 8192, maxIndices: 8192, maxObjects: 16 });
  layer.addGeometry('unit', new BoxGeometry(1, 1, 1));
  layer.addGeometry('slab', new BoxGeometry(6, 6, 1));
  layer.addObject(`o:${TARGET_REFNO}:0`, 'unit', new Matrix4());
  const blocker = options.blocker ?? 'front';
  if (blocker === 'front') layer.addObject(`o:${BLOCKER_REFNO}:0`, 'slab', new Matrix4().makeTranslation(0, 0, 10));
  if (blocker === 'aside') layer.addObject(`o:${BLOCKER_REFNO}:0`, 'slab', new Matrix4().makeTranslation(20, 0, 10));
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

function createTools(layer: DTXLayer = createLayer()) {
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

  const getAABB = vi.fn((_refnos: string[]) => [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true, target: new Vector3(0, 0, 0) },
      camera,
      canvas,
    } as any),
    dtxLayerRef: shallowRef<DTXLayer | null>(layer),
    selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene: { getAABB }, cameraFlight: { flyTo: vi.fn() } } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay, camera, layer, getAABB };
}

function makeRegion(center: [number, number, number] = [0, 0, 0]): RegionV1 {
  return {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: IDENTITY, coordinateFrameId: null },
    origin: 'members',
    kind: 'obb-union',
    boxes: [{ id: `o:${TARGET_REFNO}:0`, memberRefno: TARGET_REFNO, center, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.5, 0.5, 0.5] }],
  };
}

function makeCloud(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-i1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorWorldPos: [0, 0, 0.5],
    leaderEndWorldPos: [3, 3, 0],
    selectionBbox: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    visible: true,
    title: '检视云线',
    description: '',
    createdAt: 1_700_000_000_000,
    regionV1: makeRegion(),
    presentationV1: createRegionCloudPresentationV1(),
    labelLayoutV1: createDefaultCloudLabelLayoutV1(),
    ...overrides,
  };
}

function seedOne(store: ReturnType<typeof useToolStore>, record: CloudAnnotationRecord = makeCloud()): void {
  store.addCloudAnnotation(record);
  // addCloudAnnotation 会把它设成激活 + 待编辑（= 强调，inspection 不淡）；测试里显式清掉
  store.activeCloudAnnotationId.value = null;
  store.pendingCloudAnnotationEditId.value = null;
}

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

const OCCLUDED = SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha;

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
  resetCloudRenderFlagCache();
  const store = useToolStore();
  store.clearAll();
  store.clearCloudTargetRefnos();
  store.setToolMode('none');
  useAnnotationStyleStore().setCloudDrawMode('screen2d');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  document.body.innerHTML = '';
});

describe('cloudInspectionFade · 置顶（默认）', () => {
  it('默认显示模式是置顶：120 帧零射线、因子 1、轮廓透明度 = 样式值', () => {
    const { tools, store } = createTools();
    seedOne(store);
    tools.syncFromStore();
    tools.resetCloudRenderStats();
    for (let i = 0; i < 120; i++) tools.updateOverlayPositions();
    const snap = tools.debugCloudInspection();
    expect(snap.mode).toBe('always-on-top');
    expect(snap.pending).toBe(false);
    expect(snap.items[0]).toMatchObject({ factor: 1, probes: [], key: '' });
    expect(snap.items[0]!.outlineOpacity).toBeCloseTo(useAnnotationStyleStore().style.cloud.opacity, 9);
    expect(tools.debugCloudRenderStats().inspectionRays).toBe(0);
  });

  it('开关 cloudInspectionFade 关掉：即便覆盖成检视模式也按置顶处理、零射线', () => {
    setCloudRenderFlag('cloudInspectionFade', false);
    const { tools, store } = createTools();
    seedOne(store);
    tools.syncFromStore();
    tools.setCloudInspectionMode('inspection');
    tools.runCloudInspectionNow();
    expect(tools.debugCloudInspection().mode).toBe('always-on-top');
    expect(tools.debugCloudInspection().items[0]!.factor).toBe(1);
    expect(tools.debugCloudRenderStats().inspectionRays).toBe(0);
  });
});

describe('cloudInspectionFade · 检视模式', () => {
  it('挡板在相机与成员之间：样本 blocked → 轮廓 / 引线淡到 occludedAlpha；文字框 DOM 不淡；静止不再打射线；回到置顶立刻回 1', () => {
    const { tools, store, overlay } = createTools(createLayer({ blocker: 'front' }));
    seedOne(store);
    tools.syncFromStore();
    tools.resetCloudRenderStats();
    tools.setCloudInspectionMode('inspection');
    tools.runCloudInspectionNow();

    const style = useAnnotationStyleStore().style.cloud;
    const snap = tools.debugCloudInspection();
    expect(snap.mode).toBe('inspection');
    expect(snap.items[0]!.probes).toEqual(['blocked']);
    expect(snap.items[0]!.factor).toBe(OCCLUDED);
    expect(snap.items[0]!.outlineOpacity).toBeCloseTo(style.opacity * OCCLUDED, 9);
    expect(snap.items[0]!.leaderOpacity).toBeCloseTo(buildAnnotationLeaderStyle('cloud').opacity * OCCLUDED, 9);
    const rays = tools.debugCloudRenderStats().inspectionRays;
    expect(rays).toBeGreaterThan(0);
    // 文字框 DOM 照常可读
    const labelEl = overlay.querySelector('.dtx-anno-label') as HTMLElement;
    expect(labelEl.style.opacity).toBe('1');

    // 相机 / 模型 / 记录没变：再跑 120 帧 + 再探一次都不打射线
    for (let i = 0; i < 120; i++) tools.updateOverlayPositions();
    tools.runCloudInspectionNow();
    expect(tools.debugCloudRenderStats().inspectionRays).toBe(rays);
    expect(tools.debugCloudInspection().pending).toBe(false);

    // 回到置顶（跟随 URL，默认 engineering）：因子与透明度立刻回 1
    tools.setCloudInspectionMode(null);
    const back = tools.debugCloudInspection();
    expect(back.mode).toBe('always-on-top');
    expect(back.items[0]!.factor).toBe(1);
    expect(back.items[0]!.outlineOpacity).toBeCloseTo(style.opacity, 9);
  });

  it('挡板挪开 → clear → 因子 1；射线打不到成员（范围体中心指向空处）→ unknown → 因子 1，不冒充被挡', () => {
    const clear = createTools(createLayer({ blocker: 'aside' }));
    seedOne(clear.store);
    clear.tools.syncFromStore();
    clear.tools.setCloudInspectionMode('inspection');
    clear.tools.runCloudInspectionNow();
    expect(clear.tools.debugCloudInspection().items[0]).toMatchObject({ probes: ['clear'], factor: 1 });
    expect(clear.tools.debugCloudRenderStats().inspectionRays).toBeGreaterThan(0);
    clear.tools.dispose();
    clear.store.clearAll();
    document.body.innerHTML = '';

    const miss = createTools(createLayer({ blocker: 'front' }));
    seedOne(miss.store, makeCloud({ regionV1: makeRegion([6, 0, 0]) }));
    miss.tools.syncFromStore();
    miss.tools.setCloudInspectionMode('inspection');
    miss.tools.runCloudInspectionNow();
    expect(miss.tools.debugCloudInspection().items[0]).toMatchObject({ probes: ['unknown'], factor: 1 });
  });

  it('激活 / 悬停的云线不探也不淡（零射线、因子 1）；取消强调后才探', () => {
    const { tools, store } = createTools(createLayer({ blocker: 'front' }));
    seedOne(store);
    store.activeCloudAnnotationId.value = 'cloud-i1';
    tools.syncFromStore();
    tools.resetCloudRenderStats();
    tools.setCloudInspectionMode('inspection');
    tools.runCloudInspectionNow();
    expect(tools.debugCloudInspection().items[0]).toMatchObject({ factor: 1, probes: [] });
    expect(tools.debugCloudRenderStats().inspectionRays).toBe(0);

    store.activeCloudAnnotationId.value = null;
    tools.setHoveredCloudAnnotation('cloud-i1');
    tools.runCloudInspectionNow();
    expect(tools.debugCloudInspection().items[0]!.factor).toBe(1);
    expect(tools.debugCloudRenderStats().inspectionRays).toBe(0);

    tools.setHoveredCloudAnnotation(null);
    tools.runCloudInspectionNow();
    expect(tools.debugCloudInspection().items[0]).toMatchObject({ factor: OCCLUDED, probes: ['blocked'] });
    expect(tools.debugCloudRenderStats().inspectionRays).toBeGreaterThan(0);
  });

  it('相机停下 120 ms 后自动探（settle 定时器）；相机一动挡板不在射线上 → 重探回 1', () => {
    vi.useFakeTimers();
    const { tools, store, camera } = createTools(createLayer({ blocker: 'front' }));
    seedOne(store);
    tools.syncFromStore();
    tools.setCloudInspectionMode('inspection');
    tools.updateOverlayPositions();
    expect(tools.debugCloudInspection().pending).toBe(true);
    expect(tools.debugCloudInspection().items[0]!.factor).toBe(1);

    vi.advanceTimersByTime(150);
    tools.updateOverlayPositions(); // requestRender 为空，测试里自己补一帧让 paint 刷进材质
    expect(tools.debugCloudInspection().items[0]).toMatchObject({ factor: OCCLUDED, probes: ['blocked'] });
    const rays = tools.debugCloudRenderStats().inspectionRays;

    // 相机绕到侧面：挡板（z=10 的平板）不再挡在相机与成员之间
    camera.position.set(20, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    expect(tools.debugCloudInspection().pending).toBe(true);
    vi.advanceTimersByTime(150);
    tools.updateOverlayPositions();
    expect(tools.debugCloudInspection().items[0]).toMatchObject({ factor: 1, probes: ['clear'] });
    expect(tools.debugCloudRenderStats().inspectionRays).toBeGreaterThan(rays);
  });

  it('旧记录（legacy-v0，无范围体）：以目标合并 AABB 中心为探测点、成员 refno 作 subject，同样能判 blocked', () => {
    const { tools, store } = createTools(createLayer({ blocker: 'front' }));
    seedOne(store, makeCloud({ regionV1: undefined, presentationV1: undefined, labelLayoutV1: undefined }));
    tools.syncFromStore();
    tools.setCloudInspectionMode('inspection');
    tools.runCloudInspectionNow();
    expect(tools.debugCloudInspection().items[0]).toMatchObject({ factor: OCCLUDED, probes: ['blocked'] });
    expect(store.cloudAnnotations.value[0]!.presentationV1?.algorithm).toBe('legacy-v0');
  });
});

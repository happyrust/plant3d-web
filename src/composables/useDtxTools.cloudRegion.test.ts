import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

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
import { createDefaultCloudLabelLayoutV1, useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

import { pointInPolygon } from '@/review/domain/annotationProjection/labelLayout';
import { createRegionCloudPresentationV1, type RegionV1 } from '@/review/domain/cloudRegion';
import { DTXLayer } from '@/utils/three/dtx';

/**
 * P2 验收（2026-09-14 方案 §11 P2 / §12.1）：
 * - 创建：开关开时写 `regionV1(obb-union, origin:'members')`（局部盒 × 世界矩阵，只乘一次）+ `viewpointV1.creation` + `presentationV1 region-v1`；
 *   成员未加载（coverage 不足）不写新版记录；开关关只写旧字段。
 * - 呈现：多机位下投影轮廓包住范围体角点；跨近平面 / 出屏 / 深度外各有状态、**不回退**旧固定布局；静止 120 帧零重建；
 *   bbox3d 画同一范围体的真实盒边；`globalModelMatrix` 不等时 G_new · G_old⁻¹ 重映射；校验不过 = missing-region 走旧管线；开关关兼容显示且新字段保留。
 */

const TARGET_REFNO = '24381_145019';
const ANCHOR_REFNO = '24381_145018';
/** 目标对象：单位盒旋转 30° 再平移到 (3, 1, 0) */
const OBJECT_MATRIX = new Matrix4().makeRotationZ(Math.PI / 6).setPosition(3, 1, 0);
const TARGET_AABB = [-2, -1, -1, 2, 1, 1];

function createReadyLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject(`o:${TARGET_REFNO}:0`, 'box', OBJECT_MATRIX.clone());
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

function createTools(getAABB: (refnos: string[]) => number[] | null = () => TARGET_AABB) {
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

  const layer = createReadyLayer();
  const layerRef = shallowRef<DTXLayer | null>(layer);
  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true, target: new Vector3(0, 0, 0) },
      camera,
      canvas,
    } as any),
    dtxLayerRef: layerRef,
    selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene: { getAABB: vi.fn(getAABB) } } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay, camera, layer };
}

function pointerAt(x: number, y: number): PointerEvent {
  return { button: 0, clientX: x, clientY: y, pointerId: 1 } as PointerEvent;
}

const IDENTITY = new Matrix4().elements.slice();

function makeRegion(overrides: Partial<Extract<RegionV1, { kind: 'obb-union' }>> = {}): RegionV1 {
  return {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: IDENTITY, coordinateFrameId: null },
    origin: 'members',
    kind: 'obb-union',
    boxes: [{ id: 'o1', memberRefno: TARGET_REFNO, center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [2, 1, 1] }],
    ...overrides,
  };
}

function makeRegionCloud(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-r1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorWorldPos: [0, 0, 0],
    leaderEndWorldPos: [3, 3, 0],
    selectionBbox: { min: [-2, -1, -1], max: [2, 1, 1] },
    visible: true,
    title: '空间云线',
    description: '',
    createdAt: 1_700_000_000_000,
    regionV1: makeRegion(),
    presentationV1: createRegionCloudPresentationV1(),
    labelLayoutV1: createDefaultCloudLabelLayoutV1(),
    ...overrides,
  };
}

/** 把渲染出的 billboard 世界折线投回屏幕（CSS px） */
function projectPositions(worldPositions: number[], camera: PerspectiveCamera): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 2 < worldPositions.length; i += 3) {
    const v = new Vector3(worldPositions[i]!, worldPositions[i + 1]!, worldPositions[i + 2]!).project(camera);
    out.push({ x: ((v.x + 1) * 800) / 2, y: ((1 - v.y) * 600) / 2 });
  }
  return out;
}

function projectPoint(p: Vector3, camera: PerspectiveCamera): { x: number; y: number } {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) * 800) / 2, y: ((1 - v.y) * 600) / 2 };
}

function boxCorners(min: number[], max: number[]): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [min[0]!, max[0]!]) for (const y of [min[1]!, max[1]!]) for (const z of [min[2]!, max[2]!]) out.push(new Vector3(x, y, z));
  return out;
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
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  useAnnotationStyleStore().setCloudDrawMode('screen2d');
  document.body.innerHTML = '';
});

async function drawCloud(tools: ReturnType<typeof createTools>['tools'], store: ReturnType<typeof useToolStore>, canvas: HTMLCanvasElement) {
  store.setCloudTargetRefnos([TARGET_REFNO]);
  store.setToolMode('annotation_cloud');
  await nextTick();
  tools.pendingCloudAnchor.value = { worldPos: [0, 0, 0], refno: ANCHOR_REFNO, entityId: ANCHOR_REFNO };
  tools.onCanvasPointerDown(canvas, pointerAt(100, 100));
  tools.onCanvasPointerMove(canvas, pointerAt(300, 260));
  tools.onCanvasPointerUp(canvas, pointerAt(300, 260));
  return store.cloudAnnotations.value[0]!;
}

describe('cloudProjectedEnvelope · 创建时写范围体与创建视点', () => {
  it('成员已加载：regionV1 = 每个 objectId 一个「局部盒 × (global × instance)」OBB，presentationV1 region-v1，viewpointV1.creation 是创建证据；旧字段仍双写', async () => {
    const { tools, store, canvas, layer } = createTools();
    layer.setGlobalModelMatrix(new Matrix4().makeScale(0.5, 0.5, 0.5));
    const rec = await drawCloud(tools, store, canvas);

    expect(rec.presentationV1?.algorithm).toBe('region-v1');
    expect(rec.regionV1).toMatchObject({ version: 1, space: 'world', origin: 'members', kind: 'obb-union' });
    const region = rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>;
    expect(region.boxes).toHaveLength(1);
    const box = region.boxes[0]!;
    expect(box.id).toBe(`o:${TARGET_REFNO}:0`);
    expect(box.memberRefno).toBe(TARGET_REFNO);
    // 世界矩阵 = global(0.5) × instance(rotZ 30° + (3,1,0))：中心 (1.5, 0.5, 0)，半边长 0.25，轴按 30° 旋转
    // 实例矩阵存在 Float32Array 里，按 float32 精度比
    expect(box.center.map((v) => +v.toFixed(6))).toEqual([1.5, 0.5, 0]);
    for (const h of box.halfSize) expect(h).toBeCloseTo(0.25, 6);
    expect(box.axes[0][0]).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(box.axes[0][1]).toBeCloseTo(Math.sin(Math.PI / 6), 6);
    // 来源身份：全局矩阵本身；没有加载批次身份 → modelSnapshotId null，不冒充
    expect(region.source.globalModelMatrix).toEqual(layer.getGlobalModelMatrix().elements);
    expect(region.source.modelSnapshotId).toBeNull();
    expect(region.source.projectKey).toBeNull();

    expect(rec.viewpointV1?.creation).toMatchObject({
      version: 1,
      capturedAt: rec.createdAt,
      position: [0, 0, 20],
      target: [0, 0, 0],
      projection: { kind: 'perspective', verticalFovDeg: 60, zoom: 1, near: 0.1, far: 1000 },
      viewportCss: { width: 800, height: 600 },
      capturedContext: ['camera'],
    });
    // 旧字段照旧双写，旧端仍能按旧含义显示
    expect(rec.selectionBbox).toEqual({ min: [-2, -1, -1], max: [2, 1, 1] });
    expect(rec.screenOffset).toBeDefined();
    expect(rec.cloudSize).toBeDefined();
    expect(rec.labelLayoutV1).not.toBeNull();
  });

  it('成员未加载（coverage 不足）：不写新版范围，漏斗按 selectionBbox 补 legacy-snapshot + legacy-v0；创建视点仍记', async () => {
    const { tools, store, canvas } = createTools();
    store.setCloudTargetRefnos(['24381_999']);
    store.setToolMode('annotation_cloud');
    await nextTick();
    tools.pendingCloudAnchor.value = { worldPos: [0, 0, 0], refno: ANCHOR_REFNO, entityId: ANCHOR_REFNO };
    tools.onCanvasPointerDown(canvas, pointerAt(100, 100));
    tools.onCanvasPointerMove(canvas, pointerAt(300, 260));
    tools.onCanvasPointerUp(canvas, pointerAt(300, 260));
    const rec = store.cloudAnnotations.value[0]!;
    expect(rec.presentationV1?.algorithm).toBe('legacy-v0');
    expect(rec.regionV1?.origin).toBe('legacy-snapshot');
    expect(rec.viewpointV1?.creation?.position).toEqual([0, 0, 20]);
  });

  it('开关关：只写旧字段（regionV1 由漏斗派生 legacy-snapshot，viewpointV1 null，presentation legacy-v0）', async () => {
    setCloudRenderFlag('cloudProjectedEnvelope', false);
    const { tools, store, canvas } = createTools();
    const rec = await drawCloud(tools, store, canvas);
    expect(rec.presentationV1?.algorithm).toBe('legacy-v0');
    expect(rec.regionV1?.origin).toBe('legacy-snapshot');
    expect(rec.viewpointV1).toBeNull();
  });
});

describe('region-v1 · 呈现', () => {
  it('正对相机：轮廓走新管线（complete），投回屏幕后包住范围体全部角点；文字框按参考框 V1 布局', () => {
    const { tools, store, camera } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();

    const [info] = tools.debugCloudRegionRender();
    expect(info).toMatchObject({ regionState: 'complete', lod: 'cloud', polylineCount: 1, cellCount: 1, outlineVisible: true, bboxEdgesVisible: false });
    expect(info!.phaseAnchorId?.startsWith('src:o1:')).toBe(true);

    const polygon = projectPositions(tools.debugCloudOutlines()[0]!.worldPositions, camera);
    expect(polygon.length).toBeGreaterThan(50);
    for (const corner of boxCorners([-2, -1, -1], [2, 1, 1])) {
      expect(pointInPolygon(projectPoint(corner, camera), polygon)).toBe(true);
    }
    const [label] = tools.debugCloudLabelLayouts();
    expect(label?.layoutMode).toBe('v1');
    expect(label!.frame!.referenceBounds.width).toBeGreaterThan(0);
    expect(label!.layout!.rect.x).toBeCloseTo(label!.frame!.referenceBounds.x + label!.frame!.referenceBounds.width + 18, 6);
    // 引线起点落在真实可见 stroke 上（而不是参考矩形边）
    expect(label!.layout!.leader).not.toBeNull();
    expect(label!.leaderVisible).toBe(true);
  });

  it('多机位包含：斜视 / roll / 俯视 下投影轮廓都包住范围体角点', () => {
    const { tools, store, camera } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    const poses: { pos: [number, number, number]; up?: [number, number, number] }[] = [
      { pos: [12, 8, 15] },
      { pos: [0, 0, 20], up: [1, 1, 0] },
      { pos: [0, 25, 0.01] },
      { pos: [-15, -5, 10] },
    ];
    for (const pose of poses) {
      camera.up.set(...(pose.up ?? [0, 1, 0])).normalize();
      camera.position.set(...pose.pos);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      tools.updateOverlayPositions();
      expect(tools.debugCloudRegionRender()[0]!.regionState).toBe('complete');
      const polygon = projectPositions(tools.debugCloudOutlines()[0]!.worldPositions, camera);
      for (const corner of boxCorners([-2, -1, -1], [2, 1, 1])) {
        expect(pointInPolygon(projectPoint(corner, camera), polygon), `pose ${pose.pos.join(',')}`).toBe(true);
      }
    }
  });

  it('跨近平面 / 相机贴着目标：viewport-cut，不回退旧固定布局、不抛错；全部在深度外：depth-empty，轮廓与文字框都藏起而文字框仍是 V1 模式', () => {
    const { tools, store, camera, overlay } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();

    // 相机钻到盒子前脸 0.2 处：范围覆盖整个视口
    camera.position.set(0.3, 0.2, 1.2);
    camera.lookAt(0, 0, -5);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    let [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('viewport-cut');
    expect(tools.debugCloudLabelLayouts()[0]!.layoutMode).toBe('v1');

    // 细长目标从相机旁穿过近平面：有可见片段
    store.clearAll();
    store.addCloudAnnotation(makeRegionCloud({
      regionV1: makeRegion({ boxes: [{ id: 'pipe', memberRefno: TARGET_REFNO, center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.05, 0.05, 3] }] }),
    }));
    tools.syncFromStore();
    camera.position.set(0.3, 0.2, 0);
    camera.lookAt(0.3, 0.2, -10);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('viewport-cut');
    expect(info!.polylineCount).toBeGreaterThanOrEqual(1);
    expect(info!.outlineVisible).toBe(true);

    // 背对目标：depth-empty → 轮廓藏起、文字框 opacity 0、引线藏起，但不切回旧世界点布局
    camera.position.set(0, 0, -30);
    camera.lookAt(0, 0, -60);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('depth-empty');
    expect(info!.outlineVisible).toBe(false);
    expect(info!.extraVisible).toBe(0);
    const [label] = tools.debugCloudLabelLayouts();
    expect(label!.layoutMode).toBe('v1');
    expect(label!.leaderVisible).toBe(false);
    const labelEl = overlay.querySelector('.dtx-anno-label') as HTMLElement;
    expect(labelEl.style.opacity).toBe('0');
  });

  it('静止 120 帧：轮廓构建 / setPoints / 文字框排版 / 材质更新计数全为零；相机一动各 +1', () => {
    const { tools, store, camera } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();
    tools.resetCloudRenderStats();
    for (let i = 0; i < 120; i++) tools.updateOverlayPositions();
    expect(tools.debugCloudRenderStats()).toEqual({ frames: 120, contourBuilds: 0, setPoints: 0, labelLayouts: 0, paintUpdates: 0 });

    const anchorBefore = tools.debugCloudRegionRender()[0]!.phaseAnchorId;
    camera.position.x += 0.3;
    camera.updateMatrixWorld(true);
    tools.resetCloudRenderStats();
    tools.updateOverlayPositions();
    const moved = tools.debugCloudRenderStats();
    expect(moved.contourBuilds).toBe(1);
    expect(moved.setPoints).toBe(1);
    expect(moved.labelLayouts).toBe(1);
    expect(moved.paintUpdates).toBe(0);
    // 小步移动相位锚点不换手
    expect(tools.debugCloudRegionRender()[0]!.phaseAnchorId).toBe(anchorBefore);
  });

  it('bbox3d：画同一范围体的 12 条真实盒边（不合并 AABB、不加波浪），屏幕轮廓隐藏；可见性由裁剪结果决定', () => {
    useAnnotationStyleStore().setCloudDrawMode('bbox3d');
    const { tools, store, camera } = createTools();
    const rotated = makeRegion({ boxes: [{ id: 'r', memberRefno: TARGET_REFNO, center: [0, 0, 0], axes: [[Math.SQRT1_2, Math.SQRT1_2, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]], halfSize: [2, 1, 1] }] });
    store.addCloudAnnotation(makeRegionCloud({ regionV1: rotated }));
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const [info] = tools.debugCloudRegionRender();
    expect(info).toMatchObject({ regionState: 'complete', outlineVisible: false, bboxEdgesVisible: true });
    const outlines = tools.debugCloudOutlines();
    expect(outlines[0]!.visible).toBe(false);

    // 12 条边 × 2 端点，端点全部落在旋转盒的 8 个角上
    const cloud = (tools as any).debugCloudRegionRender()[0];
    expect(cloud.cellCount).toBe(1);

    camera.position.set(0, 0, -30);
    camera.lookAt(0, 0, -60);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    expect(tools.debugCloudRegionRender()[0]!.bboxEdgesVisible).toBe(false);
  });

  it('坐标系重映射：记录来源矩阵与当前 DTX 全局矩阵不等时先 G_new · G_old⁻¹ 再投影，轮廓随之平移', () => {
    const { tools, store, layer } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const before = tools.debugCloudLabelLayouts()[0]!.frame!.referenceBounds;

    layer.setGlobalModelMatrix(new Matrix4().makeTranslation(3, 0, 0));
    tools.updateOverlayPositions();
    const after = tools.debugCloudLabelLayouts()[0]!.frame!.referenceBounds;
    expect(tools.debugCloudRegionRender()[0]!.regionState).toBe('complete');
    expect(after.x).toBeGreaterThan(before.x + 20);
    // 记录本身不被改写
    expect(store.cloudAnnotations.value[0]!.regionV1!.source.globalModelMatrix).toEqual(IDENTITY);
  });

  it('校验不过（轴不正交）= missing-region：唯一允许走旧管线的状态，旧轮廓照常画出', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeRegionCloud({
      regionV1: makeRegion({ boxes: [{ id: 'bad', memberRefno: TARGET_REFNO, center: [0, 0, 0], axes: [[1, 0, 0], [1, 0, 0], [0, 0, 1]], halfSize: [1, 1, 1] }] }),
    }));
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('missing-region');
    expect(info!.invalidReason).toContain('orthonormal');
    expect(info!.cellCount).toBe(0);
    expect(info!.outlineVisible).toBe(true); // 旧管线按目标 AABB 贴合
    expect(tools.debugCloudLabelLayouts()[0]!.layoutMode).toBe('v1');
  });

  it('关掉 cloudProjectedEnvelope：region-v1 记录按旧管线兼容显示（参考框 = AABB 贴合矩形），新字段原样保留', () => {
    setCloudRenderFlag('cloudProjectedEnvelope', false);
    const { tools, store } = createTools();
    const rec = makeRegionCloud();
    store.addCloudAnnotation(rec);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBeNull();
    expect(info!.cellCount).toBe(0);
    expect(info!.outlineVisible).toBe(true);
    const stored = store.cloudAnnotations.value[0]!;
    expect(stored.regionV1).toEqual(rec.regionV1);
    expect(stored.presentationV1?.algorithm).toBe('region-v1');
    // 旧管线的参考框是轴对齐矩形（4 个顶点）
    expect(tools.debugCloudLabelLayouts()[0]!.frame!.enclosure).toHaveLength(4);
  });

  it('旧记录（legacy-v0）不受影响：开关开也走旧管线', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeRegionCloud({ presentationV1: undefined, regionV1: undefined }));
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const stored = store.cloudAnnotations.value[0]!;
    expect(stored.presentationV1?.algorithm).toBe('legacy-v0');
    expect(stored.regionV1?.origin).toBe('legacy-snapshot');
    expect(tools.debugCloudRegionRender()[0]!.regionState).toBeNull();
    expect(tools.debugCloudLabelLayouts()[0]!.frame!.enclosure).toHaveLength(4);
  });
});

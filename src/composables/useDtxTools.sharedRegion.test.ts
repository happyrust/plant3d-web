import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import { BoxGeometry, BufferGeometry, LineSegments, Matrix4, PerspectiveCamera, Vector3 } from 'three';

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
import { useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord, type RegionV1 } from './useToolStore';

import { createRegionCloudPresentationV1 } from '@/review/domain/cloudRegion';
import { DTXLayer } from '@/utils/three/dtx';

/**
 * P3 共享范围体（方案 §7 / §8 / §11 P3）适配层验收：
 * - rect / obb 新建走 primitiveFromPlacement：每成员对象一个真实放置盒写进 `regionV1(obb-union, members)`，`obb` 旧字段仍是合并 AABB；
 * - 线框按范围体画（多成员多盒），开关关 / 旧记录按 `obb.corners` 单盒；
 * - 重绑 member 走 store 注册的 resolver：范围体与绑定原子更新；新成员未加载 → 云线范围体不覆盖 → 走旧实时 AABB 贴合（missing-region），不用子集冒充。
 */

const REFNO_A = '24381_145019';
const REFNO_B = '24381_145020';
const REFNO_UNLOADED = '24381_145099';
const MATRIX_A = new Matrix4().makeRotationZ(Math.PI / 6).setPosition(3, 1, 0);
const MATRIX_B = new Matrix4().makeTranslation(-4, 0, 0);
const AABB_BY_REFNO: Record<string, number[]> = {
  [REFNO_A]: [2, 0, -0.5, 4, 2, 0.5],
  [REFNO_B]: [-4.5, -0.5, -0.5, -3.5, 0.5, 0.5],
};

function createReadyLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject(`o:${REFNO_A}:0`, 'box', MATRIX_A.clone());
  layer.addObject(`o:${REFNO_B}:0`, 'box', MATRIX_B.clone());
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

function createTools(pickHit: { objectId: string; point: Vector3 } | null = null) {
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

  const scene = {
    add: vi.fn(),
    remove: vi.fn(),
    getLoadedRefnos: vi.fn(() => Object.keys(AABB_BY_REFNO)),
    getAABB: vi.fn((refnos: string[]) => {
      const boxes = refnos.map((r) => AABB_BY_REFNO[r]).filter((b): b is number[] => !!b);
      if (boxes.length === 0) return null;
      return [
        Math.min(...boxes.map((b) => b[0]!)), Math.min(...boxes.map((b) => b[1]!)), Math.min(...boxes.map((b) => b[2]!)),
        Math.max(...boxes.map((b) => b[3]!)), Math.max(...boxes.map((b) => b[4]!)), Math.max(...boxes.map((b) => b[5]!)),
      ];
    }),
  };
  const toolsGroupChildren: unknown[] = [];
  const layer = createReadyLayer();
  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: (obj: unknown) => { toolsGroupChildren.push(obj); }, remove: vi.fn() },
      controls: { enabled: true, target: new Vector3(0, 0, 0) },
      camera,
      canvas,
    } as any),
    dtxLayerRef: shallowRef<DTXLayer | null>(layer),
    selectionRef: ref({ pickPoint: vi.fn(() => pickHit) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay, camera, layer, toolsGroupChildren };
}

/** toolsGroup 里线框 LineSegments 的线段数（每段 2 个顶点） */
function wireSegmentCounts(children: unknown[]): number[] {
  const out: number[] = [];
  const visit = (obj: any) => {
    if (obj instanceof LineSegments) {
      const attr = (obj.geometry as BufferGeometry).getAttribute('position');
      if (attr && attr.count >= 24) out.push(attr.count / 2);
    }
    for (const child of obj.children ?? []) visit(child);
  };
  for (const c of children) visit(c);
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  useToolStore().setAnnotationRegionMemberBoxResolver(null);
  document.body.innerHTML = '';
});

describe('rect / obb 新建走 primitiveFromPlacement', () => {
  it('框选两个对象建 OBB 批注：regionV1 每成员一个真实放置盒（A 旋转 30°、B 平移），obb 旧字段仍是合并 AABB', async () => {
    const { tools, store, canvas } = createTools();
    store.setToolMode('annotation_obb');
    await nextTick();
    tools.onCanvasPointerDown(canvas, pointerAt(200, 200));
    tools.onCanvasPointerMove(canvas, pointerAt(600, 400));
    tools.onCanvasPointerUp(canvas, pointerAt(600, 400));

    expect(store.obbAnnotations.value).toHaveLength(1);
    const rec = store.obbAnnotations.value[0]!;
    expect(rec.refnos?.sort()).toEqual([REFNO_A, REFNO_B]);
    // 旧字段：合并 AABB 的单位轴 OBB
    expect(rec.obb.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(rec.obb.center.map((v) => +v.toFixed(6))).toEqual([-0.25, 0.75, 0]);
    // 新字段：每成员一个真实放置盒
    expect(rec.regionV1).toMatchObject({ origin: 'members', kind: 'obb-union' });
    const boxes = (rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes.map((b) => b.memberRefno).sort()).toEqual([REFNO_A, REFNO_B]);
    const boxA = boxes.find((b) => b.memberRefno === REFNO_A)!;
    expect(boxA.id).toBe(`o:${REFNO_A}:0`);
    expect(boxA.center.map((v) => +v.toFixed(6))).toEqual([3, 1, 0]);
    expect(boxA.axes[0][0]).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(boxA.axes[0][1]).toBeCloseTo(Math.sin(Math.PI / 6), 6);
    for (const h of boxA.halfSize) expect(h).toBeCloseTo(0.5, 6);
    const boxB = boxes.find((b) => b.memberRefno === REFNO_B)!;
    expect(boxB.center.map((v) => +v.toFixed(6))).toEqual([-4, 0, 0]);
    expect(rec.regionV1!.source.globalModelMatrix).toEqual(new Matrix4().elements);
  });

  it('单击对象建矩形批注：regionV1 只含该成员的真实放置盒', () => {
    const { tools, store, canvas } = createTools({ objectId: `o:${REFNO_A}:0`, point: new Vector3(3, 1, 0.5) });
    store.setToolMode('annotation_rect');
    tools.onCanvasPointerDown(canvas, pointerAt(478, 274));
    tools.onCanvasPointerUp(canvas, pointerAt(478, 274));
    expect(store.rectAnnotations.value).toHaveLength(1);
    const rec = store.rectAnnotations.value[0]!;
    expect(rec.refnos).toEqual([REFNO_A]);
    const boxes = (rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.memberRefno).toBe(REFNO_A);
    expect(boxes[0]!.axes[0][1]).toBeCloseTo(Math.sin(Math.PI / 6), 6);
  });

  it('开关关：新建只写 obb，regionV1 由漏斗派生 legacy-snapshot（单位轴合并盒）', async () => {
    setCloudRenderFlag('annotationSharedRegion', false);
    const { tools, store, canvas } = createTools();
    store.setToolMode('annotation_obb');
    await nextTick();
    tools.onCanvasPointerDown(canvas, pointerAt(200, 200));
    tools.onCanvasPointerMove(canvas, pointerAt(600, 400));
    tools.onCanvasPointerUp(canvas, pointerAt(600, 400));
    const rec = store.obbAnnotations.value[0]!;
    expect(rec.regionV1?.origin).toBe('legacy-snapshot');
    expect((rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes[0]!.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  it('成员未加载（coverage 不足）：不写 members 范围体，回 legacy-snapshot', async () => {
    // 场景索引里有它的 AABB（在视口内），但 DTX 图层里没有它的几何
    AABB_BY_REFNO[REFNO_UNLOADED] = [-1, -3, -0.5, 0, -2, 0.5];
    try {
      const { tools, store, canvas } = createTools();
      store.setToolMode('annotation_obb');
      await nextTick();
      tools.onCanvasPointerDown(canvas, pointerAt(100, 100));
      tools.onCanvasPointerMove(canvas, pointerAt(790, 590));
      tools.onCanvasPointerUp(canvas, pointerAt(790, 590));
      const rec = store.obbAnnotations.value[0]!;
      expect(rec.refnos).toContain(REFNO_UNLOADED);
      expect(rec.regionV1?.origin).toBe('legacy-snapshot');
    } finally {
      delete AABB_BY_REFNO[REFNO_UNLOADED];
    }
  });
});

describe('rect / obb 线框按范围体画', () => {
  const membersRegion: RegionV1 = {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    origin: 'members',
    kind: 'obb-union',
    boxes: [
      { id: 'a', memberRefno: REFNO_A, center: [3, 1, 0], axes: [[Math.SQRT1_2, Math.SQRT1_2, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]], halfSize: [0.5, 0.5, 0.5] },
      { id: 'b', memberRefno: REFNO_B, center: [-4, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.5, 0.5, 0.5] },
    ],
  };
  const legacyObb = {
    center: [-0.25, 0.75, 0] as [number, number, number],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
    halfSize: [4.25, 1.25, 0.5] as [number, number, number],
    corners: [[-4.5, -0.5, -0.5], [4, -0.5, -0.5], [4, 2, -0.5], [-4.5, 2, -0.5], [-4.5, -0.5, 0.5], [4, -0.5, 0.5], [4, 2, 0.5], [-4.5, 2, 0.5]] as any,
  };

  it('members 范围体：两盒 24 条边（多成员多盒，不合并）；开关关 → obb.corners 单盒 12 条边；旧记录（legacy-snapshot）单盒', () => {
    const { tools, store, toolsGroupChildren } = createTools();
    store.addObbAnnotation({
      id: 'obb-1', objectIds: [REFNO_A, REFNO_B], refnos: [REFNO_A, REFNO_B], obb: legacyObb, labelWorldPos: [0, 0, 2],
      anchor: { kind: 'top_center' }, visible: true, title: 'obb', description: '', createdAt: 1, regionV1: membersRegion,
    });
    tools.syncFromStore();
    expect(wireSegmentCounts(toolsGroupChildren)).toContain(24);

    setCloudRenderFlag('annotationSharedRegion', false);
    toolsGroupChildren.length = 0;
    tools.syncFromStore();
    expect(wireSegmentCounts(toolsGroupChildren)).toContain(12);
    expect(wireSegmentCounts(toolsGroupChildren)).not.toContain(24);
    // 字段没丢
    expect(store.obbAnnotations.value[0]!.regionV1).toEqual(membersRegion);

    setCloudRenderFlag('annotationSharedRegion', true);
    store.clearAll();
    store.addRectAnnotation({
      id: 'rect-legacy', objectIds: [REFNO_A], refnos: [REFNO_A], obb: legacyObb, anchorWorldPos: [0, 0, 0],
      visible: true, title: 'rect', description: '', createdAt: 1,
    });
    toolsGroupChildren.length = 0;
    tools.syncFromStore();
    expect(store.rectAnnotations.value[0]!.regionV1?.origin).toBe('legacy-snapshot');
    expect(wireSegmentCounts(toolsGroupChildren)).toContain(12);
  });

  it('范围体不覆盖全部成员（重绑后新成员没盒）：线框退回 obb.corners 单盒，不用子集冒充', () => {
    const { tools, store, toolsGroupChildren } = createTools();
    store.addObbAnnotation({
      id: 'obb-2', objectIds: [REFNO_A, REFNO_B, REFNO_UNLOADED], refnos: [REFNO_A, REFNO_B, REFNO_UNLOADED], obb: legacyObb, labelWorldPos: [0, 0, 2],
      anchor: { kind: 'top_center' }, visible: true, title: 'obb', description: '', createdAt: 1, regionV1: membersRegion,
    });
    tools.syncFromStore();
    expect(wireSegmentCounts(toolsGroupChildren)).toContain(12);
    expect(wireSegmentCounts(toolsGroupChildren)).not.toContain(24);
  });
});

describe('重绑 member 经 DTX 图层补盒（§8 原子重绑）', () => {
  function makeRegionCloud(): CloudAnnotationRecord {
    return {
      id: 'cloud-1',
      objectIds: [REFNO_A],
      refnos: [REFNO_A],
      anchorWorldPos: [0, 0, 0],
      anchorRefno: REFNO_A,
      selectionBbox: { min: [2, 0, -0.5], max: [4, 2, 0.5] },
      visible: true,
      title: 'cloud',
      description: '',
      createdAt: 1,
      presentationV1: createRegionCloudPresentationV1(),
      regionV1: {
        version: 1, space: 'world', origin: 'members', kind: 'obb-union',
        source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: new Matrix4().elements.slice(), coordinateFrameId: null },
        boxes: [{ id: `o:${REFNO_A}:0`, memberRefno: REFNO_A, center: [3, 1, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.6, 0.6, 0.5] }],
      },
    };
  }

  it('追加已加载成员：范围体多出它的真实放置盒，selectionBbox 同步，云线继续走新管线', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    tools.updateOverlayPositions();
    expect(tools.debugCloudRegionRender()[0]!.regionState).toBe('complete');

    expect(store.addCloudAnnotationMembers('cloud-1', [REFNO_B])).toBe(1);
    const after = store.cloudAnnotations.value[0]!;
    const boxes = (after.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes;
    expect(boxes.map((b) => b.memberRefno)).toEqual([REFNO_A, REFNO_B]);
    expect(boxes[1]!.id).toBe(`o:${REFNO_B}:0`);
    expect(boxes[1]!.center.map((v) => +v.toFixed(6))).toEqual([-4, 0, 0]);
    expect(after.selectionBbox!.min[0]).toBeCloseTo(-4.5, 6);
    expect(after.selectionBbox!.max[0]).toBeCloseTo(3.6, 6);

    tools.syncFromStore();
    tools.updateOverlayPositions();
    const [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('complete');
    expect(info!.cellCount).toBe(2);
  });

  it('追加未加载成员：绑定照改，范围体不覆盖 → 云线走旧实时 AABB 贴合（missing-region / coverage），不用子集缩小范围', () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeRegionCloud());
    tools.syncFromStore();
    expect(store.addCloudAnnotationMembers('cloud-1', [REFNO_UNLOADED])).toBe(1);
    const after = store.cloudAnnotations.value[0]!;
    expect((after.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.memberRefno)).toEqual([REFNO_A]);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const [info] = tools.debugCloudRegionRender();
    expect(info!.regionState).toBe('missing-region');
    expect(info!.invalidReason).toContain('coverage');
    expect(info!.outlineVisible).toBe(true); // 旧管线按目标 AABB 贴合照常画
  });

  it('移除成员：盒随之删除，剩余成员仍覆盖 → 继续走新管线', () => {
    const { tools, store } = createTools();
    const rec = makeRegionCloud();
    store.addCloudAnnotation({
      ...rec,
      objectIds: [REFNO_A, REFNO_B],
      refnos: [REFNO_A, REFNO_B],
      regionV1: {
        ...rec.regionV1!,
        boxes: [
          ...(rec.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes,
          { id: `o:${REFNO_B}:0`, memberRefno: REFNO_B, center: [-4, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.5, 0.5, 0.5] },
        ],
      } as RegionV1,
    });
    expect(store.removeCloudAnnotationMember('cloud-1', REFNO_B)).toBe(true);
    const after = store.cloudAnnotations.value[0]!;
    expect((after.regionV1 as Extract<RegionV1, { kind: 'obb-union' }>).boxes.map((b) => b.memberRefno)).toEqual([REFNO_A]);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    expect(tools.debugCloudRegionRender()[0]!.regionState).toBe('complete');
  });
});

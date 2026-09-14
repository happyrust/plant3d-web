import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

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

import { useAnnotationBindingResolve } from './useAnnotationBindingResolve';
import { useAnnotationStyleStore } from './useAnnotationStyleStore';
import { resetCloudRenderFlagCache } from './useCloudRenderFlags';
import { createDefaultCloudLabelLayoutV1, useDtxTools } from './useDtxTools';
import { useToolStore, type AnnotationRecord, type CloudAnnotationRecord, type RectAnnotationRecord } from './useToolStore';

import { ANNOTATION_DEGRADE_VIEWPORT_STYLE, type BindingResolveProbe } from '@/review/domain/bindingResolve';
import { DTXLayer } from '@/utils/three/dtx';

/**
 * ADR-0050 视口降级（用户 2026-09-14 口径「云线 / 图钉在 missing 或 stale 时改虚线灰色，左上角加小徽标」）：
 * - 云线：轮廓 / 盒边 / 小针 / 引线灰 + 虚线，徽标贴轮廓参考框左上角；图钉只灰不挂徽标（一条记录一枚）。
 * - 图钉（文字 / 矩形 / OBB）：SVG 灰填充 + 虚线描边，左上角小徽标；文字批注引线同步灰虚线。
 * - 解析表变化就地更新：不重建 overlay（文字框元素同一个），只重刷那一条的材质（paintUpdates +1）。
 */

const TARGET_REFNO = '24381_145019';
const TARGET_AABB = [-2, -1, -1, 2, 1, 1];
const GRAY = ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor;

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
  return { tools, store, overlay };
}

function makeCloud(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorRefno: TARGET_REFNO,
    anchorWorldPos: [0, 0, 0],
    leaderEndWorldPos: [3, 3, 0],
    visible: true,
    title: '云线批注 1',
    description: '',
    createdAt: 1_700_000_000_000,
    labelLayoutV1: createDefaultCloudLabelLayoutV1(),
    ...overrides,
  };
}

function makeText(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: 'text-1',
    entityId: TARGET_REFNO,
    refno: TARGET_REFNO,
    worldPos: [0, 0, 0],
    labelWorldPos: [2, 2, 0],
    collapsed: false,
    visible: true,
    glyph: 'A1',
    title: '文字批注 1',
    description: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const OBB: RectAnnotationRecord['obb'] = {
  center: [0, 0, 0],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  halfSize: [1, 1, 1],
  corners: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
};

function makeRect(): RectAnnotationRecord {
  return {
    id: 'rect-1',
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    obb: OBB,
    anchorWorldPos: [0, 0, 1],
    visible: true,
    title: '矩形批注 1',
    description: '',
    createdAt: 1_700_000_000_000,
  };
}

/** 探针：全部已加载；`missing` 指定哪些 refno 有权威 missing 证据；`stale` 让 anchor 漂离 */
function probe(options: { missing?: string[]; stale?: boolean } = {}): BindingResolveProbe {
  return {
    isLoaded: () => true,
    isKnown: () => true,
    isVerifiedMissing: (refno) => options.missing?.includes(refno) ?? false,
    missingReason: () => 'HTTP 404',
    anchorDrift: () => options.stale === true,
  };
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

const resolveApi = useAnnotationBindingResolve();

beforeEach(() => {
  // 触发 ④（记录集合变化 → 120ms 后默认探针重算）用假定时器钉住，本测试只走注入探针
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('localStorage', createMemoryStorage());
  resetCloudRenderFlagCache();
  resolveApi.resetForTests();
  const store = useToolStore();
  store.clearAll();
  store.setToolMode('none');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  resolveApi.resetForTests();
  document.body.innerHTML = '';
});

/** store 变化 → useDtxTools 的 deep watch 异步 syncFromStore；先让它跑完，后面的断言才不会被一次整体重建打乱 */
async function flushStoreSync(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe('ADR-0050 视口降级 · 云线', () => {
  it('成员 missing：轮廓 / 盒边 / 小针 / 引线灰虚线，徽标「⚠ 不存在」贴在轮廓参考框左上角；图钉灰但不带徽标', async () => {
    const { tools, store, overlay } = createTools();
    store.addCloudAnnotation(makeCloud());
    await flushStoreSync();
    resolveApi.resolveAll(probe({ missing: [TARGET_REFNO] }));
    tools.syncFromStore();
    tools.updateOverlayPositions();

    const [cloud] = tools.debugAnnotationDegrades().filter((d) => d.id === 'cloud:cloud-1');
    expect(cloud).toMatchObject({ state: 'missing', outlineDashed: true, lineColor: GRAY, badgeText: '⚠ 不存在', badgeOpacity: '1' });
    expect(cloud!.pinFill).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColorCss);

    const frame = tools.debugCloudLabelLayouts()[0]!.frame!;
    expect(Number.parseFloat(cloud!.badgeLeft!)).toBeCloseTo(frame.referenceBounds.x, 4);
    expect(Number.parseFloat(cloud!.badgeTop!)).toBeCloseTo(frame.referenceBounds.y, 4);

    const badges = overlay.querySelectorAll('.dtx-anno-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute('title')).toContain('HTTP 404');

    const marker = overlay.querySelector<HTMLElement>('.dtx-anno-marker')!;
    expect(marker.dataset.bindingState).toBe('missing');
    expect(marker.querySelector('svg path')?.getAttribute('stroke-dasharray')).toBe('3 2');
    expect(marker.querySelector('[data-role="annotation-binding-badge"]')).toBeNull();
    expect(marker.title).toContain('HTTP 404');
  });

  it('解析表变化就地更新：正常 → stale（徽标 STALE、只重刷这一条的材质、文字框元素不重建）→ 恢复（原色实线、徽标撤掉）', async () => {
    const { tools, store, overlay } = createTools();
    store.addCloudAnnotation(makeCloud());
    await flushStoreSync();
    resolveApi.resolveAll(probe());
    await nextTick();
    tools.updateOverlayPositions();
    const labelBefore = overlay.querySelector('.dtx-anno-label');
    const cloudColor = useAnnotationStyleStore().style.cloud.color;

    expect(tools.debugAnnotationDegrades()[0]).toMatchObject({ state: null, outlineDashed: false, lineColor: cloudColor, badgeText: null });
    tools.resetCloudRenderStats();

    resolveApi.resolveAll(probe({ stale: true }));
    await nextTick();
    // watch → applyBindingDegrade 已自己跑了一帧；再跑几帧确认静止时不再重刷
    for (let i = 0; i < 3; i++) tools.updateOverlayPositions();
    const stale = tools.debugAnnotationDegrades()[0]!;
    expect(stale).toMatchObject({ state: 'stale', outlineDashed: true, lineColor: GRAY, badgeText: 'STALE', badgeOpacity: '1' });
    expect(tools.debugCloudRenderStats().paintUpdates).toBe(1);
    expect(tools.debugCloudRenderStats().contourBuilds).toBe(0);
    expect(overlay.querySelector('.dtx-anno-label')).toBe(labelBefore);
    expect(overlay.querySelector<HTMLElement>('.dtx-anno-marker')!.dataset.bindingState).toBe('stale');

    tools.resetCloudRenderStats();
    resolveApi.resolveAll(probe());
    await nextTick();
    expect(tools.debugAnnotationDegrades()[0]).toMatchObject({ state: null, outlineDashed: false, lineColor: cloudColor, badgeText: null });
    expect(overlay.querySelectorAll('.dtx-anno-badge')).toHaveLength(0);
    expect(overlay.querySelector<HTMLElement>('.dtx-anno-marker')!.dataset.bindingState).toBeUndefined();
    expect(overlay.querySelector('.dtx-anno-marker svg path')?.getAttribute('fill')).toBe('#ef4444');
    expect(tools.debugCloudRenderStats().paintUpdates).toBe(1);
  });

  it('同一条记录既有 missing 又有 stale → 按 missing 出徽标；解析结果没变时不重刷', async () => {
    const { tools, store } = createTools();
    store.addCloudAnnotation(makeCloud());
    await flushStoreSync();
    resolveApi.resolveAll(probe({ missing: [TARGET_REFNO], stale: true }));
    await nextTick();
    tools.updateOverlayPositions();
    expect(tools.debugAnnotationDegrades()[0]).toMatchObject({ state: 'missing', badgeText: '⚠ 不存在' });

    tools.resetCloudRenderStats();
    resolveApi.resolveAll(probe({ missing: [TARGET_REFNO], stale: true }));
    await nextTick();
    expect(tools.debugCloudRenderStats().paintUpdates).toBe(0);
    expect(tools.debugCloudRenderStats().frames).toBe(0);
  });
});

describe('ADR-0050 视口降级 · 图钉', () => {
  it('文字批注锚点 stale：图钉灰虚线 + 左上角「STALE」徽标，引线灰虚线；恢复后原样', async () => {
    const { tools, store, overlay } = createTools();
    store.addAnnotation(makeText());
    await flushStoreSync();
    resolveApi.resolveAll(probe({ stale: true }));
    await nextTick();
    tools.updateOverlayPositions();

    const [text] = tools.debugAnnotationDegrades().filter((d) => d.id === 'anno:text-1');
    expect(text).toMatchObject({ state: 'stale', outlineDashed: true, lineColor: GRAY, badgeText: 'STALE' });
    expect(text!.pinFill).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColorCss);
    const marker = overlay.querySelector<HTMLElement>('.dtx-anno-marker')!;
    expect(marker.dataset.bindingState).toBe('stale');
    const badge = marker.querySelector<HTMLElement>('[data-role="annotation-binding-badge"]')!;
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.left).toBe('-4px');
    // 字泡仍在右上角、内容不变
    expect(marker.querySelector('[data-role="annotation-glyph"]')?.textContent).toBe('A1');

    resolveApi.resolveAll(probe());
    await nextTick();
    const [restored] = tools.debugAnnotationDegrades().filter((d) => d.id === 'anno:text-1');
    expect(restored).toMatchObject({ state: null, outlineDashed: false, badgeText: null });
    expect(marker.querySelector('svg path')?.getAttribute('fill')).toBe('#ef4444');
    expect(marker.querySelector('[data-role="annotation-binding-badge"]')).toBeNull();
    expect(marker.title).toBe('单击选中，双击展开/收起');
  });

  it('矩形批注成员 missing：线框 / 小针 / 引线灰虚线，图钉灰 + 「⚠ 不存在」徽标；解析恢复后就地回原色实线', async () => {
    const { tools, store, overlay } = createTools();
    store.addRectAnnotation(makeRect());
    await flushStoreSync();
    resolveApi.resolveAll(probe({ missing: [TARGET_REFNO] }));
    await nextTick();
    tools.updateOverlayPositions();

    const [rect] = tools.debugAnnotationDegrades().filter((d) => d.id === 'rect:rect-1');
    expect(rect).toMatchObject({
      state: 'missing',
      outlineDashed: true,
      lineColor: GRAY,
      badgeText: '⚠ 不存在',
      pinFill: ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColorCss,
    });
    expect(overlay.querySelector<HTMLElement>('.dtx-anno-marker')!.dataset.bindingState).toBe('missing');

    resolveApi.resolveAll(probe());
    await nextTick();
    const [restored] = tools.debugAnnotationDegrades().filter((d) => d.id === 'rect:rect-1');
    // 矩形正常线色 0x111827（深灰），线框回实线
    expect(restored).toMatchObject({ state: null, outlineDashed: false, lineColor: 0x111827, badgeText: null, pinFill: '#ef4444' });
  });

  it('OBB 批注成员 missing：线框灰虚线（正常态青绿 0x0f766e）+ 图钉徽标；文字 / 云线不受影响', async () => {
    const { tools, store } = createTools();
    store.addObbAnnotation({
      id: 'obb-1',
      objectIds: [TARGET_REFNO],
      refnos: [TARGET_REFNO],
      obb: OBB,
      labelWorldPos: [0, 0, 2],
      anchor: { kind: 'top_center' },
      visible: true,
      title: 'OBB 批注 1',
      description: '',
      createdAt: 1_700_000_000_000,
    });
    store.addAnnotation(makeText({ refno: 'other-ok' }));
    await flushStoreSync();
    resolveApi.resolveAll(probe());
    await nextTick();
    tools.updateOverlayPositions();
    expect(tools.debugAnnotationDegrades().find((d) => d.id === 'obb:obb-1')).toMatchObject({ state: null, outlineDashed: false, lineColor: 0x0f766e });

    resolveApi.resolveAll(probe({ missing: [TARGET_REFNO] }));
    await nextTick();
    expect(tools.debugAnnotationDegrades().find((d) => d.id === 'obb:obb-1')).toMatchObject({
      state: 'missing',
      outlineDashed: true,
      lineColor: GRAY,
      badgeText: '⚠ 不存在',
    });
    expect(tools.debugAnnotationDegrades().find((d) => d.id === 'anno:text-1')).toMatchObject({ state: null, outlineDashed: false });
  });
});

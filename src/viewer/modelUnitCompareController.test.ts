import { afterEach, describe, expect, it, vi } from 'vitest';

import { Box3, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

import { createModelUnitCompareController, type ModelUnitCompareHost } from './modelUnitCompareController';

import type { ModelVersion } from '@/model-source';
import type { DTXLayer } from '@/utils/three/dtx';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import {
  MODEL_UNIT_VERSION_COMPARE_STATE_EVENT,
  type ModelUnitGeometryDiff,
  type ModelUnitVersionCompareOpenDetail,
  type ModelUnitVersionCompareRuntimeState,
  type ModelUnitVersionSide,
} from '@/utils/modelUnitVersionCompare';

/**
 * `modelUnitCompareController`（版本对比审核计划 P2-2 从 ViewerPanel 抽出）用假 host / 假图层跑完整条路：
 * open 装两侧并着色、环境藏目标、相机对框、运行态发布；clear 还显隐 / 相机 / 图层；切 A-B / 只看差异 / 分屏的守卫；
 * 事件路由；装到一半作废；定位；隔离图层拾取与「钉到那一版」。渲染本身（scissor pass）要 WebGL，不在这里。
 */

type FakeObject = { id: string; visible: boolean; box: Box3; material?: unknown };

/** 够控制器用的假 DTXLayer：对象显隐、包围盒、射线命中按 id 表给 */
class FakeLayer {
  objects = new Map<string, FakeObject>();
  disposed = false;
  hits = new Map<string, number>();
  constructor(objectIds: string[] = [], box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1))) {
    for (const id of objectIds) this.objects.set(id, { id, visible: true, box: box.clone() });
  }
  getAllObjectIds(): string[] { return [...this.objects.keys()]; }
  getVisibleObjectIds(): string[] { return [...this.objects.values()].filter((o) => o.visible).map((o) => o.id); }
  isObjectVisible(id: string): boolean { return this.objects.get(id)?.visible ?? false; }
  setObjectVisible(id: string, visible: boolean): void { const o = this.objects.get(id); if (o) o.visible = visible; }
  setObjectsVisible(ids: string[], visible: boolean): void { for (const id of ids) this.setObjectVisible(id, visible); }
  setAllVisible(visible: boolean): void { for (const o of this.objects.values()) o.visible = visible; }
  getObjectBoundingBoxInto(id: string, target: Box3): Box3 | null { const o = this.objects.get(id); return o ? target.copy(o.box) : null; }
  getBoundingBox(): Box3 | null {
    const box = new Box3();
    for (const o of this.objects.values()) box.union(o.box);
    return box.isEmpty() ? null : box;
  }
  raycastObject(id: string): { distance: number } | null {
    const o = this.objects.get(id);
    if (!o || !o.visible) return null;
    const distance = this.hits.get(id);
    return distance === undefined ? null : { distance };
  }
  setObjectMaterial(id: string, material: unknown): void { const o = this.objects.get(id); if (o) o.material = material; }
  dispose(): void { this.disposed = true; }
  asLayer(): DTXLayer { return this as unknown as DTXLayer; }
}

function fakeViewer(): DtxViewer & { flyTo: ReturnType<typeof vi.fn>; fitClipPlanesToBox: ReturnType<typeof vi.fn> } {
  const camera = new PerspectiveCamera(50, 2, 0.1, 1000);
  camera.position.set(10, 10, 10);
  const target = new Vector3(0, 0, 0);
  return {
    camera,
    controls: { target, enabled: true, update: vi.fn() },
    renderer: {
      getContext: () => null,
      getSize: (v: Vector2) => v.set(800, 400),
      setScissorTest: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      render: vi.fn(),
    },
    scene: {},
    flyTo: vi.fn(),
    fitClipPlanesToBox: vi.fn(),
  } as unknown as DtxViewer & { flyTo: ReturnType<typeof vi.fn>; fitClipPlanesToBox: ReturnType<typeof vi.fn> };
}

function version(sesno: number, impactKind: ModelVersion['impactKind'] = 'mesh'): ModelVersion {
  return { dbnum: 8000, unitRefno: '1_1', unitNoun: 'BRAN', sesno, sessionTime: null, impactKind };
}

function side(sesno: number, refnos: string[], impactKind: ModelVersion['impactKind'] = 'mesh'): ModelUnitVersionSide {
  return { version: version(sesno, impactKind), sesno, refnos, entries: new Map(refnos.map((refno) => [refno, []])) };
}

const ROWS: ModelUnitGeometryDiff[] = [
  { refno: '1_2', noun: 'FTUB', status: 'modified' },
  { refno: '1_3', noun: 'FTUB', status: 'unchanged' },
  { refno: '1_4', noun: 'ELBO', status: 'deleted' },
];

function detailOf(overrides: Partial<ModelUnitVersionCompareOpenDetail> = {}): ModelUnitVersionCompareOpenDetail {
  return {
    action: 'open',
    dbnum: 8000,
    unitRefno: '1_1',
    before: side(10, ['1_2', '1_3', '1_4']),
    after: side(20, ['1_2', '1_3']),
    refnos: ['1_2', '1_3', '1_4'],
    rows: ROWS,
    ...overrides,
  };
}

type Harness = ReturnType<typeof harness>;

/** 主图层里装着目标单元 1_1 的三个构件 + 环境里的 9_9；隔离图层装几何时按 refnos 造 `unit-compare:a|b:<refno>:0` */
function harness(options: { isDev?: boolean; loadedObjects?: (prefix: string) => number } = {}) {
  const viewer = fakeViewer();
  const primary = new FakeLayer(['o:1_2:0', 'o:1_3:0', 'o:1_4:0', 'o:9_9:0']);
  primary.setObjectVisible('o:1_3:0', false);
  const created: FakeLayer[] = [];
  const forgotten: FakeLayer[] = [];
  const attached: FakeLayer[] = [];
  const toasts: string[] = [];
  const selection = {
    pin: false,
    deleted: false,
    refno: null as string | null,
    clearSelection: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnoAtVersion: vi.fn(),
  };
  const host: ModelUnitCompareHost = {
    viewer: () => viewer,
    primaryLayer: () => primary.asLayer(),
    createLayer: () => { const layer = new FakeLayer(); created.push(layer); return layer.asLayer(); },
    attachLayer: (layer) => { attached.push(layer as unknown as FakeLayer); },
    forgetLayer: (layer) => { forgotten.push(layer as unknown as FakeLayer); },
    loadInstances: vi.fn(async (layer, _dbnum, refnos, loadOptions) => {
      const fake = layer as unknown as FakeLayer;
      const prefix = loadOptions.objectIdPrefix;
      if (!prefix) return { loadedObjects: refnos.length }; // 环境重取
      const count = options.loadedObjects?.(prefix) ?? refnos.length;
      for (const refno of refnos.slice(0, count)) fake.objects.set(`${prefix}:${refno}:0`, { id: `${prefix}:${refno}:0`, visible: true, box: new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2)) });
      return { loadedObjects: count };
    }),
    resolve: {
      refnoByObjectId: (_dbnum, objectId) => objectId.split(':')[1] ?? null,
      objectIdsByRefno: (_dbnum, refno) => primary.getAllObjectIds().filter((id) => id.startsWith(`o:${refno}:`)),
      objectIdsByUnitRefno: (_dbnum, unitRefno) => (unitRefno === '1_1' ? ['o:1_2:0', 'o:1_3:0', 'o:1_4:0'] : []),
    },
    normalizeRefno: (raw) => String(raw ?? '').trim().replace('/', '_'),
    requestRender: vi.fn(),
    toast: (message) => { toasts.push(message); },
    beforeSplit: vi.fn(),
    fitToBox: vi.fn(),
    renderOverlay: vi.fn(),
    onClear: vi.fn(),
    selection: {
      clearSelection: selection.clearSelection,
      setSelectedRefno: selection.setSelectedRefno,
      setSelectedRefnoAtVersion: selection.setSelectedRefnoAtVersion,
      hasVersionPin: () => selection.pin,
      selectedIsDeleted: () => selection.deleted,
      selectedRefno: () => selection.refno,
    },
    isDev: options.isDev ?? false,
  };
  const published: (ModelUnitVersionCompareRuntimeState | null)[] = [];
  const onState = (event: Event) => published.push((event as CustomEvent<ModelUnitVersionCompareRuntimeState | null>).detail);
  window.addEventListener(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, onState);
  const controller = createModelUnitCompareController(host);
  return {
    viewer, primary, created, forgotten, attached, toasts, selection, host, controller, published,
    teardown: () => { controller.dispose(); window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, onState); },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('modelUnitCompareController', () => {
  let current: Harness | null = null;
  afterEach(() => { current?.teardown(); current = null; });

  it('open：重取环境保持显隐、藏掉目标单元、两侧各装一层并按四态着色、相机对框、ready 态带 splitOutline，运行态发布到 window', async () => {
    const h = current = harness({ isDev: true });
    const detail = detailOf();
    await h.controller.open(detail);
    await flush();

    const state = h.controller.state.value!;
    expect(state.status).toBe('ready');
    expect(state.activeSide).toBe('after');
    expect(state.viewMode).toBe('single');
    expect(state.diffOnly).toBe(false);
    expect(state.environment).toEqual({ loadedRefnos: 4, refreshing: false });
    expect(state.splitOutline).toEqual({ compositor: true, renderer: null });
    expect(h.controller.statusCounts.value).toEqual({ added: 0, deleted: 1, modified: 1, unchanged: 1 });
    // 环境：已加载的 4 个 refno 重取一遍（forceReload）；之前藏着的 1_3 仍藏着、目标单元三件全藏、环境 9_9 还在
    const loads = (h.host.loadInstances as ReturnType<typeof vi.fn>).mock.calls;
    expect(loads[0]![3]).toEqual({ forceReloadRefnos: ['1_2', '1_3', '1_4', '9_9'], replaceExistingObjects: true });
    expect(h.primary.isObjectVisible('o:1_2:0')).toBe(false);
    expect(h.primary.isObjectVisible('o:1_4:0')).toBe(false);
    expect(h.primary.isObjectVisible('o:9_9:0')).toBe(true);
    // 两层：A 三件（含被删的 1_4）、B 两件；按 rows 上色，unchanged 的进「只看差异」要藏的桶
    expect(h.created).toHaveLength(2);
    const [a, b] = h.created as [FakeLayer, FakeLayer];
    expect(a.getAllObjectIds()).toEqual(['unit-compare:a:1_2:0', 'unit-compare:a:1_3:0', 'unit-compare:a:1_4:0']);
    expect(b.getAllObjectIds()).toEqual(['unit-compare:b:1_2:0', 'unit-compare:b:1_3:0']);
    expect(a.objects.get('unit-compare:a:1_4:0')!.material).toBeTruthy();
    expect(h.attached).toEqual([a, b]);
    // 缺省显 B：A 层整层关、B 层开
    expect(a.getVisibleObjectIds()).toEqual([]);
    expect(b.getVisibleObjectIds()).toEqual(['unit-compare:b:1_2:0', 'unit-compare:b:1_3:0']);
    expect(h.host.fitToBox).toHaveBeenCalledTimes(1);
    // dev 钩子（e2e 读的那些数字）
    const hook = (window as unknown as { __modelUnitVersionCompare?: Record<string, unknown> }).__modelUnitVersionCompare!;
    expect(hook).toMatchObject({ unitRefno: '1_1', beforeSesno: 10, afterSesno: 20, beforeObjects: 3, afterObjects: 2, activeSide: 'after', hiddenWhenDiffOnly: { before: 1, after: 1 } });
    // 运行态发布：loading → ready 至少各一发，最后一发是 ready 的副本
    expect(h.published.length).toBeGreaterThanOrEqual(2);
    expect(h.published.at(-1)?.status).toBe('ready');
  });

  it('tombstone 的那一侧不装几何；某一侧装出 0 件 → error 态 + toast，本轮图层放掉、环境显隐还回去', async () => {
    const h = current = harness();
    await h.controller.open(detailOf({ after: side(20, [], 'tombstone') }));
    expect(h.controller.state.value?.status).toBe('ready');
    const loads = (h.host.loadInstances as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[3]?.objectIdPrefix);
    expect(loads.map((call) => call[3].objectIdPrefix)).toEqual(['unit-compare:a']);
    h.controller.clear();

    const failing = current = harness({ loadedObjects: (prefix) => (prefix === 'unit-compare:a' ? 0 : 3) });
    h.teardown();
    await failing.controller.open(detailOf());
    const state = failing.controller.state.value!;
    expect(state.status).toBe('error');
    expect(state.error).toBe('版本 A（sesno 10）没有可显示的几何对象');
    expect(failing.toasts).toEqual(['最小交付单元版本加载失败：版本 A（sesno 10）没有可显示的几何对象']);
    expect(failing.created.every((layer) => layer.disposed)).toBe(true);
    expect(failing.forgotten).toHaveLength(2);
    // 目标单元的显隐按打开前还回去（1_3 本来就藏着）
    expect(failing.primary.isObjectVisible('o:1_2:0')).toBe(true);
    expect(failing.primary.isObjectVisible('o:1_3:0')).toBe(false);
  });

  it('clear：先让视口放掉校审持有的那份、还显隐 / 相机、放图层、清钉在某一版的选中；runId 递增', async () => {
    const h = current = harness();
    await h.controller.open(detailOf());
    const runBefore = h.controller.runId;
    h.viewer.camera.position.set(99, 99, 99);
    h.selection.pin = true;
    h.controller.clear();

    expect(h.host.onClear).toHaveBeenCalledTimes(2); // open 开头的 clear() + 这一次
    expect(h.controller.runId).toBe(runBefore + 1);
    expect(h.controller.state.value).toBeNull();
    expect(h.created.every((layer) => layer.disposed)).toBe(true);
    expect(h.primary.isObjectVisible('o:1_2:0')).toBe(true);
    expect(h.primary.isObjectVisible('o:1_4:0')).toBe(true);
    expect(h.viewer.camera.position.toArray()).toEqual([10, 10, 10]);
    expect(h.selection.clearSelection).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.published.at(-1)).toBeNull();
  });

  it('setSide / setDiffOnly / setViewMode：没 ready 不动；ready 后切 A 开 A 层关 B 层，只看差异藏 unchanged，切分屏先收工具', async () => {
    const h = current = harness();
    h.controller.setSide('before');
    h.controller.setViewMode('split');
    expect(h.host.beforeSplit).not.toHaveBeenCalled();
    await h.controller.open(detailOf());
    const [a, b] = h.created as [FakeLayer, FakeLayer];

    h.controller.setSide('before');
    expect(h.controller.state.value?.activeSide).toBe('before');
    expect(a.getVisibleObjectIds()).toHaveLength(3);
    expect(b.getVisibleObjectIds()).toEqual([]);

    h.controller.setDiffOnly(true);
    expect(h.controller.state.value?.diffOnly).toBe(true);
    expect(a.getVisibleObjectIds()).toEqual(['unit-compare:a:1_2:0', 'unit-compare:a:1_4:0']);
    h.controller.setDiffOnly(true); // 同值不重复
    h.controller.setDiffOnly(false);
    expect(a.getVisibleObjectIds()).toHaveLength(3);

    expect(h.controller.isSplitReady()).toBe(false);
    h.controller.setViewMode('split');
    expect(h.host.beforeSplit).toHaveBeenCalledTimes(1);
    expect(h.controller.state.value?.viewMode).toBe('split');
    expect(h.controller.isSplitReady()).toBe(true);
    h.controller.setViewMode('single');
    expect(h.host.beforeSplit).toHaveBeenCalledTimes(1);
  });

  it('handleEvent：close / focus / set-* / refresh-environment / request-state 各走各的，其余当 open', async () => {
    const h = current = harness();
    const event = (detail: unknown) => new CustomEvent('x', { detail });
    h.controller.handleEvent(event({ action: 'request-state' }));
    expect(h.published.at(-1)).toBeNull();
    h.controller.handleEvent(event(detailOf()));
    await flush();
    await flush();
    expect(h.controller.state.value?.status).toBe('ready');
    h.controller.handleEvent(event({ action: 'set-side', side: 'before' }));
    expect(h.controller.state.value?.activeSide).toBe('before');
    h.controller.handleEvent(event({ action: 'set-view-mode', viewMode: 'split' }));
    expect(h.controller.state.value?.viewMode).toBe('split');
    h.controller.handleEvent(event({ action: 'set-diff-only', diffOnly: true }));
    expect(h.controller.state.value?.diffOnly).toBe(true);
    h.controller.handleEvent(event({ action: 'close' }));
    expect(h.controller.state.value).toBeNull();
  });

  it('open 到一半 shouldApply 变假 → 悄悄收掉（state 为 null、图层放掉、不报错不 toast）；新的 open 作废旧的那轮', async () => {
    const h = current = harness();
    let apply = true;
    const first = h.controller.open(detailOf(), { shouldApply: () => apply });
    apply = false;
    await first;
    expect(h.controller.state.value).toBeNull();
    expect(h.toasts).toEqual([]);
    expect(h.created.every((layer) => layer.disposed)).toBe(true);

    const slow = detailOf({ before: side(11, ['1_2']), after: side(21, ['1_2']) });
    const fast = detailOf();
    const slowOpen = h.controller.open(slow);
    const fastOpen = h.controller.open(fast);
    await Promise.all([slowOpen, fastOpen]);
    // 留下的是后一轮（A 10 → B 20），先一轮（11 → 21）作废
    expect(h.controller.state.value?.detail.before.sesno).toBe(fast.before.sesno);
    expect(h.controller.state.value?.detail.after.sesno).toBe(fast.after.sesno);
    expect(h.controller.state.value?.status).toBe('ready');
    // 作废的那一轮建的两层已放掉，只剩活着的两层
    expect(h.created.filter((layer) => !layer.disposed)).toHaveLength(2);
  });

  it('focus：隔离图层里找到就飞过去并普通选中；已按「已删除」登记过的幽灵不覆盖选中；哪儿都没有相机不动', async () => {
    const h = current = harness();
    await h.controller.open(detailOf());
    h.controller.focus('1/4');
    expect(h.viewer.flyTo).toHaveBeenCalledTimes(1);
    expect(h.selection.setSelectedRefno).toHaveBeenCalledWith('1_4');

    h.selection.deleted = true;
    h.selection.refno = '1_4';
    h.controller.focus('1_4');
    expect(h.viewer.flyTo).toHaveBeenCalledTimes(2);
    expect(h.selection.setSelectedRefno).toHaveBeenCalledTimes(1);

    // 不在 A / B 里、主图层里有 → 回落主图层、普通选中
    h.controller.focus('9_9');
    expect(h.viewer.flyTo).toHaveBeenCalledTimes(3);
    expect(h.selection.setSelectedRefno).toHaveBeenLastCalledWith('9_9');

    h.controller.focus('7_7');
    expect(h.viewer.flyTo).toHaveBeenCalledTimes(3);
  });

  it('pickObject 按那一侧的隔离图层 CPU 拾取最近命中（拾非当前侧时临时开那一侧、测完复位）；selectObject 带 attributesAt 就钉到那一版', async () => {
    const attributesAt = vi.fn(async () => ({ refno: '1_2', exists: true, attributes: [] }));
    const h = current = harness();
    await h.controller.open(detailOf({ attributesAt: attributesAt as unknown as ModelUnitVersionCompareOpenDetail['attributesAt'] }));
    const [a, b] = h.created as [FakeLayer, FakeLayer];
    b.hits.set('unit-compare:b:1_2:0', 5);
    b.hits.set('unit-compare:b:1_3:0', 3);
    a.hits.set('unit-compare:a:1_4:0', 7);
    const ray = new Raycaster(new Vector3(0.5, 0.5, -10), new Vector3(0, 0, 1));

    const pickB = h.controller.pickObject(ray, 'after');
    expect(pickB).toEqual({ objectId: 'unit-compare:b:1_3:0', refno: '1_3', side: 'after', distance: 3 });
    // 当前显 B：拾 A 要临时开 A 层，测完 A 层仍关着
    const pickA = h.controller.pickObject(ray, 'before');
    expect(pickA?.refno).toBe('1_4');
    expect(a.getVisibleObjectIds()).toEqual([]);
    expect(b.getVisibleObjectIds()).toHaveLength(2);

    h.controller.selectObject(pickA!);
    expect(h.selection.setSelectedRefnoAtVersion).toHaveBeenCalledWith('1_4', expect.objectContaining({ sesno: 10, label: 'A' }));
    h.controller.selectObject(pickB!);
    expect(h.selection.setSelectedRefnoAtVersion).toHaveBeenLastCalledWith('1_3', expect.objectContaining({ sesno: 20, label: 'B' }));
    expect(h.selection.setSelectedRefno).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpatialRoomsResult, SpatialTreeLeafSelector, SpatialTreeResult } from '@/api/genModelSpatialApi';
import type { SpatialSource } from '@/model-source/ports';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

/**
 * 管件带直段（2026-09-21，`deliveryUnitScene.ts`）读的 gen-model 记录缓存：BRAN 24381_1200 的两条在册管件 + 一条房间外的 24381_1242，
 * 直管挂在 BRAN 自己的 refno 上；EQUI 24381_7000 的构件不扩。
 */
const recordMocks = vi.hoisted(() => {
  const BRAN = '24381_1200';
  const owned = new Set(['24381_1240', '24381_1241', '24381_1242']);
  const entry = (refno: string, ownerRefno: string, ownerNoun: string) => ({
    geo_hash: 'g', matrix: [], geo_index: 0, color_index: 0, name_index: 0, site_name_index: 0, lod_mask: 1,
    uniforms: { refno, owner_refno: ownerRefno, owner_noun: ownerNoun },
  });
  return {
    peek: (refno: string) => {
      if (owned.has(refno)) return [entry(refno, BRAN, 'BRAN')];
      if (refno === '24381_7001' || refno === '24381_7002') return [entry(refno, '24381_7000', 'EQUI')];
      return undefined;
    },
    leavesOfRoot: (root: string) => (root === BRAN ? [...owned, BRAN] : []),
  };
});

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ records: recordMocks }),
}));

import { useRoomTree } from '@/composables/useRoomTree';

/**
 * 「房间」页签的状态（ADR 0068，plan 2026-09-20 spatial-room-hierarchy-tree §4.5）：在册房间平铺 + 搜索、展开一间房才取树且只取一次、
 * 未内联的单元展开时按选择器补叶子、眼睛作用于节点下全部构件并推导父链勾选、选中 / 定位 / 隔离只碰场景里已有的对象。
 * 管件带直段：单元级及以上的显隐 / 隔离连所属 BRAN 的整体（BRAN 自己 + 记录缓存里它的全部构件）一起；构件行、定位、选中不扩。
 */

function roomsResult(overrides: Partial<SpatialRoomsResult> = {}): SpatialRoomsResult {
  return {
    success: true,
    status: 'ready',
    reason: null,
    definition_version: 'g1',
    rooms: [
      { refno: '24381_35580', room_num: 'R432', name: '/1RX-RM04-R432', dbnum: 7997, panel_count: 6 },
      { refno: '24381_1407', room_num: 'R143', name: '/1RX-RM01-R143', dbnum: 7997, panel_count: 4 },
      { refno: '24381_9', room_num: 'R43', name: null, dbnum: 7997, panel_count: 1 },
      { refno: '24381_5062', room_num: 'L505', name: '/1LR-RM05-L505', dbnum: 7997, panel_count: 2 },
    ],
    ...overrides,
  };
}

/** R432 的树：BRAN b1 内联两条；EQUI e1 未内联（count 3）。 */
function r432Tree(selector?: SpatialTreeLeafSelector): SpatialTreeResult {
  const equiElements = selector && 'unit' in selector && selector.unit === '24381_7000'
    ? { elements: [{ refno: '24381_7001', noun: 'NOZZ', distance: 1500 }, { refno: '24381_7002', noun: 'NOZZ', distance: 1600 }, { refno: '24381_1241', noun: 'ELBO', distance: 1700 }] }
    : {};
  return {
    success: true,
    total_count: 5,
    candidate_count: 9,
    truncated_candidates: false,
    candidate_cap: 200000,
    leaves_inline: false,
    leaf_cap: 5000,
    leaf_count: 5,
    inlined: selector ? 'unit:24381_7000' : null,
    delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
    center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' },
    radius: 0,
    shape: 'cube',
    warnings: [],
    coverage: 'global-tree',
    spatial_state: 'ready',
    rooms: [{
      refno: '24381_35580',
      room_num: 'R432',
      name: '/1RX-RM04-R432',
      count: 5,
      specs: [{
        spec_value: 3,
        count: 5,
        unit_types: [
          { noun: 'BRAN', count: 2, units: [{ refno: '24381_1200', noun: 'BRAN', name: '/B1', count: 2, min_distance: 100, elements: [{ refno: '24381_1240', noun: 'TUBI', distance: 100 }, { refno: '24381_1241', noun: 'ELBO', distance: 200 }] }] },
          { noun: 'EQUI', count: 3, units: [{ refno: '24381_7000', noun: 'EQUI', name: '/E1', count: 3, min_distance: 1500, ...equiElements }] },
        ],
        others: { count: 0, by_noun: [] },
      }],
    }],
  };
}

function makeSource(overrides: Partial<SpatialSource> = {}) {
  const rooms = vi.fn(async () => roomsResult());
  const roomTree = vi.fn(async (_refno: string, _options?: unknown, only?: SpatialTreeLeafSelector) => r432Tree(only));
  const source = {
    rooms,
    roomTree,
    nearby: vi.fn(),
    nearbyRefnos: vi.fn(),
    negativeNouns: vi.fn(),
    roomsOf: vi.fn(async () => []),
    tree: vi.fn(),
    capabilities: { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true },
    ...overrides,
  } as unknown as SpatialSource;
  return { source, rooms, roomTree };
}

/** 最小可用的 compat viewer：objects 表 + 显隐 / 选中 / xray / AABB / 飞行都记调用 */
function makeViewer(loaded: string[]) {
  const objects: Record<string, { visible: boolean; selected: boolean; xrayed: boolean }> = {};
  for (const id of loaded) objects[id] = { visible: true, selected: false, xrayed: false };
  const scene = {
    objects,
    get objectIds() { return Object.keys(objects); },
    get selectedObjectIds() { return Object.keys(objects).filter((id) => objects[id]!.selected); },
    ensureRefnos: vi.fn(),
    setObjectsVisible: vi.fn((ids: string[], visible: boolean) => { for (const id of ids) if (objects[id]) objects[id]!.visible = visible; }),
    setObjectsSelected: vi.fn((ids: string[], selected: boolean) => { for (const id of ids) if (objects[id]) objects[id]!.selected = selected; }),
    setObjectsXRayed: vi.fn((ids: string[], xrayed: boolean) => { for (const id of ids) if (objects[id]) objects[id]!.xrayed = xrayed; }),
    getAABB: vi.fn((ids: string[]) => [0, 0, 0, ids.length, 1, 1]),
  };
  const cameraFlight = { flyTo: vi.fn() };
  return { scene, cameraFlight } as unknown as DtxCompatViewer;
}

const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  // useSceneGraphOps 用 rAF 合批：测试里下一拍执行（同步执行会让它的 rafId 永远非空、之后不再合批）
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 1; });
});

describe('useRoomTree', () => {
  it('loadRoots：在册房间按房间号自然序排（R43 < R143 < R432，字母段字典序），根节点没计数、flatRows 只有根；重复调用不重拉', async () => {
    const { source, rooms } = makeSource();
    const tree = useRoomTree({ value: null }, { source: () => source });
    expect(tree.rootsStatus.value.status).toBe('idle');
    await tree.loadRoots();
    expect(rooms).toHaveBeenCalledTimes(1);
    expect(tree.rootsStatus.value).toEqual({ status: 'ready', reason: null, total: 4 });
    expect(tree.roots.value.map((room) => room.room_num)).toEqual(['L505', 'R43', 'R143', 'R432']);
    expect(tree.flatRows.value).toEqual([
      { id: 'room:24381_5062', refno: '24381_5062', name: 'L505 · /1LR-RM05-L505', type: 'ROOM', depth: 0, hasChildren: true },
      { id: 'room:24381_9', refno: '24381_9', name: 'R43', type: 'ROOM', depth: 0, hasChildren: true },
      { id: 'room:24381_1407', refno: '24381_1407', name: 'R143 · /1RX-RM01-R143', type: 'ROOM', depth: 0, hasChildren: true },
      { id: 'room:24381_35580', refno: '24381_35580', name: 'R432 · /1RX-RM04-R432', type: 'ROOM', depth: 0, hasChildren: true },
    ]);
    await tree.loadRoots();
    expect(rooms).toHaveBeenCalledTimes(1);
    await tree.loadRoots(true);
    expect(rooms).toHaveBeenCalledTimes(2);
  });

  it('loadRoots：房间体制非 ready 折成 unavailable + 原因（disabled / unsupported / initializing），degraded 算 ready 带原因，取数抛错算 error', async () => {
    const disabled = makeSource({ rooms: vi.fn(async () => roomsResult({ status: 'disabled', reason: 'room_membership=false', rooms: [] })) as unknown as SpatialSource['rooms'] });
    const t1 = useRoomTree({ value: null }, { source: () => disabled.source });
    await t1.loadRoots();
    expect(t1.rootsStatus.value).toEqual({ status: 'unavailable', reason: 'room_membership=false', total: 0 });
    expect(t1.flatRows.value).toEqual([]);

    const unsupported = makeSource({ rooms: vi.fn(async () => roomsResult({ status: 'unsupported', reason: null, rooms: [] })) as unknown as SpatialSource['rooms'] });
    const t2 = useRoomTree({ value: null }, { source: () => unsupported.source });
    await t2.loadRoots();
    expect(t2.rootsStatus.value.status).toBe('unavailable');
    expect(t2.rootsStatus.value.reason).toContain('没有房间接口');

    const degraded = makeSource({ rooms: vi.fn(async () => roomsResult({ status: 'degraded', reason: '2 块面板无几何' })) as unknown as SpatialSource['rooms'] });
    const t3 = useRoomTree({ value: null }, { source: () => degraded.source });
    await t3.loadRoots();
    expect(t3.rootsStatus.value).toEqual({ status: 'ready', reason: '2 块面板无几何', total: 4 });

    const failing = makeSource({ rooms: vi.fn(async () => { throw new Error('boom'); }) as unknown as SpatialSource['rooms'] });
    const t4 = useRoomTree({ value: null }, { source: () => failing.source });
    await t4.loadRoots();
    expect(t4.rootsStatus.value).toEqual({ status: 'error', reason: 'boom', total: 0 });
  });

  it('搜索：按房间号 / 名字 / refno（a_b 或 a/b）不分大小写过滤根，只影响 flatRows 不影响 roots', async () => {
    const { source } = makeSource();
    const tree = useRoomTree({ value: null }, { source: () => source });
    await tree.loadRoots();
    tree.setFilter('r43');
    expect(tree.flatRows.value.map((row) => row.id)).toEqual(['room:24381_9', 'room:24381_35580']);
    tree.setFilter('RM05');
    expect(tree.flatRows.value.map((row) => row.id)).toEqual(['room:24381_5062']);
    tree.setFilter('24381/1407');
    expect(tree.flatRows.value.map((row) => row.id)).toEqual(['room:24381_1407']);
    tree.setFilter('zzz');
    expect(tree.flatRows.value).toEqual([]);
    expect(tree.roots.value).toHaveLength(4);
    tree.setFilter('');
    expect(tree.flatRows.value).toHaveLength(4);
  });

  it('展开一间房：只取一次 roomTree，根名字带计数，五层按展开状态进 flatRows；未内联的单元 hasChildren 仍为 true、展开时按 unit= 补叶子并合进树', async () => {
    const { source, roomTree } = makeSource();
    const tree = useRoomTree({ value: null }, { source: () => source });
    await tree.loadRoots();

    tree.toggleExpand('room:24381_35580');
    await flush();
    expect(roomTree).toHaveBeenCalledTimes(1);
    expect(roomTree).toHaveBeenCalledWith('24381_35580');
    expect(tree.isNodeLoading('room:24381_35580')).toBe(false);
    const rows = tree.flatRows.value;
    expect(rows.find((row) => row.id === 'room:24381_35580')!.name).toBe('R432 · /1RX-RM04-R432 · 5 个构件');
    // 根展开只露出专业这一层
    expect(rows.filter((row) => row.depth === 1).map((row) => row.id)).toEqual(['spec:24381_35580:3']);
    expect(rows.some((row) => row.depth === 2)).toBe(false);

    tree.toggleExpand('spec:24381_35580:3');
    tree.toggleExpand('utype:24381_35580:3:EQUI');
    const equiUnit = tree.flatRows.value.find((row) => row.id === 'unit:24381_35580:24381_7000')!;
    expect(equiUnit).toMatchObject({ refno: '24381_7000', name: '/E1 · 3', type: 'EQUI', depth: 3, hasChildren: true });

    // 展开未内联的单元 → roomTree(room, undefined, { unit }) 补叶子；合进树后三条构件挂在它下面
    tree.toggleExpand('unit:24381_35580:24381_7000');
    expect(tree.isNodeLoading('unit:24381_35580:24381_7000')).toBe(true);
    await flush();
    expect(roomTree).toHaveBeenCalledTimes(2);
    expect(roomTree).toHaveBeenLastCalledWith('24381_35580', undefined, { unit: '24381_7000' });
    expect(tree.isNodeLoading('unit:24381_35580:24381_7000')).toBe(false);
    const leaves = tree.flatRows.value.filter((row) => row.depth === 4);
    expect(leaves.map((row) => row.refno)).toEqual(['24381_7001', '24381_7002', '24381_1241']);
    expect(tree.nodesById.value['unit:24381_35580:24381_7000']!.leavesInline).toBe(true);

    // 收起再展开：不再取
    tree.toggleExpand('room:24381_35580');
    expect(tree.flatRows.value).toHaveLength(4);
    tree.toggleExpand('room:24381_35580');
    await flush();
    expect(roomTree).toHaveBeenCalledTimes(2);
    // 展开状态还在：专业 / EQUI / 单元都仍展开
    expect(tree.flatRows.value.filter((row) => row.depth === 4)).toHaveLength(3);
  });

  it('展开一间房失败（房间没有盒 → success:false）：根不出子节点、nodeError 有一句；再展开一次会重试', async () => {
    const roomTree = vi.fn(async () => ({ ...r432Tree(), success: false, error: '房间 24381_35580 还没有包围盒', rooms: [] } as SpatialTreeResult));
    const { source } = makeSource({ roomTree: roomTree as unknown as SpatialSource['roomTree'] });
    const tree = useRoomTree({ value: null }, { source: () => source });
    await tree.loadRoots();
    tree.toggleExpand('room:24381_35580');
    await flush();
    expect(tree.nodeError('room:24381_35580')).toBe('房间 24381_35580 还没有包围盒');
    expect(tree.flatRows.value).toHaveLength(4);
    tree.toggleExpand('room:24381_35580');
    tree.toggleExpand('room:24381_35580');
    await flush();
    expect(roomTree).toHaveBeenCalledTimes(2);
  });

  it('眼睛：节点下全部构件（先补齐未内联的）写进场景显隐，勾选整枝改、父链推导 indeterminate / unchecked；setVisible 回 true 只对已加载对象生效；单元级及以上连所属 BRAN 的整体（直段 + 房间外构件）一起', async () => {
    const viewer = makeViewer(['24381_1240', '24381_7001']);
    const { source, roomTree } = makeSource();
    const tree = useRoomTree({ value: viewer }, { source: () => source });
    await tree.loadRoots();
    tree.toggleExpand('room:24381_35580');
    await flush();

    // 隐藏 BRAN 单元：两条构件 + BRAN 自己（直管挂在它名下）+ 记录里房间外的 24381_1242 → setObjectsVisible(false)；单元与其下 unchecked、专业 / 房间 indeterminate
    await tree.setVisible('unit:24381_35580:24381_1200', false);
    await flush();
    expect(viewer.scene.setObjectsVisible).toHaveBeenCalledWith(['24381_1240', '24381_1241', '24381_1200', '24381_1242'], false);
    expect(await tree.collectRefnos('unit:24381_35580:24381_1200'), '「加载模型」仍只数节点下列出的构件').toEqual(['24381_1240', '24381_1241']);
    expect(tree.getCheckState('unit:24381_35580:24381_1200')).toBe('unchecked');
    expect(tree.getCheckState('elem:24381_35580:24381_1241')).toBe('unchecked');
    expect(tree.getCheckState('utype:24381_35580:3:BRAN')).toBe('unchecked');
    expect(tree.getCheckState('spec:24381_35580:3')).toBe('indeterminate');
    expect(tree.getCheckState('room:24381_35580')).toBe('indeterminate');
    expect(tree.getCheckState('utype:24381_35580:3:EQUI')).toBe('checked');

    // 隐藏整间房：EQUI 单元的叶子未内联 → 先按 unit= 补，再把四个构件 + BRAN 整体（自己 + 房间外的 1242）都写进去；全树 unchecked
    await tree.setVisible('room:24381_35580', false);
    await flush();
    expect(roomTree).toHaveBeenLastCalledWith('24381_35580', undefined, { unit: '24381_7000' });
    const lastCall = (viewer.scene.setObjectsVisible as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect([...(lastCall[0] as string[])].sort()).toEqual(['24381_1200', '24381_1240', '24381_1241', '24381_1242', '24381_7001', '24381_7002']);
    expect(lastCall[1]).toBe(false);
    expect(tree.getCheckState('room:24381_35580')).toBe('unchecked');
    expect(tree.getCheckState('unit:24381_35580:24381_7000')).toBe('unchecked');
    expect(tree.getCheckState('elem:24381_35580:24381_7002')).toBe('unchecked');

    // 再显示 EQUI 单元：它这一枝 checked，房间回到 indeterminate；它名下混着的 ELBO 24381_1241 是管件 → 所属 BRAN 整体跟着显
    await tree.setVisible('unit:24381_35580:24381_7000', true);
    await flush();
    expect(tree.getCheckState('unit:24381_35580:24381_7000')).toBe('checked');
    expect(viewer.scene.setObjectsVisible).toHaveBeenLastCalledWith(['24381_7001', '24381_7002', '24381_1241', '24381_1200', '24381_1240', '24381_1242'], true);
    expect(tree.getCheckState('utype:24381_35580:3:EQUI')).toBe('checked');
    expect(tree.getCheckState('room:24381_35580')).toBe('indeterminate');
  });

  it('选中：单击一行把节点下已知构件选进场景、回唯一的单元 / 构件 refno 给全局选中；分组节点回 null；Ctrl 多选、Shift 连选；定位 / 隔离只碰已加载对象', async () => {
    const viewer = makeViewer(['24381_1240']);
    const { source } = makeSource();
    const tree = useRoomTree({ value: viewer }, { source: () => source });
    await tree.loadRoots();
    tree.toggleExpand('room:24381_35580');
    await flush();
    tree.toggleExpand('spec:24381_35580:3');
    tree.toggleExpand('utype:24381_35580:3:BRAN');
    tree.toggleExpand('unit:24381_35580:24381_1200');
    const rows = tree.flatRows.value;
    const indexOf = (id: string) => rows.findIndex((row) => row.id === id);
    const click = (opts: Partial<MouseEvent> = {}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...opts } as MouseEvent);

    expect(tree.selectByRowIndex(indexOf('elem:24381_35580:24381_1240'), click())).toBe('24381_1240');
    expect(tree.isRowSelected('elem:24381_35580:24381_1240')).toBe(true);
    await flush();
    expect(viewer.scene.setObjectsSelected).toHaveBeenLastCalledWith(['24381_1240'], true);
    expect(tree.selectByRowIndex(indexOf('unit:24381_35580:24381_1200'), click())).toBe('24381_1200');
    expect(tree.selectByRowIndex(indexOf('spec:24381_35580:3'), click())).toBeNull();
    expect(tree.selectByRowIndex(indexOf('elem:24381_35580:24381_1241'), click({ ctrlKey: true }))).toBeNull();
    expect(tree.selectedIds.value.size).toBe(2);
    expect(tree.selectByRowIndex(indexOf('room:24381_35580'), click())).toBeNull();
    expect(tree.selectByRowIndex(indexOf('unit:24381_35580:24381_1200'), click({ shiftKey: true }))).toBeNull();
    expect(tree.selectedIds.value.size).toBe(4);

    // 飞行：只有 24381_1240 在场景里 → 按它的 AABB 飞；节点下一个都没加载 → false
    expect(await tree.flyTo('unit:24381_35580:24381_1200')).toBe(true);
    expect(viewer.scene.getAABB).toHaveBeenCalledWith(['24381_1240']);
    expect(viewer.cameraFlight.flyTo).toHaveBeenCalledTimes(1);
    expect(await tree.flyTo('utype:24381_35580:3:EQUI')).toBe(false);

    // 隔离单元：其余 XRAY，留实体的是两条构件 + BRAN 自己（直段）+ 房间外的 1242——管件不悬空
    await tree.isolateXray('unit:24381_35580:24381_1200');
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_1240'], true);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_1240', '24381_1241', '24381_1200', '24381_1242'], false);
    tree.clearXray();
    expect(viewer.scene.setObjectsXRayed).toHaveBeenLastCalledWith(['24381_1240'], false);

    // 构件行不扩：隔离一个 ELBO 就只留它自己
    await tree.isolateXray('elem:24381_35580:24381_1241');
    expect(viewer.scene.setObjectsXRayed).toHaveBeenLastCalledWith(['24381_1241'], false);
  });

  it('sceneCompanions 可注桩：注入的函数收到节点下的构件与 BRAN 单元 refno，回什么就多动什么', async () => {
    const viewer = makeViewer(['24381_1240']);
    const { source } = makeSource();
    const sceneCompanions = vi.fn((_refnos: string[], units: string[]) => units.map((unit) => `${unit}:tubi`));
    const tree = useRoomTree({ value: viewer }, { source: () => source, sceneCompanions });
    await tree.loadRoots();
    tree.toggleExpand('room:24381_35580');
    await flush();
    expect(await tree.collectSceneRefnos('utype:24381_35580:3:BRAN')).toEqual(['24381_1240', '24381_1241', '24381_1200:tubi']);
    expect(sceneCompanions).toHaveBeenLastCalledWith(['24381_1240', '24381_1241'], ['24381_1200']);
    expect(await tree.collectSceneRefnos('elem:24381_35580:24381_1240'), '构件行不问').toEqual(['24381_1240']);
  });

  it('revealRefno（外部选中联动）：refno 在已取过树的房里 → 展开到它、单选它、回 flatRows 下标；a/b 形式也认；单元 refno 落在单元行；没取过树的房 / 不在树里 → null 且不动展开', async () => {
    const { source, roomTree } = makeSource();
    const tree = useRoomTree({ value: null }, { source: () => source });
    await tree.loadRoots();

    // 树还没取：找不到，也不去拉
    expect(tree.revealRefno('24381_1241')).toBeNull();
    expect(roomTree).not.toHaveBeenCalled();

    tree.toggleExpand('room:24381_35580');
    await flush();
    // 只展开了房间这一层；联动要把 专业 → 单元类型 → 单元 一路展开
    const hit = tree.revealRefno('24381/1241');
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe('elem:24381_35580:24381_1241');
    expect(tree.expandedIds.value.has('spec:24381_35580:3')).toBe(true);
    expect(tree.expandedIds.value.has('utype:24381_35580:3:BRAN')).toBe(true);
    expect(tree.expandedIds.value.has('unit:24381_35580:24381_1200')).toBe(true);
    expect(Array.from(tree.selectedIds.value)).toEqual(['elem:24381_35580:24381_1241']);
    expect(tree.flatRows.value[hit!.index]?.id).toBe('elem:24381_35580:24381_1241');
    expect(tree.isRowSelected('elem:24381_35580:24381_1241')).toBe(true);

    // 单元的 refno → 单元行
    const unitHit = tree.revealRefno('24381_7000');
    expect(unitHit?.id).toBe('unit:24381_35580:24381_7000');
    expect(Array.from(tree.selectedIds.value)).toEqual(['unit:24381_35580:24381_7000']);

    // 树里没有的构件：null，选中不变
    expect(tree.revealRefno('1_1')).toBeNull();
    expect(Array.from(tree.selectedIds.value)).toEqual(['unit:24381_35580:24381_7000']);
    expect(roomTree).toHaveBeenCalledTimes(1);
  });

  it('reset：清空清单 / 节点 / 展开 / 勾选，再 loadRoots 重新拉', async () => {
    const { source, rooms } = makeSource();
    const tree = useRoomTree({ value: null }, { source: () => source });
    await tree.loadRoots();
    tree.toggleExpand('room:24381_35580');
    await flush();
    tree.reset();
    expect(tree.flatRows.value).toEqual([]);
    expect(tree.rootsStatus.value.status).toBe('idle');
    await tree.loadRoots(true);
    expect(rooms).toHaveBeenCalledTimes(2);
    expect(tree.flatRows.value).toHaveLength(4);
  });
});

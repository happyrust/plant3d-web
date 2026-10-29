/**
 * 「关联房间」浮窗的全局状态（plant-ui 房间页签的对应物，2026-10-16）：
 * 入口 = PDMS 树 / 房间树 / 三维视口右键「查看关联房间」与属性面板「房间」钮——四处都开同一张卡。
 *
 * 两段数据两个口径，与 plant-ui `workbench/room.rs` 同构：
 * - 归属列表：`POST /api/v1/query` 的 `e3d.room.lookup`（`genModelV1RoomApi.ts`），服务端已按
 *   inside_count 降序 → center_dist 升序 → room_num 升序排好，首条是主归属；
 * - 房间详情 + 成员：`GET /api/v1/spatial/rooms/{refno}/tree`（`SpatialSource.roomTree`）——
 *   服务端聚合的 房间 → 专业 → 单元类型 → 单元 → 构件。浮窗里只画**扁平成员预览**（按 refno 去重、
 *   距离升序、封顶 `MEMBER_PREVIEW_LIMIT`）；层级全量在模型树「房间」页签，`viewInRoomTab` 跳过去。
 *
 * 与 plant-ui 的口径差异（v1 接口给不出的就不装出来）：成员没有 inside_count（预览按距离排）、
 * 没有 via_member 标记、没有房间码 / 待重算横幅。
 */
import { computed, ref, shallowRef } from 'vue';

import type { SpatialRoomOption, SpatialTreeLeafSelector, SpatialTreeResult } from '@/api/genModelSpatialApi';
import type { SpatialSource } from '@/model-source/ports';

import { genModelV1RoomLookup, type RoomLookupResult } from '@/api/genModelV1RoomApi';
import { branUnitRefnosCoveredBy, forEachTreeLeaf, mergeTreeLeaves, treeNodeLeavesInline } from '@/composables/spatialTree';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { enterRoomView, resolveRoomPanelRefnosWithFallback } from '@/composables/useRoomClip';
import { useSceneGraphOps } from '@/composables/useSceneGraph';
import { setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { showModelByRefnosWithAck, useViewerContext } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';
import { toRefnoKey } from '@/utils/refnoKey';
import { flyToScope } from '@/viewer/camera/focusScope';

/** 成员预览上限（plant-ui 的「成员预览」也是截断的：全量请去「房间」页签）。 */
export const MEMBER_PREVIEW_LIMIT = 50;
/** 「加载房间模型」批量确认阈值（与抽屉 / 房间树同一把尺）。 */
const LARGE_BATCH_LOAD_CONFIRM_THRESHOLD = 200;
/** 收集全部成员 / 补预览时最多为多少组未内联叶子补数（与 useRoomTree.collectRefnos 同口径）。 */
const MAX_LEAF_GROUPS = 64;

export type RoomInfoPhase = 'idle' | 'loading' | 'ready' | 'error';

/** 成员预览的一行（`SpatialTreeLeafNode` 的展示形）。 */
export type RoomMemberRow = {
  refno: string;
  noun: string;
  /** 到房间盒的距离 mm（树接口的距离口径，不是 inside_count） */
  distance: number;
  sharedRooms?: number;
};

const open = ref(false);
const elementRefno = ref<string | null>(null);
const phase = ref<RoomInfoPhase>('idle');
const errorMessage = ref<string | null>(null);
const lookup = shallowRef<RoomLookupResult | null>(null);

/** 在册房间清单（refno → 选项）：归属边里只有房号，名字 / 面板数从这里补。 */
const roomCatalog = shallowRef<Map<string, SpatialRoomOption> | null>(null);
const catalogStatus = ref<string | null>(null);

/** 当前聚焦的房间（`a_b`）与它的树 / 取数态；`null` = 还没点过房间。 */
const focusedRoom = ref<string | null>(null);
const detailPhase = ref<RoomInfoPhase>('idle');
const detailError = ref<string | null>(null);
const roomTree = shallowRef<SpatialTreeResult | null>(null);

/** 「在『房间』页签中查看全部」的请求：ModelTreePanel 监听它切页签并展开该房间。 */
const roomRevealRequest = shallowRef<{ refno: string; seq: number } | null>(null);
let revealSeq = 0;

let querySeq = 0;
let detailSeq = 0;

async function spatialSource(): Promise<SpatialSource> {
  const { getModelSource } = await import('@/model-source');
  return getModelSource().spatial;
}

// 归一化统一收口到 toRefnoKey（修「只替换首个斜杠」），保留函数名以免动调用点。
function normalizeRefno(refno: string): string {
  return toRefnoKey(refno);
}

/** `calculation_status` 的字面意思 → 给用户看的一句（memberships 为空时才有意义）。 */
function emptyStatusText(status: string, roomMembership: boolean): string {
  if (!roomMembership) return '服务端未开启房间归属计算（room_membership=false）';
  switch (status) {
    case 'computed':
    case 'ready_empty': return '该构件算过归属，不属于任何房间';
    case 'not_computed': return '该构件还没参与归属计算（可能还没生成过模型）';
    case 'disabled': return '服务端未开启房间归属计算';
    case 'initializing': return '房间模型正在就绪，稍后再试';
    case 'failed': return '房间模型构建失败';
    default: return `归属查询状态：${status}`;
  }
}

/** 打开浮窗并对 `refno` 发归属查询；重复打开同一构件也重查（归属会随重算变）。 */
export function openRoomInfo(refno: string): void {
  const key = normalizeRefno(refno);
  if (!key) return;
  elementRefno.value = key;
  open.value = true;
  focusedRoom.value = null;
  detailPhase.value = 'idle';
  detailError.value = null;
  roomTree.value = null;

  const seq = ++querySeq;
  phase.value = 'loading';
  errorMessage.value = null;
  lookup.value = null;
  void (async () => {
    try {
      const [result, catalog] = await Promise.all([
        genModelV1RoomLookup(key),
        loadRoomCatalog(),
      ]);
      if (seq !== querySeq) return;
      lookup.value = result;
      roomCatalog.value = catalog;
      phase.value = 'ready';
    } catch (error) {
      if (seq !== querySeq) return;
      phase.value = 'error';
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  })();
}

/** 在册房间清单只为补名字 / 面板数；拿不到不当错误（归属照常列，名字退回房号）。 */
async function loadRoomCatalog(): Promise<Map<string, SpatialRoomOption> | null> {
  try {
    const result = await (await spatialSource()).rooms();
    catalogStatus.value = result.status;
    if (!result.success || !Array.isArray(result.rooms)) return null;
    return new Map(result.rooms.map((room) => [room.refno, room]));
  } catch {
    return null;
  }
}

function retry(): void {
  if (elementRefno.value) openRoomInfo(elementRefno.value);
}

/** 树响应里的那间房（契约 `rooms[]` 恒一条，取不到就退第一条）。 */
function roomNodeOf(tree: SpatialTreeResult, roomRefno: string) {
  return tree.rooms.find((room) => room.refno === roomRefno) ?? tree.rooms[0] ?? null;
}

/**
 * 无边界面板的在册房（`panel_count === 0`，源模型里是空房壳）合成的空树：成员按面板归属恒空，
 * `rooms/{refno}/tree` 恒答不出——不再发请求，浮窗直接落「面板 0 · 成员 0 / 这间房没有成员」的 ready 态
 * （2026-10-16；在册清单 `panel_count` 是启动时生成的事实，不是懒查出来的）。
 */
function emptyRoomTreeResult(option: SpatialRoomOption): SpatialTreeResult {
  return {
    success: true,
    total_count: 0,
    candidate_count: 0,
    truncated_candidates: false,
    candidate_cap: 0,
    leaves_inline: true,
    leaf_cap: 0,
    leaf_count: 0,
    delivery_unit_types: [],
    rooms: [{ refno: option.refno, room_num: option.room_num, name: option.name, count: 0, specs: [] }],
  };
}

/** 还没有内联叶子的单元 / noun 组的选择器（`unit=` / `other_noun=` 补数用）。 */
function pendingLeafSelectors(tree: SpatialTreeResult, roomRefno: string): SpatialTreeLeafSelector[] {
  const room = roomNodeOf(tree, roomRefno);
  if (!room) return [];
  const out: SpatialTreeLeafSelector[] = [];
  for (const spec of room.specs) {
    for (const group of spec.unit_types) {
      for (const unit of group.units) {
        if (!Array.isArray(unit.elements)) out.push({ unit: unit.refno });
      }
    }
    for (const group of spec.others.by_noun) {
      if (!Array.isArray(group.elements)) out.push({ otherNoun: group.noun });
    }
  }
  return out;
}

/** 当前树里已知成员的扁平集（refno 去重、距离升序）；未内联的部分不在里面。 */
function memberRowsOf(tree: SpatialTreeResult, roomRefno: string): RoomMemberRow[] {
  const room = roomNodeOf(tree, roomRefno);
  if (!room) return [];
  const seen = new Set<string>();
  const rows: RoomMemberRow[] = [];
  forEachTreeLeaf({ ...tree, rooms: [room] }, (leaf) => {
    if (seen.has(leaf.refno)) return;
    seen.add(leaf.refno);
    rows.push({
      refno: leaf.refno,
      noun: leaf.noun,
      distance: leaf.distance,
      ...(typeof leaf.shared_rooms === 'number' ? { sharedRooms: leaf.shared_rooms } : {}),
    });
  });
  rows.sort((a, b) => a.distance - b.distance || a.refno.localeCompare(b.refno));
  return rows;
}

/** 选中一间房 → 取它的树；预览不够 `MEMBER_PREVIEW_LIMIT` 时再按选择器补几组叶子。 */
async function focusRoom(roomRefno: string): Promise<void> {
  const room = normalizeRefno(roomRefno);
  if (!room) return;
  focusedRoom.value = room;
  const seq = ++detailSeq;
  detailPhase.value = 'loading';
  detailError.value = null;
  roomTree.value = null;
  // 无边界面板的在册房：清单 `panel_count === 0` 已定恒空，合成空树 → ready 空态（清单没取到时退回真实请求）
  const option = roomOptionOf(room);
  if (option && option.panel_count === 0) {
    roomTree.value = emptyRoomTreeResult(option);
    detailPhase.value = 'ready';
    return;
  }
  try {
    const source = await spatialSource();
    let tree = await source.roomTree(room);
    if (!tree.success) {
      if (seq !== detailSeq) return;
      detailPhase.value = 'error';
      detailError.value = tree.error || '房间层级树取数失败';
      return;
    }
    // 预览没坐满且还有没内联的叶子组：按选择器补几组（预览最多 50 行，补 8 组封顶）
    for (const selector of pendingLeafSelectors(tree, room).slice(0, 8)) {
      if (memberRowsOf(tree, room).length >= MEMBER_PREVIEW_LIMIT) break;
      const partial = await source.roomTree(room, undefined, selector);
      if (seq !== detailSeq) return;
      if (partial.success) tree = mergeTreeLeaves(tree, partial);
    }
    if (seq !== detailSeq) return;
    roomTree.value = tree;
    detailPhase.value = 'ready';
  } catch (error) {
    if (seq !== detailSeq) return;
    detailPhase.value = 'error';
    detailError.value = error instanceof Error ? error.message : String(error);
  }
}

/** 全部成员 refno：把没内联的叶子组按选择器补齐（封顶 `MAX_LEAF_GROUPS` 组）再收。 */
async function collectRoomRefnos(): Promise<{ refnos: string[]; complete: boolean }> {
  const room = focusedRoom.value;
  const tree = roomTree.value;
  if (!room || !tree) return { refnos: [], complete: false };
  let merged = tree;
  const pending = pendingLeafSelectors(merged, room);
  const source = await spatialSource();
  for (const selector of pending.slice(0, MAX_LEAF_GROUPS)) {
    const partial = await source.roomTree(room, undefined, selector);
    if (!partial.success) continue;
    merged = mergeTreeLeaves(merged, partial);
  }
  roomTree.value = merged;
  const node = roomNodeOf(merged, room);
  const complete = !!node && pending.length <= MAX_LEAF_GROUPS
    && treeNodeLeavesInline({ kind: 'room', node });
  return { refnos: memberRowsOf(merged, room).map((row) => row.refno), complete };
}

/** 「加载房间模型」：全部成员经 `showModelByRefnosWithAck` 装进场景并飞过去；> 200 个先确认。 */
async function loadRoomModels(): Promise<void> {
  const confirmDialog = useConfirmDialogStore();
  const { refnos, complete } = await collectRoomRefnos();
  if (refnos.length === 0) {
    emitToast({ message: '这间房还没有成员（或成员树取数失败）', level: 'info' });
    return;
  }
  if (refnos.length > LARGE_BATCH_LOAD_CONFIRM_THRESHOLD) {
    const ok = await confirmDialog.open({
      title: '加载数量较多',
      message: `「加载房间模型」将加载 ${refnos.length} 个模型（超过 ${LARGE_BATCH_LOAD_CONFIRM_THRESHOLD} 个），可能要等一会儿。继续吗？`,
      confirmText: `加载 ${refnos.length} 个`,
    });
    if (!ok) return;
  }
  const result = await showModelByRefnosWithAck({ refnos, flyTo: true, timeoutMs: 120_000, ensureViewerReady: true });
  if (result.error) {
    emitToast({ message: result.error, level: 'error' });
  } else if (result.fail.length > 0) {
    emitToast({ message: `${result.ok.length} 个已加载，${result.fail.length} 个失败：${result.fail[0]?.error ?? ''}`, level: 'warning' });
  } else if (!complete) {
    emitToast({ message: '成员过多，部分分组的构件没取全', level: 'info' });
  }
}

/** 「聚焦飞行」：飞到成员里**已加载**几何的并集盒；一个都没加载时提示先加载（与房间树 flyTo 同语义）。 */
function flyToRoom(): void {
  const viewer = useViewerContext().viewerRef.value;
  if (!viewer) return;
  const loaded = memberRows.value
    .map((row) => row.refno)
    .filter((refno) => !!viewer.scene.objects[refno]);
  if (loaded.length === 0) {
    emitToast({ message: '这间房还没有已加载几何的构件，先「加载房间模型」再聚焦', level: 'info' });
    return;
  }
  void flyToScope(viewer, { refnos: loaded, source: 'room' });
}

/**
 * 「隔离成员」：
 * - 若在册房间清单带有 `panel_refnos`，进入完整「房间视图」（半透明房间体 + 穿墙直段截断 + 洋红断口 + 视口 HUD）；
 * - 否则回退到按 `refnos + covered BRAN` 隔离。
 */
async function isolateRoom(): Promise<void> {
  const viewer = useViewerContext().viewerRef.value;
  if (!viewer) return;
  const { refnos } = await collectRoomRefnos();
  if (refnos.length === 0) {
    emitToast({ message: '这间房还没有成员（或成员树取数失败）', level: 'info' });
    return;
  }
  const room = focusedRoom.value;
  const tree = roomTree.value;
  const node = focusedRoomNode.value;
  const covered = tree && node
    ? branUnitRefnosCoveredBy({ ...tree, rooms: [node] }, refnos)
    : [];
  const option = roomOptionOf(room);
  if (room) {
    const panelRefnos = await resolveRoomPanelRefnosWithFallback(room, option);
    if (panelRefnos.length > 0) {
      await enterRoomView({
        roomRefno: room,
        roomNum: node?.room_num || option?.room_num || room,
        roomName: node?.name ?? option?.name ?? null,
        panelRefnos,
        memberRefnos: refnos,
        tubeCarriers: covered,
        viewer,
      });
      return;
    }
  }
  const keep = [...new Set([...refnos, ...covered])];
  useSceneGraphOps(useViewerContext().viewerRef).isolate(keep);
}

/** 成员行点击 = 全局选中（属性面板跟着切、PDMS 树按既有联动定位）。 */
function locateMember(refno: string): void {
  setGlobalSelectedRefno(refno);
}

/** 「在『房间』页签中查看全部」：ModelTreePanel 监听请求切页签、展开并滚到这间房。 */
function viewInRoomTab(roomRefno: string): void {
  roomRevealRequest.value = { refno: normalizeRefno(roomRefno), seq: ++revealSeq };
  // 模型树面板可能还没开：先确保面板存在再发请求（watch immediate 会兜住时序）
  import('@/composables/useDockApi').then(({ ensurePanelAndActivate }) => {
    ensurePanelAndActivate('modelTree');
  });
}

const memberships = computed(() => lookup.value?.memberships ?? []);

const focusedRoomNode = computed(() => {
  const tree = roomTree.value;
  const room = focusedRoom.value;
  return tree && room ? roomNodeOf(tree, room) : null;
});

const memberRows = computed<RoomMemberRow[]>(() => {
  const tree = roomTree.value;
  const room = focusedRoom.value;
  return tree && room ? memberRowsOf(tree, room) : [];
});

const memberPreview = computed(() => memberRows.value.slice(0, MEMBER_PREVIEW_LIMIT));

/** 房间号 / 名字 / 面板数：归属边给房号，在册清单给名字与面板数；都不在册时行上只有房号。 */
function roomOptionOf(roomRefno: string | null): SpatialRoomOption | null {
  return roomRefno ? roomCatalog.value?.get(roomRefno) ?? null : null;
}

function close(): void {
  open.value = false;
}

export function useRoomInfo() {
  return {
    open,
    elementRefno,
    phase,
    errorMessage,
    lookup,
    memberships,
    catalogStatus,
    focusedRoom,
    detailPhase,
    detailError,
    roomTree,
    focusedRoomNode,
    memberRows,
    memberPreview,
    roomRevealRequest,
    openRoomInfo,
    close,
    retry,
    focusRoom,
    roomOptionOf,
    emptyStatusText,
    loadRoomModels,
    flyToRoom,
    isolateRoom,
    locateMember,
    viewInRoomTab,
  };
}

export type RoomInfoStore = ReturnType<typeof useRoomInfo>;

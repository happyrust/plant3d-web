/**
 * 模型树「房间」页签的状态（ADR 0068；plan `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md` §4.5，2026-09-21 改法）：
 * 根 = 在册房间平铺一层（`SpatialSource.rooms()`，按房间号排、顶上搜索框按房间号 / 名字 / refno 过滤），展开一间房才取
 * `SpatialSource.roomTree(refno)` 那棵 房间 → 专业 → 最小交付单元类型 → 单元 → 构件；叶子未内联（服务端超上限）的单元 / noun 组
 * 第一次展开或动作前再按 `unit=` / `other_noun=` 补一次。一间房的树取一次缓存在这里，各层从缓存切。
 *
 * 显隐 / 选中 / 定位 / 隔离只作用于该节点下**已知**的构件 refno（场景对象键 `a_b`），未加载几何的构件靠 `useSceneGraphOps` 把状态
 * 写进 compat scene、实例加载时回放；勾选状态由子构件推导（分组节点是合成 id，没有场景对象）。退役前的 `useRoomTree`（走旧后端
 * `/api/room-tree/*`）已随 legacy 删除，本文件是按新端口重写的精简版：没有 `room-group` / `comp-group` 那两层，也没有类型筛选。
 *
 * 管件要带直段（2026-09-21，`deliveryUnitScene.ts`）：直管挂在 BRAN 自己的 refno 上、树上不列，所以单元级及以上的显隐 / 隔离
 * 除了节点下列出的构件，还带上这些构件所属 BRAN 的整体（BRAN 自己 + 记录缓存里它的全部构件）；构件行的眼睛与定位不扩。
 * 直段行（方案 B，2026-09-22）在 BRAN 单元的构件行之后列出；它的眼睛是**逐段**的（T4）：只动场景里那一段直管对象
 * （`DtxCompatScene.setTubeSegmentsVisible`，对象级、不进 refno 状态表），所属 BRAN 的 refno 级动作一来整条覆盖。
 */
import { computed, ref, shallowRef } from 'vue';

import type { SpatialRoomOption, SpatialTreeResult } from '@/api/genModelSpatialApi';
import type { CheckState, FlatRow } from '@/composables/useModelTree';
import type { SpatialSource } from '@/model-source/ports';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { sceneCompanionsOf } from '@/composables/deliveryUnitScene';
import {
  ancestorsOf,
  branUnitRefnosUnder,
  flattenRoomTree,
  isRoomNodeId,
  pendingLeafNodesUnder,
  refnosUnder,
  roomNodeId,
  roomRefnoOfNodeId,
  roomRootNode,
  type RoomTreeNode,
} from '@/composables/roomTreeNodes';
import { mergeTreeLeaves, tubeKey } from '@/composables/spatialTree';
import { isDtxTubeSegmentHidden, isDtxTubeSegmentLoadedAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { useSceneGraphOps } from '@/composables/useSceneGraph';
import { resolveSceneWorldTransform } from '@/composables/useSpatialQuery';
import { getModelSource } from '@/model-source';

type Aabb6 = [number, number, number, number, number, number];

export type RoomTreeRootsStatus = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  /** 非 ready 时给用户看的一句 */
  reason: string | null;
  /** 在册房间数（ready 时） */
  total: number;
};

export type RoomTreeOptions = {
  /** 数据源按调用时刻解析（与 `useSpatialQuery` 同法），测试注桩 */
  source?: () => SpatialSource;
  /**
   * 「管件带直段」：节点下的构件 + 节点下的 BRAN 单元 → 场景里还该一起显隐 / 隔离的 refno（BRAN 自己 + 它在记录缓存里的全部构件）。
   * 缺省 `sceneCompanionsOf`（读 gen-model 记录缓存，不发请求）；测试注桩。
   */
  sceneCompanions?: (refnos: string[], branUnitRefnos: string[]) => string[];
  /** 逐段眼睛（T4）：这一段直管是否被单独藏起来了 / 对象是否已在场景里。缺省读 DTX 加载链的运行时索引；测试注桩。 */
  tubeSegmentHidden?: (key: string) => boolean;
  tubeSegmentLoaded?: (key: string) => boolean;
};

/** 逐段眼睛点在没装进场景的直段上时 `setVisible` 的回答（调用方据此提示先加载所属 BRAN）。 */
export type RoomTreeSetVisibleResult = 'applied' | 'tube-not-loaded';

/** 房间号自然序（`R43` < `R432`，字母段按字典序）。 */
function compareRoomNum(a: SpatialRoomOption, b: SpatialRoomOption): number {
  return a.room_num.localeCompare(b.room_num, undefined, { numeric: true, sensitivity: 'base' })
    || (a.name ?? '').localeCompare(b.name ?? '')
    || a.refno.localeCompare(b.refno);
}

export function useRoomTree(viewerRef: { value: DtxCompatViewer | null }, options: RoomTreeOptions = {}) {
  const source = options.source ?? (() => getModelSource().spatial);
  const sceneCompanions = options.sceneCompanions ?? sceneCompanionsOf;
  const tubeSegmentHidden = options.tubeSegmentHidden ?? isDtxTubeSegmentHidden;
  const tubeSegmentLoaded = options.tubeSegmentLoaded ?? isDtxTubeSegmentLoadedAcrossAllDbnos;
  const sceneGraph = useSceneGraphOps(viewerRef);

  const roots = ref<SpatialRoomOption[]>([]);
  const rootsStatus = ref<RoomTreeRootsStatus>({ status: 'idle', reason: null, total: 0 });
  const filterText = ref('');

  /** 全部节点（各房间的树展开后合进来）；房间根在清单到手时先放一份没计数的 */
  const nodesById = shallowRef<Record<string, RoomTreeNode>>({});
  /** 每间房取回的整树（补叶子时 `mergeTreeLeaves` 后再展一遍） */
  const treesByRoom = new Map<string, SpatialTreeResult>();
  /** 房间树 / 叶子的取数状态：正在取的节点 id 与失败原因 */
  const loadingIds = ref<Set<string>>(new Set());
  const errorById = ref<Map<string, string>>(new Map());
  const roomTreeLoaded = new Set<string>();

  const expandedIds = ref<Set<string>>(new Set());
  const selectedIds = ref<Set<string>>(new Set());
  const lastAnchorIndex = ref<number | null>(null);
  const checkStateById = ref<Map<string, CheckState>>(new Map());

  let rootsSeq = 0;

  function setLoading(id: string, loading: boolean) {
    const next = new Set(loadingIds.value);
    if (loading) next.add(id); else next.delete(id);
    loadingIds.value = next;
  }

  function setError(id: string, message: string | null) {
    const next = new Map(errorById.value);
    if (message) next.set(id, message); else next.delete(id);
    errorById.value = next;
  }

  /** 在册房间清单。`force` 重拉；非 ready 的房间体制状态折成 `unavailable` + 原因，不当错误。 */
  async function loadRoots(force = false): Promise<void> {
    if (!force && (rootsStatus.value.status === 'loading' || rootsStatus.value.status === 'ready')) return;
    const seq = ++rootsSeq;
    rootsStatus.value = { status: 'loading', reason: null, total: 0 };
    try {
      const result = await source().rooms();
      if (seq !== rootsSeq) return;
      if (!result.success) {
        rootsStatus.value = { status: 'error', reason: result.error || '房间清单取数失败', total: 0 };
        return;
      }
      if (result.status !== 'ready' && result.status !== 'degraded') {
        rootsStatus.value = { status: 'unavailable', reason: result.reason || roomsStatusFallback(result.status), total: 0 };
        roots.value = [];
        return;
      }
      const sorted = [...result.rooms].sort(compareRoomNum);
      roots.value = sorted;
      const nextNodes: Record<string, RoomTreeNode> = { ...nodesById.value };
      for (const room of sorted) {
        const id = roomNodeId(room.refno);
        if (!nextNodes[id]) nextNodes[id] = roomRootNode(room);
      }
      nodesById.value = nextNodes;
      rootsStatus.value = {
        status: 'ready',
        reason: result.status === 'degraded' ? (result.reason || '房间体制降级运行') : null,
        total: sorted.length,
      };
    } catch (error) {
      if (seq !== rootsSeq) return;
      rootsStatus.value = { status: 'error', reason: error instanceof Error ? error.message : String(error), total: 0 };
    }
  }

  function roomsStatusFallback(status: string): string {
    switch (status) {
      case 'unsupported': return '当前服务端没有房间接口';
      case 'disabled': return '服务端未开启房间归属计算（room_membership=false）';
      case 'initializing': return '房间模型正在就绪，稍后再试';
      case 'failed': return '房间模型构建失败';
      default: return `房间体制状态：${status}`;
    }
  }

  function setFilter(text: string) {
    filterText.value = text;
  }

  const filteredRoots = computed(() => {
    const q = filterText.value.trim().toLowerCase();
    if (!q) return roots.value;
    return roots.value.filter((room) =>
      room.room_num.toLowerCase().includes(q)
      || (room.name ?? '').toLowerCase().includes(q)
      || room.refno.includes(q)
      || room.refno.replace('_', '/').includes(q));
  });

  /** 一间房的整树；取过就不再取。 */
  async function ensureRoomTree(roomRefno: string): Promise<boolean> {
    const rootId = roomNodeId(roomRefno);
    if (roomTreeLoaded.has(roomRefno)) return true;
    if (loadingIds.value.has(rootId)) return false;
    setLoading(rootId, true);
    setError(rootId, null);
    try {
      const tree = await source().roomTree(roomRefno);
      if (!tree.success) {
        setError(rootId, tree.error || '房间层级树取数失败');
        return false;
      }
      const root = roots.value.find((room) => room.refno === roomRefno) ?? null;
      const flattened = flattenRoomTree(roomRefno, tree, root);
      if (!flattened) {
        setError(rootId, '响应里没有这间房');
        return false;
      }
      treesByRoom.set(roomRefno, tree);
      roomTreeLoaded.add(roomRefno);
      replaceRoomNodes(roomRefno, flattened);
      return true;
    } catch (error) {
      setError(rootId, error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setLoading(rootId, false);
    }
  }

  /** 用新展开的节点表替换这间房的全部节点，勾选状态照父节点继承（父 unchecked 子也 unchecked，其余 checked）。 */
  function replaceRoomNodes(roomRefno: string, flattened: Record<string, RoomTreeNode>) {
    const next: Record<string, RoomTreeNode> = {};
    for (const [id, node] of Object.entries(nodesById.value)) {
      if (node.roomRefno !== roomRefno) next[id] = node;
    }
    Object.assign(next, flattened);
    nodesById.value = next;

    const checks = new Map(checkStateById.value);
    const rootId = roomNodeId(roomRefno);
    const rootState = checks.get(rootId) ?? 'checked';
    const inherit = (id: string, parentState: CheckState) => {
      const node = flattened[id];
      if (!node) return;
      const own = checks.get(id);
      const state: CheckState = own ?? (parentState === 'unchecked' ? 'unchecked' : 'checked');
      checks.set(id, state);
      for (const child of node.childrenIds) inherit(child, state);
    };
    for (const child of flattened[rootId]?.childrenIds ?? []) inherit(child, rootState);
    checkStateById.value = checks;
  }

  /** 叶子未内联的单元 / noun 组：按它的选择器补一次，合进这间房的树再展一遍。 */
  async function ensureLeaves(nodeId: string): Promise<boolean> {
    const node = nodesById.value[nodeId];
    if (!node) return false;
    if (node.leavesInline || !node.leafSelector) return true;
    if (loadingIds.value.has(nodeId)) return false;
    const tree = treesByRoom.get(node.roomRefno);
    if (!tree) return false;
    setLoading(nodeId, true);
    setError(nodeId, null);
    try {
      const partial = await source().roomTree(node.roomRefno, undefined, node.leafSelector);
      if (!partial.success) {
        setError(nodeId, partial.error || '补叶子失败');
        return false;
      }
      const merged = mergeTreeLeaves(tree, partial);
      treesByRoom.set(node.roomRefno, merged);
      const root = roots.value.find((room) => room.refno === node.roomRefno) ?? null;
      const flattened = flattenRoomTree(node.roomRefno, merged, root);
      if (flattened) replaceRoomNodes(node.roomRefno, flattened);
      return true;
    } catch (error) {
      setError(nodeId, error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setLoading(nodeId, false);
    }
  }

  /** 节点下的全部构件 refno：先把没内联的叶子补齐（逐组，最多 `maxGroups` 组），再收。 */
  async function collectRefnos(nodeId: string, maxGroups = 64): Promise<string[]> {
    const pending = pendingLeafNodesUnder(nodeId, nodesById.value).slice(0, maxGroups);
    for (const group of pending) {
      await ensureLeaves(group.id);
    }
    return refnosUnder(nodeId, nodesById.value);
  }

  /**
   * 显隐 / 隔离作用的场景 refno：节点下的构件 + 它们所属 BRAN 的整体（直管挂在 BRAN 自己的 refno 上，`deliveryUnitScene.ts`）。
   * 构件行不扩（一个管件就是一个管件，E3D 口径）；「加载模型」不用它——加载链本来就按生成根把整条 BRAN 装进来。
   */
  async function collectSceneRefnos(nodeId: string): Promise<string[]> {
    const refnos = await collectRefnos(nodeId);
    const node = nodesById.value[nodeId];
    if (!node || node.kind === 'element') return refnos;
    const companions = sceneCompanions(refnos, branUnitRefnosUnder(nodeId, nodesById.value));
    if (companions.length === 0) return refnos;
    const seen = new Set(refnos);
    const out = refnos.slice();
    for (const refno of companions) {
      if (!refno || seen.has(refno)) continue;
      seen.add(refno);
      out.push(refno);
    }
    return out;
  }

  function hasChildren(node: RoomTreeNode): boolean {
    if (node.kind === 'element' || node.kind === 'tube') return false;
    if (node.kind === 'room') return node.count === null || node.count > 0 || node.childrenIds.length > 0;
    if (node.childrenIds.length > 0) return true;
    return !node.leavesInline && (node.count ?? 0) > 0;
  }

  const flatRows = computed<FlatRow[]>(() => {
    const nodes = nodesById.value;
    const out: FlatRow[] = [];
    const build = (id: string, depth: number) => {
      const node = nodes[id];
      if (!node) return;
      out.push({
        id: node.id,
        ...(node.refno ? { refno: node.refno } : {}),
        name: node.name,
        type: node.type,
        depth,
        hasChildren: hasChildren(node),
      });
      if (!expandedIds.value.has(id)) return;
      for (const child of node.childrenIds) build(child, depth + 1);
    };
    for (const room of filteredRoots.value) build(roomNodeId(room.refno), 0);
    return out;
  });

  function toggleExpand(id: string) {
    const set = new Set(expandedIds.value);
    if (set.has(id)) {
      set.delete(id);
      expandedIds.value = set;
      return;
    }
    set.add(id);
    expandedIds.value = set;
    const node = nodesById.value[id];
    if (!node) return;
    if (node.kind === 'room') {
      void ensureRoomTree(node.roomRefno);
    } else if ((node.kind === 'unit' || node.kind === 'otherNoun') && !node.leavesInline) {
      void ensureLeaves(id);
    }
  }

  function setCheckStateDeep(id: string, state: CheckState) {
    const nodes = nodesById.value;
    const checks = checkStateById.value;
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      checks.set(cur, state);
      const node = nodes[cur];
      if (!node) continue;
      for (const child of node.childrenIds) stack.push(child);
    }
  }

  /** 直段行的身份键（`tubeKey(所属 BRAN, 段)`，与场景对象索引 / 抽屉同一个键）；不是直段行回 null。 */
  function tubeKeyOfNode(node: RoomTreeNode | undefined): string | null {
    return node?.kind === 'tube' && node.tube ? tubeKey(node.tube.unitRefno, node.tube.tube) : null;
  }

  /**
   * 一个节点的勾选状态：直段行先看对象级覆盖（在抽屉里被单独藏起来的段这里也画成暗眼睛，两棵树同一份真相），
   * 再看勾选表（单元级动作整枝改下来的）；其它节点只看勾选表，缺省 checked。
   */
  function checkStateOf(id: string, checks: Map<string, CheckState>): CheckState {
    const key = tubeKeyOfNode(nodesById.value[id]);
    if (key && tubeSegmentHidden(key)) return 'unchecked';
    return checks.get(id) ?? 'checked';
  }

  function recomputeParents(id: string) {
    const nodes = nodesById.value;
    const checks = checkStateById.value;
    for (const parentId of ancestorsOf(id, nodes).reverse()) {
      const parent = nodes[parentId];
      if (!parent) break;
      let checked = 0;
      let unchecked = 0;
      let indeterminate = false;
      for (const child of parent.childrenIds) {
        const state = checkStateOf(child, checks);
        if (state === 'indeterminate') { indeterminate = true; break; }
        if (state === 'checked') checked++; else unchecked++;
      }
      checks.set(parentId, indeterminate ? 'indeterminate' : unchecked === 0 ? 'checked' : checked === 0 ? 'unchecked' : 'indeterminate');
    }
    checkStateById.value = new Map(checks);
  }

  /**
   * 眼睛：节点下全部构件显 / 隐（未内联的先补；单元级及以上连所属 BRAN 的直段一起），勾选状态整枝改、父链重算。
   * 直段行（逐段眼睛，方案 B T4）：只动场景里**那一段**直管对象（`DtxCompatScene.setTubeSegmentsVisible`，对象级、不进 refno
   * 状态表），所属 BRAN 的 refno 级动作一来整条覆盖；对象还没装进场景就什么都不做、回 `'tube-not-loaded'`（调用方提示先加载）。
   */
  async function setVisible(id: string, visible: boolean): Promise<RoomTreeSetVisibleResult> {
    const node = nodesById.value[id];
    const key = tubeKeyOfNode(node);
    if (key) {
      const applied = sceneGraph.setTubeSegmentsVisible([key], visible);
      if (applied.length === 0) return 'tube-not-loaded';
      const checks = checkStateById.value;
      checks.set(id, visible ? 'checked' : 'unchecked');
      recomputeParents(id);
      return 'applied';
    }
    const refnos = await collectSceneRefnos(id);
    if (refnos.length > 0) sceneGraph.setVisible(refnos, visible);
    setCheckStateDeep(id, visible ? 'checked' : 'unchecked');
    recomputeParents(id);
    return 'applied';
  }

  function getCheckState(id: string): CheckState {
    return checkStateOf(id, checkStateById.value);
  }

  /** 直段行的对象是否已在场景里（眼睛可点）；不是直段行回 false。 */
  function isTubeSegmentLoaded(id: string): boolean {
    const key = tubeKeyOfNode(nodesById.value[id]);
    return key ? tubeSegmentLoaded(key) : false;
  }

  function isNodeLoading(id: string): boolean {
    return loadingIds.value.has(id);
  }

  function nodeError(id: string): string | null {
    return errorById.value.get(id) ?? null;
  }

  function syncSceneSelection() {
    const viewer = viewerRef.value;
    if (!viewer) return;
    const previous = viewer.scene.selectedObjectIds;
    if (previous && previous.length > 0) viewer.scene.setObjectsSelected(previous, false);
    const union = new Set<string>();
    for (const id of selectedIds.value) {
      for (const refno of refnosUnder(id, nodesById.value)) union.add(refno);
      // 直段行：高亮它所属的 BRAN（直管挂在 BRAN 自己的 refno 上，场景里那个键就是它的直管）
      const tube = nodesById.value[id]?.tube;
      if (tube) union.add(tube.unitRefno);
    }
    if (union.size > 0) sceneGraph.setSelected(Array.from(union), true);
  }

  /**
   * 行选中（单击 / Ctrl 多选 / Shift 连选，与 PDMS 树同手势）。回这次选中里唯一的场景键（单元 / 构件行的 refno；
   * 直段行回它所属 BRAN 的 refno，D5 (i)「点行 = 选中所属 BRAN」），调用方拿它设全局选中（属性面板跟着切）；选了分组节点或多行回 null。
   */
  function selectByRowIndex(index: number, ev: MouseEvent): string | null {
    const rows = flatRows.value;
    const id = rows[index]?.id;
    if (!id) return null;
    const metaKey = ev.metaKey || ev.ctrlKey;
    if (ev.shiftKey && lastAnchorIndex.value !== null) {
      const start = Math.min(lastAnchorIndex.value, index);
      const end = Math.max(lastAnchorIndex.value, index);
      const next = new Set(selectedIds.value);
      for (const row of rows.slice(start, end + 1)) next.add(row.id);
      selectedIds.value = next;
    } else if (metaKey) {
      const next = new Set(selectedIds.value);
      if (next.has(id)) next.delete(id); else next.add(id);
      selectedIds.value = next;
      lastAnchorIndex.value = index;
    } else {
      selectedIds.value = new Set([id]);
      lastAnchorIndex.value = index;
    }
    syncSceneSelection();
    if (selectedIds.value.size !== 1) return null;
    const only = nodesById.value[Array.from(selectedIds.value)[0]!];
    if (!only) return null;
    if (only.kind === 'tube') return only.tube?.unitRefno ?? null;
    return (only.kind === 'element' || only.kind === 'unit') && only.refno ? only.refno : null;
  }

  function isRowSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  /**
   * 飞到节点下已加载几何的构件的并集盒；一个都没加载就回 false（调用方提示先加载）。
   * 直段行按服务端给的直段世界盒（mm → 场景坐标）飞，不要求加载。
   */
  async function flyTo(id: string): Promise<boolean> {
    const viewer = viewerRef.value;
    if (!viewer) return false;
    const tube = nodesById.value[id]?.tube;
    if (tube) {
      const { min, max } = tube.tube.aabb ?? {};
      if (!min || !max) return false;
      const aabb6: Aabb6 = [min[0], min[1], min[2], max[0], max[1], max[2]];
      if (!aabb6.every((value) => Number.isFinite(value))) return false;
      viewer.cameraFlight.flyTo({ aabb: resolveSceneWorldTransform(viewer as unknown as Parameters<typeof resolveSceneWorldTransform>[0]).aabbToScene(aabb6) });
      return true;
    }
    const refnos = (await collectRefnos(id)).filter((refno) => !!viewer.scene.objects[refno]);
    if (refnos.length === 0) return false;
    const aabb = viewer.scene.getAABB(refnos);
    viewer.cameraFlight.flyTo({ aabb });
    return true;
  }

  /** 隔离（其余 XRAY）：单元级及以上连所属 BRAN 的直段一起留实体，管件不会孤零零悬着。 */
  async function isolateXray(id: string): Promise<void> {
    const keep = await collectSceneRefnos(id);
    sceneGraph.isolate(keep);
  }

  function clearXray() {
    sceneGraph.clearIsolation();
  }

  /**
   * 外部选中联动（收口计划 P3-b，D5）：某个 refno（构件或单元，`a_b` / `a/b` 都收）若已在**取过树的房**里，展开到它、单选它，
   * 回它在 `flatRows` 里的下标供滚动；优先当前已展开的房。**不**为了它去拉没展开的房（那要先问归属再拉整树），也不碰场景选中
   * （选中本来就从场景 / 别的面板来）。找不到回 null。
   */
  function revealRefno(refno: string): { id: string; index: number } | null {
    const key = refno.replace('/', '_');
    const nodes = nodesById.value;
    let hit: RoomTreeNode | null = null;
    for (const node of Object.values(nodes)) {
      if ((node.kind !== 'element' && node.kind !== 'unit') || node.refno !== key) continue;
      if (!roomTreeLoaded.has(node.roomRefno)) continue;
      if (!hit || (expandedIds.value.has(roomNodeId(node.roomRefno)) && !expandedIds.value.has(roomNodeId(hit.roomRefno)))) hit = node;
    }
    if (!hit) return null;
    const expanded = new Set(expandedIds.value);
    for (const ancestor of ancestorsOf(hit.id, nodes)) expanded.add(ancestor);
    expandedIds.value = expanded;
    selectedIds.value = new Set([hit.id]);
    const index = flatRows.value.findIndex((row) => row.id === hit!.id);
    lastAnchorIndex.value = index >= 0 ? index : null;
    return { id: hit.id, index };
  }

  /** 某构件 refno 所在的房间根 id（同一构件可能在多间房下——按节点表里出现的全部房间）。 */
  function roomIdsOfRefno(refno: string): string[] {
    const out: string[] = [];
    for (const node of Object.values(nodesById.value)) {
      if (node.kind === 'element' && node.refno === refno) {
        const root = roomRefnoOfNodeId(node.id);
        if (root) out.push(roomNodeId(root));
      }
    }
    return out;
  }

  function reset() {
    rootsSeq++;
    roots.value = [];
    rootsStatus.value = { status: 'idle', reason: null, total: 0 };
    nodesById.value = {};
    treesByRoom.clear();
    roomTreeLoaded.clear();
    loadingIds.value = new Set();
    errorById.value = new Map();
    expandedIds.value = new Set();
    selectedIds.value = new Set();
    lastAnchorIndex.value = null;
    checkStateById.value = new Map();
  }

  return {
    roots,
    rootsStatus,
    filterText,
    filteredRoots,
    nodesById,
    expandedIds,
    selectedIds,
    flatRows,
    loadRoots,
    setFilter,
    toggleExpand,
    ensureRoomTree,
    ensureLeaves,
    collectRefnos,
    collectSceneRefnos,
    setVisible,
    getCheckState,
    isTubeSegmentLoaded,
    isNodeLoading,
    nodeError,
    selectByRowIndex,
    isRowSelected,
    flyTo,
    isolateXray,
    clearXray,
    revealRefno,
    roomIdsOfRefno,
    isRoomNodeId,
    reset,
  };
}

export type RoomTreeStore = ReturnType<typeof useRoomTree>;

/**
 * 模型树「房间」页签的节点模型（ADR 0068；plan `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md` §4.5，2026-09-21 改法）：
 * 根是 `GET /spatial/rooms` 的在册房间平铺一层；展开一间房把 `rooms/{refno}/tree` 那棵 房间 → 专业 → 最小交付单元类型 → 单元 → 构件
 * （专业下另有「其他构件」按 noun 分）展成带 parent / children 的节点表，行组件沿用 `ModelTreeRow`（`name` / `type` / `refno`）。
 *
 * 节点 id：`room:<房间 refno>`、`spec:<房间>:<spec_value>`、`utype:<房间>:<spec_value>:<NOUN>`、`others:<房间>:<spec_value>`、
 * `unit:<房间>:<单元 refno>`、`onoun:<房间>:<spec_value>:<NOUN>`、构件 `elem:<房间>:<refno>`。构件 / 单元的场景对象键放在 `refno`（`a_b`），
 * 显隐 / 选中 / 定位按它作用；分组节点是合成 id、没有场景对象，勾选状态由子构件推导。同一构件在两间房下各有一个节点（id 带房间），
 * 与抽屉树态「跨房构件两间房下都出现」一致。纯函数，不碰 Vue。
 */
import type {
  SpatialRoomOption,
  SpatialTreeLeafNode,
  SpatialTreeLeafSelector,
  SpatialTreeResult,
  SpatialTreeRoomNode,
  SpatialTreeUnitNode,
} from '@/api/genModelSpatialApi';

import { treeNodeLeavesInline } from '@/composables/spatialTree';
import { getSpecValueName } from '@/types/spec';

export type RoomTreeNodeKind = 'room' | 'spec' | 'unitType' | 'unit' | 'others' | 'otherNoun' | 'element';

export type RoomTreeNode = {
  id: string;
  kind: RoomTreeNodeKind;
  parentId: string | null;
  childrenIds: string[];
  /** 行上画的名字（`ModelTreeRow.name`）；分组节点把计数拼在尾巴上 */
  name: string;
  /** `ModelTreeRow.type`：房间 `ROOM`（SITE 图标）、单元 / 构件 / noun 组用 noun、专业与「其他构件」为空（无图标、不加前缀） */
  type: string;
  /** 场景对象键 `a_b`：只有单元与构件有 */
  refno?: string;
  /** 所属房间 refno（`a_b`） */
  roomRefno: string;
  /** 该节点下按 refno 去重的构件数（房间根在树取回前为 null） */
  count: number | null;
  /** 该节点的叶子是否都已内联；未内联的单元 / noun 组第一次展开或动作前先按 `leafSelector` 补 */
  leavesInline: boolean;
  leafSelector?: SpatialTreeLeafSelector;
  /** 构件 / 单元到房间盒的距离（mm）；单元是最近成员距离 */
  distance?: number;
  /** 构件属于 ≥ 2 间在册房间时服务端给的房间数 */
  sharedRooms?: number;
  /** 悬停全文 */
  title: string;
};

export const ROOM_NODE_PREFIX = 'room:';

export function roomNodeId(roomRefno: string): string {
  return `${ROOM_NODE_PREFIX}${roomRefno}`;
}
export function specNodeId(roomRefno: string, specValue: number): string {
  return `spec:${roomRefno}:${specValue}`;
}
export function unitTypeNodeId(roomRefno: string, specValue: number, noun: string): string {
  return `utype:${roomRefno}:${specValue}:${noun}`;
}
export function othersNodeId(roomRefno: string, specValue: number): string {
  return `others:${roomRefno}:${specValue}`;
}
export function unitNodeId(roomRefno: string, unitRefno: string): string {
  return `unit:${roomRefno}:${unitRefno}`;
}
export function otherNounNodeId(roomRefno: string, specValue: number, noun: string): string {
  return `onoun:${roomRefno}:${specValue}:${noun}`;
}
export function elementNodeId(roomRefno: string, refno: string): string {
  return `elem:${roomRefno}:${refno}`;
}

/** 任一节点 id 所属的房间 refno；不是本页签的 id 回 null。 */
export function roomRefnoOfNodeId(id: string): string | null {
  const parts = id.split(':');
  if (parts.length < 2) return null;
  const kind = parts[0];
  if (kind === 'room' || kind === 'spec' || kind === 'utype' || kind === 'others' || kind === 'unit' || kind === 'onoun' || kind === 'elem') {
    return parts[1] || null;
  }
  return null;
}

export function isRoomNodeId(id: string): boolean {
  return id.startsWith(ROOM_NODE_PREFIX);
}

/** 从根到 `id` 的父链（不含自身），靠节点表的 `parentId` 走；节点不在表里回空。 */
export function ancestorsOf(id: string, nodes: Record<string, RoomTreeNode>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = nodes[id]?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    out.unshift(cur);
    seen.add(cur);
    cur = nodes[cur]?.parentId ?? null;
  }
  return out;
}

/** 房间行的名字：房号 · 名字（· N 个构件，树取回后才有）。 */
function roomLabel(roomNum: string, name: string | null | undefined, count: number | null): string {
  const parts = [roomNum, name || null];
  if (typeof count === 'number') parts.push(`${count} 个构件`);
  return parts.filter(Boolean).join(' · ');
}

/** 在册房间清单里的一间 → 页签根节点（树未取回：`count` null、`childrenIds` 空、`leavesInline` false 表示还要取）。 */
export function roomRootNode(room: SpatialRoomOption): RoomTreeNode {
  const roomRefno = room.refno;
  return {
    id: roomNodeId(roomRefno),
    kind: 'room',
    parentId: null,
    childrenIds: [],
    name: roomLabel(room.room_num, room.name, null),
    type: 'ROOM',
    refno: roomRefno,
    roomRefno,
    count: null,
    leavesInline: false,
    title: [room.room_num, room.name, roomRefno, room.dbnum != null ? `库 ${room.dbnum}` : null, `${room.panel_count} 块面板`].filter(Boolean).join(' · '),
  };
}

function formatDistance(mm: number): string {
  const meters = mm / 1000;
  if (Math.abs(meters - Math.round(meters)) < 0.0001) return `${Math.round(meters)} m`;
  return `${meters.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} m`;
}

function leafNode(roomRefno: string, parentId: string, leaf: SpatialTreeLeafNode): RoomTreeNode {
  return {
    id: elementNodeId(roomRefno, leaf.refno),
    kind: 'element',
    parentId,
    childrenIds: [],
    name: leaf.refno,
    type: leaf.noun,
    refno: leaf.refno,
    roomRefno,
    count: 1,
    leavesInline: true,
    distance: leaf.distance,
    ...(typeof leaf.shared_rooms === 'number' ? { sharedRooms: leaf.shared_rooms } : {}),
    title: [leaf.refno, leaf.noun, formatDistance(leaf.distance), typeof leaf.shared_rooms === 'number' ? `跨 ${leaf.shared_rooms} 房` : null]
      .filter(Boolean).join(' · '),
  };
}

function unitNode(roomRefno: string, parentId: string, unit: SpatialTreeUnitNode): RoomTreeNode {
  const inline = Array.isArray(unit.elements);
  return {
    id: unitNodeId(roomRefno, unit.refno),
    kind: 'unit',
    parentId,
    childrenIds: [],
    name: `${unit.name || unit.refno} · ${unit.count}`,
    type: unit.noun,
    refno: unit.refno,
    roomRefno,
    count: unit.count,
    leavesInline: inline,
    ...(inline ? {} : { leafSelector: { unit: unit.refno } }),
    distance: unit.min_distance,
    title: [unit.name, `${unit.noun} ${unit.refno}`, `最近 ${formatDistance(unit.min_distance)}`, `${unit.count} 个构件`].filter(Boolean).join(' · '),
  };
}

/**
 * 把一间房的 `rooms/{refno}/tree` 响应展成节点表：根是 `room:<refno>`（名字带构件数），下面 专业 → 单元类型 → 单元 → 构件 与
 * 专业 → 其他构件 → noun 组 → 构件。响应里 `rooms[]` 不止一条时只取 refno 相同的那条（契约恒一条）。
 * 回 `null` 表示响应里没有这间房。
 */
export function flattenRoomTree(roomRefno: string, tree: SpatialTreeResult, root: SpatialRoomOption | null): Record<string, RoomTreeNode> | null {
  const room: SpatialTreeRoomNode | undefined = tree.rooms.find((entry) => entry.refno === roomRefno) ?? tree.rooms[0];
  if (!room) return null;

  const nodes: Record<string, RoomTreeNode> = {};
  const rootId = roomNodeId(roomRefno);
  const roomNode: RoomTreeNode = {
    id: rootId,
    kind: 'room',
    parentId: null,
    childrenIds: [],
    name: roomLabel(room.room_num || root?.room_num || roomRefno, room.name ?? root?.name ?? null, room.count),
    type: 'ROOM',
    refno: roomRefno,
    roomRefno,
    count: room.count,
    leavesInline: treeNodeLeavesInline({ kind: 'room', node: room }),
    title: [room.room_num, room.name, roomRefno, `${room.count} 个构件`, tree.leaves_inline ? null : `构件 ${tree.leaf_count} 个放置 > 上限 ${tree.leaf_cap}，按单元展开时再取`]
      .filter(Boolean).join(' · '),
  };
  nodes[rootId] = roomNode;

  for (const spec of room.specs) {
    const specId = specNodeId(roomRefno, spec.spec_value);
    const specNode: RoomTreeNode = {
      id: specId,
      kind: 'spec',
      parentId: rootId,
      childrenIds: [],
      name: `${getSpecValueName(spec.spec_value)} · ${spec.count}`,
      type: '',
      roomRefno,
      count: spec.count,
      leavesInline: treeNodeLeavesInline({ kind: 'spec', node: spec }),
      title: `${getSpecValueName(spec.spec_value)} · 专业 ${spec.spec_value} · ${spec.count} 个构件`,
    };
    nodes[specId] = specNode;
    roomNode.childrenIds.push(specId);

    for (const group of spec.unit_types) {
      const groupId = unitTypeNodeId(roomRefno, spec.spec_value, group.noun);
      const groupNode: RoomTreeNode = {
        id: groupId,
        kind: 'unitType',
        parentId: specId,
        childrenIds: [],
        name: `${group.noun} · ${group.units.length} 个单元 · ${group.count}`,
        type: group.noun,
        roomRefno,
        count: group.count,
        leavesInline: treeNodeLeavesInline({ kind: 'unitType', node: group }),
        title: `${group.noun} · ${group.units.length} 个最小交付单元 · ${group.count} 个构件`,
      };
      nodes[groupId] = groupNode;
      specNode.childrenIds.push(groupId);

      for (const unit of group.units) {
        const node = unitNode(roomRefno, groupId, unit);
        nodes[node.id] = node;
        groupNode.childrenIds.push(node.id);
        for (const leaf of unit.elements ?? []) {
          const child = leafNode(roomRefno, node.id, leaf);
          nodes[child.id] = child;
          node.childrenIds.push(child.id);
        }
      }
    }

    if (spec.others.count > 0 || spec.others.by_noun.length > 0) {
      const othersId = othersNodeId(roomRefno, spec.spec_value);
      const othersNode: RoomTreeNode = {
        id: othersId,
        kind: 'others',
        parentId: specId,
        childrenIds: [],
        name: `其他构件 · ${spec.others.count}`,
        type: '',
        roomRefno,
        count: spec.others.count,
        leavesInline: treeNodeLeavesInline({ kind: 'others', node: spec.others }),
        title: `其他构件 · 不属任何最小交付单元的构件，按 noun 分 · ${spec.others.count} 个`,
      };
      nodes[othersId] = othersNode;
      specNode.childrenIds.push(othersId);

      for (const group of spec.others.by_noun) {
        const inline = Array.isArray(group.elements);
        const groupId = otherNounNodeId(roomRefno, spec.spec_value, group.noun);
        const groupNode: RoomTreeNode = {
          id: groupId,
          kind: 'otherNoun',
          parentId: othersId,
          childrenIds: [],
          name: `${group.noun} · ${group.count}`,
          type: group.noun,
          roomRefno,
          count: group.count,
          leavesInline: inline,
          ...(inline ? {} : { leafSelector: { otherNoun: group.noun } }),
          distance: group.min_distance,
          title: `${group.noun} · ${group.count} 个构件 · 最近 ${formatDistance(group.min_distance)}`,
        };
        nodes[groupId] = groupNode;
        othersNode.childrenIds.push(groupId);
        for (const leaf of group.elements ?? []) {
          const child = leafNode(roomRefno, groupId, leaf);
          nodes[child.id] = child;
          groupNode.childrenIds.push(child.id);
        }
      }
    }
  }

  return nodes;
}

/** 节点下已知的全部构件 refno（去重）；叶子未内联的部分不在里面——调用方先 `ensureLeaves`。 */
export function refnosUnder(id: string, nodes: Record<string, RoomTreeNode>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = nodes[cur];
    if (!node) continue;
    if (node.kind === 'element' && node.refno && !seen.has(node.refno)) {
      seen.add(node.refno);
      out.push(node.refno);
    }
    for (let i = node.childrenIds.length - 1; i >= 0; i--) stack.push(node.childrenIds[i]!);
  }
  return out;
}

/** 节点下还没内联叶子的单元 / noun 组（要先按各自的选择器补一次才有全部 refno）。 */
export function pendingLeafNodesUnder(id: string, nodes: Record<string, RoomTreeNode>): RoomTreeNode[] {
  const out: RoomTreeNode[] = [];
  const stack = [id];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = nodes[cur];
    if (!node) continue;
    if ((node.kind === 'unit' || node.kind === 'otherNoun') && !node.leavesInline && node.leafSelector) out.push(node);
    for (const child of node.childrenIds) stack.push(child);
  }
  return out;
}

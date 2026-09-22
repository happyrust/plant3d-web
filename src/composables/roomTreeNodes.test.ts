import { describe, expect, it } from 'vitest';

import type { SpatialRoomOption, SpatialTreeResult } from '@/api/genModelSpatialApi';

import {
  ancestorsOf,
  branUnitRefnosUnder,
  elementNodeId,
  flattenRoomTree,
  isRoomNodeId,
  othersNodeId,
  otherNounNodeId,
  pendingLeafNodesUnder,
  refnosUnder,
  roomNodeId,
  roomRefnoOfNodeId,
  roomRootNode,
  specNodeId,
  unitNodeId,
  unitTypeNodeId,
} from '@/composables/roomTreeNodes';

/**
 * 「房间」页签的节点模型（ADR 0068，plan 2026-09-20 spatial-room-hierarchy-tree §4.5）：五层 id 与 parent / children、
 * 名字里的计数、构件 refno 挂在 `refno`、未内联叶子的选择器、按 refno 去重的收集。
 */

const ROOM: SpatialRoomOption = { refno: '24381_35580', room_num: 'R432', name: '/1RX-RM04-R432', dbnum: 7997, panel_count: 6 };

/** R432：spec 0 = 其他构件 PANE 1（内联）；spec 3 = BRAN b1（两条，内联）+ EQUI e1（未内联，count 3）+ 其他构件 GWALL（未内联，count 2）。 */
function roomTree(overrides: Partial<SpatialTreeResult> = {}): SpatialTreeResult {
  return {
    success: true,
    total_count: 7,
    candidate_count: 9,
    truncated_candidates: false,
    candidate_cap: 200000,
    leaves_inline: false,
    leaf_cap: 5000,
    leaf_count: 8,
    inlined: null,
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
      count: 7,
      specs: [
        {
          spec_value: 0,
          count: 1,
          unit_types: [],
          others: { count: 1, by_noun: [{ noun: 'PANE', count: 1, min_distance: 900, elements: [{ refno: '24381_4090', noun: 'PANE', distance: 900 }] }] },
        },
        {
          spec_value: 3,
          count: 6,
          unit_types: [
            { noun: 'BRAN', count: 2, units: [{ refno: '24381_1200', noun: 'BRAN', name: '/B1', count: 2, min_distance: 100, elements: [{ refno: '24381_1240', noun: 'TUBI', distance: 100 }, { refno: '24381_1241', noun: 'ELBO', distance: 200, shared_rooms: 2 }] }] },
            { noun: 'EQUI', count: 3, units: [{ refno: '24381_7000', noun: 'EQUI', name: null, count: 3, min_distance: 1500 }] },
          ],
          others: { count: 2, by_noun: [{ noun: 'GWALL', count: 2, min_distance: 50 }] },
        },
      ],
    }],
    ...overrides,
  };
}

describe('roomTreeNodes', () => {
  it('id 编排：各层前缀带房间 refno，roomRefnoOfNodeId 能从任一层解回房间；别的 id 回 null', () => {
    expect(roomNodeId('24381_35580')).toBe('room:24381_35580');
    expect(specNodeId('24381_35580', 3)).toBe('spec:24381_35580:3');
    expect(unitTypeNodeId('24381_35580', 3, 'BRAN')).toBe('utype:24381_35580:3:BRAN');
    expect(othersNodeId('24381_35580', 3)).toBe('others:24381_35580:3');
    expect(unitNodeId('24381_35580', '24381_1200')).toBe('unit:24381_35580:24381_1200');
    expect(otherNounNodeId('24381_35580', 3, 'GWALL')).toBe('onoun:24381_35580:3:GWALL');
    expect(elementNodeId('24381_35580', '24381_1240')).toBe('elem:24381_35580:24381_1240');
    for (const id of ['room:24381_35580', 'spec:24381_35580:3', 'utype:24381_35580:3:BRAN', 'others:24381_35580:3', 'unit:24381_35580:24381_1200', 'onoun:24381_35580:3:GWALL', 'elem:24381_35580:24381_1240']) {
      expect(roomRefnoOfNodeId(id)).toBe('24381_35580');
    }
    expect(roomRefnoOfNodeId('24381_1240')).toBeNull();
    expect(roomRefnoOfNodeId('pdms:x')).toBeNull();
    expect(isRoomNodeId('room:1_2')).toBe(true);
    expect(isRoomNodeId('spec:1_2:0')).toBe(false);
  });

  it('roomRootNode：清单里的一间房 → 没计数的根（名字 房号 · 名字，type ROOM，refno 是房间自己，title 带库与面板数）', () => {
    const node = roomRootNode(ROOM);
    expect(node).toMatchObject({ id: 'room:24381_35580', kind: 'room', parentId: null, childrenIds: [], name: 'R432 · /1RX-RM04-R432', type: 'ROOM', refno: '24381_35580', roomRefno: '24381_35580', count: null, leavesInline: false });
    expect(node.title).toBe('R432 · /1RX-RM04-R432 · 24381_35580 · 库 7997 · 6 块面板');
    expect(roomRootNode({ ...ROOM, name: null, dbnum: null }).name).toBe('R432');
  });

  it('flattenRoomTree：五层 parent / children 对得上，名字带计数，构件 / 单元的 refno 挂在 refno 上，type 给 ModelTreeRow 画图标', () => {
    const nodes = flattenRoomTree('24381_35580', roomTree(), ROOM)!;
    expect(nodes).toBeTruthy();
    const root = nodes['room:24381_35580']!;
    expect(root).toMatchObject({ kind: 'room', name: 'R432 · /1RX-RM04-R432 · 7 个构件', count: 7, type: 'ROOM', leavesInline: false });
    expect(root.childrenIds).toEqual(['spec:24381_35580:0', 'spec:24381_35580:3']);
    expect(root.title).toContain('放置 > 上限 5000');

    const spec0 = nodes['spec:24381_35580:0']!;
    expect(spec0).toMatchObject({ kind: 'spec', parentId: 'room:24381_35580', name: '未知或其他 · 1', type: '', count: 1, leavesInline: true });
    expect(spec0.childrenIds).toEqual(['others:24381_35580:0']);
    expect(nodes['others:24381_35580:0']).toMatchObject({ kind: 'others', parentId: 'spec:24381_35580:0', name: '其他构件 · 1', childrenIds: ['onoun:24381_35580:0:PANE'] });
    expect(nodes['onoun:24381_35580:0:PANE']).toMatchObject({ kind: 'otherNoun', type: 'PANE', name: 'PANE · 1', leavesInline: true, distance: 900, childrenIds: ['elem:24381_35580:24381_4090'] });
    expect(nodes['onoun:24381_35580:0:PANE']!.leafSelector).toBeUndefined();

    const spec3 = nodes['spec:24381_35580:3']!;
    expect(spec3.name).toBe('仪表系统 · 6');
    expect(spec3.leavesInline).toBe(false);
    expect(spec3.childrenIds).toEqual(['utype:24381_35580:3:BRAN', 'utype:24381_35580:3:EQUI', 'others:24381_35580:3']);
    expect(nodes['utype:24381_35580:3:BRAN']).toMatchObject({ kind: 'unitType', type: 'BRAN', name: 'BRAN · 1 个单元 · 2', count: 2, leavesInline: true, childrenIds: ['unit:24381_35580:24381_1200'] });

    const unit = nodes['unit:24381_35580:24381_1200']!;
    expect(unit).toMatchObject({ kind: 'unit', parentId: 'utype:24381_35580:3:BRAN', name: '/B1 · 2', type: 'BRAN', refno: '24381_1200', count: 2, leavesInline: true, distance: 100 });
    expect(unit.childrenIds).toEqual(['elem:24381_35580:24381_1240', 'elem:24381_35580:24381_1241']);
    expect(unit.title).toBe('/B1 · BRAN 24381_1200 · 最近 0.1 m · 2 个构件');

    const leaf = nodes['elem:24381_35580:24381_1241']!;
    expect(leaf).toMatchObject({ kind: 'element', parentId: 'unit:24381_35580:24381_1200', name: '24381_1241', type: 'ELBO', refno: '24381_1241', count: 1, distance: 200, sharedRooms: 2, childrenIds: [] });
    expect(leaf.title).toBe('24381_1241 · ELBO · 0.2 m · 跨 2 房');

    // 未内联：没名字的单元名字用 refno；不带 elements 的单元 / noun 组 leavesInline=false、带选择器、没有子节点
    const equi = nodes['unit:24381_35580:24381_7000']!;
    expect(equi).toMatchObject({ name: '24381_7000 · 3', type: 'EQUI', leavesInline: false, leafSelector: { unit: '24381_7000' }, childrenIds: [] });
    expect(nodes['utype:24381_35580:3:EQUI']!.leavesInline).toBe(false);
    expect(nodes['onoun:24381_35580:3:GWALL']).toMatchObject({ leavesInline: false, leafSelector: { otherNoun: 'GWALL' }, childrenIds: [], count: 2 });

    // 节点总数：1 房 + 2 专业 + 2 单元类型 + 2 其他 + 2 单元 + 2 noun 组 + 3 构件
    expect(Object.keys(nodes)).toHaveLength(14);
    // 每个非根节点的 parentId 都指向表里存在的节点，且出现在父的 childrenIds 里
    for (const node of Object.values(nodes)) {
      if (!node.parentId) continue;
      expect(nodes[node.parentId]!.childrenIds).toContain(node.id);
    }
  });

  it('flattenRoomTree：响应里没有这间房回 null；rooms[] 只有别的房间时退回第一条（契约恒一条）', () => {
    expect(flattenRoomTree('24381_35580', roomTree({ rooms: [] }), ROOM)).toBeNull();
    const tree = roomTree();
    tree.rooms[0]!.refno = '24381_1407';
    const nodes = flattenRoomTree('24381_35580', tree, ROOM)!;
    expect(nodes['room:24381_35580']).toBeTruthy();
  });

  it('refnosUnder：节点下按 refno 去重的构件（叶子未内联的部分不在）；pendingLeafNodesUnder 列出还要补叶子的单元 / noun 组；ancestorsOf 从根到父', () => {
    const nodes = flattenRoomTree('24381_35580', roomTree(), ROOM)!;
    expect(refnosUnder('room:24381_35580', nodes)).toEqual(['24381_4090', '24381_1240', '24381_1241']);
    expect(refnosUnder('spec:24381_35580:3', nodes)).toEqual(['24381_1240', '24381_1241']);
    expect(refnosUnder('unit:24381_35580:24381_7000', nodes)).toEqual([]);
    expect(refnosUnder('elem:24381_35580:24381_1241', nodes)).toEqual(['24381_1241']);
    expect(refnosUnder('nope', nodes)).toEqual([]);

    expect(pendingLeafNodesUnder('room:24381_35580', nodes).map((node) => node.id).sort()).toEqual(['onoun:24381_35580:3:GWALL', 'unit:24381_35580:24381_7000']);
    expect(pendingLeafNodesUnder('utype:24381_35580:3:BRAN', nodes)).toEqual([]);

    expect(ancestorsOf('elem:24381_35580:24381_1241', nodes)).toEqual(['room:24381_35580', 'spec:24381_35580:3', 'utype:24381_35580:3:BRAN', 'unit:24381_35580:24381_1200']);
    expect(ancestorsOf('room:24381_35580', nodes)).toEqual([]);
    expect(ancestorsOf('nope', nodes)).toEqual([]);
  });

  it('branUnitRefnosUnder（管件带直段）：节点下含自身的 BRAN 单元 refno；EQUI 单元、其他构件、构件行不给', () => {
    const nodes = flattenRoomTree('24381_35580', roomTree(), ROOM)!;
    expect(branUnitRefnosUnder('room:24381_35580', nodes)).toEqual(['24381_1200']);
    expect(branUnitRefnosUnder('spec:24381_35580:3', nodes)).toEqual(['24381_1200']);
    expect(branUnitRefnosUnder('utype:24381_35580:3:BRAN', nodes)).toEqual(['24381_1200']);
    expect(branUnitRefnosUnder('unit:24381_35580:24381_1200', nodes), '单元自己').toEqual(['24381_1200']);
    expect(branUnitRefnosUnder('utype:24381_35580:3:EQUI', nodes), 'EQUI 没有直管').toEqual([]);
    expect(branUnitRefnosUnder('unit:24381_35580:24381_7000', nodes)).toEqual([]);
    expect(branUnitRefnosUnder('elem:24381_35580:24381_1241', nodes), '构件行不扩').toEqual([]);
    expect(branUnitRefnosUnder('others:24381_35580:3', nodes)).toEqual([]);
    expect(branUnitRefnosUnder('nope', nodes)).toEqual([]);
  });

  it('直段行（方案 B）：BRAN 单元的构件行之后吐 tube 节点——id tube:<房>:<单元>#<from>-<to>#<ordinal>、type TUBI、名字「A → B · 长度（· 无效）」、没有 refno、count 0；单元名字尾「M 段直管」、各层 title 带「· M 段直管」；三个 *Under 都跳过它；老服务端没给就没有', () => {
    const withTubes = roomTree({ total_tube_count: 2 });
    const room = withTubes.rooms[0]!;
    room.tube_count = 2;
    room.specs[1]!.tube_count = 2;
    room.specs[1]!.unit_types[0]!.tube_count = 2;
    const b1 = room.specs[1]!.unit_types[0]!.units[0]!;
    b1.tube_count = 2;
    b1.tubes = [
      { ordinal: 0, from: '24381_1200', to: '24381_1240', from_noun: 'BRAN', to_noun: 'TUBI', distance: 100, length: 141.5, aabb: { min: [0, 0, 0], max: [1, 1, 1] }, invalid: false },
      { ordinal: 1, from: '24381_1240', to: '24381_1241', from_noun: 'TUBI', to_noun: 'ELBO', distance: 150, length: 2500, aabb: { min: [1, 0, 0], max: [3, 1, 1] }, invalid: true, shared_rooms: 2 },
    ];
    const nodes = flattenRoomTree('24381_35580', withTubes, ROOM)!;
    const unitId = 'unit:24381_35580:24381_1200';
    const unit = nodes[unitId]!;
    expect(unit.name).toBe('/B1 · 2 · 2 段直管');
    expect(unit.title).toContain('2 个构件 · 2 段直管');
    expect(nodes['room:24381_35580']!.name).toBe('R432 · /1RX-RM04-R432 · 7 个构件 · 2 段直管');
    expect(nodes['spec:24381_35580:3']!.title).toContain('6 个构件 · 2 段直管');
    expect(nodes['utype:24381_35580:3:BRAN']!.title).toContain('2 个构件 · 2 段直管');
    expect(nodes['utype:24381_35580:3:EQUI']!.title, '没给 tube_count 的层只说构件').toBe('EQUI · 1 个最小交付单元 · 3 个构件');

    const tubeIds = ['tube:24381_35580:24381_1200#24381_1200-24381_1240#0', 'tube:24381_35580:24381_1200#24381_1240-24381_1241#1'];
    expect(unit.childrenIds).toEqual(['elem:24381_35580:24381_1240', 'elem:24381_35580:24381_1241', ...tubeIds]);
    const first = nodes[tubeIds[0]!]!;
    expect(first).toMatchObject({ kind: 'tube', parentId: unitId, type: 'TUBI', name: 'BRAN → TUBI · 142 mm', count: 0, leavesInline: true, distance: 100, roomRefno: '24381_35580' });
    expect(first.refno).toBeUndefined();
    expect(first.tube).toEqual({ unitRefno: '24381_1200', tube: b1.tubes[0] });
    expect(first.title).toBe('直管 BRAN → TUBI · 142 mm · 距 0.1 m · 24381_1200 → 24381_1240 · 属 BRAN 24381_1200');
    const second = nodes[tubeIds[1]!]!;
    expect(second.name).toBe('TUBI → ELBO · 2.5 m · 无效');
    expect(second.sharedRooms).toBe(2);
    expect(second.title).toContain('第 2 段 · 无效直管 · 跨 2 房');
    expect(roomRefnoOfNodeId(tubeIds[0]!)).toBe('24381_35580');
    expect(ancestorsOf(tubeIds[0]!, nodes)).toEqual(['room:24381_35580', 'spec:24381_35580:3', 'utype:24381_35580:3:BRAN', unitId]);

    expect(refnosUnder(unitId, nodes), '直段没有 refno').toEqual(['24381_1240', '24381_1241']);
    expect(refnosUnder(tubeIds[0]!, nodes)).toEqual([]);
    expect(branUnitRefnosUnder(tubeIds[0]!, nodes), '直段行不扩到 BRAN').toEqual([]);
    expect(pendingLeafNodesUnder(unitId, nodes)).toEqual([]);

    const legacy = flattenRoomTree('24381_35580', roomTree(), ROOM)!;
    expect(legacy[unitId]!.name).toBe('/B1 · 2');
    expect(legacy[unitId]!.childrenIds).toHaveLength(2);
    expect(Object.values(legacy).some((node) => node.kind === 'tube')).toBe(false);
  });
});

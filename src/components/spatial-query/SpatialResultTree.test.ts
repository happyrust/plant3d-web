import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import SpatialResultTree from './SpatialResultTree.vue';

import type { SpatialTreeResult } from '@/api/genModelSpatialApi';
import type { SpatialQueryResultItem } from '@/types/spatialQuery';

/**
 * 房间层级树组件（ADR 0068，plan 2026-09-20 spatial-room-hierarchy-tree §4.3）：五层渲染与计数、缺省折叠、
 * 行文字只放主标识而名字 / refno / 说明进 `title`、动作按钮不占行宽、叶子按需取、跨房小标。
 */

/** 两间房：R1 里 BRAN b1（两条）+ EQUI e1（一条）+ 其他构件 PANE 一条；R2 里 b1 的一条跨房构件。 */
function tree(overrides: Partial<SpatialTreeResult> = {}): SpatialTreeResult {
  return {
    success: true,
    total_count: 4,
    candidate_count: 5,
    truncated_candidates: false,
    candidate_cap: 200000,
    leaves_inline: true,
    leaf_cap: 5000,
    leaf_count: 5,
    inlined: null,
    delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
    center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' },
    radius: 3000,
    shape: 'sphere',
    room_status: { rooms: [{ refno: 'r1', room_num: 'R1' }, { refno: 'r2', room_num: 'R2' }], source: 'memory', matched: 4, unresolved: 0, definition_version: 'g', library_alignment_current: null },
    warnings: [],
    coverage: 'global-tree',
    spatial_state: 'ready',
    rooms: [
      {
        refno: 'r1',
        room_num: 'R432',
        name: '/1RX-RM04-R432-A-VERY-LONG-ROOM-NAME',
        count: 4,
        specs: [
          {
            spec_value: 0,
            count: 1,
            unit_types: [],
            others: { count: 1, by_noun: [{ noun: 'PANE', count: 1, min_distance: 9000, elements: [{ refno: 'p1', noun: 'PANE', distance: 9000 }] }] },
          },
          {
            spec_value: 3,
            count: 3,
            unit_types: [
              { noun: 'BRAN', count: 2, units: [{ refno: 'b1', noun: 'BRAN', name: '/Copy-of-100-B-1-VERY-LONG-BRANCH-NAME', count: 2, min_distance: 210, elements: [{ refno: 't1', noun: 'TUBI', distance: 210 }, { refno: 'x1', noun: 'ELBO', distance: 5000, shared_rooms: 2 }] }] },
              { noun: 'EQUI', count: 1, units: [{ refno: 'e1', noun: 'EQUI', name: null, count: 1, min_distance: 2000, elements: [{ refno: 'n1', noun: 'NOZZ', distance: 2000 }] }] },
            ],
            others: { count: 0, by_noun: [] },
          },
        ],
      },
      {
        refno: 'r2',
        room_num: 'R143',
        name: null,
        count: 1,
        specs: [
          {
            spec_value: 3,
            count: 1,
            unit_types: [{ noun: 'BRAN', count: 1, units: [{ refno: 'b1', noun: 'BRAN', name: '/Copy-of-100-B-1-VERY-LONG-BRANCH-NAME', count: 1, min_distance: 5000, elements: [{ refno: 'x1', noun: 'ELBO', distance: 5000, shared_rooms: 2 }] }] }],
            others: { count: 0, by_noun: [] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function item(refno: string, overrides: Partial<SpatialQueryResultItem> = {}): SpatialQueryResultItem {
  return {
    refno,
    noun: 'TUBI',
    specValue: 3,
    specName: '仪表系统',
    dbnum: 7997,
    distance: 210,
    loaded: true,
    visible: true,
    matchedBy: 'server-spatial-index',
    name: null,
    position: null,
    bbox: null,
    sourceModel: null,
    ...overrides,
  };
}

type Emitted = {
  focus: SpatialQueryResultItem[][];
  toggleVisible: SpatialQueryResultItem[][];
  load: [string[], string][];
  showOnly: string[][][];
  isolate: string[][][];
  expand: unknown[][];
};

let unmountCurrent: (() => void) | null = null;

function mountTree(options: { tree?: SpatialTreeResult; items?: SpatialQueryResultItem[]; activeRefno?: string | null; busy?: boolean } = {}) {
  const emitted: Emitted = { focus: [], toggleVisible: [], load: [], showOnly: [], isolate: [], expand: [] };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(SpatialResultTree, {
      tree: options.tree ?? tree(),
      items: options.items ?? [],
      activeRefno: options.activeRefno ?? null,
      busy: options.busy ?? false,
      onFocus: (value: SpatialQueryResultItem) => emitted.focus.push([value]),
      onToggleVisible: (value: SpatialQueryResultItem) => emitted.toggleVisible.push([value]),
      onLoad: (refnos: string[], label: string) => emitted.load.push([refnos, label]),
      onShowOnly: (refnos: string[]) => emitted.showOnly.push([refnos]),
      onIsolate: (refnos: string[]) => emitted.isolate.push([refnos]),
      onExpand: (selector: unknown) => emitted.expand.push([selector]),
    }),
  });
  app.mount(host);
  unmountCurrent = () => {
    app.unmount();
    host.remove();
    unmountCurrent = null;
  };
  return { host, emitted };
}

afterEach(() => {
  unmountCurrent?.();
  vi.restoreAllMocks();
});

const q = (root: ParentNode, testid: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SpatialResultTree（ADR 0068 房间层级树）', () => {
  it('五层各一行，房间 / 专业 / 单元类型缺省展开、单元与其他构件收起；计数贴在每行', () => {
    const { host } = mountTree();

    const rooms = q(host, 'spatial-tree-room');
    expect(rooms.map((el) => el.dataset.roomRefno)).toEqual(['r1', 'r2']);

    const r1 = rooms[0]!;
    expect(q(r1, 'spatial-tree-spec').map((el) => el.dataset.specValue)).toEqual(['0', '3']);
    expect(q(r1, 'spatial-tree-unit-type').map((el) => el.dataset.noun)).toEqual(['BRAN', 'EQUI']);
    expect(q(r1, 'spatial-tree-unit').map((el) => el.dataset.refno)).toEqual(['b1', 'e1']);
    expect(q(r1, 'spatial-tree-others')).toHaveLength(1);
    // 单元、其他构件缺省收起：叶子与 noun 组都还没画
    expect(q(r1, 'spatial-tree-leaf')).toHaveLength(0);
    expect(q(r1, 'spatial-tree-other-noun')).toHaveLength(0);

    // 每行右侧的计数：房间 4 → 专业 1 / 3 → 单元类型 2 / 1 → 单元 2 / 1 → 其他构件 1
    expect(q(r1, 'spatial-tree-count').map((el) => text(el))).toEqual(['4', '1', '1', '3', '2', '2', '1', '1']);
    expect(q(rooms[1]!, 'spatial-tree-count').map((el) => text(el))).toEqual(['1', '1', '1', '1']);
  });

  it('行上只放主标识，名字 / refno / 说明 / 构件数进 title；短尾巴（距离、N 个单元）不参与截断', () => {
    const { host } = mountTree();
    const r1 = q(host, 'spatial-tree-room')[0]!;

    // 房间行：只显房号，名字 / refno / 数量在 title
    const roomTitle = r1.querySelector<HTMLElement>('[title*="R432"]')!;
    expect(text(roomTitle)).toBe('R432');
    expect(roomTitle.title).toBe('R432 · /1RX-RM04-R432-A-VERY-LONG-ROOM-NAME · r1 · 4 个构件');
    // 没名字的房间：title 里也没有空段
    const r2Title = q(host, 'spatial-tree-room')[1]!.querySelector<HTMLElement>('[title*="R143"]')!;
    expect(r2Title.title).toBe('R143 · r2 · 1 个构件');

    // 专业行
    const specTitles = q(r1, 'spatial-tree-spec').map((el) => el.querySelector<HTMLElement>('[title*="专业"]')!.title);
    expect(specTitles[0]).toMatch(/· 专业 0$/);
    expect(specTitles[1]).toMatch(/· 专业 3$/);

    // 单元类型行：noun 是可截段，「· 1 个单元」是短尾巴
    const bran = q(r1, 'spatial-tree-unit-type')[0]!;
    const branRow = bran.querySelector<HTMLElement>('[title^="BRAN"]')!;
    expect(branRow.title).toBe('BRAN · 1 个单元 · 2 个构件');
    const [branNoun, branTail] = Array.from(branRow.children) as [HTMLElement, HTMLElement];
    expect(text(branNoun)).toBe('BRAN');
    expect(branNoun.className).toContain('truncate');
    expect(text(branTail)).toBe('1 个单元');
    expect(branTail.className).toContain('shrink-0');

    // 单元行：名字上行、refno 进 title；距离 shrink-0
    const b1 = q(r1, 'spatial-tree-unit')[0]!;
    const b1Row = b1.querySelector<HTMLElement>('[title*="b1"]')!;
    expect(b1Row.title).toBe('/Copy-of-100-B-1-VERY-LONG-BRANCH-NAME · BRAN b1 · 最近 0.21 m · 2 个构件');
    const [b1Name, b1Distance] = Array.from(b1Row.children) as [HTMLElement, HTMLElement];
    expect(text(b1Name)).toBe('/Copy-of-100-B-1-VERY-LONG-BRANCH-NAME');
    expect(b1Name.className).toContain('truncate');
    expect(text(b1Distance)).toBe('0.21 m');
    expect(b1Distance.className).toContain('shrink-0');
    // 没名字的单元：行上是 refno，title 不带空段
    const e1Row = q(r1, 'spatial-tree-unit')[1]!.querySelector<HTMLElement>('[title*="e1"]')!;
    expect(text(e1Row.children[0]!)).toBe('e1');
    expect(e1Row.title).toBe('EQUI e1 · 最近 2.00 m · 1 个构件');

    // 其他构件行：四个字，说明进 title
    const others = q(r1, 'spatial-tree-others')[0]!;
    const othersRow = others.querySelector<HTMLElement>('[title^="其他构件"]')!;
    expect(text(othersRow)).toBe('其他构件');
    expect(othersRow.title).toBe('其他构件 · 不属任何最小交付单元的构件，按 noun 分 · 1 个');
  });

  it('三个动作叠在标题单元格里、不在行上占格：每行一组，容器绝对定位、平时 visibility hidden、行悬停 / 行内聚焦才显', () => {
    const { host } = mountTree();
    const r1 = q(host, 'spatial-tree-room')[0]!;
    // 房间 1 + 专业 2 + 单元类型 2 + 单元 2 + 其他构件 1 = 8 组
    const actions = q(r1, 'spatial-tree-node-actions');
    expect(actions).toHaveLength(8);
    for (const group of actions) {
      expect(group.className).toContain('absolute');
      // 不能用 opacity-0：Vuetify main.css 的 .opacity-0 / .pointer-events-none 带 !important，会压掉 group-hover 变体
      expect(group.className).toContain('invisible');
      expect(group.className).not.toMatch(/\bopacity-0\b|\bpointer-events-none\b/);
      expect(group.className).toContain('group-hover:visible');
      expect(group.className).toContain('group-has-[:focus-visible]:visible');
      // 父级是标题单元格（relative），计数是它的兄弟而不是子代
      expect(group.parentElement?.className).toContain('relative');
      expect(group.querySelector('[data-testid="spatial-tree-count"]')).toBeNull();
    }
  });

  it('动作：加载 / 仅显示 / 隔离按节点下的 refno 集合发出；加载带节点标签', () => {
    const { host, emitted } = mountTree();
    const r1 = q(host, 'spatial-tree-room')[0]!;

    q(r1, 'spatial-tree-node-load')[0]!.click();
    expect(emitted.load).toEqual([[['p1', 't1', 'x1', 'n1'], '房间 R432']]);

    // 专业 3 的「仅显示」
    const spec3 = q(r1, 'spatial-tree-spec')[1]!;
    q(spec3, 'spatial-tree-node-show-only')[0]!.click();
    expect(emitted.showOnly).toEqual([[['t1', 'x1', 'n1']]]);

    // 单元 b1 的「隔离」
    const b1 = q(r1, 'spatial-tree-unit')[0]!;
    q(b1, 'spatial-tree-node-isolate')[0]!.click();
    expect(emitted.isolate).toEqual([[['t1', 'x1']]]);

    // 单元类型 EQUI 的「加载」标签是 noun
    const equi = q(r1, 'spatial-tree-unit-type')[1]!;
    q(equi, 'spatial-tree-node-load')[0]!.click();
    expect(emitted.load[1]).toEqual([['n1'], 'EQUI']);
  });

  it('展开单元出叶子：refno 是唯一可截段、noun / 距离 shrink-0，title 带 refno · noun · 距离（· 跨 N 房）（· 未加载）；点行定位、眼睛切显隐', async () => {
    const { host, emitted } = mountTree({ items: [item('t1', { name: '/T1', visible: false })], activeRefno: 't1' });
    const r1 = q(host, 'spatial-tree-room')[0]!;
    const b1 = q(r1, 'spatial-tree-unit')[0]!;

    q(b1, 'spatial-tree-toggle')[0]!.click();
    await nextTick();

    const leaves = q(b1, 'spatial-tree-leaf');
    expect(leaves.map((el) => el.dataset.refno)).toEqual(['t1', 'x1']);
    // 叶子已内联：不发 expand
    expect(emitted.expand).toEqual([]);

    const t1Button = leaves[0]!.querySelector<HTMLButtonElement>('button[title]')!;
    expect(t1Button.title).toBe('t1 · TUBI · 0.21 m · /T1');
    expect(t1Button.className).toContain('text-gray-800');
    const [t1Refno, t1Noun, t1Distance] = Array.from(t1Button.children) as [HTMLElement, HTMLElement, HTMLElement];
    expect(text(t1Refno)).toBe('t1');
    expect(t1Refno.className).toContain('truncate');
    expect(t1Noun.className).toContain('shrink-0');
    expect(t1Distance.className).toContain('shrink-0');
    expect(leaves[0]!.className).toContain('bg-brand-subtle');

    // x1 不在 store 里：灰字、title 带「未加载」与「跨 2 房」，行尾有跨房小标
    const x1Button = leaves[1]!.querySelector<HTMLButtonElement>('button[title]')!;
    expect(x1Button.title).toBe('x1 · ELBO · 5.00 m · 跨 2 房 · 未加载');
    expect(x1Button.className).toContain('text-gray-400');
    expect(text(q(leaves[1]!, 'spatial-tree-shared')[0])).toBe('跨 2 房');
    expect(q(leaves[0]!, 'spatial-tree-shared')).toHaveLength(0);

    t1Button.click();
    expect(emitted.focus).toHaveLength(1);
    expect(emitted.focus[0]![0]!.refno).toBe('t1');

    const eye = q(leaves[0]!, 'spatial-tree-leaf-visibility')[0]!;
    expect(eye.title).toBe('显示');
    eye.click();
    expect(emitted.toggleVisible).toHaveLength(1);
    expect(emitted.toggleVisible[0]![0]!.refno).toBe('t1');

    // 不在 store 里的叶子合成最小项定位
    x1Button.click();
    expect(emitted.focus[1]![0]).toMatchObject({ refno: 'x1', noun: 'ELBO', loaded: false, distance: 5000 });
  });

  it('叶子未内联（服务端超上限）：单元第一次展开发 expand 且只发一次、显示「取构件中…」；高层动作不可点并给原因', async () => {
    const capped = tree({ leaves_inline: false, leaf_count: 9000 });
    for (const room of capped.rooms) {
      for (const spec of room.specs) {
        for (const group of spec.unit_types) for (const unit of group.units) unit.elements = undefined;
        for (const group of spec.others.by_noun) group.elements = undefined;
      }
    }
    const { host, emitted } = mountTree({ tree: capped });
    const r1 = q(host, 'spatial-tree-room')[0]!;

    // 房间行的动作：不可点，title 说明要先展开
    const roomLoad = q(r1, 'spatial-tree-node-load')[0] as HTMLButtonElement;
    expect(roomLoad.disabled).toBe(true);
    expect(roomLoad.title).toBe('构件太多未全部下发，先展开单元或构件类型取构件');

    const b1 = q(r1, 'spatial-tree-unit')[0]!;
    const b1Load = q(b1, 'spatial-tree-node-load')[0] as HTMLButtonElement;
    expect(b1Load.disabled).toBe(true);
    expect(b1Load.title).toBe('先展开取该组构件');

    const toggle = q(b1, 'spatial-tree-toggle')[0]!;
    toggle.click();
    await nextTick();
    expect(emitted.expand).toEqual([[{ unit: 'b1' }]]);
    expect(q(b1, 'spatial-tree-leaves-pending')).toHaveLength(1);

    // 收起再展开不重复请求
    toggle.click();
    await nextTick();
    toggle.click();
    await nextTick();
    expect(emitted.expand).toHaveLength(1);

    // 其他构件 → noun 组展开走 other_noun 选择器
    const others = q(r1, 'spatial-tree-others')[0]!;
    q(others, 'spatial-tree-toggle')[0]!.click();
    await nextTick();
    const pane = q(others, 'spatial-tree-other-noun')[0]!;
    q(pane, 'spatial-tree-toggle')[0]!.click();
    await nextTick();
    expect(emitted.expand[1]).toEqual([{ otherNoun: 'PANE' }]);
  });

  it('busy 时动作按钮全部禁用；没有房间命中时给一句空态', () => {
    const { host } = mountTree({ busy: true });
    const buttons = [
      ...q(host, 'spatial-tree-node-load'),
      ...q(host, 'spatial-tree-node-show-only'),
      ...q(host, 'spatial-tree-node-isolate'),
    ] as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    unmountCurrent?.();

    const empty = mountTree({ tree: tree({ rooms: [], total_count: 0, leaf_count: 0 }) });
    expect(text(q(empty.host, 'spatial-tree')[0])).toBe('所选房间里没有命中的构件。');
    expect(q(empty.host, 'spatial-tree-room')).toHaveLength(0);
  });
});

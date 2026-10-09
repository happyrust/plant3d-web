import { computed, ref, type ComputedRef, type Ref } from 'vue';

import type {
  ModelAttributeHistory,
  ModelElementVersionTimeline,
  ModelNodeDiffScope,
  ModelNodeVersionTimeline,
  ModelVersionImpactKind,
} from '@/model-source';

import {
  buildNodeTimelineRows,
  countNodeTimeline,
  defaultNodeScope,
  defaultNodeVersionPair,
  filterNodeTimelineRows,
  pairWithLatest,
  pairWithPrevious,
  pickNodeVersionSide,
  sliceNodeTimelineRows,
  timelineRowAttributeOnly,
  timelineRowImpact,
  type NodeTimelineRow,
  type NodeTimelineSlice,
  type NodeVersionPair,
} from '@/utils/nodeVersionTimeline';

/**
 * 节点版本面板的「时间线」那一半（ADR 0066；版本对比审核计划 P2-2 从 `ModelUnitVersionComparePanel` 里抽出来）：
 * 三条时间线并成一条、对比范围、A / B 选择、两个勾选、「加载更早」折叠、手填会话号。只管状态与选择，不取数、不碰 DOM、
 * 不知道三维对比——面板 `loadVersions` 取回来后 `setNode()` 交进来；换 A / B 之前要先收掉上一轮的三维对比，由
 * `beforePairChange` 回调交给面板做。
 *
 * 纯函数在 `utils/nodeVersionTimeline`（并表 / 筛行 / 切片 / 选边），这里只是把它们接到 Vue 的响应式上。
 */

export type NodeVersionTimelineNode = {
  /** `listElementVersions`：节点自己哪几版变过、所属单元哪几版变过（旧服务端只有单元那一列，`unitColumnOnly`） */
  timeline: ModelElementVersionTimeline;
  /** `attributeHistory`；旧服务端没有这条路由时为 null */
  history: ModelAttributeHistory | null;
  /** `listNodeVersions(subtree)`：只在节点是容器时取；没取 / 旧服务端为 null */
  nodeVersions: ModelNodeVersionTimeline | null;
  /** 节点有没有成员：null = 没问到，false = 叶子（「所有子节点」置灰） */
  hasMembers: boolean | null;
};

export type UseNodeVersionTimelineOptions = {
  /** 用户换 A / B（点行上的 A / B、与上一版比、与最新比、手填）之前调用：面板在这里收掉上一轮的三维对比 */
  beforePairChange?: () => void;
  /** 换范围之后调用：面板在这里收起「所有子节点」下展开的构件那一格 */
  afterScopeChange?: () => void;
};

export type NodeVersionTimelineState = {
  elementTimeline: Ref<ModelElementVersionTimeline | null>;
  attributeHistory: Ref<ModelAttributeHistory | null>;
  nodeVersions: Ref<ModelNodeVersionTimeline | null>;
  hasMembers: Ref<boolean | null>;
  scope: Ref<ModelNodeDiffScope>;
  beforeSesno: Ref<number | null>;
  afterSesno: Ref<number | null>;
  /** 「只看几何变的」 */
  geometryOnly: Ref<boolean>;
  /** 「只看自身变的」（`所有子节点` 下才露出）；自身列未知（旧服务端）时置灰不筛 */
  selfOnly: Ref<boolean>;
  /** 「加载更早 n 版…」点开了没：换节点重载时折回去，切范围 / 勾选不折 */
  timelineExpanded: Ref<boolean>;
  /** 手填会话号（容器撞上旧服务端时的兜底） */
  manualA: Ref<string>;
  manualB: Ref<string>;

  /** 旧服务端只给得出单元那一列：自身那一列是未知，不是「没变」 */
  selfColumnUnknown: ComputedRef<boolean>;
  hasUnit: ComputedRef<boolean>;
  /** 查的那个节点自己就是单元根（或还没查 / 是容器）：两列说的是同一件事 */
  queriedIsUnitRoot: ComputedRef<boolean>;
  /** 查的是单元里的某个构件时才有：对比结果与三维定位收窄到它 */
  queriedElementRefno: ComputedRef<string | null>;
  nodeNoun: ComputedRef<string>;
  /** 三条时间线并起来、按范围标 `inScope`，新 → 旧 */
  rows: ComputedRef<NodeTimelineRow[]>;
  /** 「本范围 n 版 · 仅属性 m」 */
  counts: ComputedRef<{ versions: number; attributeOnly: number }>;
  /** 范围内的行 + 被选为 A / B 的行，再过两个勾选 */
  visibleRows: ComputedRef<NodeTimelineRow[]>;
  /** 实际画出来的那一段 + 折起的更早版数 */
  slice: ComputedRef<NodeTimelineSlice>;
  pairReady: ComputedRef<boolean>;

  /** 查回来的节点交进来：缺省范围（Q10 c）、缺省 A / B（范围内最近两版）、折叠复位 */
  setNode(node: NodeVersionTimelineNode): void;
  /** 重查之前清空（出错时面板也调它） */
  reset(): void;
  /** 切范围不重选 A / B（Q9 a）：两端保留，越界的行灰掉；只有一端还没选时才补缺省 */
  setScope(next: ModelNodeDiffScope): void;
  /** 把某一行设为 A 或 B，两端按新旧摆正；撞到同一版时另一端让开 */
  pickSide(side: 'a' | 'b', sesno: number): void;
  compareWithPrevious(): void;
  compareWithLatest(): void;
  /** 手填 A / B：填得不对回错误文案（面板显示），填对了回 null */
  applyManualPair(): string | null;
  /** 行上那颗徽章显示哪一列：`仅自身` 看自身列；自身列未知时只剩单元那一列可显示 */
  rowImpact(row: NodeTimelineRow): ModelVersionImpactKind | null;
  /** 单元根 / 容器的那一颗徽章要不要画成「仅属性」 */
  attributeOnlyShown(row: NodeTimelineRow): boolean;
  /** 时间线里某一会话的时间；没有这一行为 null */
  sessionTimeOf(sesno: number): string | null;
};

export function useNodeVersionTimeline(options: UseNodeVersionTimelineOptions = {}): NodeVersionTimelineState {
  const elementTimeline = ref<ModelElementVersionTimeline | null>(null);
  const attributeHistory = ref<ModelAttributeHistory | null>(null);
  const nodeVersions = ref<ModelNodeVersionTimeline | null>(null);
  const hasMembers = ref<boolean | null>(null);
  const scope = ref<ModelNodeDiffScope>('subtree');
  const beforeSesno = ref<number | null>(null);
  const afterSesno = ref<number | null>(null);
  const geometryOnly = ref(false);
  const selfOnly = ref(false);
  const timelineExpanded = ref(false);
  const manualA = ref('');
  const manualB = ref('');

  const selfColumnUnknown = computed(() => elementTimeline.value?.unitColumnOnly === true);
  const hasUnit = computed(() => !!elementTimeline.value?.unitRefno);
  const queriedIsUnitRoot = computed(() => {
    const timeline = elementTimeline.value;
    return !timeline || timeline.unitRefno === null || timeline.unitRefno === timeline.refno;
  });
  const queriedElementRefno = computed(() => (queriedIsUnitRoot.value ? null : elementTimeline.value?.refno ?? null));
  const nodeNoun = computed(() => elementTimeline.value?.noun || attributeHistory.value?.noun || '');

  const rows = computed<NodeTimelineRow[]>(() => buildNodeTimelineRows({
    timeline: elementTimeline.value,
    history: attributeHistory.value,
    nodeVersions: nodeVersions.value,
    scope: scope.value,
  }));
  const counts = computed(() => countNodeTimeline(rows.value, scope.value));
  const visibleRows = computed(() => filterNodeTimelineRows(rows.value, {
    scope: scope.value,
    selected: [beforeSesno.value, afterSesno.value],
    geometryOnly: geometryOnly.value,
    selfOnly: selfOnly.value,
    selfColumnUnknown: selfColumnUnknown.value,
  }));
  const slice = computed(() => sliceNodeTimelineRows(visibleRows.value, {
    expanded: timelineExpanded.value,
    selected: [beforeSesno.value, afterSesno.value],
  }));
  const pairReady = computed(() => beforeSesno.value !== null && afterSesno.value !== null && beforeSesno.value < afterSesno.value);

  function currentPair(): NodeVersionPair {
    return { a: beforeSesno.value, b: afterSesno.value };
  }

  /** 两端一起换；没变就什么都不做（也不去收三维对比） */
  function applyPair(pair: NodeVersionPair): void {
    if (pair.a === beforeSesno.value && pair.b === afterSesno.value) return;
    options.beforePairChange?.();
    beforeSesno.value = pair.a;
    afterSesno.value = pair.b;
  }

  function reset(): void {
    elementTimeline.value = null;
    attributeHistory.value = null;
    nodeVersions.value = null;
    hasMembers.value = null;
    beforeSesno.value = null;
    afterSesno.value = null;
    timelineExpanded.value = false;
  }

  function setNode(node: NodeVersionTimelineNode): void {
    elementTimeline.value = node.timeline;
    attributeHistory.value = node.history;
    nodeVersions.value = node.nodeVersions;
    hasMembers.value = node.hasMembers;
    timelineExpanded.value = false;
    scope.value = defaultNodeScope({ unitRefno: node.timeline.unitRefno, hasMembers: node.hasMembers });
    const pair = defaultNodeVersionPair(rows.value);
    beforeSesno.value = pair.a;
    afterSesno.value = pair.b;
  }

  function setScope(next: ModelNodeDiffScope): void {
    if (next === scope.value) return;
    if (next === 'subtree' && hasMembers.value === false) return;
    scope.value = next;
    if (beforeSesno.value === null || afterSesno.value === null) {
      const pair = defaultNodeVersionPair(rows.value);
      beforeSesno.value = beforeSesno.value ?? pair.a;
      afterSesno.value = afterSesno.value ?? pair.b;
    }
    options.afterScopeChange?.();
  }

  function pickSide(side: 'a' | 'b', sesno: number): void {
    applyPair(pickNodeVersionSide(rows.value, currentPair(), side, sesno));
  }

  function compareWithPrevious(): void {
    applyPair(pairWithPrevious(rows.value, currentPair()));
  }

  function compareWithLatest(): void {
    applyPair(pairWithLatest(rows.value, currentPair()));
  }

  function applyManualPair(): string | null {
    const a = Number.parseInt(manualA.value, 10);
    const b = Number.parseInt(manualB.value, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) {
      return '手填的 A / B 要是两个不同的会话号';
    }
    // 手填只出现在容器撞上旧服务端时（容器没有自己的几何可跑），与抽出前一样直接落两端、不走 beforePairChange
    beforeSesno.value = Math.min(a, b);
    afterSesno.value = Math.max(a, b);
    return null;
  }

  function rowImpact(row: NodeTimelineRow): ModelVersionImpactKind | null {
    return timelineRowImpact(row, scope.value, selfColumnUnknown.value);
  }

  function attributeOnlyShown(row: NodeTimelineRow): boolean {
    return timelineRowAttributeOnly(row, scope.value, selfColumnUnknown.value);
  }

  function sessionTimeOf(sesno: number): string | null {
    return rows.value.find((row) => row.sesno === sesno)?.sessionTime ?? null;
  }

  return {
    elementTimeline,
    attributeHistory,
    nodeVersions,
    hasMembers,
    scope,
    beforeSesno,
    afterSesno,
    geometryOnly,
    selfOnly,
    timelineExpanded,
    manualA,
    manualB,
    selfColumnUnknown,
    hasUnit,
    queriedIsUnitRoot,
    queriedElementRefno,
    nodeNoun,
    rows,
    counts,
    visibleRows,
    slice,
    pairReady,
    setNode,
    reset,
    setScope,
    pickSide,
    compareWithPrevious,
    compareWithLatest,
    applyManualPair,
    rowImpact,
    attributeOnlyShown,
    sessionTimeOf,
  };
}

/**
 * 节点版本视图（ADR 0066，CONTEXT「节点版本视图 / 对比范围 / 属性变化时间线」）的纯函数：
 * 把构件版本时间线（`listElementVersions`，两列五态）与属性变化时间线（`attributeHistory`，user / comment /
 * 逐属性 before-after）并成面板上的一条时间线，按**对比范围**筛行；在时间线上选 A / B；把一段区间内的逐会话属性
 * 变化折成 A→B 的净差。都不碰后端、不碰 DOM，面板只负责调用与渲染。
 *
 * 会话序：前端拿不到会话链，这里按 `sesno` 数值当链序（dabacon 的 sesno 沿链单调，ADR-081 的真机语料从没见过例外）。
 */
import type {
  ModelAttributeChange,
  ModelAttributeHistory,
  ModelAttributeHistoryEntry,
  ModelElementVersionTimeline,
  ModelNodeDiffScope,
  ModelVersionImpactKind,
} from '@/model-source';

/** 面板时间线的一行 = 一个会话。 */
export type NodeTimelineRow = {
  sesno: number;
  sessionTime: string | null;
  /** 会话页的保存人 / 备注；没有属性变化时间线（旧服务端）时为 null */
  user: string | null;
  comment: string | null;
  /** 节点自身记录在这一会话的变化；null = 它自己没变 */
  selfImpact: ModelVersionImpactKind | null;
  /** 所属单元（≈ 子树）在这一会话的折叠影响；null = 单元表里没有这一会话 */
  unitImpact: ModelVersionImpactKind | null;
  /** 自身记录改了几项（属性行 + 成员 + owner）；没有时间线时为 null */
  changedCount: number | null;
  kind: ModelAttributeHistoryEntry['kind'] | null;
  /** 在当前对比范围内算不算「变了」；不算的行只在被选为 A / B 时才显示（灰掉并标「本范围无变化」） */
  inScope: boolean;
};

export type NodeTimelineInput = {
  timeline: ModelElementVersionTimeline | null;
  history: ModelAttributeHistory | null;
  scope: ModelNodeDiffScope;
};

/**
 * 并两条时间线、按范围标 `inScope`，**新 → 旧**排。
 * - `self`：自身记录变过的会话（版本表左列或属性时间线有它）。**旧服务端只给得出单元那一列
 *   （`unitColumnOnly`）时自身列是未知、不是「没变」**：这时不筛，单元表里的会话照列（行上标「本构件 ?」），
 *   否则整条时间线会空掉、缺省 A / B 也选不出来。
 * - `subtree`：节点有所属单元时 = 单元表里的会话 ∪ 自身会话（现有路由下子树 ≈ 所属单元）；节点是容器
 *   （没有单元）时只有自身会话可列——子树列要 `node/versions?scope=subtree`，面板另给提示。
 */
export function buildNodeTimelineRows(input: NodeTimelineInput): NodeTimelineRow[] {
  const bySesno = new Map<number, NodeTimelineRow>();
  const ensure = (sesno: number, sessionTime: string | null): NodeTimelineRow => {
    let row = bySesno.get(sesno);
    if (!row) {
      row = {
        sesno,
        sessionTime,
        user: null,
        comment: null,
        selfImpact: null,
        unitImpact: null,
        changedCount: null,
        kind: null,
        inScope: false,
      };
      bySesno.set(sesno, row);
    } else if (!row.sessionTime && sessionTime) {
      row.sessionTime = sessionTime;
    }
    return row;
  };
  for (const version of input.timeline?.versions ?? []) {
    const row = ensure(version.sesno, version.sessionTime);
    row.selfImpact = version.elementImpact;
    row.unitImpact = version.unitImpact;
  }
  for (const entry of input.history?.entries ?? []) {
    const row = ensure(entry.sesno, entry.sessionTime);
    row.user = entry.user;
    row.comment = entry.comment;
    row.changedCount = entry.changedCount;
    row.kind = entry.kind;
    if (!row.selfImpact) row.selfImpact = entry.impact;
  }
  const hasUnit = !!input.timeline?.unitRefno;
  // 服务端给不出自身那一列时，「自身没变」无从判断——按未知处理，别把整条时间线筛空
  const selfColumnUnknown = input.timeline?.unitColumnOnly === true;
  for (const row of bySesno.values()) {
    row.inScope = input.scope === 'self' && !selfColumnUnknown
      ? row.selfImpact !== null
      : row.selfImpact !== null || (hasUnit && row.unitImpact !== null);
  }
  return [...bySesno.values()].sort((x, y) => y.sesno - x.sesno);
}

export type NodeVersionPair = { a: number | null; b: number | null };

/** 缺省选择：B = 范围内最新一版，A = 它的上一版（范围内）；不够两版时 A 为 null。 */
export function defaultNodeVersionPair(rows: NodeTimelineRow[]): NodeVersionPair {
  const inScope = rows.filter((row) => row.inScope).sort((x, y) => y.sesno - x.sesno);
  return { b: inScope[0]?.sesno ?? null, a: inScope[1]?.sesno ?? null };
}

/**
 * 在时间线上把某一行设为 A 或 B，然后把两端按新旧摆正（A 早于 B）。两端撞到同一版时另一端顺着范围内的
 * 上一版 / 下一版让开；让不开就留 null。
 */
export function pickNodeVersionSide(
  rows: NodeTimelineRow[],
  current: NodeVersionPair,
  side: 'a' | 'b',
  sesno: number,
): NodeVersionPair {
  const ordered = rows.map((row) => row.sesno).sort((x, y) => x - y);
  let a = side === 'a' ? sesno : current.a;
  let b = side === 'b' ? sesno : current.b;
  if (a !== null && b !== null && a === b) {
    const index = ordered.indexOf(sesno);
    if (side === 'a') b = ordered[index + 1] ?? null;
    else a = ordered[index - 1] ?? null;
  }
  if (a !== null && b !== null && a > b) [a, b] = [b, a];
  return { a, b };
}

/** 「与上一版比」：保留 B，A = 时间线上 B 的上一版（范围内优先，没有就任意上一版）。 */
export function pairWithPrevious(rows: NodeTimelineRow[], current: NodeVersionPair): NodeVersionPair {
  const b = current.b ?? defaultNodeVersionPair(rows).b;
  if (b === null) return { a: null, b: null };
  const older = rows.filter((row) => row.sesno < b).sort((x, y) => y.sesno - x.sesno);
  const a = (older.find((row) => row.inScope) ?? older[0])?.sesno ?? null;
  return { a, b };
}

/** 「与最新比」：B = 范围内最新一版；A 保留，A 不早于 B 时退成 B 的上一版。 */
export function pairWithLatest(rows: NodeTimelineRow[], current: NodeVersionPair): NodeVersionPair {
  const latest = defaultNodeVersionPair(rows).b;
  if (latest === null) return { a: null, b: null };
  if (current.a !== null && current.a < latest) return { a: current.a, b: latest };
  return pairWithPrevious(rows, { a: null, b: latest });
}

/** A→B 折出来的一行净差。 */
export type FoldedAttributeChange = ModelAttributeChange & {
  /** 这一项在 (A, B] 里被改了几次（1 = 只改过一次） */
  hops: number;
};

export type FoldedAttributeDiff = {
  changes: FoldedAttributeChange[];
  /** (A, B] 里它被建 / 被删的那一版；没有为 null */
  createdAt: number | null;
  deletedAt: number | null;
  /** (A, B] 里成员表 / owner 有没有动过（净差看不出来，只提示） */
  membersTouched: boolean;
  ownerTouched: boolean;
  /** 折了几个会话 */
  sessions: number;
};

/**
 * 把属性变化时间线在 (A, B] 里的逐会话 before / after 折成净差：同名属性取最早那次的 before、最晚那次的 after，
 * 两头一样就不算变。`CACHID` 一类戳原样保留 `stamp` 标记，由界面决定怎么显示。
 */
export function foldAttributeChanges(entries: ModelAttributeHistoryEntry[], a: number, b: number): FoldedAttributeDiff {
  const inRange = entries
    .filter((entry) => entry.sesno > a && entry.sesno <= b)
    .sort((x, y) => x.sesno - y.sesno);
  const folded = new Map<string, FoldedAttributeChange>();
  let createdAt: number | null = null;
  let deletedAt: number | null = null;
  let membersTouched = false;
  let ownerTouched = false;
  for (const entry of inRange) {
    if (entry.kind === 'created') createdAt = entry.sesno;
    if (entry.kind === 'deleted') deletedAt = entry.sesno;
    if (entry.members) membersTouched = true;
    if (entry.owner) ownerTouched = true;
    for (const change of entry.changes) {
      const existing = folded.get(change.name);
      if (existing) {
        existing.after = change.after;
        existing.hops += 1;
      } else {
        folded.set(change.name, { ...change, hops: 1 });
      }
    }
  }
  return {
    changes: [...folded.values()].filter((change) => change.before !== change.after),
    createdAt,
    deletedAt,
    membersTouched,
    ownerTouched,
    sessions: inRange.length,
  };
}

/**
 * 范围开关的缺省挡位（Q10 c）：最小交付单元及以下 = `subtree`（点开一条 BRAN 要的就是连成员一起看）；
 * 容器（不在任何单元下）= `self`（先给便宜那档）。叶子（没有成员）由面板把 `subtree` 置灰，这里仍回 `self`。
 */
export function defaultNodeScope(node: { unitRefno: string | null; hasMembers: boolean | null }): ModelNodeDiffScope {
  if (node.hasMembers === false) return 'self';
  return node.unitRefno ? 'subtree' : 'self';
}

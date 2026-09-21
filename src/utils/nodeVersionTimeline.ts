/**
 * 节点版本视图（ADR 0066，CONTEXT「节点版本视图 / 对比范围 / 属性变化时间线 / 属性净差」）的纯函数：
 * 把构件版本时间线（`listElementVersions`，两列五态）与属性变化时间线（`attributeHistory`，user / comment /
 * 逐属性 before-after）并成面板上的一条时间线，按**对比范围**筛行；在时间线上选 A / B；把属性净差（服务端
 * `element/attribute-diff` 直接给的，或旧服务端下由时间线在 (A, B] 里折出来的）归成面板上同一种形状。都不碰后端、
 * 不碰 DOM，面板只负责调用与渲染。
 *
 * 会话序：前端拿不到会话链，这里按 `sesno` 数值当链序（dabacon 的 sesno 沿链单调，ADR-081 的真机语料从没见过例外）。
 */
import type {
  ModelAttributeChange,
  ModelAttributeDiff,
  ModelAttributeHistory,
  ModelAttributeHistoryEntry,
  ModelElementVersionTimeline,
  ModelNodeDiffScope,
  ModelNodeVersionTimeline,
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
  /**
   * 子树在这一会话的折叠影响：有节点版本表（`node/versions?scope=subtree`）时取它；没有时退成所属单元那一列
   * （现有路由下子树 ≈ 所属单元）。null = 子树没动。
   */
  unitImpact: ModelVersionImpactKind | null;
  /** 这一会话子树里有几何要重算的最小交付单元数；没有节点版本表时为 null */
  unitsChanged: number | null;
  /** 自身记录改了几项（属性行 + 成员 + owner）；没有时间线时为 null */
  changedCount: number | null;
  kind: ModelAttributeHistoryEntry['kind'] | null;
  /**
   * 这一会话节点自身只在属性变化时间线里出现、版本表（`element/versions` 左列 / `node/versions` 的 `self_impact`）没把它算成一版：
   * 改的是不进模型提取的属性（UDA 之类），模型口径下等于原样重写。行照列（「谁在哪一版改了什么」要它），但不计入「本范围 n 版」，
   * 行上标「仅属性」——这样版数与服务端版本表的行数对得上。
   */
  attributeOnly: boolean;
  /** 在当前对比范围内算不算「变了」；不算的行只在被选为 A / B 时才显示（灰掉并标「本范围无变化」） */
  inScope: boolean;
};

export type NodeTimelineInput = {
  timeline: ModelElementVersionTimeline | null;
  history: ModelAttributeHistory | null;
  /** 节点版本表（`scope=subtree`，CONTEXT「节点版本表」）；旧服务端没有这条路由 / 没去取时为 null */
  nodeVersions?: ModelNodeVersionTimeline | null;
  scope: ModelNodeDiffScope;
};

/**
 * 并三条时间线、按范围标 `inScope`，**新 → 旧**排。
 * - `self`：自身记录变过的会话（版本表左列 / 属性时间线 / 节点版本表的 `selfImpact` 有它）。**旧服务端只给得出
 *   单元那一列（`unitColumnOnly`）时自身列是未知、不是「没变」**：这时不筛，单元表里的会话照列（行上标「本构件 ?」），
 *   否则整条时间线会空掉、缺省 A / B 也选不出来；节点版本表在时自身列由它补齐，不再算未知。
 * - `subtree`：有节点版本表（`node/versions?scope=subtree`）时 = 它的每一行——容器（SITE / ZONE）也列得出子树，
 *   每行带 `unitsChanged`；没有时退成「单元表里的会话 ∪ 自身会话」（现有路由下子树 ≈ 所属单元），容器就只剩自身会话，
 *   面板另给提示。
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
        unitsChanged: null,
        changedCount: null,
        kind: null,
        attributeOnly: false,
        inScope: false,
      };
      bySesno.set(sesno, row);
    } else if (!row.sessionTime && sessionTime) {
      row.sessionTime = sessionTime;
    }
    return row;
  };
  const nodeVersions = input.nodeVersions ?? null;
  for (const version of input.timeline?.versions ?? []) {
    const row = ensure(version.sesno, version.sessionTime);
    row.selfImpact = version.elementImpact;
    row.unitImpact = version.unitImpact;
  }
  for (const version of nodeVersions?.versions ?? []) {
    const row = ensure(version.sesno, version.sessionTime);
    // 节点版本表说的就是子树：它在时压过单元那一列，自身列空着的也由它补
    row.unitImpact = version.impact;
    row.unitsChanged = version.unitsChanged;
    if (!row.selfImpact) row.selfImpact = version.selfImpact;
  }
  // 自身那一列有没有可信的来源：element/versions 的左列（旧服务端 unitColumnOnly 时是未知）或节点版本表的 self_impact
  const selfColumnKnown = (input.timeline !== null && !input.timeline.unitColumnOnly) || nodeVersions !== null;
  for (const entry of input.history?.entries ?? []) {
    const row = ensure(entry.sesno, entry.sessionTime);
    row.user = entry.user;
    row.comment = entry.comment;
    row.changedCount = entry.changedCount;
    row.kind = entry.kind;
    if (!row.selfImpact) {
      // 版本表没把它算成自身的一版（改的是不进模型提取的属性）：行照列，自身列有来源时标「仅属性」，没来源就只是补上
      row.selfImpact = entry.impact;
      row.attributeOnly = selfColumnKnown;
    }
  }
  const hasUnit = !!input.timeline?.unitRefno;
  const subtreeKnown = nodeVersions !== null;
  // 服务端给不出自身那一列时，「自身没变」无从判断——按未知处理，别把整条时间线筛空；节点版本表给了自身列就不算未知
  const selfColumnUnknown = input.timeline?.unitColumnOnly === true && !subtreeKnown;
  for (const row of bySesno.values()) {
    row.inScope = input.scope === 'self' && !selfColumnUnknown
      ? row.selfImpact !== null
      : row.selfImpact !== null || ((subtreeKnown || hasUnit) && row.unitImpact !== null);
  }
  return [...bySesno.values()].sort((x, y) => y.sesno - x.sesno);
}

/**
 * 「本范围 n 版 · 仅属性 m」的两个数：`versions` = 范围内版本表算成一版的会话数（与服务端 `node/versions` / `element/versions` 的
 * 行数对得上），`attributeOnly` = 范围内只有属性时间线列出来的会话数（UDA 之类，模型口径下不成一版）。
 */
export function countNodeTimeline(rows: NodeTimelineRow[], scope: ModelNodeDiffScope): { versions: number; attributeOnly: number } {
  let versions = 0;
  let attributeOnly = 0;
  for (const row of rows) {
    if (!row.inScope) continue;
    // `self` 只看自身列；`subtree` 下子树列有它就仍是一版（自身只改了属性、成员却动了几何）
    const onlyAttributes = scope === 'self' ? row.attributeOnly : row.attributeOnly && row.unitImpact === null;
    if (onlyAttributes) attributeOnly += 1;
    else versions += 1;
  }
  return { versions, attributeOnly };
}

/** 时间线头上的两个勾选 + 当前范围 / 选择，决定哪些行画出来（`filterNodeTimelineRows`）。 */
export type NodeTimelineFilter = {
  scope: ModelNodeDiffScope;
  /** 被选为 A / B 的会话号：不在范围内 / 被勾选筛掉也照样留着（面板灰掉并标「本范围无变化」） */
  selected: readonly (number | null)[];
  /** 「只看几何变的」：这一范围里影响为 null / noop 的行不列 */
  geometryOnly: boolean;
  /**
   * 「只看自身变的」（设计稿 S2；只在 `subtree` 下有意义——`self` 范围本来就只列自身变过的）：子树动了、节点自身记录没动的会话不列。
   * 「自身变过」含只改了属性的会话（`attributeOnly`）——问的是「我自己动了没」，不是「几何变没变」。
   */
  selfOnly: boolean;
  /** 旧服务端只给得出单元那一列（`unitColumnOnly`）：自身列是未知、不是「没变」，`selfOnly` 不筛（面板把勾选置灰） */
  selfColumnUnknown: boolean;
};

/**
 * 面板时间线实际画出来的行：范围外的只在被选为 A / B 时留着；两个勾选各筛一维、可叠加；被选中的行永远不被勾选筛掉
 * （否则 A / B 徽章会指着一行看不见的东西）。
 */
export function filterNodeTimelineRows(rows: NodeTimelineRow[], filter: NodeTimelineFilter): NodeTimelineRow[] {
  return rows.filter((row) => {
    const selected = filter.selected.includes(row.sesno);
    if (selected) return true;
    if (!row.inScope) return false;
    if (filter.geometryOnly) {
      const impact = filter.scope === 'self' ? row.selfImpact : row.unitImpact ?? row.selfImpact;
      if (!impact || impact === 'noop') return false;
    }
    if (filter.selfOnly && filter.scope === 'subtree' && !filter.selfColumnUnknown && row.selfImpact === null) return false;
    return true;
  });
}

/** 时间线缺省画出来的行数（设计稿 S1「加载更早 n 版…」）；取数不分页，只是展示上先折起更早的 */
export const NODE_TIMELINE_INITIAL_ROWS = 20;

export type NodeTimelineSlice = {
  /** 实际画出来的行（从最近那一版起连续的一段） */
  rows: NodeTimelineRow[];
  /** 折起来没画的更早版数；0 = 全列出来了（没有「加载更早」那一行） */
  hidden: number;
};

/**
 * 时间线缺省只画最近 `initial` 行，其余折成一行「加载更早 n 版…」（点开 = `expanded`，整表全列）。
 * 切的是**连续的一段**（从最近那一版往前数），被选为 A / B 的行一定在这一段里——切点顺延到它，所以 URL / 「与最新比」把 A 选在
 * 很早的会话时，A 与它之后的全部会话都露出来，「加载更早」只折它之前的。计数（「本范围 n 版」）不看这里，仍按全表。
 */
export function sliceNodeTimelineRows(
  rows: NodeTimelineRow[],
  options: { expanded: boolean; selected: readonly (number | null)[]; initial?: number },
): NodeTimelineSlice {
  const initial = options.initial ?? NODE_TIMELINE_INITIAL_ROWS;
  if (options.expanded || rows.length <= initial) return { rows, hidden: 0 };
  let cut = initial;
  rows.forEach((row, index) => {
    if (index >= cut && options.selected.includes(row.sesno)) cut = index + 1;
  });
  return { rows: rows.slice(0, cut), hidden: rows.length - cut };
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
 * **旧服务端的回落**：把属性变化时间线在 (A, B] 里的逐会话 before / after 折成净差：同名属性取最早那次的 before、最晚那次的
 * after，两头一样就不算变。`CACHID` 一类戳原样保留 `stamp` 标记，由界面决定怎么显示。新服务端上净差由
 * `element/attribute-diff` 两端直接读终态给出（见 `viewFromAttributeDiff`），不再走这里——折出来的成员 / owner 只能说「动过」，
 * 服务端给的是两端的真差。
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
 * 属性对比 tab 上一格净差的统一形状（CONTEXT「属性净差」）：服务端 `element/attribute-diff` 直接给的（`server`），或旧服务端下
 * 由属性变化时间线在 (A, B] 里折出来的（`folded`）。面板只认这一种，两条来路在这里归一。
 */
export type AttributeNetDiffView = {
  /** `server` = 服务端两端直接读终态；`folded` = 旧服务端，把时间线在 (A, B] 里折 */
  source: 'server' | 'folded';
  /**
   * created = A 侧不存在；deleted = B 侧不存在；unchanged = 两端一字没差、影响也判不出。`folded` 只判得出
   * created / deleted（区间里有那一行），其余为 null（折出来的看不出「记录重写但字没变」）。
   */
  kind: ModelAttributeDiff['kind'] | null;
  /** 与版本表同一词表；`folded` 给不出，为 null */
  impact: ModelVersionImpactKind | null;
  /** 净差行（含戳，由界面决定显示）；`hops` 在 `server` 下一律 1 */
  changes: FoldedAttributeChange[];
  /** 成员表两端的真差（`server`）；`folded` 给不出，只有 `membersTouched` */
  members: { added: string[]; removed: string[]; reordered: boolean } | null;
  /** owner 改挂 `[A 侧, B 侧]`（`server`）；`folded` 给不出，只有 `ownerTouched` */
  owner: [string, string] | null;
  /** `folded`：(A, B] 里成员表 / owner 有没有动过（净差看不出来，只提示）；`server` 下与 `members` / `owner` 非空同义 */
  membersTouched: boolean;
  ownerTouched: boolean;
  /** `folded`：(A, B] 里它被建 / 被删的那一版；`server` 下为 null（`kind` 已经说了） */
  createdAt: number | null;
  deletedAt: number | null;
  /** `folded`：折了几个会话；`server` 下为 null */
  sessions: number | null;
  /** 某一端属性行渲染不出来的原因（`server`）；此时 `changes` 可能为空但 `kind` / `impact` 仍成立 */
  attributesUnavailable: string | null;
  warnings: string[];
};

/** 服务端 `element/attribute-diff` 的回执 → 面板的一格净差。 */
export function viewFromAttributeDiff(diff: ModelAttributeDiff): AttributeNetDiffView {
  return {
    source: 'server',
    kind: diff.kind,
    impact: diff.impact,
    changes: diff.changes.map((change) => ({ ...change, hops: 1 })),
    members: diff.members,
    owner: diff.owner,
    membersTouched: diff.members !== null,
    ownerTouched: diff.owner !== null,
    createdAt: null,
    deletedAt: null,
    sessions: null,
    attributesUnavailable: diff.attributesUnavailable,
    warnings: diff.warnings,
  };
}

/** 旧服务端：时间线在 (A, B] 里折出来的净差 → 面板的一格净差。 */
export function viewFromFold(fold: FoldedAttributeDiff): AttributeNetDiffView {
  return {
    source: 'folded',
    kind: fold.deletedAt !== null ? 'deleted' : fold.createdAt !== null ? 'created' : null,
    impact: null,
    changes: fold.changes,
    members: null,
    owner: null,
    membersTouched: fold.membersTouched,
    ownerTouched: fold.ownerTouched,
    createdAt: fold.createdAt,
    deletedAt: fold.deletedAt,
    sessions: fold.sessions,
    attributesUnavailable: null,
    warnings: [],
  };
}

/**
 * 净差表里一行属性都没有时该说什么：`visible` 是按「含戳」筛完剩下的行数——筛掉的全是戳就提示勾「含戳」，
 * 其余按来路与 `kind` 照实说（两端一字没差 / 只有成员 owner 动了 / 记录重写但字没变 / 折出来为零）。
 */
export function emptyNetDiffText(view: AttributeNetDiffView, visible: number): string | null {
  if (visible > 0) return null;
  if (view.changes.length > 0) return '只有戳（CACHID 一类）变了，勾「含戳」查看';
  if (view.source === 'folded') return view.sessions === 0 ? '这段区间里它自己一次都没改过' : '净差为零（改过又改回来了）';
  if (view.attributesUnavailable) return `属性行渲染不出来：${view.attributesUnavailable}`;
  if (view.kind === 'unchanged') return '两端一字没差（原样换页不是它的一版）';
  if (view.members || view.owner) return '属性一字没差，只有成员表 / owner 动了';
  if (view.kind === 'created') return 'B 侧没有已设的属性';
  if (view.kind === 'deleted') return 'A 侧没有已设的属性';
  return '记录重写但渲染出来的字没变';
}

/**
 * 范围开关的缺省挡位（Q10 c）：最小交付单元及以下 = `subtree`（点开一条 BRAN 要的就是连成员一起看）；
 * 容器（不在任何单元下）= `self`（先给便宜那档）。叶子（没有成员）由面板把 `subtree` 置灰，这里仍回 `self`。
 */
export function defaultNodeScope(node: { unitRefno: string | null; hasMembers: boolean | null }): ModelNodeDiffScope {
  if (node.hasMembers === false) return 'self';
  return node.unitRefno ? 'subtree' : 'self';
}

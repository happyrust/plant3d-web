import type { MbdDiagnosticsSnapshot } from '@/composables/useMbdDiagnosticsStore';

/**
 * 票 134（#103）：空包时尺寸面板在标题下直接写一两行中文的「为什么没有标注」。
 *
 * 空包 = 标注包被接受（取数、契约、映射都过了）却一个图元都没有。原因写在包的诊断里，但诊断区缺省收起，求解器的说明又全是
 * 英文（建筑空楼板那句末尾还带着 PML 的方法名与行号）。这里从一个空包的诊断里挑出该写在标题下的那一两条，并给出中文：
 *
 * - **按规则号给中文，不解析正文。** 求解器的句式不固定（`civil.nothing_to_annotate` 有 6 种、`support.nothing_to_annotate`
 *   有 2 种，里面带着个数），按规则号只能说到「这块建筑楼板上没有可标注的内容」这一级；具体缺哪一样仍在诊断区的原文里。
 * - **服务端的说明本来就是中文**（`data.view_issue`、`adapter.civil_wall_without_solid`），原样用。
 * - **没有中文说法的规则号退回原文**，不报错——后端先于前端长出新规则号是常态。
 * - 原文、PML 行号、其余的细节一条不动地留在诊断区；标注包本身不改。
 */

type Issue = MbdDiagnosticsSnapshot['issues'][number];

/** 标题下最多写几行；一个空包的诊断最多有六七条，其余的留在诊断区。 */
export const MBD_EMPTY_REASON_MAX_LINES = 2;

/**
 * 空包里出现过的规则号（2026-11-12 最终标注包 `respond-final-b3-83f69d8`：259 个空包、13 个规则号）。
 * `text` 是面板写的那句；`null` = 正文是服务端写的中文，原样用。
 *
 * **数组的先后就是一个空包里有好几条时的先后**：
 * 1. 先是「为什么空」的那七条——每个空包恰好有其中一条（逐个组合数过，14 种组合）；
 * 2. 再是陪着出现的细节：「管道上没有点 ATTA」在前，服务端的中文说明（`data.view_issue`）其次，求解器其余的细节在后。
 *
 * `data.view_issue` 排在 `support.em4_no_pipe_atta` 之后是 P2 定的：REST 空支架上服务端那句讲的是归属（「配不到 STRU，以 REST 为
 * 归属对象」），不是「为什么空」。按规则号分不开它和别的 `data.view_issue`，所以这一挪对同时带这两条的包一律生效——
 * `respond-final-b4-641284675` 的 260 个空包里是 147 个：1 个 EM4 的 REST，和 146 个 EM4 的 STRU 空支架（它们的服务端说明是
 * 「N 根型钢没有 SPRE」，现在让到第三位、留在诊断区）；另 7 个 em9_pipe_supp 的 REST 没有「没有点 ATTA」这一条，第二行不变。
 */
export const MBD_EMPTY_REASON_WORDINGS: readonly Readonly<{ ruleId: string; text: string | null }>[] = [
  // —— 为什么空 ——
  { ruleId: 'data.empty_branch', text: '这条支管下面没有任何管件，没有可标注的内容。' },
  { ruleId: 'civil.geometry_missing', text: '这个土建构件缺少出图要用的几何（面或轴线），标不出来。' },
  { ruleId: 'adapter.civil_wall_without_solid', text: null },
  { ruleId: 'support.no_parts', text: '这个支架下面没有能当作零件的元件，没有可标注的几何。' },
  { ruleId: 'support.nothing_to_annotate', text: '这个支架的构件出不了尺寸，也出不了标签，没有可标注的内容。' },
  {
    ruleId: 'civil.nothing_to_annotate',
    text: '这块建筑楼板上没有可标注的内容：建筑窗体只标墙名与门、房间号与标高、地沟开孔，这里三样都没有能标的。',
  },
  { ruleId: 'civil.arch_floor_only', text: '建筑窗体只给楼板（FLOOR）出标注，这个对象不是楼板。' },
  // —— 陪着出现的细节 ——
  { ruleId: 'support.em4_no_pipe_atta', text: '这个支架的管道上没有点 ATTA，找不了墙，也定不出参考视向。' },
  { ruleId: 'data.view_issue', text: null },
  { ruleId: 'support.part_geometry_missing', text: '有构件缺少可用的截面数据（POSS / POSE / 截面点），被跳过了。' },
  { ruleId: 'civil.member_off_face', text: '随这个构件交来的成员里有不在它任何一个面上的，这些成员没有标注。' },
  { ruleId: 'civil.arch_round_member', text: '有圆形的开孔，建筑窗体不标圆形开孔。' },
  { ruleId: 'adapter.implied_tube_not_drawn', text: '首尾之间的隐含直管与端口不同轴，E3D 在这里不画管子，所以不标管长。' },
];

const WORDING_RANK = new Map(MBD_EMPTY_REASON_WORDINGS.map((entry, index) => [entry.ruleId, index] as const));
const SEVERITY_RANK: Readonly<Record<Issue['severity'], number>> = { error: 0, warning: 1, info: 2 };

/**
 * 这句话的出处：`rule` = 按规则号给的中文；`server` = 服务端原本就是中文的说明；`original` = 没有中文说法，退回原文。
 */
export type MbdEmptyReasonOrigin = 'rule' | 'server' | 'original';

export type MbdEmptyReasonLine = Readonly<{
  /** 取自哪一条诊断（原文在诊断区里对得上）。 */
  issueId: string;
  ruleId: string | null;
  origin: MbdEmptyReasonOrigin;
  text: string;
}>;

export type MbdEmptyReasonSource = Readonly<{
  refno: string;
  /** 空数组 = 后端没有给出原因。 */
  lines: readonly MbdEmptyReasonLine[];
}>;

export type MbdEmptyReasonSummary = Readonly<{
  /** 同屏不止一个标注包：每一行要点名是哪个对象。 */
  multiSource: boolean;
  sources: readonly MbdEmptyReasonSource[];
}>;

/**
 * 一个空包的诊断 → 写在标题下的那一两行（{@link MBD_EMPTY_REASON_MAX_LINES}）。
 *
 * 先后：认识的规则号按 {@link MBD_EMPTY_REASON_WORDINGS} 的顺序；不认识的排在后面，按级别（error → warning → info）；
 * 再相同就按诊断在包里的顺序。同一个规则号只写一次（取包里的头一条）；没有规则号的诊断各算各的。
 */
export function mbdEmptyReasonLines(issues: readonly Issue[]): readonly MbdEmptyReasonLine[] {
  const ranked = issues
    .map((issue, index) => {
      const known = issue.rule_id === undefined ? undefined : WORDING_RANK.get(issue.rule_id);
      return {
        issue,
        index,
        rank: known ?? MBD_EMPTY_REASON_WORDINGS.length + SEVERITY_RANK[issue.severity],
      };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const lines: MbdEmptyReasonLine[] = [];
  const seen = new Set<string>();
  for (const { issue } of ranked) {
    if (lines.length >= MBD_EMPTY_REASON_MAX_LINES) break;
    const key = issue.rule_id ?? `\u0000${issue.id}`;
    if (seen.has(key)) continue;
    const wording = issue.rule_id === undefined
      ? undefined
      : MBD_EMPTY_REASON_WORDINGS[WORDING_RANK.get(issue.rule_id) ?? -1];
    const text = (wording?.text ?? issue.message).trim();
    // 没有话可写的诊断不占一行（也不占这个规则号的名额）。
    if (text === '') continue;
    seen.add(key);
    lines.push({
      issueId: issue.id,
      ruleId: issue.rule_id ?? null,
      origin: wording === undefined ? 'original' : wording.text === null ? 'server' : 'rule',
      text,
    });
  }
  return lines;
}

/**
 * 哪些标注包要在标题下写原因：同步层标了空包（`empty`）、且没有装载失败的。有图元的包不写；装载失败（契约 / 映射拒收、
 * 422）有自己的提示，不在这里；没说是不是空包的老快照不猜。一个都没有时返回 `null`。
 */
export function summarizeMbdEmptyReasons(snapshot: MbdDiagnosticsSnapshot): MbdEmptyReasonSummary | null {
  const sources = snapshot.sources
    .filter(source => source.empty === true && source.loadError === null)
    .map(source => ({ refno: source.refno, lines: mbdEmptyReasonLines(source.issues) }));
  if (sources.length === 0) return null;
  return { multiSource: snapshot.sources.length > 1, sources };
}

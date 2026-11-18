import { describe, expect, it } from 'vitest';

import {
  MBD_EMPTY_REASON_MAX_LINES,
  MBD_EMPTY_REASON_WORDINGS,
  mbdEmptyReasonLines,
  summarizeMbdEmptyReasons,
} from './mbdEmptyReasons';

import type { MbdV2Issue } from '../adapters/mbdV2Contract';
import type {
  MbdDiagnosticsSnapshot,
  MbdDiagnosticsSourceSnapshot,
} from '@/composables/useMbdDiagnosticsStore';

/**
 * 空包里出现过的 13 个规则号，正文各取最终标注包（`respond-final-b3-83f69d8`，2026-11-12）里的一条原话。
 * `chinese` 是面板该写的那句；`null` = 正文本来就是服务端写的中文，原样用。
 */
const REAL: readonly Readonly<{
  ruleId: string;
  severity: MbdV2Issue['severity'];
  message: string;
  chinese: string | null;
}>[] = [
  {
    ruleId: 'data.empty_branch',
    severity: 'info',
    message: 'branch has no members; nothing to split',
    chinese: '这条支管下面没有任何管件，没有可标注的内容。',
  },
  {
    ruleId: 'civil.geometry_missing',
    severity: 'error',
    message: 'GWALL: GWALL needs at least two non-horizontal faces',
    chinese: '这个土建构件缺少出图要用的几何（面或轴线），标不出来。',
  },
  {
    ruleId: 'adapter.civil_wall_without_solid',
    severity: 'info',
    message: 'STWALL 15201_379 没有截面（SPRE 没设）：在 E3D 里没有实体，不标——PML 土建窗体在这种墙上读不出厚度，不出图',
    chinese: null,
  },
  {
    ruleId: 'support.no_parts',
    severity: 'info',
    message: 'the support has no element that becomes a part (no geometry to dimension)',
    chinese: '这个支架下面没有能当作零件的元件，没有可标注的几何。',
  },
  {
    ruleId: 'support.nothing_to_annotate',
    severity: 'info',
    message: 'nothing to annotate on this support: 1 part(s) (PCLA × 1) with 0 contact(s) between them give 0 dimension chain(s) and 0 label(s)',
    chinese: '这个支架的构件出不了尺寸，也出不了标签，没有可标注的内容。',
  },
  {
    ruleId: 'civil.nothing_to_annotate',
    severity: 'info',
    message: 'nothing to annotate on this arch floor: none of the 6 nearby wall(s) stands on the slab; none of the 2 nearby room(s) has a mark '
      + 'point on the slab top; no NXTR trench in the slab (markCivil.drawarch L1691-1710 draws only wall names and doors, room numbers '
      + 'with their elevations, and trench openings)',
    chinese: '这块建筑楼板上没有可标注的内容：建筑窗体只标墙名与门、房间号与标高、地沟开孔，这里三样都没有能标的。',
  },
  {
    ruleId: 'civil.arch_floor_only',
    severity: 'info',
    message: 'the arch form only annotates FLOOR elements (markCivil.drawarch L1679)',
    chinese: '建筑窗体只给楼板（FLOOR）出标注，这个对象不是楼板。',
  },
  {
    ruleId: 'data.view_issue',
    severity: 'warning',
    message: '3 根型钢（SCTN / GENSEC）没有 SPRE（Nulref）：24383_80215、24383_80216、24383_80217。库里没有它们的截面规格（E3D 只画中心线），'
      + '没有截面点、PPLI 与目录原语，这几根的型钢尺寸出不了',
    chinese: null,
  },
  {
    ruleId: 'support.em4_no_pipe_atta',
    severity: 'info',
    message: 'the support has no point ATTA on its pipes: no wall search, no reference look direction and no near walls (PML errors on the '
      + 'unset mbdlocation, suiSupport.pmlobj:2388)',
    chinese: '这个支架的管道上没有点 ATTA，找不了墙，也定不出参考视向。',
  },
  {
    ruleId: 'support.part_geometry_missing',
    severity: 'info',
    message: 'SCTN 24383_80215 has no usable section data (POSS / POSE / section points); skipped',
    chinese: '有构件缺少可用的截面数据（POSS / POSE / 截面点），被跳过了。',
  },
  {
    ruleId: 'civil.member_off_face',
    severity: 'info',
    message: '1 member(s) handed over with this element are not on any of its faces and are not annotated (PML civilMem drops them the same '
      + 'way). By type: NXTR 1 (24381_37301). By reason: 1 cross no face of the element. By owner: no owner name 1.',
    chinese: '随这个构件交来的成员里有不在它任何一个面上的，这些成员没有标注。',
  },
  {
    ruleId: 'civil.arch_round_member',
    severity: 'info',
    message: 'NXTR 24381_37027 is round; the arch form skips round openings (markCivil.pmlobj L1405)',
    chinese: '有圆形的开孔，建筑窗体不标圆形开孔。',
  },
  {
    ruleId: 'adapter.implied_tube_not_drawn',
    severity: 'warning',
    message: 'implied tube Head -> Tail (51953.6 mm) is not coaxial with its ports (116.94° off); E3D draws no tube here, so no tube length '
      + 'is dimensioned',
    chinese: '首尾之间的隐含直管与端口不同轴，E3D 在这里不画管子，所以不标管长。',
  },
];

const realOf = (ruleId: string) => REAL.find(entry => entry.ruleId === ruleId)!;

function issue(ruleId: string | undefined, overrides: Partial<MbdV2Issue> = {}): MbdV2Issue {
  const real = ruleId === undefined ? undefined : REAL.find(entry => entry.ruleId === ruleId);
  return {
    id: `issue:${ruleId ?? 'no-rule'}:${overrides.message ?? ''}`,
    severity: real?.severity ?? 'info',
    category: 'data',
    message: real?.message ?? `message of ${ruleId ?? 'no rule'}`,
    ...(ruleId === undefined ? {} : { rule_id: ruleId }),
    ...overrides,
  };
}

function source(
  refno: string,
  overrides: Partial<MbdDiagnosticsSourceSnapshot> = {},
): MbdDiagnosticsSourceSnapshot {
  return {
    refno,
    issues: [],
    skipped: [],
    layoutMode: null,
    notes: [],
    sourceVersion: null,
    isolines: [],
    loadError: null,
    ...overrides,
  };
}

function snapshot(sources: readonly MbdDiagnosticsSourceSnapshot[]): MbdDiagnosticsSnapshot {
  return {
    loadedAt: 1,
    channel: 'api',
    sourceId: sources.map(entry => entry.refno).join(','),
    issues: sources.flatMap(entry => entry.issues),
    skipped: [],
    layoutMode: null,
    notes: [],
    sourceVersion: null,
    isolines: [],
    loadError: null,
    sources,
    deferredRefnos: [],
  };
}

const rulesOf = (issues: readonly MbdV2Issue[]) => mbdEmptyReasonLines(issues).map(line => line.ruleId);
const shuffled = <T>(items: readonly T[]): T[] => [...items].reverse();

/**
 * 票 134：空包（被接受、一个图元都没有）时，尺寸面板在标题下直接写一两行中文的「为什么没有标注」。
 * 中文按诊断的规则号给——不解析求解器的英文正文（句式不固定：`civil.nothing_to_annotate` 有 6 种、`data.view_issue`
 * 有 16 种）；服务端的说明本来就是中文，原样用；没有中文说法的规则号退回原文。原文与 PML 行号照旧留在诊断区。
 */
describe('mbdEmptyReasonLines：一个空包的诊断里，标题下写哪一两句', () => {
  it.each(REAL.map(entry => [entry.ruleId, entry] as const))('says %s in Chinese', (_ruleId, entry) => {
    const lines = mbdEmptyReasonLines([issue(entry.ruleId)]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      issueId: `issue:${entry.ruleId}:`,
      ruleId: entry.ruleId,
      origin: entry.chinese === null ? 'server' : 'rule',
      text: entry.chinese ?? entry.message,
    });
    // 给了中文说法的那几条：一个英文字母的求解器原话都不带出来（PML 的方法名、行号留在诊断区）。
    if (entry.chinese !== null) {
      expect(lines[0]!.text).not.toMatch(/markCivil|pmlobj|L\d{3,}|nothing to|has no/);
    }
  });

  it('knows exactly the 13 rule ids seen in empty packages', () => {
    expect(MBD_EMPTY_REASON_WORDINGS.map(entry => entry.ruleId).sort()).toEqual(REAL.map(entry => entry.ruleId).sort());
    expect(new Set(MBD_EMPTY_REASON_WORDINGS.map(entry => entry.ruleId)).size).toBe(13);
  });

  it('writes the same sentence for every wording the solver uses under one rule id', () => {
    // `support.nothing_to_annotate` 在 EM4 支架上是另一种句式；`civil.geometry_missing` 按构件类型有三种。
    const em4 = issue('support.nothing_to_annotate', {
      message: 'nothing to annotate on this support: 0 usable member(s) (section members, plates, hangers, clamps, legs), 0 element(s) '
        + 'skipped for missing geometry, 0 point ATTA(s) on its pipes; they give 0 dimension line(s) and 0 label(s)',
    });
    const floor = issue('civil.geometry_missing', { message: 'FLOOR: FLOOR needs its top and bottom faces' });

    expect(mbdEmptyReasonLines([em4])[0]!.text).toBe(realOf('support.nothing_to_annotate').chinese);
    expect(mbdEmptyReasonLines([floor])[0]!.text).toBe(realOf('civil.geometry_missing').chinese);
  });

  /**
   * 一个空包里好几条诊断时的先后：先写「为什么空」的那一条，再至多补一条细节——「管道上没有点 ATTA」排在服务端的中文说明
   * 前面（P2 的决定：REST 空支架的服务端说明讲的是归属，不是「为什么空」），服务端的说明排在求解器其余的细节前面。
   * 下面是最终标注包里空包的全部 14 种规则号组合。
   */
  it.each([
    // 146 个 EM4 支架：服务端那句讲的是「几根型钢没有 SPRE」，这一挪它也让到了第三位，留在诊断区
    [['data.view_issue', 'support.em4_no_pipe_atta', 'support.part_geometry_missing', 'support.nothing_to_annotate'],
      ['support.nothing_to_annotate', 'support.em4_no_pipe_atta']],
    [['civil.nothing_to_annotate'], ['civil.nothing_to_annotate']],
    [['support.em4_no_pipe_atta', 'support.nothing_to_annotate'], ['support.nothing_to_annotate', 'support.em4_no_pipe_atta']],
    [['civil.arch_floor_only'], ['civil.arch_floor_only']],
    [['data.view_issue', 'civil.geometry_missing'], ['civil.geometry_missing', 'data.view_issue']],
    [['data.view_issue', 'support.nothing_to_annotate'], ['support.nothing_to_annotate', 'data.view_issue']],
    [['data.empty_branch'], ['data.empty_branch']],
    [['adapter.civil_wall_without_solid'], ['adapter.civil_wall_without_solid']],
    [['civil.member_off_face', 'civil.nothing_to_annotate'], ['civil.nothing_to_annotate', 'civil.member_off_face']],
    [['adapter.implied_tube_not_drawn', 'data.empty_branch'], ['data.empty_branch', 'adapter.implied_tube_not_drawn']],
    [['data.view_issue', 'support.no_parts'], ['support.no_parts', 'data.view_issue']],
    [['civil.arch_round_member', 'civil.member_off_face', 'civil.nothing_to_annotate'],
      ['civil.nothing_to_annotate', 'civil.member_off_face']],
    [['data.view_issue', 'civil.arch_floor_only'], ['civil.arch_floor_only', 'data.view_issue']],
    // EM4 的 REST 空支架（1 个）：服务端那句讲的是「配不到 STRU，以 REST 为归属对象」
    [['data.view_issue', 'support.em4_no_pipe_atta', 'support.nothing_to_annotate'],
      ['support.nothing_to_annotate', 'support.em4_no_pipe_atta']],
  ] as const)('orders %j as %j', (given, expected) => {
    const issues = given.map(ruleId => issue(ruleId));

    expect(rulesOf(issues)).toEqual(expected);
    // 先后只看规则号，不看诊断在包里的顺序。
    expect(rulesOf(shuffled(issues))).toEqual(expected);
  });

  it('orders the accompanying details among themselves: no point ATTA, the server note, then the solver\'s other details', () => {
    const details = [
      'support.em4_no_pipe_atta',
      'data.view_issue',
      'support.part_geometry_missing',
      'civil.member_off_face',
      'civil.arch_round_member',
      'adapter.implied_tube_not_drawn',
    ];

    // 相邻的两条两两比：表里前一条总排在后一条前面，不看它们在包里谁先谁后。
    for (let index = 0; index + 1 < details.length; index += 1) {
      const [earlier, later] = [details[index]!, details[index + 1]!];
      expect(rulesOf([issue(later), issue(earlier)])).toEqual([earlier, later]);
      expect(rulesOf([issue(earlier), issue(later)])).toEqual([earlier, later]);
    }
    // 「为什么空」的那七条都排在任何一条细节前面。
    const whyEmpty = [
      'data.empty_branch',
      'civil.geometry_missing',
      'adapter.civil_wall_without_solid',
      'support.no_parts',
      'support.nothing_to_annotate',
      'civil.nothing_to_annotate',
      'civil.arch_floor_only',
    ];
    for (const why of whyEmpty) {
      expect(rulesOf([issue(details[0]), issue(why)])).toEqual([why, details[0]]);
    }
  });

  it('never writes more than two lines, and one rule id only once', () => {
    const issues = [
      issue('support.part_geometry_missing', { id: 'a', message: 'SCTN 1 has no usable section data; skipped' }),
      issue('support.part_geometry_missing', { id: 'b', message: 'SCTN 2 has no usable section data; skipped' }),
      issue('support.part_geometry_missing', { id: 'c', message: 'SCTN 3 has no usable section data; skipped' }),
      issue('support.em4_no_pipe_atta', { id: 'd' }),
      issue('support.nothing_to_annotate', { id: 'e' }),
    ];

    expect(MBD_EMPTY_REASON_MAX_LINES).toBe(2);
    expect(mbdEmptyReasonLines(issues).map(line => line.issueId)).toEqual(['e', 'd']);
    // 同一个规则号有好几条时取包里的头一条（服务端的中文说明每条说的不一样，取头一条）。
    const views = [
      issue('data.view_issue', { id: 'v1', message: '头一句' }),
      issue('data.view_issue', { id: 'v2', message: '第二句' }),
    ];
    expect(mbdEmptyReasonLines(views)).toEqual([{ issueId: 'v1', ruleId: 'data.view_issue', origin: 'server', text: '头一句' }]);
  });

  it('falls back to the original text for a rule id it has no Chinese for', () => {
    const unknown = issue('support.some_future_rule', { id: 'x', message: 'a brand new reason the front end has never heard of' });

    expect(mbdEmptyReasonLines([unknown])).toEqual([{
      issueId: 'x',
      ruleId: 'support.some_future_rule',
      origin: 'original',
      text: 'a brand new reason the front end has never heard of',
    }]);
    // 没有规则号的老诊断同样退回原文、不报错。
    const bare = issue(undefined, { id: 'y', message: '老后端的一句话' });
    expect(mbdEmptyReasonLines([bare])).toEqual([{ issueId: 'y', ruleId: null, origin: 'original', text: '老后端的一句话' }]);
  });

  it('puts every rule it knows ahead of the ones it does not, and orders the unknown ones by severity', () => {
    const info = issue('zzz.unknown_info', { id: 'i', severity: 'info', message: 'unknown info' });
    const error = issue('zzz.unknown_error', { id: 'e', severity: 'error', message: 'unknown error' });
    const warning = issue(undefined, { id: 'w', severity: 'warning', message: 'unknown warning' });

    // 认识的细节（哪怕只是 info）排在不认识的 error 前面：认识的才说得出中文。
    expect(mbdEmptyReasonLines([error, issue('civil.arch_round_member', { id: 'known' })]).map(line => line.issueId))
      .toEqual(['known', 'e']);
    expect(mbdEmptyReasonLines([info, warning, error]).map(line => line.issueId)).toEqual(['e', 'w']);
    // 两条没有规则号的诊断是两件事，各占一行。
    const second = issue(undefined, { id: 'w2', severity: 'warning', message: 'another unknown warning' });
    expect(mbdEmptyReasonLines([warning, second]).map(line => line.issueId)).toEqual(['w', 'w2']);
  });

  it('skips an issue that has no text to show', () => {
    const blank = issue('zzz.blank', { id: 'blank', severity: 'error', message: '   ' });

    expect(mbdEmptyReasonLines([blank])).toEqual([]);
    expect(mbdEmptyReasonLines([blank, issue('data.empty_branch', { id: 'ok' })]).map(line => line.issueId)).toEqual(['ok']);
  });

  it('returns no line when the backend gave no reason at all', () => {
    expect(mbdEmptyReasonLines([])).toEqual([]);
  });
});

describe('summarizeMbdEmptyReasons：哪些包要在标题下写原因', () => {
  it('lists only accepted packages without a single primitive', () => {
    const summary = summarizeMbdEmptyReasons(snapshot([
      source('EMPTY', { empty: true, issues: [issue('data.empty_branch')] }),
      // 有图元的包：哪怕带着同样的诊断也不写（那不是「为什么没有标注」）。
      source('DRAWN', { empty: false, issues: [issue('support.part_geometry_missing')] }),
      // 没说是不是空包的老快照：不猜。
      source('OLD', { issues: [issue('data.empty_branch')] }),
      // 装载失败不是空包：它有自己的失败提示。
      source('FAILED', { empty: true, loadError: 'HTTP 422', issues: [issue('data.empty_branch')] }),
    ]));

    expect(summary).toEqual({
      multiSource: true,
      sources: [{
        refno: 'EMPTY',
        lines: [{
          issueId: 'issue:data.empty_branch:',
          ruleId: 'data.empty_branch',
          origin: 'rule',
          text: '这条支管下面没有任何管件，没有可标注的内容。',
        }],
      }],
    });
  });

  it('keeps a package the backend gave no reason for, with no lines', () => {
    expect(summarizeMbdEmptyReasons(snapshot([source('SILENT', { empty: true })]))).toEqual({
      multiSource: false,
      sources: [{ refno: 'SILENT', lines: [] }],
    });
  });

  it('keeps the packages in the order they were asked for', () => {
    const summary = summarizeMbdEmptyReasons(snapshot([
      source('B', { empty: true, issues: [issue('civil.arch_floor_only')] }),
      source('A', { empty: true }),
      source('C', { empty: true, issues: [issue('support.no_parts')] }),
    ]));

    expect(summary?.sources.map(entry => entry.refno)).toEqual(['B', 'A', 'C']);
    expect(summary?.multiSource).toBe(true);
  });

  it('says nothing when no package is empty, or there is no package at all', () => {
    expect(summarizeMbdEmptyReasons(snapshot([source('DRAWN', { empty: false })]))).toBeNull();
    expect(summarizeMbdEmptyReasons(snapshot([]))).toBeNull();
    // 只有顶层字段、没有逐包明细的旧调用方：不知道是不是空包，不写。
    expect(summarizeMbdEmptyReasons({ ...snapshot([]), sourceId: 'LEGACY', issues: [issue('data.empty_branch')] })).toBeNull();
  });
});

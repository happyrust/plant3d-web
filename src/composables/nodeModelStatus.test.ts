import { describe, expect, it, vi } from 'vitest';

import {
  describeNodeModelStatus,
  judgeNodeModelFacts,
  judgeNodeModelStatus,
  nodeModelFactsOf,
  nodeModelStatusAction,
  nodeModelStatusIconKind,
  nodeStatusQuerySince,
  reloadCheckSince,
  resolveNodeModelStatus,
  type NodeChangedSession,
  type NodeModelFacts,
} from './nodeModelStatus';

import type { DbnumRow, NodeModelStatusResponse } from '@/api/genModelV1Api';

/** 本机 1112：模型与数据都在 738，库文件已到 748 */
const ROW_1112: DbnumRow = {
  dbnum: 1112, db_type: 'DESI', initialized: true, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738,
  model_sesno_time: '2026-09-23T15:19:54', model_verdict: 'in_sync', model_source: 'database',
};
/** 本机 8000：三枚水位对齐 */
const ROW_8000: DbnumRow = {
  dbnum: 8000, db_type: 'DESI', initialized: true, file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143,
  model_verdict: 'in_sync', model_source: 'database',
};
/** 本机 7997：未初始化，模型按需生成 */
const ROW_7997: DbnumRow = {
  dbnum: 7997, db_type: 'DESI', initialized: false, file_latest_sesno: 447, applied_sesno: 0, model_sesno: 0,
  model_verdict: 'not_judged', model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
};

const session = (sesno: number, unitsChanged = 1, time: string | null = null): NodeChangedSession => ({ sesno, time, unitsChanged });

function judge(row: DbnumRow | null, loadedModelSesno: number | null, changedSessions: NodeChangedSession[] | null, error: string | null = null) {
  return judgeNodeModelStatus({ dbnum: row?.dbnum ?? 1, row, loadedModelSesno, changedSessions, error, now: 1000 });
}

describe('judgeNodeModelStatus（节点一级：只有模型生成之后真被改到才算落后）', () => {
  it('水位之后没有会话改到本节点：最新，哪怕库文件多了 10 个会话', () => {
    const status = judge(ROW_1112, 738, []);
    expect(status).toMatchObject({
      verdict: 'latest', modelSesno: 738, fileLatestSesno: 748, loadedModelSesno: 738, librarySessionsAhead: 10,
      laggingSessions: [], reloadableSessions: [],
    });
    expect(describeNodeModelStatus(status).headline).toBe('最新（库有 10 个新会话，未涉及本节点）');
    expect(describeNodeModelStatus(status).detail).toBe('模型按会话 738 生成（2026-09-23 15:19 保存）；库文件最新 748');
  });

  it('三枚水位对齐的库：最新，不提新会话', () => {
    const status = judge(ROW_8000, 1143, []);
    expect(status.verdict).toBe('latest');
    expect(describeNodeModelStatus(status).headline).toBe('最新');
  });

  it('水位之后有会话改到了本节点（网格 / 位置 / 增 / 删）：落后，点名是哪几个会话、动了几个单元', () => {
    const status = judge(ROW_1112, 738, [session(740, 2), session(745, 1)]);
    expect(status.verdict).toBe('lagging');
    expect(status.laggingSessions.map((item) => item.sesno)).toEqual([740, 745]);
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('落后：会话 740（2 个单元）、745（1 个单元）改到了本节点');
    expect(text.detail).toContain('模型按会话 738 生成');
    expect(text.detail).toContain('更新到最新');
    expect(nodeModelStatusAction(status)).toBe('update');
    expect(nodeModelStatusIconKind(status)).toBe('stale');
  });

  it('库里的模型已经比本页装的新、而且其间有会话改到了本节点：有更新可重载', () => {
    // 本页装的时候模型水位是 730；现在库到了 738，其间 735 改到了本节点
    const status = judge(ROW_1112, 730, [session(735, 3)]);
    expect(status.verdict).toBe('reloadable');
    expect(status.reloadableSessions.map((item) => item.sesno)).toEqual([735]);
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('有更新可重载：会话 735（3 个单元）改到了本节点');
    expect(text.detail).toContain('本页装的是会话 730 的模型，库里已到 738');
    expect(nodeModelStatusAction(status)).toBe('reload');
    expect(nodeModelStatusIconKind(status)).toBe('reloadable');
  });

  it('库的模型水位前进了，但其间没有会话改到本节点：仍是最新，不叫人重载', () => {
    expect(judge(ROW_1112, 730, []).verdict).toBe('latest');
  });

  it('既有能重载换上的、又有库还没追上的：按落后算，两件事都说', () => {
    const status = judge(ROW_1112, 730, [session(735), session(742)]);
    expect(status.verdict).toBe('lagging');
    expect(status.reloadableSessions.map((item) => item.sesno)).toEqual([735]);
    expect(status.laggingSessions.map((item) => item.sesno)).toEqual([742]);
    expect(describeNodeModelStatus(status).detail).toContain('重载');
  });

  it('会话多的时候只点前三个，其余说个数', () => {
    const status = judge(ROW_1112, 738, [session(739), session(740), session(741), session(742), session(743)]);
    expect(describeNodeModelStatus(status).headline).toBe('落后：会话 739（1 个单元）、740（1 个单元）、741（1 个单元）等 5 个会话改到了本节点');
  });

  it('未初始化的库：模型按需生成，没有水位可比，标「未跟踪」', () => {
    const status = judge(ROW_7997, 0, []);
    expect(status.verdict).toBe('untracked');
    expect(describeNodeModelStatus(status).headline).toBe('库未初始化：模型按需生成，暂不跟踪新旧');
    expect(nodeModelStatusAction(status)).toBeNull();
    expect(nodeModelStatusIconKind(status)).toBeNull();
  });

  it('接口失败：未知，带上原因；不下「最新 / 落后」的结论', () => {
    const status = judge(ROW_1112, 738, null, 'timeout: node/versions');
    expect(status.verdict).toBe('unknown');
    expect(describeNodeModelStatus(status).headline).toBe('新旧未知（timeout: node/versions）');
    expect(nodeModelStatusAction(status)).toBeNull();
  });

  it('库状态还没取到、库没有模型水位：未知', () => {
    expect(judge(null, null, []).verdict).toBe('unknown');
    expect(judge({ ...ROW_1112, model_sesno: 0, model_verdict: 'lagging' }, null, []).verdict).toBe('unknown');
  });

  it('库正在被写：更新中', () => {
    const status = judge({ ...ROW_1112, model_source: 'memory', model_source_reason: 'initialization_publishing' }, 738, []);
    expect(status.verdict).toBe('updating');
    expect(describeNodeModelStatus(status).headline).toBe('库正在更新，稍后再看');
  });

  it('装的时候没记下水位（库状态当时没取到）：按现在的模型水位算', () => {
    const status = judge(ROW_1112, null, [session(740)]);
    expect(status.verdict).toBe('lagging');
    expect(status.loadedModelSesno).toBeNull();
  });
});

describe('nodeStatusQuerySince（要不要问、从哪个会话之后问起）', () => {
  it('库文件没有比起点更新的会话：不用问', () => {
    expect(nodeStatusQuerySince(ROW_8000, 1143)).toBeNull();
  });
  it('库文件有新会话：从模型水位之后问', () => {
    expect(nodeStatusQuerySince(ROW_1112, 738)).toBe(738);
  });
  it('本页装的比库里的旧：从本页那一版之后问（一次问全）', () => {
    expect(nodeStatusQuerySince(ROW_1112, 730)).toBe(730);
    expect(nodeStatusQuerySince(ROW_8000, 1100)).toBe(1100);
  });
  it('未初始化 / 没有水位 / 正在被写 / 行没取到：不问', () => {
    expect(nodeStatusQuerySince(ROW_7997, 0)).toBeNull();
    expect(nodeStatusQuerySince(null, 5)).toBeNull();
    expect(nodeStatusQuerySince({ ...ROW_1112, model_source_reason: 'initialization_publishing' }, 738)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 后端的节点模型状态接口（gen-model 规范 §4.5.3）。下面三份回执是 2026-11-11 本机新后端的原样回执（只留用到的格）。
// ---------------------------------------------------------------------------

const LIBRARY_7999: NodeModelStatusResponse['library'] = {
  file_latest_sesno: 236, file_latest_time: '2026-11-10T11:59:15+08:00', applied_sesno: 213, model_sesno: 213,
  model_sesno_time: '2026-10-27T01:02:57+08:00', initialized: true, model_verdict: 'in_sync', model_verdict_reason: null,
  model_source: 'database', model_source_reason: null, data_batch_running: false, model_task_running: false, in_watch_scope: false,
};
const LIBRARY_7997: NodeModelStatusResponse['library'] = {
  file_latest_sesno: 447, file_latest_time: '2026-11-07T19:43:00+08:00', applied_sesno: 0, model_sesno: 0, model_sesno_time: null,
  initialized: true, model_verdict: 'not_judged', model_verdict_reason: 'data_watermark_unestablished',
  model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
  data_batch_running: false, model_task_running: false, in_watch_scope: true,
};
const LIBRARY_8000: NodeModelStatusResponse['library'] = {
  ...LIBRARY_7999, file_latest_sesno: 1146, applied_sesno: 1143, model_sesno: 1143, model_sesno_time: '2026-11-07T19:45:43+08:00',
  in_watch_scope: true,
};

/** 7999 的整个 SITE：3362 个单元都靠库的模型水位担保；库文件多了 23 个会话，净差分里没有改到它 */
const SITE_LATEST: NodeModelStatusResponse = {
  refno: '24383/80211', noun: 'SITE', dbnum: 7999, unit_root: null, verdict: 'latest', verdict_reason: null,
  library: LIBRARY_7999,
  units: { total: 3362, generated: 3362, missing: 0, failed: 0, lagging: 0, exact: true },
  generated_at: { sesno_min: 213, sesno_max: 213, time_min: '2026-10-27T01:02:57+08:00', time_max: '2026-10-27T01:02:57+08:00', basis: 'library_watermark' },
  changes: { from_sesno: 213, to_sesno: 236, units_changed: 0, units_added: 0, units_removed: 0, elements: { added: 0, deleted: 0, modified: 0, noop: 0 }, unattributed: false },
  precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 },
  cached: true, elapsed_ms: 8,
};
/** 7997 的测试 SITE：后端重启之后一个单元都没生成过，21 个，超过阈值 */
const SITE_NOT_GENERATED: NodeModelStatusResponse = {
  refno: '24381/535', noun: 'SITE', dbnum: 7997, unit_root: null, verdict: 'not_generated', verdict_reason: null,
  library: LIBRARY_7997,
  units: { total: 21, generated: 0, missing: 21, failed: 0, lagging: 0, exact: true },
  generated_at: null, changes: null,
  precheck: { units_to_generate: 21, needs_confirm: true, confirm_threshold_units: 20 },
};
/** 它下面那个没有子节点的 ZONE：没有生成单元 */
const ZONE_EMPTY: NodeModelStatusResponse = {
  refno: '24381/179753', noun: 'ZONE', dbnum: 7997, unit_root: null, verdict: 'empty', verdict_reason: null,
  library: LIBRARY_7997,
  units: { total: 0, generated: 0, missing: 0, failed: 0, lagging: 0, exact: true },
  generated_at: null, changes: null,
  precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 },
};

function facts(response: NodeModelStatusResponse, patch: Partial<NodeModelStatusResponse> = {}): NodeModelFacts {
  return nodeModelFactsOf({ ...response, ...patch });
}

function judgeFacts(
  response: NodeModelStatusResponse,
  patch: Partial<NodeModelStatusResponse> = {},
  loadedModelSesno: number | null = null,
  changedSinceLoaded?: NodeChangedSession[] | null,
) {
  return judgeNodeModelFacts({ facts: facts(response, patch), loadedModelSesno, changedSinceLoaded, now: 1000 });
}

describe('nodeModelFactsOf（接口回执 → 事实）', () => {
  it('字段改成驼峰，单元根改成 a_b；数字缺了按 0、布尔缺了按保守的一边算', () => {
    expect(facts(SITE_LATEST)).toMatchObject({
      verdict: 'latest', dbnum: 7999, noun: 'SITE', unitRoot: null,
      units: { total: 3362, generated: 3362, missing: 0, failed: 0, lagging: 0, exact: true },
      generatedAt: { sesnoMin: 213, sesnoMax: 213, basis: 'library_watermark' },
      changes: { fromSesno: 213, toSesno: 236, unitsChanged: 0, unattributed: false },
      precheck: { unitsToGenerate: 0, needsConfirm: false, thresholdUnits: 20 },
      library: { fileLatestSesno: 236, modelSesno: 213, inWatchScope: false },
    });
    expect(facts(SITE_LATEST, { unit_root: '24383/80300' }).unitRoot).toBe('24383_80300');
    const sparse = nodeModelFactsOf({
      refno: '1/2', noun: 'zone', dbnum: 1, unit_root: null, verdict: 'partial', verdict_reason: null,
      library: {} as NodeModelStatusResponse['library'],
      units: { total: 4 } as NodeModelStatusResponse['units'],
      generated_at: null, changes: null,
      precheck: { units_to_generate: 30, confirm_threshold_units: 20 } as NodeModelStatusResponse['precheck'],
    });
    expect(sparse.noun).toBe('ZONE');
    expect(sparse.units).toEqual({ total: 4, generated: 0, missing: 0, failed: 0, lagging: 0, exact: false });
    expect(sparse.library.inWatchScope).toBe(false);
    // 后端没给「要不要确认」时按它给的阈值自己算；阈值 0 = 从不要求确认
    expect(sparse.precheck.needsConfirm).toBe(true);
    expect(facts(SITE_NOT_GENERATED, { precheck: { units_to_generate: 500, confirm_threshold_units: 0 } as NodeModelStatusResponse['precheck'] }).precheck.needsConfirm).toBe(false);
  });
});

describe('judgeNodeModelFacts（接口给的事实 → 行上的状态）', () => {
  it('最新：库文件多出来的会话没有改到它；说出有多少个单元', () => {
    const status = judgeFacts(SITE_LATEST, {}, 213);
    expect(status).toMatchObject({ verdict: 'latest', source: 'model-status', modelSesno: 213, fileLatestSesno: 236, librarySessionsAhead: 23, inWatchScope: false });
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('最新（库有 23 个新会话，未涉及本节点）');
    expect(text.detail).toBe('模型按会话 213 生成（2026-10-27 01:02 保存）；库文件最新 236；3362 个单元都已生成');
    expect(nodeModelStatusAction(status)).toBeNull();
    expect(nodeModelStatusIconKind(status)).toBe('current');
  });

  it('未生成（未初始化的库也答得出）：说出有几个单元，给「生成」', () => {
    const status = judgeFacts(SITE_NOT_GENERATED);
    expect(status).toMatchObject({ verdict: 'not_generated', unitsToGenerate: 21, modelSesno: null, generated: null });
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('未生成：21 个单元都没有模型');
    expect(text.detail).toContain('生成并显示');
    expect(nodeModelStatusAction(status)).toBe('generate');
    expect(nodeModelStatusIconKind(status)).toBe('empty');
  });

  it('部分生成：说出缺几个、其中几个是上次失败的，给「生成」；已生成的那部分是按需生成的', () => {
    const status = judgeFacts(SITE_NOT_GENERATED, {
      verdict: 'partial',
      units: { total: 21, generated: 10, missing: 9, failed: 2, lagging: 0, exact: true },
      generated_at: { sesno_min: 447, sesno_max: 447, time_min: null, time_max: null, basis: 'own_generation' },
      precheck: { units_to_generate: 11, needs_confirm: false, confirm_threshold_units: 20 },
    });
    expect(status.verdict).toBe('partial');
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('部分生成：21 个单元里有 11 个没有模型（其中 2 个上次生成失败）');
    expect(text.detail).toBe('模型是后端这次运行期间按需生成的，对应会话 447；库文件最新 447。点「生成」补齐（不重算已有的）');
    expect(nodeModelStatusAction(status)).toBe('generate');
    expect(nodeModelStatusIconKind(status)).toBe('partial');
  });

  it('部分生成 / 未生成、库有模型水位又在更新范围里、库文件比水位新：缺的多半是水位之后才建的——给「更新」，不给「生成」', () => {
    // 8000：模型水位 1143，有人保存到了 1146，测试 SITE 下多了一个新设备
    const partial = judgeFacts(SITE_LATEST, {
      verdict: 'partial', dbnum: 8000, library: LIBRARY_8000,
      units: { total: 2, generated: 1, missing: 1, failed: 0, lagging: 0, exact: true },
      generated_at: { sesno_min: 1143, sesno_max: 1143, time_min: '2026-11-07T19:45:43+08:00', time_max: null, basis: 'library_watermark' },
      precheck: { units_to_generate: 1, needs_confirm: false, confirm_threshold_units: 20 },
    }, 1143);
    expect(nodeModelStatusAction(partial)).toBe('update');
    const text = describeNodeModelStatus(partial);
    expect(text.headline).toBe('部分生成：2 个单元里有 1 个没有模型');
    expect(text.detail).toBe(
      '模型按会话 1143 生成（2026-11-07 19:45 保存）；库文件最新 1146。库文件比模型水位新 3 个会话，没有模型的单元多半是之后才有的：点「更新」让后端把这个库更新到最新',
    );
    const none = judgeFacts(SITE_NOT_GENERATED, { dbnum: 8000, library: LIBRARY_8000 });
    expect(nodeModelStatusAction(none)).toBe('update');
    expect(describeNodeModelStatus(none).detail).toContain('点「更新」让后端把这个库更新到最新');

    // 库文件没有比水位新的会话（缺的是上次失败的）、库不在更新范围里、库没有模型水位：照旧是「生成」
    const caughtUp = { ...LIBRARY_8000, file_latest_sesno: 1143 };
    expect(nodeModelStatusAction(judgeFacts(SITE_NOT_GENERATED, { library: caughtUp }))).toBe('generate');
    expect(nodeModelStatusAction(judgeFacts(SITE_NOT_GENERATED, { library: { ...LIBRARY_8000, in_watch_scope: false } }))).toBe('generate');
    expect(nodeModelStatusAction(judgeFacts(SITE_NOT_GENERATED))).toBe('generate');
  });

  it('没有生成单元：不需要生成，没有动作，图标是一道短横', () => {
    const status = judgeFacts(ZONE_EMPTY);
    expect(status.verdict).toBe('empty');
    expect(describeNodeModelStatus(status).headline).toBe('没有要生成的模型（这个节点下没有生成单元）');
    expect(nodeModelStatusAction(status)).toBeNull();
    expect(nodeModelStatusIconKind(status)).toBe('nothing');
  });

  it('落后（在更新范围里的库）：说出改到几个单元、从哪个会话到哪个会话，给「更新」', () => {
    const status = judgeFacts(SITE_LATEST, {
      verdict: 'lagging', verdict_reason: 'units_changed', dbnum: 8000, library: LIBRARY_8000,
      units: { total: 40, generated: 40, missing: 0, failed: 0, lagging: 2, exact: true },
      generated_at: { sesno_min: 1143, sesno_max: 1143, time_min: '2026-11-07T19:45:43+08:00', time_max: null, basis: 'library_watermark' },
      changes: { from_sesno: 1143, to_sesno: 1146, units_changed: 3, units_added: 1, units_removed: 0, elements: { added: 4, deleted: 0, modified: 2, noop: 1 }, unattributed: false },
    }, 1143);
    expect(status).toMatchObject({ verdict: 'lagging', librarySessionsAhead: 3, inWatchScope: true });
    const text = describeNodeModelStatus(status);
    expect(text.headline).toBe('落后：生成之后有 2 个单元被改到');
    expect(text.detail).toBe(
      '模型按会话 1143 生成（2026-11-07 19:45 保存）；库文件最新 1146。会话 1143 之后到 1146，改到 3 个交付单元（新增 1）。点「更新」让后端把这个库更新到最新',
    );
    expect(nodeModelStatusAction(status)).toBe('update');
    expect(nodeModelStatusIconKind(status)).toBe('stale');
  });

  it('落后，但只有归不到单元上的变化：照样算落后，话换一种说法', () => {
    const status = judgeFacts(SITE_LATEST, {
      verdict: 'lagging', verdict_reason: 'other_changes', library: LIBRARY_8000,
      changes: { from_sesno: 1143, to_sesno: 1146, units_changed: 0, units_added: 0, units_removed: 0, elements: { added: 0, deleted: 0, modified: 1, noop: 0 }, unattributed: true },
    });
    expect(describeNodeModelStatus(status).headline).toBe('落后：生成之后这个节点下有改动（不在某个生成单元名下，或有单元被删）');
  });

  it('落后、但库不在后端的更新范围里：库一级的更新会被拒绝，给节点一级的更新，写明只动这个节点', () => {
    const status = judgeFacts(SITE_LATEST, {
      verdict: 'lagging', verdict_reason: 'units_changed',
      units: { total: 3362, generated: 3362, missing: 0, failed: 0, lagging: 5, exact: true },
    });
    expect(nodeModelStatusAction(status)).toBe('update-node');
    const detail = describeNodeModelStatus(status).detail;
    expect(detail).toContain('这个库不在后端的更新范围里（不参与）：点「更新」让后端把这个节点下的单元按库文件最新会话重新生成，做完自动换到屏幕上');
    // 不再把人指到右键「重新生成模型」上去
    expect(detail).not.toContain('重新生成模型');
  });

  it('落后、模型是按需生成的（未初始化的库）：没有库水位可推进，给节点一级的更新', () => {
    const status = judgeFacts(SITE_NOT_GENERATED, {
      verdict: 'lagging', verdict_reason: 'units_changed',
      units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 1, exact: true },
      generated_at: { sesno_min: 445, sesno_max: 447, time_min: null, time_max: null, basis: 'own_generation' },
      changes: { from_sesno: 445, to_sesno: 447, units_changed: 1, units_added: 0, units_removed: 0, elements: { added: 0, deleted: 0, modified: 1, noop: 0 }, unattributed: false },
      precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 },
    });
    expect(nodeModelStatusAction(status)).toBe('update-node');
    const text = describeNodeModelStatus(status);
    expect(text.detail).toContain('对应会话 445–447');
    expect(text.detail).toContain('这个库的模型按需生成：点「更新」让后端把这个节点下的单元按库文件最新会话重新生成，做完自动换到屏幕上');
    expect(text.detail).not.toContain('先清后生成');
  });

  it('落后、按需生成、而且有单元被删：提示里先说要先清后生成、点了会先问', () => {
    const status = judgeFacts(SITE_NOT_GENERATED, {
      verdict: 'lagging', verdict_reason: 'other_changes',
      units: { total: 20, generated: 20, missing: 0, failed: 0, lagging: 0, exact: true },
      generated_at: { sesno_min: 445, sesno_max: 445, time_min: null, time_max: null, basis: 'own_generation' },
      changes: { from_sesno: 445, to_sesno: 447, units_changed: 2, units_added: 0, units_removed: 2, elements: { added: 0, deleted: 9, modified: 0, noop: 0 }, unattributed: false },
      precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 },
    });
    expect(nodeModelStatusAction(status)).toBe('update-node');
    expect(describeNodeModelStatus(status).detail).toContain('有 2 个单元已被删，要先清后生成，点了会先说明再问');
  });

  it('两种「更新」怎么分：库有模型水位、在更新范围里才是库一级的；按需生成的（不管在不在范围里）和不在范围里的都是节点一级的', () => {
    const lagging = (library: NodeModelStatusResponse['library'], basis: 'library_watermark' | 'own_generation' | 'mixed') => judgeFacts(SITE_LATEST, {
      verdict: 'lagging', verdict_reason: 'units_changed', library,
      units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 1, exact: true },
      generated_at: { sesno_min: 445, sesno_max: 445, time_min: null, time_max: null, basis },
    });
    // 7997：在后端的监听范围里，但没初始化、模型全是按需生成的——库一级的更新没有水位可推进
    expect(nodeModelStatusAction(lagging(LIBRARY_7997, 'own_generation'))).toBe('update-node');
    expect(nodeModelStatusAction(lagging({ ...LIBRARY_7997, in_watch_scope: false }, 'own_generation'))).toBe('update-node');
    expect(nodeModelStatusAction(lagging(LIBRARY_7999, 'library_watermark'))).toBe('update-node');
    expect(nodeModelStatusAction(lagging(LIBRARY_7999, 'mixed'))).toBe('update-node');
    expect(nodeModelStatusAction(lagging(LIBRARY_8000, 'library_watermark'))).toBe('update');
    // 一部分靠库水位、一部分按需生成：库在范围里就让库一级的更新去追（它会推进水位）
    expect(nodeModelStatusAction(lagging(LIBRARY_8000, 'mixed'))).toBe('update');
  });

  it('库正在被写：更新中；后端判不了：未知，原因码翻成话', () => {
    expect(judgeFacts(SITE_LATEST, { verdict: 'updating', verdict_reason: 'data_batch_running' }).verdict).toBe('updating');
    const unknown = judgeFacts(SITE_LATEST, { verdict: 'unknown', verdict_reason: 'watermarks_inconsistent' });
    expect(unknown.verdict).toBe('unknown');
    expect(describeNodeModelStatus(unknown).headline).toBe('新旧未知（这个库的数据水位和模型水位对不上）');
    expect(describeNodeModelStatus(judgeFacts(SITE_LATEST, { verdict: 'unknown', verdict_reason: 'something_new' })).headline)
      .toBe('新旧未知（后端判不了（something_new））');
  });

  it('有更新可重载：库里的模型比本页装的新，其间有会话改到了本节点', () => {
    // 本页装的时候库的模型水位是 205；现在是 213，其间 210 改到了它
    const status = judgeFacts(SITE_LATEST, {}, 205, [session(210, 3), session(230, 1)]);
    expect(status.verdict).toBe('reloadable');
    expect(status.reloadableSessions.map((item) => item.sesno)).toEqual([210]);
    expect(nodeModelStatusAction(status)).toBe('reload');
    expect(describeNodeModelStatus(status).detail).toContain('本页装的是会话 205 的模型，库里已到 213');
    // 其间没有改到它：仍是最新
    expect(judgeFacts(SITE_LATEST, {}, 205, []).verdict).toBe('latest');
    // 该问而没问到：不下「最新」的结论
    expect(judgeFacts(SITE_LATEST, {}, 205, null).verdict).toBe('unknown');
  });

  it('既落后、库里又有能重载换上的：按落后算，两件事都说', () => {
    const status = judgeFacts(SITE_LATEST, {
      verdict: 'lagging', verdict_reason: 'units_changed', library: LIBRARY_8000,
      units: { total: 40, generated: 40, missing: 0, failed: 0, lagging: 1, exact: true },
    }, 1100, [session(1120, 2)]);
    expect(status.verdict).toBe('lagging');
    expect(describeNodeModelStatus(status).detail).toContain('点「重载」可先换上');
  });
});

describe('reloadCheckSince（要不要再问一次「本页那一版之后改没改到本节点」）', () => {
  it('本页装的比库现在的模型水位旧、节点靠库水位担保：从本页那一版之后问', () => {
    expect(reloadCheckSince(facts(SITE_LATEST), 205)).toBe(205);
  });
  it('本页装的就是库现在这一版、没记下本页那一版、节点没装进场景：不问', () => {
    expect(reloadCheckSince(facts(SITE_LATEST), 213)).toBeNull();
    expect(reloadCheckSince(facts(SITE_LATEST), null)).toBeNull();
    expect(reloadCheckSince(facts(SITE_LATEST), 0)).toBeNull();
  });
  it('未生成 / 部分生成 / 没有生成单元 / 更新中 / 按需生成的库：不问', () => {
    expect(reloadCheckSince(facts(SITE_NOT_GENERATED), 5)).toBeNull();
    expect(reloadCheckSince(facts(ZONE_EMPTY), 5)).toBeNull();
    expect(reloadCheckSince(facts(SITE_LATEST, { verdict: 'updating' }), 205)).toBeNull();
    expect(reloadCheckSince(facts(SITE_LATEST, {
      generated_at: { sesno_min: 213, sesno_max: 213, time_min: null, time_max: null, basis: 'own_generation' },
    }), 205)).toBeNull();
  });
});

describe('resolveNodeModelStatus（事实来源的唯一入口）', () => {
  it('先问节点模型状态接口：一次就有结论，节点版本表不用问', async () => {
    const fetchFacts = vi.fn(async () => facts(SITE_NOT_GENERATED));
    const listChangedSessions = vi.fn(async () => []);
    const status = await resolveNodeModelStatus({
      dbnum: 7997, refno: '24381_535', row: ROW_7997, loadedModelSesno: null, fetchFacts, listChangedSessions, now: 7,
    });
    expect(fetchFacts).toHaveBeenCalledWith({ refno: '24381_535', signal: undefined });
    expect(listChangedSessions).not.toHaveBeenCalled();
    expect(status).toMatchObject({ verdict: 'not_generated', source: 'model-status', unitsToGenerate: 21, checkedAt: 7 });
  });

  it('库里的模型比本页装的新：再用节点版本表问一次其间改没改到本节点', async () => {
    const listChangedSessions = vi.fn(async () => [session(210, 3)]);
    const status = await resolveNodeModelStatus({
      dbnum: 7999, refno: '24383_80211', row: null, loadedModelSesno: 205,
      fetchFacts: async () => facts(SITE_LATEST), listChangedSessions,
    });
    expect(listChangedSessions).toHaveBeenCalledWith({ dbnum: 7999, refno: '24383_80211', sinceSesno: 205, signal: undefined });
    expect(status.verdict).toBe('reloadable');
  });

  it('那一次补问失败：不下「最新」的结论；本来就落后的照样说落后', async () => {
    const failing = async () => { throw new Error('timeout: node/versions'); };
    const latest = await resolveNodeModelStatus({
      dbnum: 7999, refno: '24383_80211', row: null, loadedModelSesno: 205, fetchFacts: async () => facts(SITE_LATEST), listChangedSessions: failing,
    });
    expect(latest).toMatchObject({ verdict: 'unknown', reason: 'timeout: node/versions' });
    const lagging = await resolveNodeModelStatus({
      dbnum: 7999, refno: '24383_80211', row: null, loadedModelSesno: 205,
      fetchFacts: async () => facts(SITE_LATEST, { verdict: 'lagging', verdict_reason: 'units_changed' }), listChangedSessions: failing,
    });
    expect(lagging.verdict).toBe('lagging');
  });

  it('服务端没有那条路由（回 null）：退回过渡办法——水位看库状态那一行，需要时问节点版本表', async () => {
    const listChangedSessions = vi.fn(async () => [session(740, 2)]);
    const status = await resolveNodeModelStatus({
      dbnum: 1112, refno: '9304_2', row: ROW_1112, loadedModelSesno: 738, fetchFacts: async () => null, listChangedSessions,
    });
    expect(listChangedSessions).toHaveBeenCalledWith({ dbnum: 1112, refno: '9304_2', sinceSesno: 738, signal: undefined });
    expect(status).toMatchObject({ verdict: 'lagging', source: 'versions', units: null, unitsToGenerate: null });
    expect((await resolveNodeModelStatus({
      dbnum: 7997, refno: '1_1', row: ROW_7997, loadedModelSesno: 0, fetchFacts: async () => null, listChangedSessions,
    })).verdict).toBe('untracked');
  });

  it('接口在、这一次没答上来：未知，带上原因（业务错误码翻成话），不退回过渡办法、不往外抛', async () => {
    const listChangedSessions = vi.fn(async () => []);
    const notFound = await resolveNodeModelStatus({
      dbnum: 7997, refno: '24381_999', row: ROW_7997, loadedModelSesno: null, listChangedSessions,
      fetchFacts: async () => { throw Object.assign(new Error('生成根 24381/999 解出 dbnum 7997，但 D:\\x\\ams7997_0001 最新会话上没有它'), { code: 'REFNO_NOT_FOUND' }); },
    });
    expect(notFound).toMatchObject({ verdict: 'unknown', source: 'model-status', reason: '库文件最新会话上没有这个节点（可能已被删除）' });
    const network = await resolveNodeModelStatus({
      dbnum: 1112, refno: '9304_2', row: ROW_1112, loadedModelSesno: 738, listChangedSessions,
      fetchFacts: async () => { throw new Error('gen-model 请求失败 GET …: Failed to fetch'); },
    });
    expect(network).toMatchObject({ verdict: 'unknown', reason: 'gen-model 请求失败 GET …: Failed to fetch' });
    expect(listChangedSessions).not.toHaveBeenCalled();
    // 库状态那一行说库正在被写：照实说更新中
    const updating = await resolveNodeModelStatus({
      dbnum: 1112, refno: '9304_2', row: { ...ROW_1112, model_source: 'memory', model_source_reason: 'initialization_publishing' },
      loadedModelSesno: 738, listChangedSessions, fetchFacts: async () => { throw new Error('503'); },
    });
    expect(updating.verdict).toBe('updating');
  });
});

describe('resolveNodeModelStatus（过渡办法：没有接上节点模型状态接口）', () => {
  it('需要问的时候按起点问一次，只算影响模型的会话', async () => {
    const listChangedSessions = vi.fn(async () => [session(740, 2)]);
    const status = await resolveNodeModelStatus({
      dbnum: 1112, refno: '9304_2', row: ROW_1112, loadedModelSesno: 738, listChangedSessions, now: 5,
    });
    expect(listChangedSessions).toHaveBeenCalledWith({ dbnum: 1112, refno: '9304_2', sinceSesno: 738, signal: undefined });
    expect(status.verdict).toBe('lagging');
    expect(status.checkedAt).toBe(5);
  });

  it('不需要问（水位对齐 / 未初始化）时一个请求都不发', async () => {
    const listChangedSessions = vi.fn(async () => []);
    expect((await resolveNodeModelStatus({ dbnum: 8000, refno: '1_1', row: ROW_8000, loadedModelSesno: 1143, listChangedSessions })).verdict).toBe('latest');
    expect((await resolveNodeModelStatus({ dbnum: 7997, refno: '1_1', row: ROW_7997, loadedModelSesno: 0, listChangedSessions })).verdict).toBe('untracked');
    expect(listChangedSessions).not.toHaveBeenCalled();
  });

  it('接口抛错：回未知，不往外抛（不挡显示）', async () => {
    const status = await resolveNodeModelStatus({
      dbnum: 1112, refno: '9304_2', row: ROW_1112, loadedModelSesno: 738,
      listChangedSessions: async () => { throw new Error('SESSION_NOT_FOUND: since_sesno 738 不在会话链上'); },
    });
    expect(status.verdict).toBe('unknown');
    expect(status.reason).toContain('SESSION_NOT_FOUND');
  });
});

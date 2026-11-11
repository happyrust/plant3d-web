import { describe, expect, it, vi } from 'vitest';

import {
  describeNodeModelStatus,
  judgeNodeModelStatus,
  nodeModelStatusAction,
  nodeModelStatusIconKind,
  nodeStatusQuerySince,
  resolveNodeModelStatus,
  type NodeChangedSession,
} from './nodeModelStatus';

import type { DbnumRow } from '@/api/genModelV1Api';

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

describe('resolveNodeModelStatus（事实来源的唯一入口）', () => {
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

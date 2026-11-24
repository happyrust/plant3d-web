import { describe, expect, it } from 'vitest';

import {
  batchCheckSummary,
  incrementalRoundsOf,
  isBaselineTask,
  isOutdated,
  isPendingFor,
  passingAncestorChecks,
  pendingRoots,
  pendingRoundFor,
  roundAfterCheck,
  roundLabel,
  rootsOfTask,
  rvmBadgeTitle,
  taskPendingRoots,
} from './incrementalRvmTargets';

import type { RvmNodeStatus } from './rvmCheckFormat';
import type { TaskListEntryDto } from '@/api/genModelV1Api';

function batch(id: string, finishedAt: string, units: Record<string, unknown>[], extra: Partial<TaskListEntryDto> = {}): TaskListEntryDto {
  return {
    task_id: id,
    kind: 'data_batch',
    state: 'succeeded',
    finished_at: finishedAt,
    dbnum: 7999,
    start_sesno: 1416,
    end_sesno: 1416,
    detail: { intent: 'apply_window', model_start_sesno: null },
    result: { units },
    ...extra,
  } as TaskListEntryDto;
}

/** 后端重启后的初始化：模型从会话 0 起整库重算 */
function baseline(id: string, finishedAt: string, units: Record<string, unknown>[], endSesno = 1416): TaskListEntryDto {
  return batch(id, finishedAt, units, { start_sesno: 1, end_sesno: endSesno, detail: { intent: 'model_only', model_start_sesno: 0 } });
}

function status(refno: string, verdict: RvmNodeStatus['verdict'], at: string | null, sesno: number | null = 1415, dbnum: number | null = 7999): RvmNodeStatus {
  return { refno, verdict, taskId: 't', at, sesno, dbnum, message: '', name: null, stage: null, reasons: '' };
}

const BRAN = { root_refno: '24381/145018', noun: 'BRAN', status: 'generated', kind: 'regen' };
const EQUI = { root_refno: '24381/150101', noun: 'EQUI', status: 'generated', kind: 'transform' };
const STRU = { root_refno: '24381/160001', noun: 'STRU', status: 'generated', kind: 'unit' };
const FAILED = { root_refno: '24381/145099', noun: 'BRAN', status: 'failed' };

describe('rootsOfTask', () => {
  it('只取落地的 data_batch / model_rebuild 里生成成功的单元，refno 转成 a_b', () => {
    const roots = rootsOfTask(batch('b1', '2026-11-05T06:32:00Z', [BRAN, EQUI, FAILED, BRAN]));
    expect(roots.map((root) => root.refno)).toEqual(['24381_145018', '24381_150101']);
    expect(roots[1]!.unitKind).toBe('transform');
    expect(roots[0]).toMatchObject({ sesno: 1416, startSesno: 1416, dbnum: 7999, baseline: false });
  });

  it('运行中、失败、其它种类、缺 finished_at 都不出根', () => {
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { state: 'running' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { state: 'failed' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { kind: 'room_rebuild' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '', [BRAN]))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { kind: 'model_rebuild', state: 'partial' }))).toHaveLength(1);
  });
});

describe('isBaselineTask', () => {
  it('整库从头生成的几种：模型从会话 0 起、重新初始化、人工全量重建、库第一次摄入', () => {
    expect(isBaselineTask(baseline('b', '2026-11-07T06:27:00Z', [BRAN]))).toBe(true);
    expect(isBaselineTask(batch('b', '2026-11-07T06:27:00Z', [BRAN], { start_sesno: 1, detail: { intent: 'reinitialize', model_start_sesno: 0 } }))).toBe(true);
    expect(isBaselineTask(batch('b', '2026-11-07T06:27:00Z', [BRAN], { kind: 'model_rebuild', start_sesno: null, end_sesno: null, detail: null }))).toBe(true);
    expect(isBaselineTask(batch('b', '2026-11-07T06:27:00Z', [BRAN], { start_sesno: 1, detail: null }))).toBe(true);
  });

  it('真正的增量：数据窗口、目录级联点名的 model_only、从中途水位补的 model_only', () => {
    expect(isBaselineTask(batch('b', '2026-11-05T06:32:00Z', [BRAN]))).toBe(false);
    expect(isBaselineTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { detail: { intent: 'model_only', model_start_sesno: 1416 } }))).toBe(false);
    expect(isBaselineTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { start_sesno: 1400, detail: { intent: 'model_only', model_start_sesno: 1399 } }))).toBe(false);
    expect(isBaselineTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { detail: null }))).toBe(false);
  });
});

describe('incrementalRoundsOf', () => {
  it('同一根出现在多轮时取会话号最新的一轮；会话号相同取后落地的', () => {
    const rounds = incrementalRoundsOf([
      batch('later-but-older-session', '2026-11-05T07:00:00Z', [BRAN], { start_sesno: 1414, end_sesno: 1414 }),
      batch('new', '2026-11-05T06:32:00Z', [BRAN, EQUI]),
      batch('same-session-relanded', '2026-11-05T06:50:00Z', [EQUI]),
    ]);
    expect(rounds.get('24381_145018')?.latest.taskId).toBe('new');
    expect(rounds.get('24381_150101')?.latest.taskId).toBe('same-session-relanded');
  });

  it('基线轮记进 latest，但不顶掉最新的增量轮；只在基线轮里出现的根没有增量轮', () => {
    const rounds = incrementalRoundsOf([
      batch('incr', '2026-11-05T06:32:00Z', [BRAN]),
      baseline('base', '2026-11-07T06:27:00Z', [BRAN, EQUI], 1416),
    ]);
    const bran = rounds.get('24381_145018')!;
    expect(bran.latest.taskId).toBe('base');
    expect(bran.latestIncremental?.taskId).toBe('incr');
    expect(rounds.get('24381_150101')?.latestIncremental).toBeNull();
  });
});

describe('isOutdated / isPendingFor', () => {
  const round = { finishedAt: '2026-11-05T06:32:00Z', sesno: 1416, dbnum: 7999, baseline: false };

  it('同库按会话号比：结论的会话早于这一轮是过期，同一会话或更晚不是，不看时刻', () => {
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:20:00Z', 1415), round)).toBe(true);
    // 核对开工后才落地的新会话：结论时刻晚于落地也照样过期
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:40:00Z', 1415), round)).toBe(true);
    // 同一会话的批次后来又落地一次（后端重启重跑）：不过期
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:20:00Z', 1416), round)).toBe(false);
    expect(isOutdated(status('x', 'fail', '2026-11-05T06:20:00Z', 1417), round)).toBe(false);
  });

  it('任一边缺会话号或库号对不上时退回比时刻', () => {
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:20:00Z', null), round)).toBe(true);
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:40:00Z', null), round)).toBe(false);
    expect(isOutdated(status('x', 'fail', null, null), round)).toBe(true);
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:40:00Z', 1, 8000), round)).toBe(false);
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:40:00Z', 1416), { ...round, sesno: null })).toBe(false);
  });

  it('没有结论：增量轮算待校验，基线轮不算；排队 / 运行中都不算', () => {
    expect(isPendingFor(null, round)).toBe(true);
    expect(isPendingFor(null, { ...round, baseline: true })).toBe(false);
    expect(isOutdated(null, round)).toBe(false);
    expect(isPendingFor(status('x', 'queued', '2026-11-05T06:00:00Z', 1400), round)).toBe(false);
    expect(isPendingFor(status('x', 'running', '2026-11-05T06:00:00Z', 1400), round)).toBe(false);
  });
});

describe('pendingRoundFor / roundAfterCheck / pendingRoots', () => {
  const rounds = incrementalRoundsOf([
    batch('incr', '2026-11-05T06:32:00Z', [BRAN]),
    baseline('base', '2026-11-07T06:27:00Z', [BRAN, EQUI], 1420),
  ]);
  const bran = rounds.get('24381_145018')!;
  const equi = rounds.get('24381_150101')!;

  it('没核对过：有增量轮就因增量轮待校验，只在基线轮里的不待校验', () => {
    expect(pendingRoundFor(null, bran)?.taskId).toBe('incr');
    expect(pendingRoundFor(null, equi)).toBeNull();
  });

  it('核对过：先看增量轮，再看基线轮；都覆盖得到就不待校验', () => {
    expect(pendingRoundFor(status('x', 'pass', null, 1415), bran)?.taskId).toBe('incr');
    expect(pendingRoundFor(status('x', 'pass', null, 1416), bran)?.taskId).toBe('base');
    expect(pendingRoundFor(status('x', 'pass', null, 1420), bran)).toBeNull();
    expect(pendingRoundFor(status('x', 'running', null, 1400), bran)).toBeNull();
    expect(roundAfterCheck({ at: null, sesno: 1419, dbnum: 7999 }, equi)?.taskId).toBe('base');
  });

  it('pendingRoots 只留待校验的根', () => {
    const statuses = { '24381_145018': status('24381_145018', 'pass', null, 1420) };
    expect(pendingRoots(rounds, statuses)).toEqual([]);
    expect(pendingRoots(rounds, {}).map((root) => root.refno)).toEqual(['24381_145018']);
  });
});

describe('祖先核对通过覆盖子树里的根', () => {
  const SITE = '24381_100000';
  const ZONE = '24381_100001';
  const chain = ['24381_145018', ZONE, SITE, '16192_0'];
  const rounds = incrementalRoundsOf([batch('incr', '2026-11-05T06:32:00Z', [BRAN])]);
  const bran = rounds.get('24381_145018')!;

  it('只收祖先里核对通过的结论，自己和不一致的不算', () => {
    const statuses = {
      '24381_145018': status('24381_145018', 'pass', null, 1416),
      [ZONE]: status(ZONE, 'fail', null, 1420),
      [SITE]: status(SITE, 'pass', null, 1420),
    };
    expect(passingAncestorChecks('24381_145018', chain, statuses).map((item) => item.refno)).toEqual([SITE]);
    expect(passingAncestorChecks('24381_145018', undefined, statuses)).toEqual([]);
  });

  it('SITE 通过、会话不早于这一轮：没核对过的根也不待校验；SITE 会话更早则仍待校验', () => {
    expect(pendingRoundFor(null, bran, [status(SITE, 'pass', null, 1416)])).toBeNull();
    expect(pendingRoundFor(null, bran, [status(SITE, 'pass', null, 1415)])?.taskId).toBe('incr');
    expect(isPendingFor(null, bran.latest, [status(SITE, 'pass', null, 1416)])).toBe(false);
  });

  it('自己的结论和祖先通过比谁新：自己过期但 SITE 更新且通过，不待校验；排队中照旧不算', () => {
    expect(pendingRoundFor(status('x', 'fail', null, 1400), bran, [status(SITE, 'pass', null, 1416)])).toBeNull();
    expect(pendingRoundFor(status('x', 'pass', null, 1400), bran, [status(SITE, 'pass', null, 1410)])?.taskId).toBe('incr');
    expect(pendingRoundFor(status('x', 'queued', null, null), bran, [])).toBeNull();
  });

  it('批次汇总：靠祖先通过覆盖的根记作通过', () => {
    const entry = batch('b', '2026-11-05T06:32:00Z', [BRAN, EQUI]);
    const passes = (refno: string) => (refno === '24381_145018' ? [status(SITE, 'pass', null, 1416)] : []);
    expect(batchCheckSummary(entry, {}, passes)).toMatchObject({ total: 2, pending: 1, pass: 1, unchecked: 0 });
    expect(taskPendingRoots(entry, {}, passes).map((root) => root.refno)).toEqual(['24381_150101']);
  });
});

describe('batchCheckSummary', () => {
  it('按这条记录自己这一轮分桶', () => {
    const entry = batch('b', '2026-11-05T06:32:00Z', [
      BRAN,
      EQUI,
      { root_refno: '1/1', status: 'generated' },
      { root_refno: '1/2', status: 'generated' },
      { root_refno: '1/3', status: 'generated' },
      { root_refno: '1/4', status: 'generated' },
    ]);
    const later = '2026-11-05T07:00:00Z';
    const map: Record<string, RvmNodeStatus> = {
      '24381_150101': status('24381_150101', 'pass', '2026-11-05T06:00:00Z', 1415),
      '1_1': status('1_1', 'running', later, null),
      '1_2': status('1_2', 'pass', later, 1416),
      '1_3': status('1_3', 'kind_differ', later, 1416),
      '1_4': status('1_4', 'tool_error', later, 1416),
    };
    expect(batchCheckSummary(entry, map)).toEqual({ total: 6, pending: 2, running: 1, pass: 1, mismatch: 1, failed: 1, other: 0, unchecked: 0 });
    expect(taskPendingRoots(entry, map).map((root) => root.refno)).toEqual(['24381_145018', '24381_150101']);
  });

  it('基线轮：没核对过的记作未核对，只有结论落后的算待校验', () => {
    const entry = baseline('base', '2026-11-07T06:27:00Z', [BRAN, EQUI, { root_refno: '1/1', status: 'generated' }], 1420);
    const map: Record<string, RvmNodeStatus> = {
      '24381_150101': status('24381_150101', 'pass', '2026-11-05T06:00:00Z', 1416),
      '1_1': status('1_1', 'pass', '2026-11-05T06:00:00Z', 1420),
    };
    expect(batchCheckSummary(entry, map)).toMatchObject({ total: 3, pending: 1, pass: 1, unchecked: 1 });
    expect(taskPendingRoots(entry, map).map((root) => root.refno)).toEqual(['24381_150101']);
  });
});

describe('roundLabel / rvmBadgeTitle', () => {
  const roots = rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN, EQUI, STRU]));
  const [root, transformRoot, unitRoot] = roots;

  it('增量轮叫「第 N 轮增量」，基线轮叫「会话 1→N 整库生成」', () => {
    expect(roundLabel(root!)).toBe('第 1416 轮增量');
    expect(roundLabel(rootsOfTask(baseline('base', '2026-11-07T06:27:00Z', [BRAN], 435))[0]!)).toBe('会话 1→435 整库生成');
  });

  it('从未校验：写增量待校验、轮次和发布方式', () => {
    const title = rvmBadgeTitle(null, root);
    expect(title).toContain('增量待校验');
    expect(title).toContain('第 1416 轮增量（整根重算）');
    expect(rvmBadgeTitle(null, unitRoot)).toContain('（单元级发布）');
  });

  it('刚体前移 / 单元级发布：说明核对不直接检查这条便宜路的发布结果', () => {
    expect(rvmBadgeTitle(null, transformRoot)).toContain('不直接检查这一轮刚体前移的发布结果');
    expect(rvmBadgeTitle(null, unitRoot)).toContain('不直接检查这一轮单元级发布的发布结果');
    expect(rvmBadgeTitle(null, root)).not.toContain('不直接检查');
  });

  it('过期：写上次结论和之后的轮次', () => {
    const title = rvmBadgeTitle(status(root!.refno, 'pass', '2026-11-05T06:20:00Z'), root);
    expect(title).toContain('RVM 核对：通过');
    expect(title).toContain('上次结论 通过');
    expect(title).toContain('之后第 1416 轮增量重算过，待重新校验');
    expect(title.endsWith('点击查看结果')).toBe(true);
  });

  it('不待校验时退回普通提示；都没有给空串', () => {
    expect(rvmBadgeTitle(status('x', 'fail', null), null)).toContain('RVM 核对：不一致');
    expect(rvmBadgeTitle(null, null)).toBe('');
  });
});

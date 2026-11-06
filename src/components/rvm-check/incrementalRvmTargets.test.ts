import { describe, expect, it } from 'vitest';

import {
  batchCheckSummary,
  incrementalRootsOf,
  isOutdated,
  isPendingFor,
  pendingRoots,
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
    end_sesno: 1416,
    result: { units },
    ...extra,
  } as TaskListEntryDto;
}

function status(refno: string, verdict: RvmNodeStatus['verdict'], at: string | null): RvmNodeStatus {
  return { refno, verdict, taskId: 't', at, sesno: 1415, message: '', name: null, stage: null, reasons: '' };
}

const BRAN = { root_refno: '24381/145018', noun: 'BRAN', status: 'generated', kind: 'regen' };
const EQUI = { root_refno: '24381/150101', noun: 'EQUI', status: 'generated', kind: 'transform' };
const FAILED = { root_refno: '24381/145099', noun: 'BRAN', status: 'failed' };

describe('rootsOfTask', () => {
  it('只取落地的 data_batch / model_rebuild 里生成成功的单元，refno 转成 a_b', () => {
    const roots = rootsOfTask(batch('b1', '2026-11-05T06:32:00Z', [BRAN, EQUI, FAILED, BRAN]));
    expect(roots.map((root) => root.refno)).toEqual(['24381_145018', '24381_150101']);
    expect(roots[1]!.unitKind).toBe('transform');
    expect(roots[0]!.sesno).toBe(1416);
  });

  it('运行中、失败、其它种类、缺 finished_at 都不出根', () => {
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { state: 'running' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { state: 'failed' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { kind: 'room_recalc' }))).toEqual([]);
    expect(rootsOfTask(batch('b', '', [BRAN]))).toEqual([]);
    expect(rootsOfTask(batch('b', '2026-11-05T06:32:00Z', [BRAN], { kind: 'model_rebuild', state: 'partial' }))).toHaveLength(1);
  });
});

describe('incrementalRootsOf', () => {
  it('同一根出现在多轮时取最新一轮，结果从新到旧', () => {
    const roots = incrementalRootsOf([
      batch('old', '2026-11-05T06:20:00Z', [BRAN, EQUI], { end_sesno: 1415 }),
      batch('new', '2026-11-05T06:32:00Z', [BRAN]),
    ]);
    expect(roots.map((root) => [root.refno, root.taskId])).toEqual([
      ['24381_145018', 'new'],
      ['24381_150101', 'old'],
    ]);
  });
});

describe('isOutdated / isPendingFor', () => {
  const root = { finishedAt: '2026-11-05T06:32:00Z' };
  it('结论早于落地是过期，晚于落地不是', () => {
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:20:00Z'), root)).toBe(true);
    expect(isOutdated(status('x', 'pass', '2026-11-05T06:40:00Z'), root)).toBe(false);
    expect(isOutdated(status('x', 'fail', null), root)).toBe(true);
  });

  it('没有结论算待校验；排队 / 运行中不算', () => {
    expect(isPendingFor(null, root)).toBe(true);
    expect(isOutdated(null, root)).toBe(false);
    expect(isPendingFor(status('x', 'queued', '2026-11-05T06:00:00Z'), root)).toBe(false);
    expect(isPendingFor(status('x', 'running', '2026-11-05T06:00:00Z'), root)).toBe(false);
  });

  it('pendingRoots 只留待校验的', () => {
    const roots = incrementalRootsOf([batch('b', '2026-11-05T06:32:00Z', [BRAN, EQUI])]);
    const map = { '24381_150101': status('24381_150101', 'pass', '2026-11-05T06:50:00Z') };
    expect(pendingRoots(roots, map).map((r) => r.refno)).toEqual(['24381_145018']);
  });
});

describe('batchCheckSummary', () => {
  it('按这条记录自己的落地时刻分桶', () => {
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
      '24381_150101': status('24381_150101', 'pass', '2026-11-05T06:00:00Z'),
      '1_1': status('1_1', 'running', later),
      '1_2': status('1_2', 'pass', later),
      '1_3': status('1_3', 'kind_differ', later),
      '1_4': status('1_4', 'tool_error', later),
    };
    expect(batchCheckSummary(entry, map)).toEqual({ total: 6, pending: 2, running: 1, pass: 1, mismatch: 1, failed: 1, other: 0 });
    expect(taskPendingRoots(entry, map).map((root) => root.refno)).toEqual(['24381_145018', '24381_150101']);
  });
});

describe('rvmBadgeTitle', () => {
  const [root] = incrementalRootsOf([batch('b', '2026-11-05T06:32:00Z', [BRAN])]);
  it('从未校验：写增量待校验和轮次', () => {
    const title = rvmBadgeTitle(null, root);
    expect(title).toContain('增量待校验');
    expect(title).toContain('第 1416 轮增量');
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

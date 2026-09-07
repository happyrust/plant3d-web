import { describe, expect, it } from 'vitest';

import { rootsFromFinishedDrains } from './useGenModelV1ModelSync';

import type { TaskEntryDto } from '@/api/genModelV1Api';

function drain(id: string, state: string, finishedAt: string | null, roots: string[]): TaskEntryDto {
  return {
    task_id: id,
    kind: 'model_drain',
    state,
    finished_at: finishedAt,
    detail: { epoch_id: 7, roots: roots.map((r) => ({ dbnum: 7997, target_refno: r, action: 'regen_root', revision: 1 })) },
  };
}

const TASKS: TaskEntryDto[] = [
  drain('m-1', 'succeeded', '2026-09-07T10:00:00+08:00', ['24381/145018', '24381/100677']),
  drain('m-2', 'running', null, ['24381/999']),
  drain('m-3', 'yielded', '2026-09-07T10:05:00+08:00', ['24381/145018', '24381/200']),
  { task_id: 'db-1', kind: 'data_batch', state: 'succeeded', finished_at: '2026-09-07T10:06:00+08:00' },
  drain('m-4', 'partial', '2026-09-07T10:07:00+08:00', ['24381_300']),
];

describe('rootsFromFinishedDrains', () => {
  it('水位 null：全部收口的 drain 都算，跑着的不算，别的 kind 不算；根归一 a_b 去重；水位推到最晚', () => {
    const out = rootsFromFinishedDrains(TASKS, null, new Set());
    expect(out.taskIds).toEqual(['m-1', 'm-3', 'm-4']);
    expect(out.roots).toEqual(['24381_145018', '24381_100677', '24381_200', '24381_300']);
    expect(out.newWatermark).toBe('2026-09-07T10:07:00+08:00');
  });

  it('水位 \'\'（推过但当时没有 drain）：全部算新', () => {
    const out = rootsFromFinishedDrains(TASKS, '', new Set());
    expect(out.taskIds).toEqual(['m-1', 'm-3', 'm-4']);
  });

  it('只处理水位之后的；处理过的 task_id 跳过；水位仍推到最晚', () => {
    const out = rootsFromFinishedDrains(TASKS, '2026-09-07T10:00:00+08:00', new Set(['m-4']));
    expect(out.taskIds).toEqual(['m-3']);
    expect(out.roots).toEqual(['24381_145018', '24381_200']);
    expect(out.newWatermark).toBe('2026-09-07T10:07:00+08:00');
  });

  it('没有任何收口的 drain：水位保持原样（null 或原值）', () => {
    expect(rootsFromFinishedDrains([drain('m-2', 'running', null, ['1/1'])], null, new Set()).newWatermark).toBeNull();
    expect(rootsFromFinishedDrains([], '2026-09-07T10:00:00+08:00', new Set()).newWatermark).toBe('2026-09-07T10:00:00+08:00');
    expect(rootsFromFinishedDrains([], '', new Set()).newWatermark).toBeNull();
  });
});

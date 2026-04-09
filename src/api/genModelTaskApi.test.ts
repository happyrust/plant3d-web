import { describe, expect, it } from 'vitest';

import { normalizeTask } from './genModelTaskApi';

describe('normalizeTask', () => {
  it('maps RefnoModelGeneration to DataGeneration and preserves bundle metadata', () => {
    const task = normalizeTask({
      id: 'task-refno-1',
      name: '按 refno 生成',
      task_type: 'RefnoModelGeneration',
      status: 'Completed',
      progress: {
        percentage: 100,
      },
      metadata: {
        bundle_url: '/files/output/tasks/task-refno-1/',
      },
    });

    expect(task.type).toBe('DataGeneration');
    expect(task.status).toBe('completed');
    expect(task.metadata?.bundle_url).toBe('/files/output/tasks/task-refno-1/');
  });

  it('maps ModelExport to ModelExport', () => {
    const task = normalizeTask({
      id: 'task-export-1',
      name: '导出模型',
      task_type: 'ModelExport',
      status: 'Pending',
      progress: 0,
    });

    expect(task.type).toBe('ModelExport');
    expect(task.status).toBe('pending');
  });
});

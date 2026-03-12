import { describe, expect, it } from 'vitest';

import {
  isDesignerResubmissionTask,
  getDesignerTaskStatusBucket,
  getResubmissionSubmissionCount,
  getResubmissionLatestReturnTime,
} from './reviewTaskFilters';

import type { ReviewTask } from '@/types/auth';

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'Desc',
    modelName: 'Model',
    status: 'draft',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: '设计人',
    reviewerId: 'checker-1',
    reviewerName: '校核人',
    components: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    currentNode: 'sj',
    ...overrides,
  };
}

describe('reviewTaskFilters', () => {
  it('treats draft + returnReason at sj as a designer resubmission task', () => {
    const task = createTask({ returnReason: '请补充材料', currentNode: 'sj', status: 'draft' });
    expect(isDesignerResubmissionTask(task)).toBe(true);
  });

  it('does not treat plain draft tasks as resubmission tasks', () => {
    const task = createTask({ returnReason: undefined, currentNode: 'sj', status: 'draft' });
    expect(isDesignerResubmissionTask(task)).toBe(false);
  });

  it('maps returned draft task to returned bucket', () => {
    const task = createTask({ returnReason: '退回', currentNode: 'sj', status: 'draft' });
    expect(getDesignerTaskStatusBucket(task)).toBe('returned');
  });

  it('maps active workflow tasks to pending bucket', () => {
    const task = createTask({ currentNode: 'jd', status: 'submitted' });
    expect(getDesignerTaskStatusBucket(task)).toBe('pending');
  });

  it('counts submit actions in workflow history', () => {
    const count = getResubmissionSubmissionCount([
      { node: 'sj', action: 'submit', operatorId: 'u1', operatorName: 'A', timestamp: 1 },
      { node: 'jd', action: 'return', operatorId: 'u2', operatorName: 'B', timestamp: 2 },
      { node: 'sj', action: 'submit', operatorId: 'u1', operatorName: 'A', timestamp: 3 },
    ]);

    expect(count).toBe(2);
  });

  it('returns the latest return timestamp', () => {
    const latest = getResubmissionLatestReturnTime([
      { node: 'jd', action: 'return', operatorId: 'u2', operatorName: 'B', timestamp: 2 },
      { node: 'sh', action: 'return', operatorId: 'u3', operatorName: 'C', timestamp: 5 },
    ]);

    expect(latest).toBe(5);
  });
});

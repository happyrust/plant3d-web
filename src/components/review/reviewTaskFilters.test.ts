import { describe, expect, it } from 'vitest';

import {
  isCanonicalReturnedTask,
  isDesignerResubmissionTask,
  isRejectedDesignerTask,
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
  it('treats rejected tasks as canonical returned tasks', () => {
    const task = createTask({ currentNode: 'sh', status: 'rejected', returnReason: '需要重新处理' });

    expect(isCanonicalReturnedTask(task)).toBe(true);
  });

  it('treats sj draft tasks with latest return metadata as canonical returned tasks', () => {
    const task = createTask({
      currentNode: 'sj',
      status: 'draft',
      returnReason: '请重新补充材料',
      workflowHistory: [
        { node: 'jd', action: 'return', operatorId: 'u1', operatorName: '校核员', comment: '请重新补充材料', timestamp: 10 },
      ],
    });

    expect(isCanonicalReturnedTask(task)).toBe(true);
    expect(isRejectedDesignerTask(task)).toBe(true);
    expect(isDesignerResubmissionTask(task)).toBe(true);
  });

  it('does not treat plain drafts as canonical returned tasks', () => {
    const task = createTask({ currentNode: 'sj', status: 'draft', returnReason: '   ' });

    expect(isCanonicalReturnedTask(task)).toBe(false);
    expect(isRejectedDesignerTask(task)).toBe(false);
  });

  it('does not treat rejected tasks outside resubmission state as designer resubmission tasks', () => {
    const task = createTask({ currentNode: 'jd', status: 'rejected', returnReason: '流程已拒绝' });

    expect(isCanonicalReturnedTask(task)).toBe(true);
    expect(isDesignerResubmissionTask(task)).toBe(false);
  });

  it('treats draft + returnReason at sj as a designer resubmission task', () => {
    const task = createTask({ returnReason: '请补充材料', currentNode: 'sj', status: 'draft' });
    expect(isDesignerResubmissionTask(task)).toBe(true);
  });

  it('does not treat plain draft tasks as resubmission tasks', () => {
    const task = createTask({ returnReason: undefined, currentNode: 'sj', status: 'draft' });
    expect(isDesignerResubmissionTask(task)).toBe(false);
  });

  it('stops treating sj draft tasks as canonical returned after a newer resubmit step', () => {
    const task = createTask({
      returnReason: '旧退回原因',
      currentNode: 'sj',
      status: 'draft',
      workflowHistory: [
        { node: 'jd', action: 'return', operatorId: 'u1', operatorName: '校核员', comment: '请补充材料', timestamp: 10 },
        { node: 'sj', action: 'submit', operatorId: 'u2', operatorName: '设计员', comment: '重新提交', timestamp: 20 },
      ],
    });

    expect(isCanonicalReturnedTask(task)).toBe(false);
    expect(isDesignerResubmissionTask(task)).toBe(false);
  });
  it('maps returned draft task to returned bucket', () => {
    const task = createTask({ returnReason: '退回', currentNode: 'sj', status: 'draft' });
    expect(getDesignerTaskStatusBucket(task)).toBe('returned');
  });

  it('treats rejected tasks as returned tasks', () => {
    const task = createTask({ currentNode: 'sh', status: 'rejected', returnReason: '需要重新处理' });
    expect(isRejectedDesignerTask(task)).toBe(true);
    expect(getDesignerTaskStatusBucket(task)).toBe('returned');
  });

  it('keeps resubmittable semantic limited to sj draft even when canonical returned is true', () => {
    const task = createTask({ currentNode: 'jd', status: 'rejected', returnReason: '仍属于退回语义' });

    expect(getDesignerTaskStatusBucket(task)).toBe('returned');
    expect(isDesignerResubmissionTask(task)).toBe(false);
  });

  it('maps active workflow tasks to pending bucket', () => {
    const task = createTask({ currentNode: 'jd', status: 'submitted' });
    expect(getDesignerTaskStatusBucket(task)).toBe('pending');
  });

  it('maps approved tasks to approved bucket', () => {
    const task = createTask({ currentNode: 'pz', status: 'approved' });

    expect(getDesignerTaskStatusBucket(task)).toBe('approved');
  });

  it('treats cancelled tasks as non-returned designer-visible other bucket', () => {
    const task = createTask({ currentNode: 'sj', status: 'cancelled' });

    expect(isCanonicalReturnedTask(task)).toBe(false);
    expect(getDesignerTaskStatusBucket(task)).toBe('other');
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

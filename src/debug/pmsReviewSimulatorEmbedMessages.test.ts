import { describe, expect, it } from 'vitest';

import {
  parseEmbeddedFormSavedMessage,
  parseEmbeddedWorkflowActionMessage,
} from './pmsReviewSimulatorEmbedMessages';

describe('parseEmbeddedWorkflowActionMessage', () => {
  it('接受合法的 active / agree / return / stop 消息', () => {
    for (const action of ['active', 'agree', 'return', 'stop'] as const) {
      const message = parseEmbeddedWorkflowActionMessage({
        type: 'plant3d.workflow_action',
        action,
        formId: 'FORM-1',
        taskId: 'task-1',
        comments: 'note',
        targetNode: action === 'return' ? 'sj' : undefined,
        source: 'review-panel',
      });
      expect(message?.action).toBe(action);
      expect(message?.formId).toBe('FORM-1');
      expect(message?.taskId).toBe('task-1');
      expect(message?.comments).toBe('note');
      expect(message?.source).toBe('review-panel');
    }
  });

  it('拒绝错误 type', () => {
    expect(parseEmbeddedWorkflowActionMessage({
      type: 'plant3d.something_else',
      action: 'active',
    })).toBeNull();
  });

  it('拒绝非法 action', () => {
    expect(parseEmbeddedWorkflowActionMessage({
      type: 'plant3d.workflow_action',
      action: 'unknown',
    })).toBeNull();
  });

  it('对非对象 / null / 字符串等输入返回 null', () => {
    expect(parseEmbeddedWorkflowActionMessage(null)).toBeNull();
    expect(parseEmbeddedWorkflowActionMessage(undefined)).toBeNull();
    expect(parseEmbeddedWorkflowActionMessage('plant3d.workflow_action')).toBeNull();
    expect(parseEmbeddedWorkflowActionMessage(42)).toBeNull();
  });

  it('对错类型的字段（非 string）会丢弃为 undefined', () => {
    const message = parseEmbeddedWorkflowActionMessage({
      type: 'plant3d.workflow_action',
      action: 'agree',
      formId: 123,
      taskId: { not: 'a string' },
      comments: ['array'],
      targetNode: false,
      source: undefined,
    });
    expect(message).not.toBeNull();
    expect(message?.formId).toBeUndefined();
    expect(message?.taskId).toBeUndefined();
    expect(message?.comments).toBeUndefined();
    expect(message?.targetNode).toBeUndefined();
    expect(message?.source).toBeUndefined();
  });
});

describe('parseEmbeddedFormSavedMessage', () => {
  it('接受合法消息并 trim formId / taskId', () => {
    const message = parseEmbeddedFormSavedMessage({
      type: 'plant3d.form_saved',
      source: 'initiate-review-panel',
      formId: '  FORM-A1  ',
      taskId: '  task-1  ',
      componentCount: 3,
      packageName: '编校审包-1',
    });
    expect(message?.taskId).toBe('task-1');
    expect(message?.formId).toBe('FORM-A1');
    expect(message?.componentCount).toBe(3);
    expect(message?.packageName).toBe('编校审包-1');
    expect(message?.source).toBe('initiate-review-panel');
  });

  it('formId 为空字符串时归一化为 null', () => {
    const message = parseEmbeddedFormSavedMessage({
      type: 'plant3d.form_saved',
      formId: '   ',
      taskId: 'task-x',
    });
    expect(message?.formId).toBeNull();
    expect(message?.taskId).toBe('task-x');
  });

  it('缺少 taskId 拒绝', () => {
    expect(parseEmbeddedFormSavedMessage({
      type: 'plant3d.form_saved',
      formId: 'FORM-X',
    })).toBeNull();

    expect(parseEmbeddedFormSavedMessage({
      type: 'plant3d.form_saved',
      taskId: '   ',
      formId: 'FORM-X',
    })).toBeNull();
  });

  it('错误 type 拒绝', () => {
    expect(parseEmbeddedFormSavedMessage({
      type: 'plant3d.something_else',
      taskId: 'task-1',
      formId: 'FORM-1',
    })).toBeNull();
  });

  it('非对象 / 缺字段 / 错类型字段全部安全降级', () => {
    expect(parseEmbeddedFormSavedMessage(null)).toBeNull();
    expect(parseEmbeddedFormSavedMessage(undefined)).toBeNull();
    expect(parseEmbeddedFormSavedMessage('plant3d.form_saved')).toBeNull();

    const message = parseEmbeddedFormSavedMessage({
      type: 'plant3d.form_saved',
      taskId: 'task-mix',
      formId: 'FORM-mix',
      componentCount: 'not-a-number',
      packageName: 42,
      source: ['array'],
    });
    expect(message?.taskId).toBe('task-mix');
    expect(message?.formId).toBe('FORM-mix');
    expect(message?.componentCount).toBeUndefined();
    expect(message?.packageName).toBeUndefined();
    expect(message?.source).toBeUndefined();
  });
});

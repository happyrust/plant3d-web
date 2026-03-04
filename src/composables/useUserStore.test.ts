import { describe, it, expect } from 'vitest';
import { UserRole } from '@/types/auth';
import {
  isCheckerRole,
  isApproverRole,
  getNextWorkflowNode,
  statusFromNode,
} from './useUserStore';

describe('isCheckerRole', () => {
  it('returns true for PROOFREADER', () => {
    expect(isCheckerRole(UserRole.PROOFREADER)).toBe(true);
  });

  it('returns false for non-checker roles', () => {
    expect(isCheckerRole(UserRole.DESIGNER)).toBe(false);
    expect(isCheckerRole(UserRole.REVIEWER)).toBe(false);
    expect(isCheckerRole(UserRole.MANAGER)).toBe(false);
    expect(isCheckerRole(UserRole.ADMIN)).toBe(false);
    expect(isCheckerRole(undefined)).toBe(false);
  });
});

describe('isApproverRole', () => {
  it('returns true for REVIEWER, MANAGER, ADMIN', () => {
    expect(isApproverRole(UserRole.REVIEWER)).toBe(true);
    expect(isApproverRole(UserRole.MANAGER)).toBe(true);
    expect(isApproverRole(UserRole.ADMIN)).toBe(true);
  });

  it('returns false for non-approver roles', () => {
    expect(isApproverRole(UserRole.DESIGNER)).toBe(false);
    expect(isApproverRole(UserRole.PROOFREADER)).toBe(false);
    expect(isApproverRole(undefined)).toBe(false);
  });
});

describe('getNextWorkflowNode', () => {
  it('returns jd for sj', () => {
    expect(getNextWorkflowNode('sj')).toBe('jd');
  });

  it('returns sh for jd', () => {
    expect(getNextWorkflowNode('jd')).toBe('sh');
  });

  it('returns null for sh (last node in WORKFLOW_NODE_ORDER)', () => {
    expect(getNextWorkflowNode('sh')).toBeNull();
  });

  it('defaults to sj -> jd when no node provided', () => {
    expect(getNextWorkflowNode()).toBe('jd');
    expect(getNextWorkflowNode(undefined)).toBe('jd');
  });

  it('returns jd for unknown node', () => {
    expect(getNextWorkflowNode('unknown' as any)).toBe('jd');
  });
});

describe('statusFromNode', () => {
  it('returns draft for sj', () => {
    expect(statusFromNode('sj')).toBe('draft');
  });

  it('returns submitted for jd', () => {
    expect(statusFromNode('jd')).toBe('submitted');
  });

  it('returns in_review for sh', () => {
    expect(statusFromNode('sh')).toBe('in_review');
  });

  it('returns in_review for pz', () => {
    expect(statusFromNode('pz')).toBe('in_review');
  });
});

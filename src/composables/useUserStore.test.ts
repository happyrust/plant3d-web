import { describe, it, expect } from 'vitest';

import {
  buildSwitchUserTokenRequest,
  isCheckerRole,
  isApproverRole,
  getNextWorkflowNode,
  resolveReviewProjectIdFromSession,
  statusFromNode,
  normalizeBackendUser,
} from './useUserStore';

import { UserRole, UserStatus } from '@/types/auth';

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

  it('returns pz for sh', () => {
    expect(getNextWorkflowNode('sh')).toBe('pz');
  });

  it('returns null for pz (last node in WORKFLOW_NODE_ORDER)', () => {
    expect(getNextWorkflowNode('pz')).toBeNull();
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

describe('normalizeBackendUser', () => {
  it('maps backend workflow role codes to frontend roles', () => {
    const user = normalizeBackendUser({
      id: 'u-1',
      username: 'checker',
      email: 'checker@example.com',
      name: '校核员',
      role: 'jd',
    });

    expect(user.role).toBe(UserRole.PROOFREADER);
    expect(user.id).toBe('u-1');
    expect(user.name).toBe('校核员');
  });

  it('preserves existing frontend roles', () => {
    const user = normalizeBackendUser({
      id: 'u-2',
      username: 'reviewer',
      email: 'reviewer@example.com',
      name: '审核员',
      role: 'reviewer',
    });

    expect(user.role).toBe(UserRole.REVIEWER);
  });
});

describe('switch user auth helpers', () => {
  it('builds a token request using backend workflow role codes', () => {
    const request = buildSwitchUserTokenRequest(
      {
        id: 'reviewer_001',
        username: 'reviewer',
        email: 'reviewer@example.com',
        name: '审核员',
        role: UserRole.REVIEWER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      'project-123',
    );

    expect(request).toEqual({
      projectId: 'project-123',
      userId: 'reviewer_001',
      role: 'sh',
    });
  });

  it('prefers embed project id from session storage when present', () => {
    const projectId = resolveReviewProjectIdFromSession({
      getItem: (key: string) => key === 'embed_mode_params'
        ? JSON.stringify({ projectId: 'embed-project-1' })
        : null,
    });

    expect(projectId).toBe('embed-project-1');
  });

  it('falls back to debug-project when session storage is empty', () => {
    const projectId = resolveReviewProjectIdFromSession({
      getItem: () => null,
    });

    expect(projectId).toBe('debug-project');
  });
});

import { describe, expect, it } from 'vitest';

import {
  findNextActionableAnnotation,
  isAnnotationActionableForRole,
} from './annotationSheetNavigation';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

function item(
  id: string,
  statusKey: AnnotationWorkspaceItem['statusKey'],
): AnnotationWorkspaceItem {
  return {
    id,
    type: 'text',
    title: id,
    description: '',
    createdAt: 1,
    activityAt: 1,
    visible: true,
    refnos: [],
    commentCount: 0,
    statusKey,
    statusLabel: statusKey,
    statusTone: '',
    priority: 'low',
    priorityLabel: '低',
    priorityTone: '',
  };
}

describe('annotationSheetNavigation', () => {
  it('按当前角色识别需要处理的批注状态', () => {
    expect(isAnnotationActionableForRole(item('pending', 'pending'), UserRole.DESIGNER)).toBe(true);
    expect(isAnnotationActionableForRole(item('rejected', 'rejected'), UserRole.DESIGNER)).toBe(true);
    expect(isAnnotationActionableForRole(item('fixed', 'fixed'), UserRole.DESIGNER)).toBe(false);

    expect(isAnnotationActionableForRole(item('fixed', 'fixed'), UserRole.PROOFREADER)).toBe(true);
    expect(isAnnotationActionableForRole(item('wont-fix', 'wont_fix'), UserRole.REVIEWER)).toBe(true);
    expect(isAnnotationActionableForRole(item('pending-reviewer', 'pending'), UserRole.MANAGER)).toBe(false);

    expect(isAnnotationActionableForRole(item('admin-open', 'pending'), UserRole.ADMIN)).toBe(true);
    expect(isAnnotationActionableForRole(item('admin-fixed', 'fixed'), UserRole.ADMIN)).toBe(true);
    expect(isAnnotationActionableForRole(item('approved', 'approved'), UserRole.ADMIN)).toBe(false);
    expect(isAnnotationActionableForRole(item('viewer', 'pending'), UserRole.VIEWER)).toBe(false);
  });

  it('从当前项之后查找下一条并支持回绕', () => {
    const items = [
      item('a', 'pending'),
      item('b', 'approved'),
      item('c', 'pending'),
    ];
    const actionable = (candidate: AnnotationWorkspaceItem) => candidate.statusKey === 'pending';

    expect(findNextActionableAnnotation(items, 'text:a', actionable)?.id).toBe('c');
    expect(findNextActionableAnnotation(items, 'text:c', actionable)?.id).toBe('a');
  });

  it('当前项已被筛选移除时从结果首项开始查找', () => {
    const items = [
      item('a', 'approved'),
      item('b', 'fixed'),
    ];

    expect(findNextActionableAnnotation(
      items,
      'text:removed',
      (candidate) => candidate.statusKey === 'fixed',
    )?.id).toBe('b');
  });

  it('没有其他可处理项时返回 null 且不会返回当前项', () => {
    const items = [item('a', 'pending'), item('b', 'approved')];

    expect(findNextActionableAnnotation(
      items,
      'text:a',
      (candidate) => candidate.statusKey === 'pending',
    )).toBeNull();
  });
});

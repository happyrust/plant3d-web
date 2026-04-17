import { describe, expect, it } from 'vitest';

import {
  ANNOTATION_SEVERITY_VALUES,
  canEditAnnotationSeverity,
  compareAnnotationSeverity,
  getAnnotationSeverityDisplay,
  isAnnotationSeverity,
  normalizeAnnotationSeverity,
  UserRole,
  UserStatus,
  type AnnotationSeverity,
  type User,
} from './auth';

function makeUser(partial: Partial<User> = {}): User {
  return {
    id: partial.id ?? 'u-1',
    username: partial.username ?? 'alice',
    email: partial.email ?? 'alice@example.com',
    name: partial.name ?? 'Alice',
    role: partial.role ?? UserRole.DESIGNER,
    status: partial.status ?? UserStatus.ACTIVE,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
    ...partial,
  };
}

describe('AnnotationSeverity helpers', () => {
  it('ANNOTATION_SEVERITY_VALUES 按严重度由高到低排列，恰好 4 档', () => {
    expect(ANNOTATION_SEVERITY_VALUES).toEqual(['critical', 'severe', 'normal', 'suggestion']);
  });

  it('isAnnotationSeverity 只接受 4 种合法值', () => {
    expect(isAnnotationSeverity('critical')).toBe(true);
    expect(isAnnotationSeverity('severe')).toBe(true);
    expect(isAnnotationSeverity('normal')).toBe(true);
    expect(isAnnotationSeverity('suggestion')).toBe(true);
    expect(isAnnotationSeverity('urgent')).toBe(false);
    expect(isAnnotationSeverity('')).toBe(false);
    expect(isAnnotationSeverity(null)).toBe(false);
    expect(isAnnotationSeverity(undefined)).toBe(false);
  });

  it('normalizeAnnotationSeverity 非法值返回 undefined，合法值原样保留', () => {
    expect(normalizeAnnotationSeverity('critical')).toBe('critical');
    expect(normalizeAnnotationSeverity('low')).toBeUndefined();
    expect(normalizeAnnotationSeverity(undefined)).toBeUndefined();
    expect(normalizeAnnotationSeverity(null)).toBeUndefined();
  });

  it('getAnnotationSeverityDisplay 返回 label/color/dot/rank，rank 满足严重度递增', () => {
    const critical = getAnnotationSeverityDisplay('critical');
    const severe = getAnnotationSeverityDisplay('severe');
    const normal = getAnnotationSeverityDisplay('normal');
    const suggestion = getAnnotationSeverityDisplay('suggestion');
    const unset = getAnnotationSeverityDisplay(undefined);

    expect(critical.label).toBe('致命');
    expect(severe.label).toBe('严重');
    expect(normal.label).toBe('一般');
    expect(suggestion.label).toBe('建议');
    expect(unset.label).toBe('未设置');

    expect(critical.rank).toBeGreaterThan(severe.rank);
    expect(severe.rank).toBeGreaterThan(normal.rank);
    expect(normal.rank).toBeGreaterThan(suggestion.rank);
    expect(suggestion.rank).toBeGreaterThan(unset.rank);
  });

  it('compareAnnotationSeverity 用于列表降序：致命 > 严重 > 一般 > 建议 > 未设置', () => {
    const list: (AnnotationSeverity | undefined)[] = ['normal', undefined, 'critical', 'suggestion', 'severe'];
    const sorted = [...list].sort(compareAnnotationSeverity);
    expect(sorted).toEqual(['critical', 'severe', 'normal', 'suggestion', undefined]);
  });

  describe('canEditAnnotationSeverity', () => {
    it('作者本人：无论角色（designer/viewer），均可修改', () => {
      const designer = makeUser({ id: 'u-author', role: UserRole.DESIGNER });
      const viewer = makeUser({ id: 'u-author', role: UserRole.VIEWER });
      expect(canEditAnnotationSeverity(designer, 'u-author')).toBe(true);
      expect(canEditAnnotationSeverity(viewer, 'u-author')).toBe(true);
    });

    it('审核侧角色：即使不是作者，也可修改', () => {
      const cases: UserRole[] = [UserRole.PROOFREADER, UserRole.REVIEWER, UserRole.MANAGER, UserRole.ADMIN];
      for (const role of cases) {
        const user = makeUser({ id: 'u-other', role });
        expect(canEditAnnotationSeverity(user, 'u-author')).toBe(true);
      }
    });

    it('非作者且不是审核侧角色：禁止修改（典型：其他设计人员 / viewer）', () => {
      const otherDesigner = makeUser({ id: 'u-other', role: UserRole.DESIGNER });
      const viewer = makeUser({ id: 'u-other', role: UserRole.VIEWER });
      expect(canEditAnnotationSeverity(otherDesigner, 'u-author')).toBe(false);
      expect(canEditAnnotationSeverity(viewer, 'u-author')).toBe(false);
    });

    it('未登录用户：禁止', () => {
      expect(canEditAnnotationSeverity(null, 'u-author')).toBe(false);
    });

    it('authorId 未提供：不享受作者豁免，只按角色判断', () => {
      const designer = makeUser({ id: 'u-d', role: UserRole.DESIGNER });
      const reviewer = makeUser({ id: 'u-r', role: UserRole.REVIEWER });
      expect(canEditAnnotationSeverity(designer)).toBe(false);
      expect(canEditAnnotationSeverity(reviewer)).toBe(true);
    });
  });
});

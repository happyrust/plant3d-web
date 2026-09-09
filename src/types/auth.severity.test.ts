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

// 批注错误类型现为三档（auth.ts）：原则错误 principle（×）> 一般错误 general（△）> 图面错误 drawing（○）。
// 旧的四档 critical/severe/normal/suggestion 已不存在，这里按现行三档钉。
describe('AnnotationSeverity helpers', () => {
  it('ANNOTATION_SEVERITY_VALUES 按严重度由高到低排列，恰好 3 档', () => {
    expect(ANNOTATION_SEVERITY_VALUES).toEqual(['principle', 'general', 'drawing']);
  });

  it('isAnnotationSeverity 只接受 3 种合法值', () => {
    expect(isAnnotationSeverity('principle')).toBe(true);
    expect(isAnnotationSeverity('general')).toBe(true);
    expect(isAnnotationSeverity('drawing')).toBe(true);
    // 旧四档与其它任意值都不再合法
    expect(isAnnotationSeverity('critical')).toBe(false);
    expect(isAnnotationSeverity('severe')).toBe(false);
    expect(isAnnotationSeverity('urgent')).toBe(false);
    expect(isAnnotationSeverity('')).toBe(false);
    expect(isAnnotationSeverity(null)).toBe(false);
    expect(isAnnotationSeverity(undefined)).toBe(false);
  });

  it('normalizeAnnotationSeverity 非法值返回 undefined，合法值原样保留', () => {
    expect(normalizeAnnotationSeverity('principle')).toBe('principle');
    expect(normalizeAnnotationSeverity('drawing')).toBe('drawing');
    expect(normalizeAnnotationSeverity('critical')).toBeUndefined();
    expect(normalizeAnnotationSeverity('low')).toBeUndefined();
    expect(normalizeAnnotationSeverity(undefined)).toBeUndefined();
    expect(normalizeAnnotationSeverity(null)).toBeUndefined();
  });

  it('getAnnotationSeverityDisplay 返回 label/color/dot/rank/symbol，rank 满足严重度递增', () => {
    const principle = getAnnotationSeverityDisplay('principle');
    const general = getAnnotationSeverityDisplay('general');
    const drawing = getAnnotationSeverityDisplay('drawing');
    const unset = getAnnotationSeverityDisplay(undefined);

    expect(principle.label).toBe('原则错误');
    expect(general.label).toBe('一般错误');
    expect(drawing.label).toBe('图面错误');
    expect(unset.label).toBe('未设置');

    expect(principle.symbol).toBe('×');
    expect(general.symbol).toBe('△');
    expect(drawing.symbol).toBe('○');
    expect(unset.symbol).toBe('');

    expect(principle.rank).toBeGreaterThan(general.rank);
    expect(general.rank).toBeGreaterThan(drawing.rank);
    expect(drawing.rank).toBeGreaterThan(unset.rank);
    for (const display of [principle, general, drawing, unset]) {
      expect(display.color).toBeTruthy();
      expect(display.dot).toBeTruthy();
    }
  });

  it('compareAnnotationSeverity 用于列表降序：原则错误 > 一般错误 > 图面错误 > 未设置', () => {
    const list: (AnnotationSeverity | undefined)[] = ['general', undefined, 'principle', 'drawing'];
    const sorted = [...list].sort(compareAnnotationSeverity);
    expect(sorted).toEqual(['principle', 'general', 'drawing', undefined]);
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

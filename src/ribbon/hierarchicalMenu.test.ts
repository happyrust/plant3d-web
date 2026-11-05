import { describe, expect, it } from 'vitest';

import { buildHierarchicalMenuTabs } from './hierarchicalMenu';
import { RIBBON_TABS } from './ribbonConfig';

import { UserRole } from '@/types/auth';

describe('buildHierarchicalMenuTabs', () => {
  it('drops the project tab for roles outside ADMIN / MANAGER', () => {
    const ids = (role: UserRole | undefined) => buildHierarchicalMenuTabs(RIBBON_TABS, role).map((tab) => tab.id);
    expect(ids(UserRole.DESIGNER)).not.toContain('project');
    expect(ids(undefined)).not.toContain('project');
    expect(ids(UserRole.ADMIN)).toContain('project');
    expect(ids(UserRole.MANAGER)).toContain('project');
  });

  it('keeps unrestricted commands for every role', () => {
    const view = buildHierarchicalMenuTabs(RIBBON_TABS, UserRole.DESIGNER).find((tab) => tab.id === 'review');
    expect(view?.groups.flatMap((group) => group.commands.map((command) => command.id))).toContain('review.start');
  });
});

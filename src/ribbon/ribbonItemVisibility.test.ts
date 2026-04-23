import { describe, expect, it } from 'vitest';

import { filterRibbonItemsForUser, isRibbonButtonVisibleForRole } from './ribbonItemVisibility';

import type { RibbonButtonItem, RibbonItem } from './ribbonTypes';

import { UserRole } from '@/types/auth';

function buildButton(overrides: Partial<RibbonButtonItem>): RibbonButtonItem {
  return {
    kind: 'button',
    id: 'btn.x',
    label: 'X',
    commandId: 'x',
    ...overrides,
  };
}

describe('isRibbonButtonVisibleForRole', () => {
  it('未声明 roles 时对任意角色可见', () => {
    const button = buildButton({ id: 'btn.unrestricted' });
    expect(isRibbonButtonVisibleForRole(button, UserRole.VIEWER)).toBe(true);
    expect(isRibbonButtonVisibleForRole(button, undefined)).toBe(true);
    expect(isRibbonButtonVisibleForRole(button, UserRole.DESIGNER)).toBe(true);
  });

  it('声明了空 roles 数组等同未声明', () => {
    const button = buildButton({ id: 'btn.empty-roles', roles: [] });
    expect(isRibbonButtonVisibleForRole(button, UserRole.VIEWER)).toBe(true);
    expect(isRibbonButtonVisibleForRole(button, undefined)).toBe(true);
  });

  it('roles 命中当前角色 → 可见', () => {
    const button = buildButton({
      id: 'btn.reviewer-only',
      roles: [UserRole.REVIEWER, UserRole.ADMIN],
    });
    expect(isRibbonButtonVisibleForRole(button, UserRole.REVIEWER)).toBe(true);
    expect(isRibbonButtonVisibleForRole(button, UserRole.ADMIN)).toBe(true);
  });

  it('roles 未命中当前角色 → 隐藏', () => {
    const button = buildButton({
      id: 'btn.reviewer-only',
      roles: [UserRole.REVIEWER],
    });
    expect(isRibbonButtonVisibleForRole(button, UserRole.VIEWER)).toBe(false);
    expect(isRibbonButtonVisibleForRole(button, UserRole.DESIGNER)).toBe(false);
  });

  it('声明了 roles 但未提供 user role → 隐藏（保守策略）', () => {
    const button = buildButton({
      id: 'btn.annotation-table',
      roles: [UserRole.DESIGNER, UserRole.REVIEWER],
    });
    expect(isRibbonButtonVisibleForRole(button, undefined)).toBe(false);
  });
});

describe('filterRibbonItemsForUser', () => {
  it('过滤受限按钮，保留 stack 和 separator', () => {
    const items: RibbonItem[] = [
      buildButton({ id: 'btn.open', roles: [UserRole.DESIGNER] }),
      buildButton({ id: 'btn.public' }),
      { kind: 'separator', id: 'sep.1' },
      {
        kind: 'stack',
        id: 'stack.1',
        items: [
          buildButton({ id: 'btn.stack-a' }),
          buildButton({ id: 'btn.stack-b' }),
        ],
      },
    ];

    const filteredForDesigner = filterRibbonItemsForUser(items, UserRole.DESIGNER);
    expect(filteredForDesigner.map((i) => i.id)).toEqual(['btn.open', 'btn.public', 'sep.1', 'stack.1']);

    const filteredForViewer = filterRibbonItemsForUser(items, UserRole.VIEWER);
    expect(filteredForViewer.map((i) => i.id)).toEqual(['btn.public', 'sep.1', 'stack.1']);

    const filteredForAnon = filterRibbonItemsForUser(items, undefined);
    expect(filteredForAnon.map((i) => i.id)).toEqual(['btn.public', 'sep.1', 'stack.1']);
  });
});

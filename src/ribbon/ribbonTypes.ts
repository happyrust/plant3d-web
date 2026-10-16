import type { Component } from 'vue';

import type { UserRole } from '@/types/auth';

export type RibbonIconComponent = Component;

export type RibbonButtonItem = {
  kind: 'button';
  id: string;
  label: string;
  icon?: string;
  commandId: string;
  disabled?: boolean;
  /**
   * 可选 · 当前态谓词：返回 true 时按激活态渲染（如「显示主题」指示当前选中的主题）。
   * 在渲染期求值，谓词内读响应式 ref 可自动联动。
   */
  active?: () => boolean;
  /**
   * 可选 · 若声明则仅当前用户角色命中此列表时可见；未声明则始终可见。
   * 由 `src/ribbon/ribbonItemVisibility.ts` 过滤，`src/components/ribbon/RibbonBar.vue` 消费。
   * 参见 `docs/plans/2026-04-23-ribbon-annotation-table-role-visibility-pr10-design.md`。
   */
  roles?: UserRole[];
};

export type RibbonStackItem = {
  kind: 'stack';
  id: string;
  items: RibbonButtonItem[];
};

export type RibbonSeparatorItem = {
  kind: 'separator';
  id: string;
};

export type RibbonItem = RibbonButtonItem | RibbonStackItem | RibbonSeparatorItem;

export type RibbonGroupConfig = {
  id: string;
  label: string;
  items: RibbonItem[];
};

export type RibbonTabConfig = {
  id: string;
  label: string;
  groups: RibbonGroupConfig[];
};

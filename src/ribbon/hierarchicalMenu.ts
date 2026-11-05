import type { RibbonButtonItem, RibbonTabConfig } from '@/ribbon/ribbonTypes';
import type { UserRole } from '@/types/auth';

import { isRibbonButtonVisibleForRole } from '@/ribbon/ribbonItemVisibility';

export type HierarchicalMenuCommand = RibbonButtonItem;

export type HierarchicalMenuGroup = {
  id: string;
  label: string;
  commands: HierarchicalMenuCommand[];
};

export type HierarchicalMenuTab = {
  id: string;
  label: string;
  groups: HierarchicalMenuGroup[];
};

function flattenGroupCommands(tab: RibbonTabConfig, userRole: UserRole | undefined): HierarchicalMenuTab {
  return {
    id: tab.id,
    label: tab.label,
    groups: tab.groups
      .map((group) => ({
        id: group.id,
        label: group.label,
        commands: group.items.flatMap((item) => {
          if (item.kind === 'button') return [item];
          if (item.kind === 'stack') return item.items;
          return [];
        }).filter((command) => isRibbonButtonVisibleForRole(command, userRole)),
      }))
      .filter((group) => group.commands.length > 0),
  };
}

export function buildHierarchicalMenuTabs(
  tabs: RibbonTabConfig[],
  userRole: UserRole | undefined,
): HierarchicalMenuTab[] {
  return tabs.map((tab) => flattenGroupCommands(tab, userRole)).filter((tab) => tab.groups.length > 0);
}

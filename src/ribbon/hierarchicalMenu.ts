import type { RibbonButtonItem, RibbonTabConfig } from '@/ribbon/ribbonTypes';

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

function flattenGroupCommands(tab: RibbonTabConfig): HierarchicalMenuTab {
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
        }),
      }))
      .filter((group) => group.commands.length > 0),
  };
}

export function buildHierarchicalMenuTabs(tabs: RibbonTabConfig[]): HierarchicalMenuTab[] {
  return tabs.map(flattenGroupCommands).filter((tab) => tab.groups.length > 0);
}

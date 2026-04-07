import { nextTick } from 'vue';

import type { MenuMode } from '@/composables/useMenuMode';
import { RIBBON_TABS } from '@/ribbon/ribbonConfig';
import type { RibbonItem } from '@/ribbon/ribbonTypes';

import type { GuideStep } from './types';

function collectCommandIdsFromItem(item: RibbonItem): string[] {
  if (item.kind === 'button') return [item.commandId];
  if (item.kind === 'stack') return item.items.map((s) => s.commandId);
  return [];
}

let commandToTabId: Map<string, string> | null = null;

function getCommandToTabMap(): Map<string, string> {
  if (!commandToTabId) {
    commandToTabId = new Map();
    for (const tab of RIBBON_TABS) {
      for (const group of tab.groups) {
        for (const item of group.items) {
          for (const cid of collectCommandIdsFromItem(item)) {
            if (!commandToTabId.has(cid)) commandToTabId.set(cid, tab.id);
          }
        }
      }
    }
  }
  return commandToTabId;
}

export function getRibbonTabIdForCommand(commandId: string): string | null {
  return getCommandToTabMap().get(commandId) ?? null;
}

function tabLabel(tabId: string): string {
  return RIBBON_TABS.find((t) => t.id === tabId)?.label ?? tabId;
}

const COMMAND_SELECTOR_RE = /\[data-command="([^"]+)"\]/;

export function extractDataCommandFromSelector(selector: string): string | null {
  const m = selector.match(COMMAND_SELECTOR_RE);
  return m?.[1] ?? null;
}

/** 分层菜单下子项仅在展开后挂载；展示高亮前尽量自动点开对应顶层菜单 */
export async function ensureHierarchicalDropdownVisibleForCommand(commandId: string): Promise<void> {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`[data-command="${commandId}"]`)) return;
  const tabId = getRibbonTabIdForCommand(commandId);
  if (!tabId) return;
  const tabTrigger = document.querySelector<HTMLElement>(`button[data-ribbon-tab="${tabId}"]`);
  tabTrigger?.click();
  await nextTick();
  await new Promise<void>((r) => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  });
}

function buildOpenHierarchicalTabStep(tabId: string, commandId: string): GuideStep {
  const label = tabLabel(tabId);
  return {
    id: `hierarchical-open-${tabId}-before-${commandId.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    targetSelector: `button[data-ribbon-tab="${tabId}"]`,
    title: `展开「${label}」菜单`,
    description: `请先点击顶部「${label}」展开下拉菜单，下一步将在子菜单中选择具体按钮。`,
    placement: 'bottom',
    actionHint: `在顶部菜单栏找到「${label}」并单击；展开后再进入下一步。`,
  };
}

function chainOnBeforeShow(
  step: GuideStep,
  before: () => Promise<void> | void,
): GuideStep {
  const prev = step.onBeforeShow;
  return {
    ...step,
    onBeforeShow: async () => {
      await before();
      await prev?.();
    },
  };
}

/** 分层菜单：凡指向 data-command 的步骤前插入「展开顶层菜单」一步，并在展示时尝试自动展开下拉 */
export function withHierarchicalMenuCommandSteps(steps: GuideStep[], menuMode: MenuMode): GuideStep[] {
  if (menuMode !== 'hierarchical') return steps;

  const out: GuideStep[] = [];

  for (const step of steps) {
    if (step.menuMode === 'ribbon') {
      out.push(step);
      continue;
    }

    const commandId = extractDataCommandFromSelector(step.targetSelector);
    if (!commandId) {
      out.push(step);
      continue;
    }

    const tabId = getRibbonTabIdForCommand(commandId);
    if (!tabId) {
      out.push(step);
      continue;
    }

    out.push(buildOpenHierarchicalTabStep(tabId, commandId));
    out.push(
      chainOnBeforeShow(step, () => ensureHierarchicalDropdownVisibleForCommand(commandId)),
    );
  }

  return out;
}

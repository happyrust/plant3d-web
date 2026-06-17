import { describe, expect, it } from 'vitest';

import { RIBBON_TABS } from './ribbonConfig';

import type { RibbonButtonItem, RibbonItem } from './ribbonTypes';

function flattenItems(items: RibbonItem[]): RibbonButtonItem[] {
  const buttons: RibbonButtonItem[] = [];
  for (const item of items) {
    if (item.kind === 'button') {
      buttons.push(item);
    } else if (item.kind === 'stack') {
      buttons.push(...flattenItems(item.items));
    }
  }
  return buttons;
}

describe('MBD ribbon config', () => {
  it('provides flow direction display command', () => {
    const mbdTab = RIBBON_TABS.find((tab) => tab.id === 'mbd');
    const displayGroup = mbdTab?.groups.find((group) => group.id === 'mbd.display');
    const buttons = flattenItems(displayGroup?.items ?? []);
    const flowButton = buttons.find((button) => button.id === 'mbd.flow_direction');

    expect(flowButton).toMatchObject({
      id: 'mbd.flow_direction',
      commandId: 'mbd.flow_direction',
      label: '流向',
      icon: 'trending_up',
    });
  });
});

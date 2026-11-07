/** dbnum 只用于内部数据路由，不在模型树行中展示。 */
import { describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { FlatRow } from '@/composables/useModelTree';

async function mountRow(row: FlatRow, extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelTreeRow, { row, index: 0, expanded: false, selected: false, checkState: 'checked', ...extra });
  app.mount(host);
  await nextTick();
  return { host, unmount: () => { app.unmount(); host.remove(); } };
}

const SITE_V1: FlatRow = { id: '9304_2', name: '/1RS-CIVI', type: 'SITE', depth: 1, hasChildren: true, dbnum: 1112 };
const SITE_LEGACY: FlatRow = { id: '9304_2', name: '/1RS-CIVI', type: 'SITE', depth: 1, hasChildren: true };

describe('ModelTreeRow dbnum 隐藏', () => {
  it('v1 行即使带 dbnum 也不渲染库号', async () => {
    const { host, unmount } = await mountRow(SITE_V1);
    try {
      expect(host.querySelector('[data-testid="model-tree-dbnum-badge"]')).toBeNull();
      expect(host.textContent).not.toContain('1112');
    } finally {
      unmount();
    }
  });

  it('legacy 行与幽灵节点同样不渲染 dbnum', async () => {
    const legacy = await mountRow(SITE_LEGACY);
    try {
      expect(legacy.host.querySelector('[data-testid="model-tree-dbnum-badge"]')).toBeNull();
    } finally {
      legacy.unmount();
    }
    const ghost = await mountRow(SITE_V1, { ghost: true });
    try {
      expect(ghost.host.querySelector('[data-testid="model-tree-dbnum-badge"]')).toBeNull();
    } finally {
      ghost.unmount();
    }
  });
});

describe('ModelTreeRow 分组行（GPWL / GPSET）', () => {
  it('分组节点用分组图标、坏槽显示「N 个成员不可解析」；引用行带「引用」角标，悬停说明经由的 GPITEM', async () => {
    const group = await mountRow({ id: '2013286748_11', name: '/HVAC', type: 'GPSET', depth: 2, hasChildren: true, unresolvedCount: 2 });
    try {
      expect(group.host.querySelector('[data-testid="model-tree-group-icon"]')).not.toBeNull();
      expect(group.host.querySelector('[data-testid="model-tree-unresolved-badge"]')?.textContent).toContain('2 个成员不可解析');
      expect(group.host.querySelector('[data-testid="model-tree-secondary-badge"]')).toBeNull();
    } finally {
      group.unmount();
    }
    const member = await mountRow({ id: '17496_8518', name: '/1RS-WF05', type: 'ZONE', depth: 3, hasChildren: true, secondary: true, via: '2013286748_12' });
    try {
      const badge = member.host.querySelector<HTMLElement>('[data-testid="model-tree-secondary-badge"]');
      expect(badge?.textContent).toContain('引用');
      expect(badge?.title).toContain('2013286748/12');
      expect(member.host.querySelector('[data-testid="model-tree-group-icon"]')).toBeNull();
      expect(member.host.querySelector('[data-testid="model-tree-unresolved-badge"]')).toBeNull();
    } finally {
      member.unmount();
    }
  });

  it('老 gen-model 没认解析视图时 GPSET 行提示「后端未支持分组解析」（是提示不是错误）；认了的不提示', async () => {
    const stored = await mountRow({ id: '2013286748_11', name: '/HVAC', type: 'GPSET', depth: 2, hasChildren: true, groupViewUnsupported: true });
    try {
      const badge = stored.host.querySelector<HTMLElement>('[data-testid="model-tree-group-view-unsupported-badge"]');
      expect(badge?.textContent).toContain('后端未支持分组解析');
      expect(badge?.title).toContain('GPITEM');
    } finally {
      stored.unmount();
    }
    const resolved = await mountRow({ id: '2013286748_11', name: '/HVAC', type: 'GPSET', depth: 2, hasChildren: true });
    try {
      expect(resolved.host.querySelector('[data-testid="model-tree-group-view-unsupported-badge"]')).toBeNull();
    } finally {
      resolved.unmount();
    }
  });
});

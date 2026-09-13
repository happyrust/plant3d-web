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

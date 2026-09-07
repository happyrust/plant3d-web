/**
 * plan 2026-09-06 P2-4：树行尾的 dbnum 小徽标——只有 gen-model-v1 的行带 `dbnum`，legacy 的行没有这一格、DOM 不变。
 */
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

describe('ModelTreeRow dbnum 徽标', () => {
  it('v1 行带 dbnum：行尾画出小徽标，悬停说明所属库', async () => {
    const { host, unmount } = await mountRow(SITE_V1);
    try {
      const badge = host.querySelector('[data-testid="model-tree-dbnum-badge"]');
      expect(badge).not.toBeNull();
      expect(badge!.textContent?.trim()).toBe('1112');
      expect(badge!.getAttribute('title')).toBe('所属库 dbnum 1112');
      // 徽标在眼睛按钮之前（行尾）
      const eye = host.querySelector('[data-testid="model-tree-row"] button:last-of-type');
      expect(eye).not.toBeNull();
      expect(badge!.compareDocumentPosition(eye!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('legacy 行没有 dbnum：不渲染徽标；幽灵（已删除）节点也不画', async () => {
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

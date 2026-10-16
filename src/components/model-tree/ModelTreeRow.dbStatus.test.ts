/** 库边界行行尾的「模型生成状态」圆点：非边界行 / 幽灵行不画，也不占探测。 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { FlatRow } from '@/composables/useModelTree';

const acquireMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const refreshMock = vi.hoisted(() => vi.fn());
const viewMock = vi.hoisted(() => vi.fn((): { kind: string; title: string } => ({ kind: 'current', title: 'DB 7997 · 模型已生成且为最新' })));

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: viewMock,
    acquire: acquireMock,
    refresh: refreshMock,
    invalidate: vi.fn(),
    scheduleReprobe: vi.fn(),
    noteGenerated: vi.fn(),
    reconcile: vi.fn(),
  }),
}));

async function mountRow(row: FlatRow, extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelTreeRow, { row, index: 0, expanded: false, selected: false, checkState: 'checked', ...extra });
  app.mount(host);
  await nextTick();
  return { host, unmount: () => { app.unmount(); host.remove(); } };
}

const SITE_BOUNDARY: FlatRow = { id: '24383_42520', name: '/SITE-A', type: 'SITE', depth: 1, hasChildren: true, dbnum: 7997, dbBoundary: true };
const ZONE_INSIDE: FlatRow = { id: '17496_8518', name: '/1RS-WF05', type: 'ZONE', depth: 2, hasChildren: true, dbnum: 1112 };

describe('ModelTreeRow 库状态圆点', () => {
  it('库边界行画状态圆点、挂探测、带 tooltip；点击重查', async () => {
    viewMock.mockReturnValue({ kind: 'current', title: 'DB 7997 · 模型已生成且为最新' });
    const { host, unmount } = await mountRow(SITE_BOUNDARY);
    try {
      const dot = host.querySelector('[data-testid="model-tree-db-status"]');
      expect(dot).not.toBeNull();
      expect(dot?.getAttribute('data-db-status')).toBe('current');
      expect(dot?.getAttribute('title')).toContain('DB 7997');
      expect(acquireMock).toHaveBeenCalledWith(7997);
      (dot as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(refreshMock).toHaveBeenCalledWith(7997);
    } finally {
      unmount();
    }
  });

  it.each(['empty', 'stale', 'probing', 'unknown'] as const)('状态 %s 落到 data-db-status', async (kind) => {
    viewMock.mockReturnValue({ kind, title: `DB 7997 · ${kind}` });
    const { host, unmount } = await mountRow(SITE_BOUNDARY);
    try {
      expect(host.querySelector('[data-testid="model-tree-db-status"]')?.getAttribute('data-db-status')).toBe(kind);
    } finally {
      unmount();
    }
  });

  it('非边界行（库内深处节点）不画圆点、不占探测；幽灵行同样不画', async () => {
    acquireMock.mockClear();
    const inside = await mountRow(ZONE_INSIDE);
    try {
      expect(inside.host.querySelector('[data-testid="model-tree-db-status"]')).toBeNull();
    } finally {
      inside.unmount();
    }
    const ghost = await mountRow(SITE_BOUNDARY, { ghost: true });
    try {
      expect(ghost.host.querySelector('[data-testid="model-tree-db-status"]')).toBeNull();
    } finally {
      ghost.unmount();
    }
    expect(acquireMock).not.toHaveBeenCalled();
  });
});

/** 行尾的 RVM 核对状态图标：有结论才画，颜色按结论，点击把 refno 交出去。 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { RvmNodeStatus } from '@/components/rvm-check/rvmCheckFormat';
import type { FlatRow } from '@/composables/useModelTree';

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: vi.fn(() => null),
    acquire: vi.fn(() => vi.fn()),
    refresh: vi.fn(),
  }),
}));

const SITE: FlatRow = { id: '24383_42520', refno: '24383_42520', name: '/SITE-A', type: 'SITE', depth: 1, hasChildren: true };

function status(verdict: RvmNodeStatus['verdict']): RvmNodeStatus {
  return {
    refno: '24383_42520',
    verdict,
    taskId: 'rvm-check-1',
    at: '2026-11-04T08:00:00Z',
    sesno: 812,
    message: '9 件都对上了',
    name: '/SITE-A',
    stage: 'compare',
    reasons: '',
  };
}

async function mountRow(extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onRvmStatus = vi.fn();
  const app = createApp({
    render: () => h(ModelTreeRow, {
      row: SITE, index: 0, expanded: false, selected: false, checkState: 'checked', onRvmStatus, ...extra,
    }),
  });
  app.mount(host);
  await nextTick();
  return { host, onRvmStatus, unmount: () => { app.unmount(); host.remove(); } };
}

describe('ModelTreeRow RVM 核对图标', () => {
  it.each(['pass', 'kind_differ', 'fail', 'empty', 'tool_error', 'external', 'running', 'queued'] as const)('结论 %s 落到 data-rvm-status', async (verdict) => {
    const { host, unmount } = await mountRow({ rvmStatus: status(verdict) });
    try {
      const icon = host.querySelector('[data-testid="model-tree-rvm-status"]');
      expect(icon?.getAttribute('data-rvm-status')).toBe(verdict);
      expect(icon?.querySelector('svg')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('通过是绿色，悬停写结论、会话号', async () => {
    const { host, unmount } = await mountRow({ rvmStatus: status('pass') });
    try {
      const icon = host.querySelector('[data-testid="model-tree-rvm-status"]');
      expect(icon?.querySelector('svg')?.getAttribute('class')).toContain('text-emerald-600');
      expect(icon?.getAttribute('title')).toContain('RVM 核对：通过');
      expect(icon?.getAttribute('title')).toContain('会话 812');
    } finally {
      unmount();
    }
  });

  it('无可比内容是灰色，非几何问题是蓝灰色并写主要原因', async () => {
    const empty = await mountRow({ rvmStatus: status('empty') });
    try {
      const icon = empty.host.querySelector('[data-testid="model-tree-rvm-status"]');
      expect(icon?.querySelector('svg')?.getAttribute('class')).toContain('text-zinc-400');
      expect(icon?.getAttribute('title')).toContain('RVM 核对：无可比内容');
    } finally {
      empty.unmount();
    }
    const external = await mountRow({ rvmStatus: { ...status('external'), reasons: '命名没配上 156' } });
    try {
      const icon = external.host.querySelector('[data-testid="model-tree-rvm-status"]');
      expect(icon?.querySelector('svg')?.getAttribute('class')).toContain('text-slate-500');
      expect(icon?.getAttribute('title')).toContain('主要原因：命名没配上 156');
    } finally {
      external.unmount();
    }
  });

  it('没核对过、幽灵行都不画', async () => {
    const plain = await mountRow();
    try {
      expect(plain.host.querySelector('[data-testid="model-tree-rvm-status"]')).toBeNull();
    } finally {
      plain.unmount();
    }
    const ghost = await mountRow({ rvmStatus: status('fail'), ghost: true });
    try {
      expect(ghost.host.querySelector('[data-testid="model-tree-rvm-status"]')).toBeNull();
    } finally {
      ghost.unmount();
    }
  });

  it('点击交出 refno', async () => {
    const { host, onRvmStatus, unmount } = await mountRow({ rvmStatus: status('fail') });
    try {
      (host.querySelector('[data-testid="model-tree-rvm-status"]') as HTMLElement).click();
      expect(onRvmStatus).toHaveBeenCalledWith('24383_42520');
    } finally {
      unmount();
    }
  });
});

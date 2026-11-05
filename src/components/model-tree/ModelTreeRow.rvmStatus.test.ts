/** 行尾合并状态图标的 RVM 一侧：颜色按结论，实心 / 空心 / 角标按生成状态，点击把 refno 交出去。 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { RvmNodeStatus } from '@/components/rvm-check/rvmCheckFormat';
import type { FlatRow } from '@/composables/useModelTree';

const viewMock = vi.hoisted(() => vi.fn((): { kind: string; title: string } | null => null));
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: viewMock,
    acquire: vi.fn(() => vi.fn()),
    refresh: refreshMock,
  }),
}));

const SITE: FlatRow = { id: '24383_42520', refno: '24383_42520', name: '/SITE-A', type: 'SITE', depth: 1, hasChildren: true };
const SITE_DB: FlatRow = { ...SITE, dbnum: 7997, dbBoundary: true };

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
      const icon = host.querySelector('[data-testid="model-tree-status"]');
      expect(icon?.getAttribute('data-rvm-status')).toBe(verdict);
      expect(icon?.querySelector('svg')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('通过是绿色，悬停写结论、会话号', async () => {
    const { host, unmount } = await mountRow({ rvmStatus: status('pass') });
    try {
      const icon = host.querySelector('[data-testid="model-tree-status"]');
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
      const icon = empty.host.querySelector('[data-testid="model-tree-status"]');
      expect(icon?.querySelector('svg')?.getAttribute('class')).toContain('text-zinc-400');
      expect(icon?.getAttribute('title')).toContain('RVM 核对：无可比内容');
    } finally {
      empty.unmount();
    }
    const external = await mountRow({ rvmStatus: { ...status('external'), reasons: '命名没配上 156' } });
    try {
      const icon = external.host.querySelector('[data-testid="model-tree-status"]');
      expect(icon?.querySelector('svg')?.getAttribute('class')).toContain('text-slate-500');
      expect(icon?.getAttribute('title')).toContain('主要原因：命名没配上 156');
    } finally {
      external.unmount();
    }
  });

  it('没核对过、幽灵行都不画', async () => {
    const plain = await mountRow();
    try {
      expect(plain.host.querySelector('[data-testid="model-tree-status"]')).toBeNull();
    } finally {
      plain.unmount();
    }
    const ghost = await mountRow({ rvmStatus: status('fail'), ghost: true });
    try {
      expect(ghost.host.querySelector('[data-testid="model-tree-status"]')).toBeNull();
    } finally {
      ghost.unmount();
    }
  });

  it('点击交出 refno，不去重查生成状态', async () => {
    viewMock.mockReturnValue({ kind: 'current', title: 'DB 7997 · 模型已生成且为最新' });
    refreshMock.mockClear();
    const { host, onRvmStatus, unmount } = await mountRow({ row: SITE_DB, rvmStatus: status('fail') });
    try {
      (host.querySelector('[data-testid="model-tree-status"]') as HTMLElement).click();
      expect(onRvmStatus).toHaveBeenCalledWith('24383_42520');
      expect(refreshMock).not.toHaveBeenCalled();
    } finally {
      unmount();
      viewMock.mockReturnValue(null);
    }
  });

  it('同一个图标里叠生成状态：最新实心、滞后带角标、无模型空心、未知变淡', async () => {
    const cases = [
      { kind: 'current', fill: 'solid', stale: false },
      { kind: 'stale', fill: 'solid', stale: true },
      { kind: 'empty', fill: 'outline', stale: false },
      { kind: 'unknown', fill: 'outline', stale: false },
    ] as const;
    try {
      for (const c of cases) {
        viewMock.mockReturnValue({ kind: c.kind, title: `DB 7997 · ${c.kind}` });
        const { host, unmount } = await mountRow({ row: SITE_DB, rvmStatus: status('pass') });
        try {
          const buttons = host.querySelectorAll('[data-testid="model-tree-status"]');
          expect(buttons).toHaveLength(1);
          const button = buttons[0]!;
          expect(button.getAttribute('data-rvm-status')).toBe('pass');
          expect(button.getAttribute('data-db-status')).toBe(c.kind);
          expect(button.querySelector('[data-testid="model-tree-status-icon"]')?.getAttribute('data-fill')).toBe(c.fill);
          expect(!!button.querySelector('[data-testid="model-tree-status-stale"]')).toBe(c.stale);
          expect(button.getAttribute('title')).toContain('RVM 核对：通过');
          expect(button.getAttribute('title')).toContain(`DB 7997 · ${c.kind}`);
          if (c.fill === 'solid') expect(button.querySelector('.bg-emerald-600')).not.toBeNull();
          if (c.kind === 'unknown') expect(button.querySelector('svg')?.getAttribute('class')).toContain('opacity-60');
        } finally {
          unmount();
        }
      }
    } finally {
      viewMock.mockReturnValue(null);
    }
  });

  it('核对进行中只画转圈，不叠生成状态', async () => {
    viewMock.mockReturnValue({ kind: 'current', title: 'DB 7997 · 模型已生成且为最新' });
    const { host, unmount } = await mountRow({ row: SITE_DB, rvmStatus: status('running') });
    try {
      const icon = host.querySelector('[data-testid="model-tree-status-icon"]');
      expect(icon?.getAttribute('data-fill')).toBeNull();
      expect(icon?.querySelector('.animate-spin')).not.toBeNull();
    } finally {
      unmount();
      viewMock.mockReturnValue(null);
    }
  });
});

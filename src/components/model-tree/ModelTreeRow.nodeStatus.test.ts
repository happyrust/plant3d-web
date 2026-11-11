/** 行尾的节点一级状态（方案 2026-11-10 C2）：已加载的 SITE / ZONE 行画它自己的新旧，并给「更新」「重载」。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { FlatRow } from '@/composables/useModelTree';

type NodeView = { verdict: string | null; iconKind: string | null; title: string; action: 'update' | 'reload' | null; checking: boolean };

const dbViewMock = vi.hoisted(() => vi.fn((): { kind: string; title: string } => ({ kind: 'file_ahead', title: 'DB 1112 · 库有 10 个新会话未更新' })));
const dbRefreshMock = vi.hoisted(() => vi.fn());
const nodeViewMock = vi.hoisted(() => vi.fn((_refno: string): NodeView | null => null));
const nodeRecheckMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: dbViewMock, acquire: vi.fn(() => vi.fn()), refresh: dbRefreshMock,
    invalidate: vi.fn(), scheduleReprobe: vi.fn(), noteGenerated: vi.fn(), reconcile: vi.fn(),
  }),
}));
vi.mock('@/composables/useLoadedNodeStatus', () => ({
  useLoadedNodeStatus: () => ({ view: nodeViewMock, recheck: nodeRecheckMock }),
}));

async function mountRow(row: FlatRow, extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onNodeAction = vi.fn();
  const app = createApp(ModelTreeRow, {
    row, index: 0, expanded: false, selected: false, checkState: 'checked', onNodeAction, ...extra,
  });
  app.mount(host);
  await nextTick();
  const status = () => host.querySelector('[data-testid="model-tree-status"]');
  const action = () => host.querySelector('[data-testid="model-tree-node-action"]') as HTMLElement | null;
  return { host, status, action, onNodeAction, unmount: () => { app.unmount(); host.remove(); } };
}

const SITE: FlatRow = { id: '9304_2', name: '/1RS-CIVI', type: 'SITE', depth: 1, hasChildren: true, dbnum: 1112, dbBoundary: true };
const ZONE: FlatRow = { id: '17496_8516', name: '/1RS-WF03', type: 'ZONE', depth: 2, hasChildren: true, dbnum: 1112 };

const LATEST: NodeView = {
  verdict: 'latest', iconKind: 'current', action: null, checking: false,
  title: '本节点：最新（库有 10 个新会话，未涉及本节点）\n模型按会话 738 生成；库文件最新 748',
};
const LAGGING: NodeView = { verdict: 'lagging', iconKind: 'stale', action: 'update', checking: false, title: '本节点：落后：会话 742（3 个单元）改到了本节点' };
const RELOADABLE: NodeView = { verdict: 'reloadable', iconKind: 'reloadable', action: 'reload', checking: false, title: '本节点：有更新可重载：会话 742（2 个单元）改到了本节点' };

beforeEach(() => {
  vi.clearAllMocks();
  nodeViewMock.mockReturnValue(null);
});

describe('ModelTreeRow 节点一级状态', () => {
  it('已加载的 SITE 行：图标按节点自己的结论画（库有新会话但没涉及它 → 绿），提示先写节点、再写库', async () => {
    nodeViewMock.mockReturnValue(LATEST);
    const { status, action, unmount } = await mountRow(SITE);
    try {
      expect(nodeViewMock).toHaveBeenCalledWith('9304_2');
      expect(status()?.getAttribute('data-node-status')).toBe('latest');
      expect(status()?.getAttribute('data-db-status')).toBe('file_ahead');
      expect(status()?.querySelector('svg')?.getAttribute('class')).toContain('fill-success');
      expect((status()?.getAttribute('title') ?? '').split('\n')).toEqual([
        '本节点：最新（库有 10 个新会话，未涉及本节点）',
        '模型按会话 738 生成；库文件最新 748',
        'DB 1112 · 库有 10 个新会话未更新',
        '点击重查',
      ]);
      expect(action()).toBeNull();
    } finally {
      unmount();
    }
  });

  it('库内的 ZONE 行平时不画状态；装过之后画它自己的', async () => {
    const plain = await mountRow(ZONE);
    try {
      expect(plain.status()).toBeNull();
    } finally {
      plain.unmount();
    }
    nodeViewMock.mockReturnValue(LATEST);
    const loaded = await mountRow(ZONE);
    try {
      expect(loaded.status()?.getAttribute('data-node-status')).toBe('latest');
      expect(loaded.status()?.getAttribute('title')).toContain('DB 1112');
    } finally {
      loaded.unmount();
    }
  });

  it('落后：琥珀色，行上给「更新」，点了交出 node-action(update)', async () => {
    nodeViewMock.mockReturnValue(LAGGING);
    const { status, action, onNodeAction, unmount } = await mountRow(ZONE);
    try {
      expect(status()?.querySelector('svg')?.getAttribute('class')).toContain('fill-warning');
      expect(action()?.textContent?.trim()).toBe('更新');
      expect(action()?.getAttribute('data-action')).toBe('update');
      action()!.click();
      expect(onNodeAction).toHaveBeenCalledWith('17496_8516', 'update');
    } finally {
      unmount();
    }
  });

  it('这个库的「更新到最新」在排队 / 在跑：按钮写「更新中」并禁用，提示里是进度；没成时按钮恢复、提示里留着原因', async () => {
    const state = await import('@/composables/updateToLatestState');
    state.__resetUpdateToLatestStateForTests();
    nodeViewMock.mockReturnValue(LAGGING);
    state.setUpdateToLatestState(1112, { phase: 'running', message: '模型生成 3/10', taskIds: ['batch-1'] });
    const busy = await mountRow(ZONE);
    try {
      expect(busy.action()?.textContent?.trim()).toBe('更新中');
      expect((busy.action() as HTMLButtonElement).disabled).toBe(true);
      expect(busy.action()?.getAttribute('data-busy')).toBe('true');
      expect(busy.action()?.getAttribute('title')).toContain('库 1112 更新到最新：模型生成 3/10');
    } finally {
      busy.unmount();
    }

    state.setUpdateToLatestState(1112, { phase: 'rejected', message: '后端没有受理：库不在更新范围里' });
    const rejected = await mountRow(ZONE);
    try {
      expect(rejected.action()?.textContent?.trim()).toBe('更新');
      expect((rejected.action() as HTMLButtonElement).disabled).toBe(false);
      expect(rejected.action()?.getAttribute('title')).toContain('上一次更新到最新：后端没有受理：库不在更新范围里');
    } finally {
      rejected.unmount();
      state.__resetUpdateToLatestStateForTests();
    }
  });

  it('节点状态正在重查（库的水位刚变）：动作按钮先禁用，免得按着旧结论再点一次', async () => {
    nodeViewMock.mockReturnValue({ ...LAGGING, checking: true });
    const { action, unmount } = await mountRow(ZONE);
    try {
      expect(action()?.textContent?.trim()).toBe('更新');
      expect((action() as HTMLButtonElement).disabled).toBe(true);
    } finally {
      unmount();
    }
  });

  it('有更新可重载：蓝色刷新图标，行上给「重载」，点了交出 node-action(reload)', async () => {
    nodeViewMock.mockReturnValue(RELOADABLE);
    const { status, action, onNodeAction, unmount } = await mountRow(SITE);
    try {
      expect(status()?.getAttribute('data-node-status')).toBe('reloadable');
      expect(status()?.querySelector('[data-testid="model-tree-status-reloadable-icon"]')).not.toBeNull();
      expect(action()?.textContent?.trim()).toBe('重载');
      action()!.click();
      expect(onNodeAction).toHaveBeenCalledWith('9304_2', 'reload');
    } finally {
      unmount();
    }
  });

  it.each([
    ['核对中', { verdict: null, iconKind: null, action: null, checking: true, title: '本节点：正在核对新旧…' }, 'checking'],
    ['未知', { verdict: 'unknown', iconKind: null, action: null, checking: false, title: '本节点：新旧未知（timeout）' }, 'unknown'],
    ['未跟踪', { verdict: 'untracked', iconKind: null, action: null, checking: false, title: '本节点：库未初始化：模型按需生成，暂不跟踪新旧' }, 'untracked'],
  ] as const)('%s：说不出结论时图标沿用库一级的圆点，提示里照写', async (_name, view, attr) => {
    nodeViewMock.mockReturnValue(view as NodeView);
    const { status, action, unmount } = await mountRow(SITE);
    try {
      expect(status()?.getAttribute('data-node-status')).toBe(attr);
      // 库一级是 file_ahead：蓝色实心圆
      expect(status()?.querySelector('svg')?.getAttribute('class')).toContain('fill-sky-500');
      expect(status()?.getAttribute('title')).toContain(view.title);
      expect(action()).toBeNull();
    } finally {
      unmount();
    }
  });

  it('没核对过 RVM 时点图标：重问这个节点（不是只重查库）', async () => {
    nodeViewMock.mockReturnValue(LATEST);
    const { status, unmount } = await mountRow(SITE);
    try {
      (status() as HTMLElement).click();
      expect(nodeRecheckMock).toHaveBeenCalledWith('9304_2');
      expect(dbRefreshMock).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('核对过 RVM 的行：结论照画，节点状态叠成角标（落后琥珀、可重载蓝），提示三段都在', async () => {
    const rvmStatus = { refno: '9304_2', verdict: 'pass', taskId: 't', at: null, sesno: null, message: '', name: null, stage: null, reasons: '' };
    nodeViewMock.mockReturnValue(RELOADABLE);
    const reloadable = await mountRow(SITE, { rvmStatus });
    try {
      expect(reloadable.status()?.querySelector('[data-testid="model-tree-status-reloadable"]')).not.toBeNull();
      expect(reloadable.status()?.querySelector('[data-testid="model-tree-status-icon"]')?.getAttribute('data-fill')).toBe('solid');
      const title = reloadable.status()?.getAttribute('title') ?? '';
      expect(title).toContain('RVM 核对：通过');
      expect(title).toContain('本节点：有更新可重载');
      expect(title).toContain('DB 1112');
    } finally {
      reloadable.unmount();
    }
    nodeViewMock.mockReturnValue(LAGGING);
    const lagging = await mountRow(SITE, { rvmStatus });
    try {
      expect(lagging.status()?.querySelector('[data-testid="model-tree-status-stale"]')).not.toBeNull();
    } finally {
      lagging.unmount();
    }
  });

  it('幽灵行不问节点状态', async () => {
    nodeViewMock.mockReturnValue(LAGGING);
    const { status, action, unmount } = await mountRow(SITE, { ghost: true });
    try {
      expect(status()).toBeNull();
      expect(action()).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('ModelTreeRow 行上的「生成」（方案 2026-11-10 B3：节点下还有没有模型的部分）', () => {
  const fillButton = (host: HTMLElement) => host.querySelector('[data-testid="model-tree-node-fill"]') as HTMLButtonElement | null;

  it('没有待补齐的部分：不出按钮', async () => {
    const state = await import('@/composables/generationFillState');
    state.__resetGenerationFillStateForTests();
    const { host, unmount } = await mountRow(SITE);
    try {
      expect(fillButton(host)).toBeNull();
    } finally {
      unmount();
    }
  });

  it('上次选了「只显示已有的」：行上有「生成」，提示写明还有多少；点了交出 node-action(generate)；和「重载」可以同时在', async () => {
    const state = await import('@/composables/generationFillState');
    state.__resetGenerationFillStateForTests();
    state.notePendingGenerationFill({ root: '9304_2', dbnum: 1112, chunks: 2, units: 27, exact: false, reason: 'declined' });
    nodeViewMock.mockReturnValue(RELOADABLE);
    const { host, action, onNodeAction, unmount } = await mountRow(SITE);
    try {
      const button = fillButton(host)!;
      expect(button.textContent?.trim()).toBe('生成');
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('title')).toContain('还有约 27 个单元没有模型（分在 2 块里），上次选了先不生成');
      button.click();
      expect(onNodeAction).toHaveBeenCalledWith('9304_2', 'generate');
      expect(action()?.textContent?.trim()).toBe('重载');
    } finally {
      unmount();
      state.__resetGenerationFillStateForTests();
    }
  });

  it('正在补齐：按钮写「生成中」并禁用；补齐完按钮消失', async () => {
    const state = await import('@/composables/generationFillState');
    state.__resetGenerationFillStateForTests();
    state.notePendingGenerationFill({ root: '9304_2', dbnum: 1112, chunks: 1, units: 8, exact: false, reason: 'pending' });
    const session = state.beginGenerationFill('9304_2');
    const { host, unmount } = await mountRow(SITE);
    try {
      expect(fillButton(host)?.textContent?.trim()).toBe('生成中');
      expect(fillButton(host)?.disabled).toBe(true);
      expect(fillButton(host)?.getAttribute('data-busy')).toBe('true');
      session.end();
      state.clearPendingGenerationFill('9304_2');
      await nextTick();
      expect(fillButton(host)).toBeNull();
    } finally {
      unmount();
      state.__resetGenerationFillStateForTests();
    }
  });

  it('幽灵行不出「生成」', async () => {
    const state = await import('@/composables/generationFillState');
    state.__resetGenerationFillStateForTests();
    state.notePendingGenerationFill({ root: '9304_2', dbnum: 1112, chunks: 1, units: 8, exact: false, reason: 'pending' });
    const { host, unmount } = await mountRow(SITE, { ghost: true });
    try {
      expect(fillButton(host)).toBeNull();
    } finally {
      unmount();
      state.__resetGenerationFillStateForTests();
    }
  });
});

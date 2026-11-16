/**
 * 行尾的转圈点一下 = 停（加载中可以停，用户 2026-11-11 定）：这个节点的加载能停时，转圈中间有一个小方块、按钮可点，
 * 点了交出 `stop-loading`；不能停（重新生成、别的处理中）时照旧是禁用的转圈。
 * 还在排队、没轮到的（#166）一律能停：点了就是取消。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelTreeRow from './ModelTreeRow.vue';

import type { FlatRow } from '@/composables/useModelTree';

import { __resetModelLoadSessionsForTests, beginModelLoadSession, requestStopModelLoad } from '@/composables/modelLoadSession';

vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: vi.fn(() => null), acquire: vi.fn(() => vi.fn()), refresh: vi.fn(),
    invalidate: vi.fn(), scheduleReprobe: vi.fn(), noteGenerated: vi.fn(), reconcile: vi.fn(),
  }),
}));
vi.mock('@/composables/useLoadedNodeStatus', () => ({
  useLoadedNodeStatus: () => ({ view: vi.fn(() => null), recheck: vi.fn() }),
}));

const SITE: FlatRow = { id: '24383_80211', name: '/7999-SITE', type: 'SITE', depth: 1, hasChildren: true, dbnum: 7999 };

async function mountRow(extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onStopLoading = vi.fn();
  const onToggleVisible = vi.fn();
  const app = createApp(ModelTreeRow, {
    row: SITE, index: 0, expanded: false, selected: false, checkState: 'unchecked', onStopLoading, onToggleVisible, ...extra,
  });
  app.mount(host);
  await nextTick();
  const eye = () => host.querySelector('[data-testid="model-tree-eye"]') as HTMLButtonElement;
  const stopIcon = () => host.querySelector('[data-testid="model-tree-stop-icon"]');
  return { host, eye, stopIcon, onStopLoading, onToggleVisible, unmount: () => { app.unmount(); host.remove(); } };
}

beforeEach(() => {
  __resetModelLoadSessionsForTests();
});

describe('ModelTreeRow 行尾：加载中点一下停', () => {
  it('没有在加载：是眼睛，点了切换显示；它仍是这一行最后一个按钮', async () => {
    const { host, eye, stopIcon, onStopLoading, onToggleVisible, unmount } = await mountRow();
    try {
      expect(eye().disabled).toBe(false);
      expect(eye().getAttribute('data-loading')).toBeNull();
      expect(eye().getAttribute('title')).toBeNull();
      expect(stopIcon()).toBeNull();
      const buttons = host.querySelectorAll('button');
      expect(buttons[buttons.length - 1]).toBe(eye());
      eye().click();
      expect(onToggleVisible).toHaveBeenCalledWith('24383_80211', true);
      expect(onStopLoading).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('加载中、能停：转圈里有个小方块，按钮可点，提示写明停了会怎样；点了交出 stop-loading，不切换显示', async () => {
    const session = beginModelLoadSession('24383_80211');
    const { eye, stopIcon, onStopLoading, onToggleVisible, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(false);
      expect(eye().getAttribute('data-loading')).toBe('true');
      expect(eye().getAttribute('data-stoppable')).toBe('true');
      expect(eye().querySelector('.animate-spin')).not.toBeNull();
      expect(stopIcon()).not.toBeNull();
      expect(eye().getAttribute('title')).toContain('点一下停');
      expect(eye().getAttribute('title')).toContain('再点眼睛会更快');
      eye().click();
      expect(onStopLoading).toHaveBeenCalledWith('24383_80211');
      expect(onToggleVisible).not.toHaveBeenCalled();
    } finally {
      unmount();
      session.end();
    }
  });

  it('点了停之后：正在收，按钮不能再点', async () => {
    const session = beginModelLoadSession('24383_80211');
    const { eye, stopIcon, onStopLoading, unmount } = await mountRow({ loading: true });
    try {
      requestStopModelLoad('24383_80211');
      await nextTick();
      expect(eye().disabled).toBe(true);
      expect(eye().getAttribute('data-stoppable')).toBeNull();
      expect(stopIcon()).toBeNull();
      expect(eye().getAttribute('title')).toContain('正在停');
      eye().click();
      expect(onStopLoading).not.toHaveBeenCalled();
    } finally {
      unmount();
      session.end();
    }
  });

  it('加载中、不能停（重新生成）：照旧是禁用的转圈，提示说明不能停', async () => {
    const session = beginModelLoadSession('24383_80211', { stoppable: false });
    const { eye, stopIcon, onStopLoading, onToggleVisible, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(true);
      expect(eye().getAttribute('data-loading')).toBe('true');
      expect(stopIcon()).toBeNull();
      expect(eye().getAttribute('title')).toContain('不能停');
      eye().click();
      expect(onStopLoading).not.toHaveBeenCalled();
      expect(onToggleVisible).not.toHaveBeenCalled();
    } finally {
      unmount();
      session.end();
    }
  });

  it('行在转圈、但不是在显示这个节点（别的处理占着它）：禁用的转圈', async () => {
    const { eye, stopIcon, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(true);
      expect(stopIcon()).toBeNull();
    } finally {
      unmount();
    }
  });

  it('加载开始得比行晚（先转圈、后有加载会话）：会话一建立按钮就变成可点', async () => {
    const { eye, stopIcon, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(true);
      const session = beginModelLoadSession('24383/80211');
      await nextTick();
      expect(eye().disabled).toBe(false);
      expect(stopIcon()).not.toBeNull();
      session.end();
      await nextTick();
      expect(eye().disabled).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe('ModelTreeRow 行尾：还在排队的节点（#166）', () => {
  it('前面有别的节点在加载、这一行还没轮到：照样是可点的小方块，提示写明是排队、点了就取消；轮到之后换回「加载中」的提示', async () => {
    const ahead = beginModelLoadSession('17496_8516');
    ahead.waitTurn();
    const session = beginModelLoadSession('24383_80211');
    void session.waitTurn();
    const { eye, stopIcon, onStopLoading, onToggleVisible, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(false);
      expect(eye().getAttribute('data-stoppable')).toBe('true');
      expect(stopIcon()).not.toBeNull();
      expect(eye().getAttribute('title')).toContain('排队中');
      expect(eye().getAttribute('title')).toContain('点一下取消');
      eye().click();
      expect(onStopLoading).toHaveBeenCalledWith('24383_80211');
      expect(onToggleVisible).not.toHaveBeenCalled();

      ahead.end();
      await nextTick();
      expect(eye().disabled).toBe(false);
      expect(stopIcon()).not.toBeNull();
      expect(eye().getAttribute('title')).toContain('加载中，点一下停');
    } finally {
      unmount();
      session.end();
      ahead.end();
    }
  });

  it('重新生成也在排队：没轮到之前能取消（还什么都没发给后端）；轮到之后回到禁用的转圈', async () => {
    const ahead = beginModelLoadSession('17496_8516');
    ahead.waitTurn();
    const session = beginModelLoadSession('24383_80211', { stoppable: false });
    void session.waitTurn();
    const { eye, stopIcon, onStopLoading, unmount } = await mountRow({ loading: true });
    try {
      expect(eye().disabled).toBe(false);
      expect(stopIcon()).not.toBeNull();
      expect(eye().getAttribute('title')).toContain('排队中');

      ahead.end();
      await nextTick();
      expect(eye().disabled).toBe(true);
      expect(stopIcon()).toBeNull();
      expect(eye().getAttribute('title')).toContain('不能停');
      eye().click();
      expect(onStopLoading).not.toHaveBeenCalled();
    } finally {
      unmount();
      session.end();
      ahead.end();
    }
  });

  it('排队中点了取消、显示流程还没收完的那一下：按钮不能再点', async () => {
    const ahead = beginModelLoadSession('17496_8516');
    ahead.waitTurn();
    const session = beginModelLoadSession('24383_80211');
    void session.waitTurn();
    const { eye, stopIcon, onStopLoading, unmount } = await mountRow({ loading: true });
    try {
      requestStopModelLoad('24383_80211');
      await nextTick();
      expect(eye().disabled).toBe(true);
      expect(stopIcon()).toBeNull();
      expect(eye().getAttribute('title')).toContain('正在停');
      eye().click();
      expect(onStopLoading).not.toHaveBeenCalled();
    } finally {
      unmount();
      session.end();
      ahead.end();
    }
  });
});

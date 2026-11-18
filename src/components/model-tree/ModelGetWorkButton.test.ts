/**
 * 状态栏的「取最新」按钮：只管画。逻辑（`useModelGetWork`）换成假的，看按钮在各状态下的样子、点了做什么、
 * 属性面板的缓存是不是登记成了「取最新之后要重取」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

const h = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  withQueryClient: true,
  getLatest: vi.fn(async () => undefined),
  derived: [] as { name: string; run: (context: unknown) => unknown }[],
  unregistered: [] as string[],
  state: null as unknown as { running: boolean; queued: boolean; progress: string; last: Record<string, unknown> | null },
}));

vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => {
    if (!h.withQueryClient) throw new Error('vue-query 没有安装');
    return { invalidateQueries: h.invalidateQueries };
  },
}));

vi.mock('@/composables/useModelGetWork', async () => {
  const { reactive } = await import('vue');
  h.state = reactive({ running: false, queued: false, progress: '', last: null });
  return {
    useModelGetWork: () => ({ state: h.state, getLatest: h.getLatest }),
    registerGetWorkDerived: (handler: { name: string; run: (context: unknown) => unknown }) => {
      h.derived.push(handler);
      return () => {
        h.unregistered.push(handler.name);
      };
    },
  };
});

import ModelGetWorkButton from './ModelGetWorkButton.vue';

async function mountButton() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelGetWorkButton);
  app.mount(host);
  await nextTick();
  return {
    button: () => host.querySelector<HTMLButtonElement>('[data-testid="model-getwork-button"]')!,
    label: () => host.querySelector('[data-testid="model-getwork-label"]')?.textContent?.trim() ?? '',
    result: () => host.querySelector<HTMLElement>('[data-testid="model-getwork-result"]'),
    /** 这一组里从左到右画了什么 */
    order: () => [...host.querySelector('[data-testid="model-getwork"]')!.children].map((element) => (element as HTMLElement).dataset.testid),
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function report(patch: Record<string, unknown> = {}) {
  return {
    ok: true, level: 'success', finishedAt: new Date(2026, 10, 12, 10, 30, 5).getTime(),
    summary: '已取最新：模型树新增 1；模型重载 1 个节点（新增 2 个构件）。',
    detail: ['树上新增：/AIOS-INC-ADD', '重载 /AIOS-INC-SITE（24384_26547）：现有 9 个构件，新增 2'],
    ...patch,
  };
}

beforeEach(() => {
  h.invalidateQueries.mockClear();
  h.getLatest.mockClear();
  h.derived.length = 0;
  h.unregistered.length = 0;
  h.withQueryClient = true;
  Object.assign(h.state, { running: false, queued: false, progress: '', last: null });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('状态栏的「取最新」按钮', () => {
  it('平时：按钮上就是「取最新」，没有结果那一句；悬停说明讲清它做什么、不做什么', async () => {
    const view = await mountButton();
    try {
      expect(view.label()).toBe('取最新');
      expect(view.button().dataset.running).toBe('false');
      expect(view.result()).toBeNull();
      const title = view.button().getAttribute('title') ?? '';
      expect(title).toContain('把模型树和已装的三维模型同步到后台现在的状态');
      expect(title).toContain('不会让后端开工');
    } finally {
      view.unmount();
    }
  });

  it('点一下：叫一次取最新', async () => {
    const view = await mountButton();
    try {
      view.button().click();
      expect(h.getLatest).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  it('运行中：按钮上是这一轮正在做的事（没有进度文字时是「正在取最新…」），上一轮的结果先不画；再点会排下一轮', async () => {
    const view = await mountButton();
    try {
      Object.assign(h.state, { running: true, progress: '', last: report() });
      await nextTick();
      expect(view.label()).toBe('正在取最新…');
      expect(view.button().dataset.running).toBe('true');
      expect(view.result()).toBeNull();
      expect(view.button().getAttribute('title')).toContain('现在再点会排成下一轮');

      h.state.progress = '等后台把库 8000 更新完…（已等 6 秒，最多 45 秒）';
      h.state.queued = true;
      await nextTick();
      expect(view.label()).toBe('等后台把库 8000 更新完…（已等 6 秒，最多 45 秒）');
      expect(view.button().dataset.queued).toBe('true');
      expect(view.button().getAttribute('title')).toContain('这一轮完了会再跑一轮');

      // 运行中也点得动（排队由逻辑那一层管）
      view.button().click();
      expect(h.getLatest).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  it('做完：按钮回到「取最新」，左边常驻那一句（按钮留在最右端）；悬停是那一句加逐条细节和时刻', async () => {
    const view = await mountButton();
    try {
      expect(view.order()).toEqual(['model-getwork-button']);
      h.state.last = report();
      await nextTick();
      expect(view.label()).toBe('取最新');
      // 那一句画在按钮左边：按钮钉在状态栏最右端，底部正中的提示条盖不到它（盖住了就没法再点一次）
      expect(view.order()).toEqual(['model-getwork-result', 'model-getwork-button']);
      const result = view.result()!;
      expect(result.textContent?.trim()).toBe('已取最新：模型树新增 1；模型重载 1 个节点（新增 2 个构件）。');
      expect(result.dataset.level).toBe('success');
      expect(result.dataset.ok).toBe('true');
      const lines = (result.getAttribute('title') ?? '').split('\n');
      expect(lines[0]).toBe('已取最新：模型树新增 1；模型重载 1 个节点（新增 2 个构件）。');
      expect(lines.slice(1, 3)).toEqual(['· 树上新增：/AIOS-INC-ADD', '· 重载 /AIOS-INC-SITE（24384_26547）：现有 9 个构件，新增 2']);
      expect(lines.at(-1)).toMatch(/^（.*10.*30.*）$/);
    } finally {
      view.unmount();
    }
  });

  it('结果的轻重画成不同的颜色：没做成是红的、有没跟上的是黄的、没变化是淡的', async () => {
    const view = await mountButton();
    try {
      const classOf = async (patch: Record<string, unknown>) => {
        h.state.last = report(patch);
        await nextTick();
        return view.result()!.className;
      };
      expect(await classOf({ level: 'error', ok: false })).toContain('text-danger');
      expect(view.result()!.dataset.ok).toBe('false');
      expect(await classOf({ level: 'warning' })).toContain('text-warning');
      expect(await classOf({ level: 'success' })).toContain('text-foreground');
      expect(await classOf({ level: 'info' })).toContain('text-muted-foreground');
    } finally {
      view.unmount();
    }
  });

  it('属性面板的缓存登记成「取最新之后重取」；卸载时撤掉登记', async () => {
    const view = await mountButton();
    expect(h.derived.map((item) => item.name)).toEqual(['属性面板']);
    await h.derived[0]!.run({ changed: false });
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pdms', 'ui-attr'] });
    view.unmount();
    expect(h.unregistered).toEqual(['属性面板']);
  });

  it('没装 VueQueryPlugin 也能挂；那一步就省掉', async () => {
    h.withQueryClient = false;
    const view = await mountButton();
    try {
      await expect(Promise.resolve(h.derived[0]!.run({ changed: true }))).resolves.toBeUndefined();
      expect(h.invalidateQueries).not.toHaveBeenCalled();
      expect(view.label()).toBe('取最新');
    } finally {
      view.unmount();
    }
  });
});

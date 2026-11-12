/**
 * K10：底部状态栏的更新提示条（增量更新案例集合 K 组，gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。
 * 文案、重载按钮何时出现、点重载派发 showModelByRefnos 并让属性面板重拉、忽略；没装 VueQueryPlugin 也能挂。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

const h = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  withQueryClient: true,
}));

vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => {
    if (!h.withQueryClient) throw new Error('vue-query 没有安装');
    return { invalidateQueries: h.invalidateQueries };
  },
}));

vi.mock('@/composables/useGenModelV1Health', async () => {
  const { computed, reactive } = await import('vue');
  const state = reactive({
    status: 'ok',
    modelPhaseOpen: true,
    modelReady: true,
    verdict: { total: 1, inSync: 1, lagging: 0, notJudged: 0, laggingDbnums: [] as number[], error: null as string | null },
    namespace: null,
    version: null,
    startedAt: null,
    serviceGeneration: 0,
    dataFace: null,
    sulDbMedium: null,
    sulDbDurable: null,
    deliveryUnitTypes: [] as string[],
    initializationStatus: null,
    error: null,
    lastCheckedAt: null,
  });
  return {
    useGenModelV1Health: () => ({
      state,
      summary: computed(() => '已连接 gen-model :9199'),
      verdictText: computed(() => ''),
      start: vi.fn(),
      stop: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

vi.mock('@/composables/useGenModelV1TaskFeed', () => ({
  subscribeGenModelV1TaskEvents: vi.fn(() => () => undefined),
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1TaskChanges: vi.fn(async () => ({ items: [], next_cursor: null })),
}));

import GenModelV1HealthBadge from './GenModelV1HealthBadge.vue';

import {
  __resetGenModelV1UpdateNoticeForTests,
  handleGenModelV1TaskEnvelopeForNotice,
  setGenModelV1LoadedProbe,
} from '@/composables/useGenModelV1UpdateNotice';

function finished(
  batch: Record<string, unknown>,
  units: unknown[],
  extra: { taskId?: string; state?: string } = {},
) {
  const taskId = extra.taskId ?? 'db-20261026-212127-000047';
  return {
    type: 'task_finished',
    task_id: taskId,
    payload: {
      task_id: taskId,
      state: extra.state ?? 'succeeded',
      result: {
        batch: { dbnum: 8000, db_type: 'DESI', start_sesno: 726, end_sesno: 727, changed_elements: 2, ...batch },
        units,
      },
    },
  };
}

const MOVED = [{ root_refno: '24384/24776', kind: 'regen', status: 'generated' }];

async function mountBadge() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(GenModelV1HealthBadge);
  app.mount(host);
  await nextTick();
  return {
    host,
    bar: () => host.querySelector('[data-testid="gen-model-v1-update-notice"]'),
    text: () => host.querySelector('[data-testid="gen-model-v1-update-notice-text"]')?.textContent?.trim() ?? '',
    reloadButton: () => host.querySelector<HTMLButtonElement>('[data-testid="gen-model-v1-update-notice-reload"]'),
    getWorkHint: () => host.querySelector<HTMLElement>('[data-testid="gen-model-v1-update-notice-getwork-hint"]'),
    dismissButton: () => host.querySelector<HTMLButtonElement>('[data-testid="gen-model-v1-update-notice-dismiss"]'),
    unmount: () => { app.unmount(); host.remove(); },
  };
}

beforeEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
  h.invalidateQueries.mockClear();
  h.withQueryClient = true;
  setGenModelV1LoadedProbe({ dbnums: () => [8000], isRootLoaded: (refno) => refno === '24384_24776' });
});

afterEach(() => {
  __resetGenModelV1UpdateNoticeForTests();
});

describe('K10 状态栏更新提示条', () => {
  it('没有提示时不画；来了一批就画出 10-26 复验时那一句，悬停说明点名任务与生成根', async () => {
    const view = await mountBadge();
    try {
      expect(view.bar()).toBeNull();
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED));
      await nextTick();
      expect(view.text()).toBe('库 8000 已更新到会话 726→727（改 2 项，场景内 1 根受影响）');
      const title = view.bar()?.getAttribute('title') ?? '';
      expect(title).toContain('gen-model 任务 db-20261026-212127-000047');
      expect(title).toContain('批次里的生成根：24384_24776');
      expect(view.reloadButton()).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('点「重载」：派发 showModelByRefnos（refreshModel、不飞相机）、让属性面板的 ui-attr 查询重拉、提示条消失', async () => {
    const view = await mountBadge();
    const events: unknown[] = [];
    const onShow = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('showModelByRefnos', onShow);
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED));
      await nextTick();
      view.reloadButton()!.click();
      await nextTick();
      expect(events).toEqual([{ refnos: ['24384_24776'], refreshModel: true, flyTo: false }]);
      expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pdms', 'ui-attr'] });
      expect(view.bar()).toBeNull();
    } finally {
      window.removeEventListener('showModelByRefnos', onShow);
      view.unmount();
    }
  });

  it('批次里的根没有一个认得出在场景里：只提示、没有「重载」，换成一句「点「取最新」同步」；「×」忽略后提示条消失', async () => {
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, [{ root_refno: '24384/23257', status: 'generated' }]));
      await nextTick();
      expect(view.text()).toBe('库 8000 已更新到会话 726→727（改 2 项）');
      expect(view.reloadButton()).toBeNull();
      // 没有动作可点的时候把人引到「取最新」：单独一段，不跟着前面那句一起被截断
      expect(view.getWorkHint()?.textContent?.trim()).toBe('点「取最新」同步');
      expect(view.getWorkHint()?.className).toContain('shrink-0');
      // 认不出不等于不在场景里（经上层节点装进来的单元认不出）：不再说「不用重载」
      const title = view.bar()?.getAttribute('title') ?? '';
      expect(title).not.toContain('不在场景里');
      expect(title).toContain('这一批改到的单元里没有本页单独装过的（经上层的 SITE / ZONE 装进来的在这里认不出），所以没有「重载」可点');
      view.dismissButton()!.click();
      await nextTick();
      expect(view.bar()).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('连着几批、跨库：并成一条，列出库号；partial 里生成失败的根只点名不重载', async () => {
    setGenModelV1LoadedProbe({
      dbnums: () => [8000, 7997],
      isRootLoaded: (refno) => refno === '24384_24776' || refno === '24381_109449',
    });
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED, { taskId: 't1' }));
      await handleGenModelV1TaskEnvelopeForNotice(finished(
        { dbnum: 7997, start_sesno: 364, end_sesno: 365 },
        [
          { root_refno: '24381/109449', status: 'failed' },
          { root_refno: '24381/109450', status: 'generated' },
        ],
        { taskId: 't2', state: 'partial' },
      ));
      await nextTick();
      expect(view.text()).toBe('库 8000、7997 已更新（改 4 项，场景内 1 根受影响，1 根生成失败）');
      expect(view.bar()?.getAttribute('title')).toContain('生成失败、重载不换（场景里保留旧几何）：24381_109449');
    } finally {
      view.unmount();
    }
  });

  it('没装 VueQueryPlugin 也能挂；重载照样派发，只是省掉属性面板重拉', async () => {
    h.withQueryClient = false;
    const view = await mountBadge();
    const events: unknown[] = [];
    const onShow = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('showModelByRefnos', onShow);
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED));
      await nextTick();
      view.reloadButton()!.click();
      expect(events).toHaveLength(1);
      expect(h.invalidateQueries).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('showModelByRefnos', onShow);
      view.unmount();
    }
  });
});

describe('更新提示条把人引到「取最新」（2026-11-12）', () => {
  it('悬停说明的最后一行：要把模型树和已装的模型一起同步，点右边的「取最新」', async () => {
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED));
      await nextTick();
      const lines = (view.bar()?.getAttribute('title') ?? '').split('\n');
      expect(lines.at(-1)).toBe('要把模型树和已装的模型一起同步到最新，点右边的「取最新」');
      expect(lines.length).toBeGreaterThan(1);
    } finally {
      view.unmount();
    }
  });

  it('有「重载」可点的时候不画那句「点「取最新」同步」（两样只出一样）', async () => {
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, MOVED));
      await nextTick();
      expect(view.reloadButton()).not.toBeNull();
      expect(view.getWorkHint()).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('装着节点的库有变化、批次里一个单元回执都没有（改的是库里别处）：照样出提示，引到「取最新」', async () => {
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 1667, end_sesno: 1684, changed_elements: 37 }, []));
      await nextTick();
      expect(view.text()).toBe('库 8000 已更新到会话 1667→1684（改 37 项）');
      expect(view.reloadButton()).toBeNull();
      expect(view.getWorkHint()).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('先来一批认不出根的（出那句引导），再来一批认得出根的并进同一条：换成「重载」，引导收起', async () => {
    const view = await mountBadge();
    try {
      await handleGenModelV1TaskEnvelopeForNotice(finished({}, [{ root_refno: '24384/23257', status: 'generated' }], { taskId: 't1' }));
      await nextTick();
      expect(view.reloadButton()).toBeNull();
      expect(view.getWorkHint()?.textContent?.trim()).toBe('点「取最新」同步');

      await handleGenModelV1TaskEnvelopeForNotice(finished({ start_sesno: 728, end_sesno: 729 }, MOVED, { taskId: 't2' }));
      await nextTick();
      expect(view.reloadButton()).not.toBeNull();
      expect(view.getWorkHint()).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
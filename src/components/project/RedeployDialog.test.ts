/** 重新部署弹窗的选库页：候选库在页面开着时变化（手动刷新或后台刷新），勾选要跟着对账。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import type { DbnumRow } from '@/api/genModelV1Api';

const dbRows = ref<DbnumRow[]>([]);
const refreshDbnums = vi.fn(async () => {});
const redeploy = vi.fn(async () => 'accepted' as const);

vi.mock('@/composables/useModelGenerationAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useModelGenerationAdmin')>();
  const { computed: c, ref: r } = await import('vue');
  return {
    ...actual,
    useModelGenerationAdmin: () => ({
      dbRows,
      dbList: c(() => dbRows.value),
      dbLoading: r(false),
      dbError: r(null),
      refreshDbnums,
      probeRedeploySupport: async () => 'ok',
      redeploy,
      redeployBusy: r(false),
      redeployError: r(null),
      redeployTaskIds: r([]),
      redeployTasks: r([]),
      retryDbnums: vi.fn(),
      storageVersionInfo: r(null),
      upgradeProgress: r(null),
      backendVersion: r(null),
      taskFeedStatus: r('down'),
    }),
  };
});

vi.mock('@/composables/useRedeployRvmFollowUp', async () => {
  const { ref: r } = await import('vue');
  return {
    useRedeployRvmFollowUp: () => ({
      enabled: r(false),
      error: r(null),
      queuedDbnums: r([]),
      siteRows: r([]),
      summary: r({ total: 0, passed: 0, failed: 0, pending: 0, stopped: 0 }),
    }),
  };
});

vi.mock('@/composables/useRvmCheckStore', () => ({ useRvmCheckStore: () => ({ openRun: vi.fn() }) }));
vi.mock('@/composables/useDockApi', () => ({ ensurePanelAndActivate: vi.fn() }));

const { default: RedeployDialog } = await import('./RedeployDialog.vue');

function row(dbnum: number): DbnumRow {
  return { dbnum, db_type: 'DESI', file_name: `db${dbnum}`, initialized: true } as DbnumRow;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const checked = () =>
  [...document.body.querySelectorAll<HTMLInputElement>('[data-testid^="redeploy-db-"]')]
    .filter((el) => el.checked)
    .map((el) => Number(el.dataset.testid!.slice('redeploy-db-'.length)))
    .sort((a, b) => a - b);

let unmount: () => void = () => {};

beforeEach(async () => {
  dbRows.value = [row(5100), row(8000)];
  refreshDbnums.mockClear();
  redeploy.mockClear();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(RedeployDialog, { open: true }) });
  app.mount(host);
  unmount = () => {
    app.unmount();
    host.remove();
  };
  await settle();
});

afterEach(() => {
  unmount();
  document.body.innerHTML = '';
});

describe('RedeployDialog 选库页', () => {
  it('打开时全选；「刷新」按钮调 refreshDbnums', async () => {
    expect(checked()).toEqual([5100, 8000]);
    refreshDbnums.mockClear(); // 打开时 probe 已经拉过一次
    q('[data-testid="redeploy-refresh"]')!.click();
    expect(refreshDbnums).toHaveBeenCalledTimes(1);
  });

  it('全选状态下，后台刷新带出的新库自动勾上', async () => {
    dbRows.value = [row(5100), row(8000), row(250206)];
    await settle();
    expect(checked()).toEqual([5100, 8000, 250206]);
    expect(q('[data-testid="redeploy-next"]')!.textContent).toContain('3 个库');
  });

  it('点掉过一个库后，新库不擅自勾上，点掉的也不复活', async () => {
    q<HTMLInputElement>('[data-testid="redeploy-db-8000"]')!.click();
    await settle();
    dbRows.value = [row(5100), row(8000), row(250206)];
    await settle();
    expect(checked()).toEqual([5100]);
  });

  it('确认页上候选库变化不改提交名单，回到选库页再补', async () => {
    q('[data-testid="redeploy-next"]')!.click();
    await settle();
    dbRows.value = [row(5100), row(8000), row(250206)];
    await settle();
    expect(document.body.textContent).toContain('以下 2 个设计库');
    const back = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('返回修改'))!;
    back.click();
    await settle();
    expect(checked()).toEqual([5100, 8000, 250206]);
  });
});

/** 重新部署弹窗的 RVM 校验块：汇总一行、逐 SITE 状态、只有没通过的 SITE 能点。 */
import { describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import RedeployRvmSites from './RedeployRvmSites.vue';

import type { FollowUpSiteRow, FollowUpSummary } from '@/composables/redeployRvmFollowUp';

function row(refno: string, state: FollowUpSiteRow['state'], extra: Partial<FollowUpSiteRow> = {}): FollowUpSiteRow {
  return { refno, name: `/${refno}`, dbnum: 8000, state, taskId: `t-${refno}`, stage: null, message: '', ...extra };
}

async function mount(rows: FollowUpSiteRow[], summary: FollowUpSummary) {
  const opened: (FollowUpSiteRow | null)[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(RedeployRvmSites, { rows, summary, queuedDbnums: [8000], error: null, onOpen: (value: FollowUpSiteRow | null) => opened.push(value) }),
  });
  app.mount(host);
  await nextTick();
  const site = (refno: string) => host.querySelector<HTMLElement>(`[data-testid="redeploy-rvm-site-${refno}"]`)!;
  return { host, opened, site, unmount: () => { app.unmount(); host.remove(); } };
}

describe('RedeployRvmSites', () => {
  it('shows the summary and per-SITE state', async () => {
    const { host, site, unmount } = await mount(
      [row('a', 'pass'), row('b', 'fail'), row('c', 'running', { stage: 'e3d_export' }), row('d', 'queued')],
      { total: 4, passed: 1, failed: 1, pending: 2, stopped: 0 },
    );
    try {
      expect(host.querySelector('[data-testid="redeploy-rvm-summary"]')!.textContent!.trim()).toBe('4 个 SITE：1 通过 · 1 未通过 · 2 进行中');
      expect(site('a').textContent).toContain('通过');
      expect(site('b').textContent).toContain('不一致');
      expect(site('c').textContent).toContain('核对中 · E3D 导出');
      expect(site('d').textContent).toContain('排队中');
    } finally {
      unmount();
    }
  });

  it('only failed SITEs are clickable and open their run', async () => {
    const { opened, site, unmount } = await mount(
      [row('a', 'pass'), row('b', 'fail'), row('e', 'request_error', { taskId: null })],
      { total: 3, passed: 1, failed: 2, pending: 0, stopped: 0 },
    );
    try {
      expect(site('a').tagName).toBe('DIV');
      site('a').click();
      expect(opened).toEqual([]);
      expect(site('b').tagName).toBe('BUTTON');
      site('b').click();
      site('e').click();
      expect(opened.map((value) => value?.refno)).toEqual(['b', 'e']);
    } finally {
      unmount();
    }
  });

  it('the panel link opens without a SITE', async () => {
    const { host, opened, unmount } = await mount([], { total: 0, passed: 0, failed: 0, pending: 0, stopped: 0 });
    try {
      expect(host.querySelector('[data-testid="redeploy-rvm-summary"]')!.textContent!.trim()).toBe('库 8000 下没有 SITE');
      host.querySelector('button')!.click();
      expect(opened).toEqual([null]);
    } finally {
      unmount();
    }
  });
});

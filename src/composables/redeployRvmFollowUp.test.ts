import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { createRedeployRvmFollowUp, type SiteTarget } from './redeployRvmFollowUp';

import type { StorageVersionUpgradeHealth } from '@/api/genModelV1Api';
import type { AdminTaskView } from '@/composables/useModelGenerationAdmin';

const SITES: SiteTarget[] = [
  { refno: '24381_42520', name: '/1RB-CIVI', noun: 'SITE', dbnum: 7997 },
  { refno: '24381_44873', name: '/1RC-CIVI', noun: 'SITE', dbnum: 7997 },
  { refno: '24383_1', name: '/8000-SITE', noun: 'SITE', dbnum: 8000 },
  { refno: '9304_2', name: '/1RS-CIVI', noun: 'SITE', dbnum: null },
];

function upgrade(over: Partial<StorageVersionUpgradeHealth>): StorageVersionUpgradeHealth {
  return {
    state: 'running',
    requested: [7997, 8000],
    done: 0,
    done_dbnums: [],
    failed: [],
    started_at: '2026-11-05T19:30:00+08:00',
    finished_at: null,
    full_scope: false,
    ...over,
  };
}

function setup(initial: StorageVersionUpgradeHealth | null = null, enabledValue = true) {
  const progress = ref<StorageVersionUpgradeHealth | null>(initial);
  const tasks = ref<AdminTaskView[]>([]);
  const enabled = ref(enabledValue);
  const collectSites = vi.fn(async () => SITES);
  const enqueue = vi.fn((targets: unknown[]) => targets.length);
  const followUp = createRedeployRvmFollowUp({ progress, tasks, enabled, collectSites, enqueue });
  return { progress, tasks, enabled, collectSites, enqueue, followUp };
}

describe('createRedeployRvmFollowUp', () => {
  it('queues the SITEs of each dbnum as soon as it finishes', async () => {
    const { progress, enqueue, followUp } = setup();
    progress.value = upgrade({});
    await nextTick();
    expect(enqueue).not.toHaveBeenCalled();

    progress.value = upgrade({ done: 1, done_dbnums: [8000] });
    await nextTick();
    await followUp.settled();
    expect(enqueue).toHaveBeenLastCalledWith([{ refno: '24383_1', name: '/8000-SITE', noun: 'SITE' }]);

    progress.value = upgrade({ state: 'done', done: 2, done_dbnums: [8000, 7997] });
    await nextTick();
    await followUp.settled();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenLastCalledWith([
      { refno: '24381_42520', name: '/1RB-CIVI', noun: 'SITE' },
      { refno: '24381_44873', name: '/1RC-CIVI', noun: 'SITE' },
    ]);
    expect(followUp.queuedDbnums.value).toEqual([7997, 8000]);
    expect(followUp.queuedSites.value).toBe(3);
  });

  it('does not re-run dbnums that were already done when first seen', async () => {
    const { progress, enqueue, followUp } = setup(upgrade({ done: 1, done_dbnums: [8000] }));
    progress.value = upgrade({ state: 'done', done: 2, done_dbnums: [8000, 7997] });
    await nextTick();
    await followUp.settled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toHaveLength(2);
  });

  it('keeps the run when started_at arrives after submit', async () => {
    const { progress, enqueue, followUp } = setup();
    progress.value = upgrade({ started_at: undefined });
    await nextTick();
    progress.value = upgrade({ done: 1, done_dbnums: [8000] });
    await nextTick();
    await followUp.settled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('queues SITEs for successful retry tasks', async () => {
    const { tasks, enqueue, followUp } = setup(upgrade({ state: 'failed', failed: [{ dbnum: 8000, reason: 'x' }] }));
    tasks.value = [{ taskId: 't1', dbnum: 8000, state: 'running' } as AdminTaskView];
    await nextTick();
    expect(enqueue).not.toHaveBeenCalled();
    tasks.value = [{ taskId: 't1', dbnum: 8000, state: 'succeeded' } as AdminTaskView];
    await nextTick();
    await followUp.settled();
    expect(enqueue).toHaveBeenCalledWith([{ refno: '24383_1', name: '/8000-SITE', noun: 'SITE' }]);
  });

  it('does nothing while the switch is off', async () => {
    const { progress, collectSites, enqueue, followUp } = setup(null, false);
    progress.value = upgrade({});
    await nextTick();
    progress.value = upgrade({ done: 1, done_dbnums: [8000] });
    await nextTick();
    await followUp.settled();
    expect(collectSites).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('reports tree errors without throwing', async () => {
    const { progress, collectSites, followUp } = setup();
    collectSites.mockRejectedValueOnce(new Error('boom'));
    progress.value = upgrade({});
    await nextTick();
    progress.value = upgrade({ done: 1, done_dbnums: [8000] });
    await nextTick();
    await followUp.settled();
    expect(followUp.error.value).toBe('读 SITE 清单失败：boom');
  });
});

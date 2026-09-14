import { describe, expect, it } from 'vitest';

import { buildAnnotationDraftStatusRows } from './annotationDraftStatusRows';

import {
  applyDraftSessionEvent,
  createDraftSessionState,
  deriveDraftSaveStatus,
  type DraftSessionEvent,
  type DraftSessionState,
} from '@/composables/useAnnotationDraftSession';

function stateAfter(events: DraftSessionEvent[], remoteCapability: 'unavailable' | 'available' = 'unavailable'): DraftSessionState {
  return events.reduce(
    (state, event) => applyDraftSessionEvent(state, event),
    createDraftSessionState('v1|project=p|task=t|round=0|user=u', 1, 0, remoteCapability),
  );
}

const fmt = (ts: number) => `T${ts}`;

describe('buildAnnotationDraftStatusRows（三行状态文案）', () => {
  it('刚进任务、没草稿、没确认：本机无草稿 / 未确认，云端那一行不出现（U3 前不可用）', () => {
    const rows = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(stateAfter([])),
      draftCount: 0,
      hasUnconfirmedChanges: false,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      formatTime: fmt,
    });
    expect(rows.map((r) => r.id)).toEqual(['local', 'confirmed']);
    expect(rows[0]).toMatchObject({ state: 'empty', label: '本机 · 无草稿', tone: 'neutral' });
    expect(rows[1]).toMatchObject({ state: 'never', label: '未确认', tone: 'neutral' });
  });

  it('编辑了还没刷盘：本机 · 未存；刷盘后与确认记录不一致：本机已存 · 未落库 + 未确认 · 有待确认内容', () => {
    const unsaved = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(stateAfter([{ type: 'edit', at: 1 }])),
      draftCount: 1,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      formatTime: fmt,
    });
    expect(unsaved[0]).toMatchObject({ state: 'unsaved', label: '本机 · 未存', tone: 'warn' });

    const saved = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(stateAfter([{ type: 'edit', at: 1 }, { type: 'local-persisted', revision: 1, at: 2 }])),
      draftCount: 1,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      formatTime: fmt,
    });
    expect(saved[0]).toMatchObject({ state: 'saved-unconfirmed', label: '本机已存 · 未落库', tone: 'warn' });
    expect(saved[0]?.detail).toContain('确认当前数据后才进服务端');
    expect(saved[1]).toMatchObject({ state: 'never-pending', label: '未确认 · 有待确认内容', tone: 'warn' });
  });

  it('本机内容全部确认过：本机已存（不再说未落库）+ 已确认到修订 N · 最近时间', () => {
    const rows = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(stateAfter([{ type: 'edit', at: 1 }, { type: 'local-persisted', revision: 1, at: 2 }])),
      draftCount: 3,
      hasUnconfirmedChanges: false,
      confirmedRecordCount: 2,
      lastConfirmedAt: 1700000000000,
      formatTime: fmt,
    });
    expect(rows[0]).toMatchObject({ state: 'saved', label: '本机已存', tone: 'ok' });
    expect(rows[1]).toMatchObject({ state: 'up-to-date', label: '已确认到修订 2', detail: '最近 T1700000000000', tone: 'ok' });
  });

  it('确认过之后又改了：已确认到修订 N · 有未确认修改', () => {
    const rows = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(stateAfter([{ type: 'edit', at: 1 }, { type: 'local-persisted', revision: 1, at: 2 }])),
      draftCount: 4,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 2,
      lastConfirmedAt: 5,
      formatTime: fmt,
    });
    expect(rows[1]).toMatchObject({ state: 'has-unconfirmed-changes', label: '已确认到修订 2 · 有未确认修改', detail: '最近 T5', tone: 'warn' });
  });

  it('本机写入失败：红字 + 原因；没给原因用默认说明', () => {
    const failed = stateAfter([{ type: 'edit', at: 1 }, { type: 'local-persist-failed', revision: 1, error: 'QuotaExceededError', at: 2 }]);
    const rows = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(failed),
      draftCount: 1,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      localWriteError: failed.localWriteError,
      formatTime: fmt,
    });
    expect(rows[0]).toMatchObject({ state: 'write-failed', label: '本机写入失败', detail: 'QuotaExceededError', tone: 'danger' });

    const noReason = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(failed),
      draftCount: 1,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      localWriteError: null,
      formatTime: fmt,
    });
    expect(noReason[0]?.detail).toContain('刷新会丢');
  });

  it('云端能力可用时（U3）才出现云端那一行，语气跟 remote 状态走', () => {
    const acked = stateAfter([
      { type: 'edit', at: 1 },
      { type: 'local-persisted', revision: 1, at: 2 },
      { type: 'remote-sent', revision: 1, mutationId: 'm1', at: 3 },
      { type: 'remote-acked', revision: 1, mutationId: 'm1', draftId: 'd1', draftRevision: 1, at: 4 },
      { type: 'edit', at: 5 },
    ], 'available');
    const rows = buildAnnotationDraftStatusRows({
      status: deriveDraftSaveStatus(acked),
      draftCount: 1,
      hasUnconfirmedChanges: true,
      confirmedRecordCount: 0,
      lastConfirmedAt: null,
      formatTime: fmt,
    });
    expect(rows.map((r) => r.id)).toEqual(['local', 'remote', 'confirmed']);
    expect(rows[1]).toMatchObject({ id: 'remote', state: 'behind', label: '云端草稿 · 有未同步修改', tone: 'warn' });
  });
});

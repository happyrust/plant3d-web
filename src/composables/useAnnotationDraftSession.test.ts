import { describe, expect, it } from 'vitest';

import {
  applyDraftSessionEvent,
  createAnnotationDraftSession,
  createDraftSessionState,
  deriveDraftSaveStatus,
  resetAnnotationDraftSessionForTests,
  useAnnotationDraftSession,
  type DraftSessionState,
} from './useAnnotationDraftSession';

import { buildAnnotationScope, stampForScope } from '@/review/domain/annotationScope';

function edited(state: DraftSessionState, times: number, at = 1): DraftSessionState {
  let s = state;
  for (let i = 0; i < times; i += 1) s = applyDraftSessionEvent(s, { type: 'edit', at: at + i });
  return s;
}

const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'A', reviewRound: 1, userId: 'u' });
const scopeB = buildAnnotationScope({ projectId: 'p', taskId: 'B', reviewRound: 1, userId: 'u' });

describe('applyDraftSessionEvent（纯 reducer）· 本机维度', () => {
  it('初始 clean；编辑后 unsaved；本机写到当前修订后 saved（但仍「未落库」）', () => {
    const s0 = createDraftSessionState('k', 1, 0);
    expect(deriveDraftSaveStatus(s0).local).toBe('clean');
    const s1 = edited(s0, 2);
    expect(s1.localRevision).toBe(2);
    expect(deriveDraftSaveStatus(s1).local).toBe('unsaved');
    const s2 = applyDraftSessionEvent(s1, { type: 'local-persisted', revision: 2, at: 5 });
    const st = deriveDraftSaveStatus(s2);
    expect(st.local).toBe('saved');
    expect(st.labels.local).toBe('本机已存 · 未落库');
    // 云端不可用：那一行不显示，不假装
    expect(st.remote).toBe('unavailable');
    expect(st.labels.remote).toBeNull();
  });

  it('写入修订 1 成功后又编辑到 2 → 仍 unsaved；旧修订的成功回执不会把 persisted 倒退', () => {
    let s = edited(createDraftSessionState('k', 1, 0), 1);
    s = applyDraftSessionEvent(s, { type: 'local-persisted', revision: 1, at: 2 });
    s = edited(s, 1, 3);
    expect(deriveDraftSaveStatus(s).local).toBe('unsaved');
    s = applyDraftSessionEvent(s, { type: 'local-persisted', revision: 2, at: 4 });
    const stale = applyDraftSessionEvent(s, { type: 'local-persisted', revision: 1, at: 5 });
    expect(stale).toBe(s);
  });

  it('localStorage 写失败 → write-failed 带错误；之后成功写到 ≥ 失败修订才清掉', () => {
    let s = edited(createDraftSessionState('k', 1, 0), 1);
    s = applyDraftSessionEvent(s, { type: 'local-persist-failed', revision: 1, error: 'QuotaExceededError', at: 2 });
    expect(deriveDraftSaveStatus(s).local).toBe('write-failed');
    expect(s.localWriteError).toBe('QuotaExceededError');
    s = edited(s, 1, 3);
    expect(deriveDraftSaveStatus(s).local).toBe('write-failed');
    s = applyDraftSessionEvent(s, { type: 'local-persisted', revision: 2, at: 4 });
    expect(deriveDraftSaveStatus(s).local).toBe('saved');
    expect(s.localWriteFailedAtRevision).toBeNull();
    expect(s.localWriteError).toBeNull();
  });

  it('不可能的修订号（超过本机修订 / 0 / 非整数）原样返回旧状态', () => {
    const s = edited(createDraftSessionState('k', 1, 0), 1);
    expect(applyDraftSessionEvent(s, { type: 'local-persisted', revision: 2, at: 1 })).toBe(s);
    expect(applyDraftSessionEvent(s, { type: 'local-persisted', revision: 0, at: 1 })).toBe(s);
    expect(applyDraftSessionEvent(s, { type: 'confirmed', revision: 1.5, at: 1 })).toBe(s);
  });
});

describe('applyDraftSessionEvent · 云端草稿维度（U3 之前不可用，可用后按 mutationId 对回执）', () => {
  function available(): DraftSessionState {
    return createDraftSessionState('k', 1, 0, 'available');
  }

  it('未发送 → 发送中 → ACK 到当前修订 = saved；label「已保存 · 未确认」', () => {
    let s = edited(available(), 1);
    expect(deriveDraftSaveStatus(s).remote).toBe('never-sent');
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm1', at: 2 });
    expect(deriveDraftSaveStatus(s).remote).toBe('saving');
    s = applyDraftSessionEvent(s, { type: 'remote-acked', revision: 1, mutationId: 'm1', draftId: 'd1', draftRevision: 1, at: 3 });
    const st = deriveDraftSaveStatus(s);
    expect(st.remote).toBe('saved');
    expect(st.labels.remote).toBe('云端草稿 · 已保存 · 未确认');
    expect(st.hasUnsyncedChanges).toBe(false);
    expect(s.remote.draftId).toBe('d1');
  });

  it('修订 7 的 ACK 到达时已编辑到 8：ACK 照记（ackRevision=7），状态 behind、hasUnsyncedChanges=true', () => {
    let s = edited(available(), 7);
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 7, mutationId: 'm7', at: 8 });
    s = edited(s, 1, 9);
    s = applyDraftSessionEvent(s, { type: 'remote-acked', revision: 7, mutationId: 'm7', draftId: 'd', draftRevision: 3, at: 10 });
    expect(s.remote.ackRevision).toBe(7);
    expect(s.localRevision).toBe(8);
    const st = deriveDraftSaveStatus(s);
    expect(st.remote).toBe('behind');
    expect(st.labels.remote).toBe('云端草稿 · 有未同步修改');
    expect(st.hasUnsyncedChanges).toBe(true);
  });

  it('对不上在途 mutationId 的 ACK / 失败是更早一发的迟到回执，不采纳', () => {
    let s = edited(available(), 2);
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm1', at: 2 });
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 2, mutationId: 'm2', at: 3 });
    const late = applyDraftSessionEvent(s, { type: 'remote-acked', revision: 1, mutationId: 'm1', draftId: null, draftRevision: null, at: 4 });
    expect(late).toBe(s);
    const lateFail = applyDraftSessionEvent(s, { type: 'remote-failed', revision: 1, mutationId: 'm1', error: 'x', at: 4 });
    expect(lateFail).toBe(s);
    s = applyDraftSessionEvent(s, { type: 'remote-acked', revision: 2, mutationId: 'm2', draftId: 'd', draftRevision: 2, at: 5 });
    expect(s.remote.ackRevision).toBe(2);
    expect(deriveDraftSaveStatus(s).remote).toBe('saved');
  });

  it('发送失败 → failed 带错误；再发一次清错误', () => {
    let s = edited(available(), 1);
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm1', at: 2 });
    s = applyDraftSessionEvent(s, { type: 'remote-failed', revision: 1, mutationId: 'm1', error: '503', at: 3 });
    expect(deriveDraftSaveStatus(s).remote).toBe('failed');
    expect(s.remote.lastError).toBe('503');
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm1b', at: 4 });
    expect(deriveDraftSaveStatus(s).remote).toBe('saving');
    expect(s.remote.lastError).toBeNull();
  });

  it('云端不可用时 remote-sent 被忽略；capability 事件切到 available 后才收', () => {
    let s = edited(createDraftSessionState('k', 1, 0), 1);
    expect(applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm', at: 1 })).toBe(s);
    s = applyDraftSessionEvent(s, { type: 'remote-capability', capability: 'available', at: 2 });
    s = applyDraftSessionEvent(s, { type: 'remote-sent', revision: 1, mutationId: 'm', at: 3 });
    expect(s.remote.inFlight).toBe(true);
  });
});

describe('applyDraftSessionEvent · 正式确认维度', () => {
  it('未确认 → 确认到修订 N → 再编辑 = 「已确认到修订 N · 有未确认修改」；确认不会倒退', () => {
    let s = edited(createDraftSessionState('k', 1, 0), 3);
    expect(deriveDraftSaveStatus(s).labels.confirmed).toBe('未确认');
    s = applyDraftSessionEvent(s, { type: 'confirmed', revision: 3, at: 4 });
    expect(deriveDraftSaveStatus(s).confirmed).toBe('up-to-date');
    expect(deriveDraftSaveStatus(s).labels.confirmed).toBe('已确认到修订 3');
    s = edited(s, 1, 5);
    const st = deriveDraftSaveStatus(s);
    expect(st.confirmed).toBe('has-unconfirmed-changes');
    expect(st.labels.confirmed).toBe('已确认到修订 3 · 有未确认修改');
    // 云端不可用时，hasUnsyncedChanges 看的是「本机领先已确认」
    expect(st.hasUnsyncedChanges).toBe(true);
    expect(applyDraftSessionEvent(s, { type: 'confirmed', revision: 2, at: 6 })).toBe(s);
  });

  it('reset 清空一切、换 key 与 epoch，云端能力沿用旧状态（除非显式给）', () => {
    let s = edited(createDraftSessionState('k1', 1, 0, 'available'), 4);
    s = applyDraftSessionEvent(s, { type: 'confirmed', revision: 4, at: 5 });
    const r = applyDraftSessionEvent(s, { type: 'reset', scopeKey: 'k2', epoch: 2, at: 6 });
    expect(r).toEqual({ ...createDraftSessionState('k2', 2, 6, 'available') });
    const r2 = applyDraftSessionEvent(s, { type: 'reset', scopeKey: 'k2', epoch: 2, at: 6, remoteCapability: 'unavailable' });
    expect(r2.remote.capability).toBe('unavailable');
  });
});

describe('createAnnotationDraftSession（响应式外壳，不接 UI）', () => {
  it('enterScope 同一 scope 幂等；换 scope 重置状态并递增 epoch', () => {
    let t = 100;
    const session = createAnnotationDraftSession(() => t++);
    const stampA = session.enterScope(scopeA);
    expect(stampA.epoch).toBe(1);
    expect(session.markEdited()).toBe(1);
    expect(session.markEdited()).toBe(2);
    const again = session.enterScope(scopeA);
    expect(again).toEqual(stampA);
    expect(session.state.value.localRevision).toBe(2);
    const stampB = session.enterScope(scopeB);
    expect(stampB.epoch).toBe(2);
    expect(session.state.value.localRevision).toBe(0);
    expect(session.status.value.local).toBe('clean');
  });

  it('A 任务迟到的回执带 A 的戳，切到 B 后 dispatch 被拒且 B 的状态不变', () => {
    const session = createAnnotationDraftSession(() => 1);
    const stampA = session.enterScope(scopeA);
    session.markEdited();
    session.enterScope(scopeB);
    session.markEdited();
    const before = session.state.value;
    const verdict = session.dispatch({ type: 'local-persisted', revision: 1, at: 2 }, stampA);
    expect(verdict).toEqual({ accept: false, reason: 'scope-changed' });
    expect(session.state.value).toBe(before);
    expect(session.status.value.local).toBe('unsaved');
    // B 自己的戳才进得去
    const ok = session.dispatch({ type: 'local-persisted', revision: 1, at: 3 }, session.currentStamp());
    expect(ok.accept).toBe(true);
    expect(session.status.value.local).toBe('saved');
  });

  it('A→B→A：A 的旧戳按 epoch 拒；新进入的 A 是干净状态', () => {
    const session = createAnnotationDraftSession(() => 1);
    const stampA1 = session.enterScope(scopeA);
    session.markEdited();
    session.enterScope(scopeB);
    const stampA3 = session.enterScope(scopeA);
    expect(stampA3.epoch).toBe(3);
    expect(session.state.value.localRevision).toBe(0);
    expect(session.judge(stampA1)).toEqual({ accept: false, reason: 'epoch-stale' });
    expect(session.dispatch({ type: 'edit', at: 1 }, stampA1).accept).toBe(false);
    expect(session.state.value.localRevision).toBe(0);
  });

  it('leaveScope 后没有 scope：markEdited 返回 0、dispatch 一律 no-scope、epoch 已推进', () => {
    const session = createAnnotationDraftSession(() => 1);
    const stamp = session.enterScope(scopeA);
    session.leaveScope();
    expect(session.scope.value).toBeNull();
    expect(session.currentStamp()).toBeNull();
    expect(session.markEdited()).toBe(0);
    expect(session.dispatch({ type: 'edit', at: 1 })).toEqual({ accept: false, reason: 'no-scope' });
    expect(session.judge(stamp)).toEqual({ accept: false, reason: 'no-scope' });
    expect(session.state.value.epoch).toBe(2);
  });

  it('同一 scope 再次 enterScope 只允许更新云端能力，不重置修订', () => {
    const session = createAnnotationDraftSession(() => 1);
    session.enterScope(scopeA);
    session.markEdited();
    session.enterScope(scopeA, { remoteCapability: 'available' });
    expect(session.state.value.localRevision).toBe(1);
    expect(session.state.value.remote.capability).toBe('available');
    expect(session.status.value.remote).toBe('never-sent');
  });

  it('dispatch 不带戳 = 当前 scope 的同步操作，直接进 reducer', () => {
    const session = createAnnotationDraftSession(() => 1);
    session.enterScope(scopeA);
    session.markEdited();
    expect(session.dispatch({ type: 'confirmed', revision: 1, at: 2 }).accept).toBe(true);
    expect(session.status.value.confirmed).toBe('up-to-date');
  });

  it('瞬态回执守卫：没戳照旧放行；同 scope 同 epoch 放行；换 scope / A→B→A / 离开校审一律拒', () => {
    const session = createAnnotationDraftSession(() => 1);
    expect(session.isTransientReceiptCurrent(null)).toBe(true);
    const stampA = session.enterScope(scopeA);
    expect(session.isTransientReceiptCurrent(stampA)).toBe(true);
    session.enterScope(scopeB);
    expect(session.isTransientReceiptCurrent(stampA)).toBe(false);
    session.enterScope(scopeA);
    expect(session.isTransientReceiptCurrent(stampA)).toBe(false);
    session.leaveScope();
    expect(session.isTransientReceiptCurrent(stampA)).toBe(false);
    expect(session.isTransientReceiptCurrent(null)).toBe(true);
  });

  it('数据类回执落点：没戳 unscoped；同 scope（含 A→B→A）current；在别的 scope / 已离开 → 写出发时那个 scope 的容器', () => {
    const session = createAnnotationDraftSession(() => 1);
    expect(session.routeDataReceipt(null)).toEqual({ kind: 'unscoped' });
    const stampA = session.enterScope(scopeA);
    expect(session.routeDataReceipt(stampA)).toEqual({ kind: 'current' });
    session.enterScope(scopeB);
    expect(session.routeDataReceipt(stampA)).toEqual({ kind: 'other-scope', scopeKey: stampA.scopeKey });
    session.enterScope(scopeA);
    // epoch 变了，但记录 X 的截图还是记录 X 的：仍落内存
    expect(session.routeDataReceipt(stampA)).toEqual({ kind: 'current' });
    session.leaveScope();
    expect(session.routeDataReceipt(stampA)).toEqual({ kind: 'other-scope', scopeKey: stampA.scopeKey });
  });

  it('useAnnotationDraftSession 是单例；reset 后重建', () => {
    resetAnnotationDraftSessionForTests();
    const a = useAnnotationDraftSession();
    expect(useAnnotationDraftSession()).toBe(a);
    resetAnnotationDraftSessionForTests();
    expect(useAnnotationDraftSession()).not.toBe(a);
    // 与 stampForScope 的形制一致
    a.enterScope(scopeA);
    expect(a.currentStamp()).toEqual(stampForScope(scopeA, 1));
  });
});

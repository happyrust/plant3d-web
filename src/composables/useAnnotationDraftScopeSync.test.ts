import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';

/** 本测试环境没有 localStorage / sessionStorage 全局；给内存实现（flag 持久化与本 tab draftSessionId 都要它） */
vi.hoisted(() => {
  const createMemoryStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() { return map.size; },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => { map.delete(key); },
      setItem: (key: string, value: string) => { map.set(key, String(value)); },
    } as Storage;
  };
  vi.stubGlobal('localStorage', createMemoryStorage());
  vi.stubGlobal('sessionStorage', createMemoryStorage());
});

const currentTask = ref<{ id: string; reviewRound?: number } | null>(null);
const currentUser = ref<{ id: string } | null>({ id: 'JH' });
const setAnnotationDraftScopeMock = vi.fn((_scope: AnnotationScope | null) => true);
const emptyJournal = (): AnnotationDraftJournal => ({
  revision: 0, persistedRevision: 0, failedRevision: null, error: null, storageScope: '', at: 0,
});
const annotationDraftJournal = shallowRef<AnnotationDraftJournal>(emptyJournal());

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({ currentTask }),
}));
vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({ setAnnotationDraftScope: setAnnotationDraftScopeMock, annotationDraftJournal }),
}));
vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser, currentUserId: ref('fallback-user') }),
}));

import {
  computeAnnotationDraftScope,
  deriveTaskReviewRound,
  DRAFT_SESSION_ID_STORAGE_KEY,
  getAnnotationDraftScopeSyncHostCount,
  resolveTabDraftSessionId,
  useAnnotationDraftScopeSync,
} from './useAnnotationDraftScopeSync';
import { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } from './useAnnotationDraftSession';
import { resetAnnotationUxFlagCache, setAnnotationUxFlag } from './useAnnotationUxFlags';

import type { AnnotationDraftJournal } from './useToolStore';
import type { AnnotationScope } from '@/review/domain/annotationScope';

import { setCurrentProjectPath } from '@/lib/filesOutput';

describe('computeAnnotationDraftScope / deriveTaskReviewRound（纯函数）', () => {
  it('有任务：taskId 身份、round 只认任务上显式的 reviewRound', () => {
    const scope = computeAnnotationDraftScope({
      projectId: 'ams',
      task: { id: 'task-1', reviewRound: 2 },
      userId: 'JH',
      draftSessionId: 'ds-ignored',
    });
    expect(scope).toMatchObject({ projectId: 'ams', taskId: 'task-1', draftSessionId: null, reviewRound: 2, userId: 'JH' });
    expect(deriveTaskReviewRound({ id: 't' })).toBe(0);
    expect(deriveTaskReviewRound({ id: 't', reviewRound: Number.NaN })).toBe(0);
    expect(deriveTaskReviewRound(null)).toBe(0);
  });

  it('没有任务：用本 tab 的 draftSessionId 顶替，不退回全局', () => {
    const scope = computeAnnotationDraftScope({ projectId: null, task: null, userId: null, draftSessionId: 'ds-tab' });
    expect(scope.taskId).toBeNull();
    expect(scope.draftSessionId).toBe('ds-tab');
    expect(scope.projectId).toBe('__default__');
    expect(scope.userId).toBe('anonymous');
  });
});

describe('resolveTabDraftSessionId', () => {
  beforeEach(() => sessionStorage.clear());

  it('sessionStorage 里没有就造一个并记住；再取同一个', () => {
    const first = resolveTabDraftSessionId();
    expect(first).toMatch(/^ds-/);
    expect(sessionStorage.getItem(DRAFT_SESSION_ID_STORAGE_KEY)).toBe(first);
    expect(resolveTabDraftSessionId()).toBe(first);
  });

  it('sessionStorage 不可用退到进程内存，且稳定', () => {
    const a = resolveTabDraftSessionId(null);
    expect(a).toMatch(/^ds-/);
    expect(resolveTabDraftSessionId(null)).toBe(a);
  });
});

describe('useAnnotationDraftScopeSync（接线：任务 / 用户变化 → store scope + 草稿会话）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setAnnotationUxFlag('scopedDraftsV1', true);
    resetAnnotationUxFlagCache();
    resetAnnotationDraftSessionForTests();
    setAnnotationDraftScopeMock.mockClear();
    annotationDraftJournal.value = emptyJournal();
    currentTask.value = null;
    currentUser.value = { id: 'JH' };
    sessionStorage.setItem(DRAFT_SESSION_ID_STORAGE_KEY, 'ds-tab');
    expect(getAnnotationDraftScopeSyncHostCount()).toBe(0);
  });

  afterEach(() => {
    resetAnnotationUxFlagCache();
    expect(getAnnotationDraftScopeSyncHostCount()).toBe(0);
  });

  it('装上即同步一次：没有任务用 draftSessionId；任务一变同步切到任务 scope（flush:sync，不等 tick）', () => {
    const sync = useAnnotationDraftScopeSync({ projectId: () => 'ams' });
    expect(setAnnotationDraftScopeMock).toHaveBeenCalledTimes(1);
    expect(sync.current()).toMatchObject({ taskId: null, draftSessionId: 'ds-tab', projectId: 'ams', userId: 'JH' });

    currentTask.value = { id: 'task-A' };
    expect(setAnnotationDraftScopeMock).toHaveBeenCalledTimes(2);
    expect(setAnnotationDraftScopeMock.mock.lastCall?.[0]).toMatchObject({ taskId: 'task-A', draftSessionId: null, reviewRound: 0 });
    expect(useAnnotationDraftSession().scope.value?.taskId).toBe('task-A');
    expect(useAnnotationDraftSession().state.value.epoch).toBe(2);

    sync.stop();
    expect(setAnnotationDraftScopeMock.mock.lastCall?.[0]).toBeNull();
    expect(useAnnotationDraftSession().scope.value).toBeNull();
    expect(sync.current()).toBeNull();
    // 重复 stop 幂等
    sync.stop();
    expect(setAnnotationDraftScopeMock).toHaveBeenCalledTimes(3);
  });

  it('用户身份优先用传入的取法（嵌入模式的可信身份），没有再回用户库', () => {
    const sync = useAnnotationDraftScopeSync({ userId: () => 'embed-user', projectId: () => 'ams' });
    expect(sync.current()?.userId).toBe('embed-user');
    sync.stop();

    const fallback = useAnnotationDraftScopeSync({ userId: () => null, projectId: () => 'ams' });
    expect(fallback.current()?.userId).toBe('JH');
    currentUser.value = null;
    expect(fallback.current()?.userId).toBe('fallback-user');
    fallback.stop();
  });

  it('多宿主：两个面板同时装，底下只有一份同步；少一个宿主 scope 不动，最后一个卸了才回 null', () => {
    const a = useAnnotationDraftScopeSync({ userId: () => 'embed-user', projectId: () => 'ams' });
    const b = useAnnotationDraftScopeSync({ projectId: () => 'ams' });
    expect(getAnnotationDraftScopeSyncHostCount()).toBe(2);
    // 第二个宿主登记只是让共享 watch 重取一遍：同一 scope，store 幂等（mock 记录调用但 scope 相同）
    expect(a.current()).toEqual(b.current());
    expect(b.current()?.userId).toBe('embed-user');

    currentTask.value = { id: 'task-A' };
    expect(a.current()?.taskId).toBe('task-A');
    expect(b.current()?.taskId).toBe('task-A');

    const callsBefore = setAnnotationDraftScopeMock.mock.calls.length;
    a.stop();
    expect(a.current()).toBeNull();
    // 少了 a：用户 id 回落到用户库，但没有任何一发 null
    expect(setAnnotationDraftScopeMock.mock.calls.slice(callsBefore).some(([scope]) => scope === null)).toBe(false);
    expect(b.current()).toMatchObject({ taskId: 'task-A', userId: 'JH' });
    expect(useAnnotationDraftSession().scope.value?.taskId).toBe('task-A');

    b.stop();
    expect(setAnnotationDraftScopeMock.mock.lastCall?.[0]).toBeNull();
    expect(useAnnotationDraftSession().scope.value).toBeNull();
    expect(getAnnotationDraftScopeSyncHostCount()).toBe(0);
  });

  it('本机草稿流水 → 草稿会话：内容变了记 edit，写成记 local-persisted，写败记 local-persist-failed，再写成清掉失败', () => {
    const sync = useAnnotationDraftScopeSync({ projectId: () => 'ams' });
    currentTask.value = { id: 'task-A' };
    const session = useAnnotationDraftSession();
    expect(session.status.value.local).toBe('clean');

    // store 的批注数组变了（还没刷盘）
    annotationDraftJournal.value = { ...annotationDraftJournal.value, revision: 1, at: 10 };
    expect(session.state.value.localRevision).toBe(1);
    expect(session.status.value.local).toBe('unsaved');

    // 刷盘成功
    annotationDraftJournal.value = { ...annotationDraftJournal.value, persistedRevision: 1, storageScope: 'k', at: 11 };
    expect(session.status.value.local).toBe('saved');
    expect(session.state.value.persistedLocalRevision).toBe(1);

    // 再编辑一笔，刷盘失败（配额满）
    annotationDraftJournal.value = { ...annotationDraftJournal.value, revision: 2, at: 12 };
    annotationDraftJournal.value = { ...annotationDraftJournal.value, failedRevision: 2, error: 'QuotaExceededError', at: 13 };
    expect(session.state.value.localRevision).toBe(2);
    expect(session.status.value.local).toBe('write-failed');
    expect(session.state.value.localWriteError).toBe('QuotaExceededError');

    // 之后一次成功写入清掉失败
    annotationDraftJournal.value = { ...annotationDraftJournal.value, persistedRevision: 2, failedRevision: null, error: null, at: 14 };
    expect(session.status.value.local).toBe('saved');
    expect(session.state.value.localWriteFailedAtRevision).toBeNull();

    // 切任务：会话重置，旧流水不会串进新 scope
    currentTask.value = { id: 'task-B' };
    expect(session.state.value.localRevision).toBe(0);
    expect(session.status.value.local).toBe('clean');
    sync.stop();
  });

  it('工程变了 scope 跟着变：setCurrentProjectPath / modelProjectChanged / popstate 任一到来都重取 projectId，容器切走、epoch+1', () => {
    setCurrentProjectPath(null);
    // 不给 projectId 取法：走 URL / 当前工程（happy-dom 的 URL 没有 output_project → __default__）
    const sync = useAnnotationDraftScopeSync();
    currentTask.value = { id: 'task-A' };
    expect(sync.current()).toMatchObject({ projectId: '__default__', taskId: 'task-A' });
    const session = useAnnotationDraftSession();
    const epochBefore = session.state.value.epoch;

    // useModelProjects.applyProject 首屏那次：只 setCurrentProjectPath、不派事件，也要跟上
    setCurrentProjectPath('P2');
    expect(sync.current()).toMatchObject({ projectId: 'P2', taskId: 'task-A' });
    expect(setAnnotationDraftScopeMock.mock.lastCall?.[0]).toMatchObject({ projectId: 'P2', taskId: 'task-A' });
    expect(session.scope.value?.projectId).toBe('P2');
    expect(session.state.value.epoch).toBe(epochBefore + 1);
    // 同值再设：不重算、不递增
    const calls = setAnnotationDraftScopeMock.mock.calls.length;
    setCurrentProjectPath('P2');
    expect(setAnnotationDraftScopeMock.mock.calls.length).toBe(calls);
    expect(session.state.value.epoch).toBe(epochBefore + 1);
    sync.stop();

    // 宿主自己给 projectId（嵌入模式）：值变了没人碰 store，切换工程事件 / popstate 让它重取
    let hostProject = 'P3';
    const hosted = useAnnotationDraftScopeSync({ projectId: () => hostProject });
    expect(hosted.current()?.projectId).toBe('P3');
    hostProject = 'P4';
    expect(hosted.current()?.projectId).toBe('P3');
    window.dispatchEvent(new CustomEvent('modelProjectChanged', { detail: {} }));
    expect(hosted.current()?.projectId).toBe('P4');
    hostProject = 'P5';
    window.dispatchEvent(new Event('popstate'));
    expect(hosted.current()?.projectId).toBe('P5');
    hosted.stop();

    // 最后一个宿主卸了：信号监听一起拆，不再碰 store
    const after = setAnnotationDraftScopeMock.mock.calls.length;
    setCurrentProjectPath('P6');
    window.dispatchEvent(new Event('popstate'));
    expect(setAnnotationDraftScopeMock.mock.calls.length).toBe(after);
    setCurrentProjectPath(null);
  });

  it('开关关着：不装同步、不碰 store', () => {
    setAnnotationUxFlag('scopedDraftsV1', false);
    resetAnnotationUxFlagCache();
    const sync = useAnnotationDraftScopeSync();
    currentTask.value = { id: 'task-A' };
    expect(setAnnotationDraftScopeMock).not.toHaveBeenCalled();
    expect(sync.current()).toBeNull();
    expect(getAnnotationDraftScopeSyncHostCount()).toBe(0);
    sync.stop();
    expect(setAnnotationDraftScopeMock).not.toHaveBeenCalled();
  });
});

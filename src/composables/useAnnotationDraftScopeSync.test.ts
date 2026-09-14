import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

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

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({ currentTask }),
}));
vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({ setAnnotationDraftScope: setAnnotationDraftScopeMock }),
}));
vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser, currentUserId: ref('fallback-user') }),
}));

import {
  computeAnnotationDraftScope,
  deriveTaskReviewRound,
  DRAFT_SESSION_ID_STORAGE_KEY,
  resolveTabDraftSessionId,
  useAnnotationDraftScopeSync,
} from './useAnnotationDraftScopeSync';
import { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } from './useAnnotationDraftSession';
import { resetAnnotationUxFlagCache, setAnnotationUxFlag } from './useAnnotationUxFlags';

import type { AnnotationScope } from '@/review/domain/annotationScope';

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
    currentTask.value = null;
    currentUser.value = { id: 'JH' };
    sessionStorage.setItem(DRAFT_SESSION_ID_STORAGE_KEY, 'ds-tab');
  });

  afterEach(() => {
    resetAnnotationUxFlagCache();
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

  it('开关关着：不装同步、不碰 store', () => {
    setAnnotationUxFlag('scopedDraftsV1', false);
    resetAnnotationUxFlagCache();
    const sync = useAnnotationDraftScopeSync();
    currentTask.value = { id: 'task-A' };
    expect(setAnnotationDraftScopeMock).not.toHaveBeenCalled();
    expect(sync.current()).toBeNull();
    sync.stop();
    expect(setAnnotationDraftScopeMock).not.toHaveBeenCalled();
  });
});

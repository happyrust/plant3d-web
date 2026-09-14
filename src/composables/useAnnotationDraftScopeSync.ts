import { getCurrentScope, onScopeDispose, watch } from 'vue';

import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { isAnnotationUxFlagEnabled } from '@/composables/useAnnotationUxFlags';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { getOutputProjectFromUrl } from '@/lib/filesOutput';
import {
  buildAnnotationScope,
  canonicalizeReviewRound,
  createDraftSessionId,
  type AnnotationScope,
} from '@/review/domain/annotationScope';

/**
 * 把校审上下文（当前任务 / 当前用户 / 项目）同步成批注草稿 scope——U0 的接线层。
 *
 * - 有任务：scope = 项目 + 任务 id + 轮次 + 用户；没有任务（新建单据 / 外部按 form 聚焦）：用**本 tab 的** `draftSessionId`
 *   顶替任务 id（`sessionStorage` 记一份，刷新不丢、跨 tab 不共用），这样旧 `project=…|db=…` 容器在校审面板打开期间**永远不再被写**，
 *   真正只读。
 * - 同步是 `flush:'sync'`：`currentTask` 一变就切容器，抢在面板自己的 `watch(currentTask)`（确认记录回放、clearAll）之前，
 *   回放的东西只会落进新任务的 key。
 * - 宿主（面板）卸载时回到 null：离开校审上下文 = 回到旧作用域；`useAnnotationDraftSession` 同步 `enterScope / leaveScope`。
 * - 开关 `annotationUx.scopedDraftsV1` 关着 = 整个同步不装，store 照旧。
 */

export type AnnotationDraftScopeTask = {
  id: string;
  /** 今天的 ReviewTask 没有这个字段；U3 `annotation-context.review_round` 到位后从服务端权威值填 */
  reviewRound?: number | null;
};

export type AnnotationDraftScopeInput = {
  projectId: string | null;
  task: AnnotationDraftScopeTask | null;
  userId: string | null;
  /** 没有任务时顶替任务 id 的会话身份 */
  draftSessionId: string;
};

/**
 * 任务的校审轮次。只认任务对象上显式的 `reviewRound`（服务端给的），拿不到就 0。
 * **不**从 `workflowHistory` 数 `return` 推：列表 / 详情两条路径 history 有无不一致，会把同一任务的草稿劈成两个 key。
 */
export function deriveTaskReviewRound(task: AnnotationDraftScopeTask | null | undefined): number {
  return canonicalizeReviewRound(task?.reviewRound);
}

export function computeAnnotationDraftScope(input: AnnotationDraftScopeInput): AnnotationScope {
  const taskId = input.task?.id ?? null;
  return buildAnnotationScope({
    projectId: input.projectId,
    taskId,
    draftSessionId: taskId ? null : input.draftSessionId,
    reviewRound: deriveTaskReviewRound(input.task),
    userId: input.userId,
  });
}

export const DRAFT_SESSION_ID_STORAGE_KEY = 'plant3d.review.draftSessionId';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

let memoryDraftSessionId: string | null = null;

/** 本 tab 的 draftSessionId：sessionStorage 里有就用，没有就造一个记进去；拿不到 sessionStorage 就退到进程内存 */
export function resolveTabDraftSessionId(storage: StorageLike | null = defaultSessionStorage()): string {
  if (storage) {
    try {
      const existing = storage.getItem(DRAFT_SESSION_ID_STORAGE_KEY)?.trim();
      if (existing) return existing;
      const created = createDraftSessionId();
      storage.setItem(DRAFT_SESSION_ID_STORAGE_KEY, created);
      return created;
    } catch {
      // 落到内存
    }
  }
  if (!memoryDraftSessionId) memoryDraftSessionId = createDraftSessionId();
  return memoryDraftSessionId;
}

function defaultSessionStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** 与 `useToolStore.getCurrentStorageScope()` 同一取法：`output_project` → `project_id` */
export function readProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromOutput = getOutputProjectFromUrl();
    if (fromOutput) return fromOutput;
    return new URLSearchParams(window.location.search).get('project_id');
  } catch {
    return null;
  }
}

export type AnnotationDraftScopeSyncOptions = {
  /** 当前用户 id 的取法；缺省用用户库（嵌入模式的面板应把可信 JWT 身份传进来） */
  userId?: () => string | null | undefined;
  projectId?: () => string | null | undefined;
  draftSessionId?: () => string;
};

export type AnnotationDraftScopeSync = {
  /** 当前同步出来的 scope（开关关 / 尚未同步时 null） */
  current: () => AnnotationScope | null;
  stop: () => void;
};

export function useAnnotationDraftScopeSync(options: AnnotationDraftScopeSyncOptions = {}): AnnotationDraftScopeSync {
  if (!isAnnotationUxFlagEnabled('scopedDraftsV1')) {
    return { current: () => null, stop: () => {} };
  }

  const reviewStore = useReviewStore();
  const toolStore = useToolStore();
  const userStore = useUserStore();
  const draftSession = useAnnotationDraftSession();

  let current: AnnotationScope | null = null;

  const readUserId = (): string | null => {
    const fromOption = options.userId?.();
    if (typeof fromOption === 'string' && fromOption.trim()) return fromOption.trim();
    const store = userStore as {
      currentUser?: { value?: { id?: string | null } | null };
      currentUserId?: { value?: string | null };
    };
    return store.currentUser?.value?.id?.trim() || store.currentUserId?.value?.trim() || null;
  };

  const readProjectId = (): string | null => {
    const fromOption = options.projectId?.();
    if (typeof fromOption === 'string' && fromOption.trim()) return fromOption.trim();
    return readProjectIdFromUrl();
  };

  const apply = (scope: AnnotationScope) => {
    current = scope;
    (toolStore as { setAnnotationDraftScope?: (s: AnnotationScope | null) => boolean }).setAnnotationDraftScope?.(scope);
    draftSession.enterScope(scope);
  };

  const stopWatch = watch(
    () => {
      const task = reviewStore.currentTask.value as (AnnotationDraftScopeTask & { workflowHistory?: unknown }) | null;
      return {
        taskId: task?.id ?? null,
        reviewRound: deriveTaskReviewRound(task),
        userId: readUserId(),
        projectId: readProjectId(),
      };
    },
    (snapshot) => {
      apply(computeAnnotationDraftScope({
        projectId: snapshot.projectId,
        task: snapshot.taskId ? { id: snapshot.taskId, reviewRound: snapshot.reviewRound } : null,
        userId: snapshot.userId,
        draftSessionId: options.draftSessionId?.() ?? resolveTabDraftSessionId(),
      }));
    },
    { immediate: true, flush: 'sync' },
  );

  const stop = () => {
    stopWatch();
    current = null;
    (toolStore as { setAnnotationDraftScope?: (s: AnnotationScope | null) => boolean }).setAnnotationDraftScope?.(null);
    draftSession.leaveScope();
  };

  if (getCurrentScope()) onScopeDispose(stop);

  return { current: () => current, stop };
}

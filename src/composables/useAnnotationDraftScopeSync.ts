import { getCurrentScope, onScopeDispose, ref, watch, type WatchStopHandle } from 'vue';

import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { isAnnotationUxFlagEnabled } from '@/composables/useAnnotationUxFlags';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore, type AnnotationDraftJournal } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { getOutputProjectFromUrl, onCurrentProjectPathChange } from '@/lib/filesOutput';
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
 * - **多宿主**：ReviewPanel / DesignerCommentHandlingPanel / InitiateReviewPanel 在 dock 里可以同时开着，每个都装一次；
 *   底下只有一份同步在跑，宿主只是登记 / 注销。最后一个宿主卸载才回到 null（离开校审上下文 = 回到旧作用域）；
 *   中途少一个宿主不影响别的面板。用户 id / 项目 id 按登记顺序取第一个给出值的宿主，都没给再回用户库 / URL。
 * - 本机草稿流水：`useToolStore.annotationDraftJournal` 每变一次就派发进 `useAnnotationDraftSession`
 *   （内容变了 → `edit`；写成 → `local-persisted`；写败 → `local-persist-failed`），面板的「本机」那一行由此而来。
 * - **工程变了 scope 跟着变**：projectId 取自 URL / 当前工程（不是响应式的），所以这里订阅三路信号——
 *   `filesOutput.onCurrentProjectPathChange`（`useModelProjects.applyProject` 每次落工程都会走，含首屏那次不派事件的）、
 *   `modelProjectChanged`（切换工程）、`popstate`（浏览器前进 / 后退 / 别处改 URL 后手动派发）——任一到来就重取一遍 projectId，
 *   与 `useToolStore` 刷新旧作用域用的信号一致。工程换了就是另一个 scope：容器切走、epoch+1，旧工程在途的回执只能归旧工程。
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
  /** 当前同步出来的 scope（开关关 / 本宿主已注销 / 尚未同步时 null） */
  current: () => AnnotationScope | null;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// 共享的一份同步 + 宿主登记表
// ---------------------------------------------------------------------------

type Host = { id: symbol; options: AnnotationDraftScopeSyncOptions };

type ToolStoreForScopeSync = {
  setAnnotationDraftScope?: (scope: AnnotationScope | null) => boolean;
  annotationDraftJournal?: { value: AnnotationDraftJournal };
};

const hosts: Host[] = [];
/** 宿主增减时 +1，让共享 watch 重新取一遍 userId / projectId（登记表本身不是响应式的） */
const hostsVersion = ref(0);
/** URL / 当前工程变化时 +1（projectId 不是响应式的，靠它让共享 watch 重取） */
const projectRevision = ref(0);

let currentScope: AnnotationScope | null = null;
let stopSharedWatch: WatchStopHandle | null = null;
let stopJournalWatch: WatchStopHandle | null = null;
let stopProjectSignals: (() => void) | null = null;

/** 工程 / URL 变化的三路信号 → `projectRevision`；返回一次性拆除函数 */
function listenProjectSignals(): () => void {
  const bump = () => {
    projectRevision.value += 1;
  };
  const offPath = onCurrentProjectPathChange(bump);
  if (typeof window === 'undefined') return offPath;
  window.addEventListener('popstate', bump);
  window.addEventListener('modelProjectChanged', bump);
  return () => {
    offPath();
    window.removeEventListener('popstate', bump);
    window.removeEventListener('modelProjectChanged', bump);
  };
}

function firstFromHosts<T>(pick: (host: Host) => T | null | undefined): T | null {
  for (const host of hosts) {
    const value = pick(host);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function startSharedSync(): void {
  const reviewStore = useReviewStore();
  const toolStore = useToolStore() as unknown as ToolStoreForScopeSync;
  const userStore = useUserStore() as {
    currentUser?: { value?: { id?: string | null } | null };
    currentUserId?: { value?: string | null };
  };
  const draftSession = useAnnotationDraftSession();

  const readUserId = (): string | null => {
    const fromHost = firstFromHosts((host) => trimmedOrNull(host.options.userId?.()));
    if (fromHost) return fromHost;
    return trimmedOrNull(userStore.currentUser?.value?.id) || trimmedOrNull(userStore.currentUserId?.value) || null;
  };

  const readProjectId = (): string | null => {
    const fromHost = firstFromHosts((host) => trimmedOrNull(host.options.projectId?.()));
    return fromHost ?? readProjectIdFromUrl();
  };

  const readDraftSessionId = (): string => {
    return firstFromHosts((host) => host.options.draftSessionId?.()) ?? resolveTabDraftSessionId();
  };

  const apply = (scope: AnnotationScope) => {
    currentScope = scope;
    toolStore.setAnnotationDraftScope?.(scope);
    draftSession.enterScope(scope);
  };

  stopProjectSignals = listenProjectSignals();

  stopSharedWatch = watch(
    () => {
      void hostsVersion.value;
      void projectRevision.value;
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
        draftSessionId: readDraftSessionId(),
      }));
    },
    { immediate: true, flush: 'sync' },
  );

  // 本机草稿流水 → 草稿会话。`flush:'sync'`：切 scope 时旧容器的刷盘回执要落在旧 scope 的会话里，不能等到 enterScope 之后。
  const journalRef = toolStore.annotationDraftJournal;
  if (journalRef) {
    stopJournalWatch = watch(
      () => journalRef.value,
      (journal, prev) => {
        if (!journal || !draftSession.scope.value) return;
        if (!prev || journal.revision > prev.revision) draftSession.markEdited(journal.at);
        const revision = draftSession.state.value.localRevision;
        if (revision === 0) return;
        if (journal.failedRevision !== null && journal.failedRevision >= journal.revision) {
          draftSession.dispatch({ type: 'local-persist-failed', revision, error: journal.error, at: journal.at });
        } else if (journal.persistedRevision >= journal.revision) {
          draftSession.dispatch({ type: 'local-persisted', revision, at: journal.at });
        }
      },
      { flush: 'sync' },
    );
  }
}

function stopSharedSync(): void {
  stopSharedWatch?.();
  stopSharedWatch = null;
  stopJournalWatch?.();
  stopJournalWatch = null;
  stopProjectSignals?.();
  stopProjectSignals = null;
  currentScope = null;
  (useToolStore() as unknown as ToolStoreForScopeSync).setAnnotationDraftScope?.(null);
  useAnnotationDraftSession().leaveScope();
}

export function useAnnotationDraftScopeSync(options: AnnotationDraftScopeSyncOptions = {}): AnnotationDraftScopeSync {
  if (!isAnnotationUxFlagEnabled('scopedDraftsV1')) {
    return { current: () => null, stop: () => {} };
  }

  const host: Host = { id: Symbol('annotation-draft-scope-host'), options };
  let registered = true;
  hosts.push(host);
  if (hosts.length === 1) {
    startSharedSync();
  } else {
    hostsVersion.value += 1;
  }

  const stop = () => {
    if (!registered) return;
    registered = false;
    const index = hosts.indexOf(host);
    if (index >= 0) hosts.splice(index, 1);
    if (hosts.length === 0) {
      stopSharedSync();
    } else {
      hostsVersion.value += 1;
    }
  };

  if (getCurrentScope()) onScopeDispose(stop);

  return { current: () => (registered ? currentScope : null), stop };
}

/** 当前登记在册的宿主数（测试 / 排障用） */
export function getAnnotationDraftScopeSyncHostCount(): number {
  return hosts.length;
}

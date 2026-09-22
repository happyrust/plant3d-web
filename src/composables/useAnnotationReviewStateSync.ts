import {
  annotationReviewStatesQuery,
  normalizeAnnotationReviewStateView,
  type AnnotationReviewStateView,
} from '@/api/reviewApi';
import { useToolStore, type AnnotationType } from '@/composables/useToolStore';

const VALID_ANNOTATION_TYPES: readonly AnnotationType[] = ['text', 'cloud', 'rect', 'obb'];

function isValidAnnotationType(value: unknown): value is AnnotationType {
  return typeof value === 'string'
    && (VALID_ANNOTATION_TYPES as readonly string[]).includes(value);
}

function getAnnotationStateKey(view: AnnotationReviewStateView): string | null {
  const annotationId = typeof view.annotationId === 'string' ? view.annotationId.trim() : '';
  if (!annotationId) return null;
  if (!isValidAnnotationType(view.annotationType)) return null;
  return `${view.annotationType}:${annotationId}`;
}

function isNewerAnnotationState(
  candidate: AnnotationReviewStateView,
  current: AnnotationReviewStateView,
): boolean {
  const candidateRound = Number.isFinite(candidate.reviewRound) ? candidate.reviewRound : 0;
  const currentRound = Number.isFinite(current.reviewRound) ? current.reviewRound : 0;
  if (candidateRound !== currentRound) return candidateRound > currentRound;

  const candidateUpdatedAt = Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0;
  const currentUpdatedAt = Number.isFinite(current.updatedAt) ? current.updatedAt : 0;
  return candidateUpdatedAt > currentUpdatedAt;
}

function pickLatestAnnotationStates(
  views: (AnnotationReviewStateView | null | undefined)[],
): AnnotationReviewStateView[] {
  const latestByAnnotation = new Map<string, AnnotationReviewStateView>();
  for (const view of views) {
    if (!view) continue;
    const key = getAnnotationStateKey(view);
    if (!key) continue;

    const current = latestByAnnotation.get(key);
    if (!current || isNewerAnnotationState(view, current)) {
      latestByAnnotation.set(key, view);
    }
  }
  return Array.from(latestByAnnotation.values());
}

export type SyncAnnotationReviewStatesOptions = {
  formId?: string | null;
  taskId?: string | null;
  silent?: boolean;
  /**
   * U0 回执守卫：请求回来、写 store 之前问一次「还该写吗」（调用方拿 scope 戳判）。
   * 返回 false = 用户已切到别的任务，这批状态一条都不写（回到原任务时会重新拉），结果标 `skipped: true`。
   */
  shouldApply?: () => boolean;
  /** 跳过同参合并 / 短窗复用，一定发一次新请求（显式「刷新」用） */
  force?: boolean;
  /** 覆盖短窗长度（毫秒），缺省 `ANNOTATION_REVIEW_STATES_FRESH_WINDOW_MS` */
  freshWindowMs?: number;
};

type AnnotationReviewStatesQueryResponse = Awaited<ReturnType<typeof annotationReviewStatesQuery>>;

type PendingQuery = {
  promise: Promise<AnnotationReviewStatesQueryResponse>;
  /** 回包时刻；null = 还在飞。单独一个对象，方便回调里认出「表里放的还是不是我这一条」 */
  marker: { settledAt: number | null };
};

/**
 * 同参（form_id + task_id）请求的合并窗：回包后这么多毫秒内再来同参调用，直接复用上一份回包不再发请求。
 * 2026-09-22 真机：校审面板一进页 ReviewPanel 几个 watch 各自触发，1.3 s 内对同一 form 发了 10 次 GET
 * `annotation-states`（+845 / +1236 / +1238 / +1277 / +1759 / +1771 / +1789 / +1944 / +1954 / +2122 ms），
 * 回包内容一模一样。窗口刻意短：只吃掉这种一进页的抖动，不替代刷新。
 */
export const ANNOTATION_REVIEW_STATES_FRESH_WINDOW_MS = 1200;

const pendingQueries = new Map<string, PendingQuery>();

function queryCacheKey(formId: string, taskId: string | undefined): string {
  return `${formId}|${taskId ?? ''}`;
}

/**
 * 作废合并窗里的回包：不传 formId 清全部，传了只清该单据下的（含带 / 不带 task_id 两种键）。
 * 本地刚提交过处理动作（`annotation-states/apply`）后要调一次，否则窗内再 sync 会把旧回包写回去、盖掉刚提交的状态。
 */
export function invalidateAnnotationReviewStatesCache(formId?: string | null): void {
  const trimmed = formId?.trim();
  if (!trimmed) {
    pendingQueries.clear();
    return;
  }
  for (const key of Array.from(pendingQueries.keys())) {
    if (key.startsWith(`${trimmed}|`)) pendingQueries.delete(key);
  }
}

/**
 * 同参在飞合并 + 短窗复用：
 * - 同 key 还有请求在飞 → 共用那份 promise；
 * - 同 key 上一份成功回包还在 `freshWindowMs` 内 → 直接复用；
 * - 失败（抛错或 `success=false`）的不进窗，下一次照常重发。
 * 只合并「取回包」这一步；写 store 仍由每个调用方按自己的 `shouldApply` 各自决定（多写一遍是幂等的）。
 */
function fetchAnnotationReviewStatesShared(
  formId: string,
  taskId: string | undefined,
  options: { force?: boolean; freshWindowMs: number },
): Promise<AnnotationReviewStatesQueryResponse> {
  const key = queryCacheKey(formId, taskId);
  const now = Date.now();
  const existing = options.force ? undefined : pendingQueries.get(key);
  if (existing) {
    const { settledAt } = existing.marker;
    const reusable = settledAt === null || now - settledAt <= options.freshWindowMs;
    if (reusable) return existing.promise;
    pendingQueries.delete(key);
  }

  const marker: PendingQuery['marker'] = { settledAt: null };
  const isMine = () => pendingQueries.get(key)?.marker === marker;
  const promise = annotationReviewStatesQuery({ formId, taskId }).then(
    (response) => {
      if (response?.success) {
        marker.settledAt = Date.now();
      } else if (isMine()) {
        pendingQueries.delete(key);
      }
      return response;
    },
    (error: unknown) => {
      if (isMine()) pendingQueries.delete(key);
      throw error;
    },
  );
  pendingQueries.set(key, { promise, marker });
  return promise;
}

export type SyncAnnotationReviewStatesResult = {
  ok: boolean;
  appliedCount: number;
  totalCount: number;
  errorMessage?: string;
  /** `shouldApply` 拒了：请求成功但一条都没写 */
  skipped?: boolean;
};

/**
 * 拉取 `form_id (+ task_id)` 下所有批注的处理状态并写入本地 `toolStore`。
 *
 * 设计师 / 校核 / 审核分布在不同浏览器或会话时，本地 `toolStore.reviewState`
 * 不会自动同步对方的 `fixed/wont_fix/agree/reject + note + history`。
 * 任务级入口（ReviewPanel / DesignerCommentHandlingPanel）在 task 切换时
 * 调用本函数，让批注卡片与时间线能立即看到对方的最新处理。
 *
 * 仅在 formId 存在时调用后端；taskId 缺失时仍可拉取（按 form 维度）。
 * 后端没返回对应批注（数据未上传或被清理）时跳过，不抹平本地已存在的状态。
 * 同参调用在飞合并 + 回包后 `ANNOTATION_REVIEW_STATES_FRESH_WINDOW_MS` 内复用（见 `fetchAnnotationReviewStatesShared`），
 * 传 `force: true` 绕开；本地刚提交处理动作后调 `invalidateAnnotationReviewStatesCache`。
 */
export async function syncAnnotationReviewStates(
  options: SyncAnnotationReviewStatesOptions,
): Promise<SyncAnnotationReviewStatesResult> {
  const formId = options.formId?.trim();
  if (!formId) {
    return { ok: false, appliedCount: 0, totalCount: 0, errorMessage: 'missing formId' };
  }

  let response: AnnotationReviewStatesQueryResponse;
  try {
    response = await fetchAnnotationReviewStatesShared(
      formId,
      options.taskId?.trim() || undefined,
      {
        force: options.force,
        freshWindowMs: options.freshWindowMs ?? ANNOTATION_REVIEW_STATES_FRESH_WINDOW_MS,
      },
    );
  } catch (err) {
    return {
      ok: false,
      appliedCount: 0,
      totalCount: 0,
      errorMessage: err instanceof Error ? err.message : 'annotation states query failed',
    };
  }

  if (!response?.success) {
    return {
      ok: false,
      appliedCount: 0,
      totalCount: 0,
      errorMessage: response?.errorMessage || 'annotation states query failed',
    };
  }

  const views = response.states ?? [];
  if (options.shouldApply && !options.shouldApply()) {
    return { ok: true, appliedCount: 0, totalCount: views.length, skipped: true };
  }

  const store = useToolStore();
  let appliedCount = 0;

  for (const view of pickLatestAnnotationStates(views)) {
    const annotationId = view.annotationId.trim();
    const normalized = normalizeAnnotationReviewStateView(view);
    const ok = store.setAnnotationReviewState(view.annotationType, annotationId, normalized);
    if (ok) appliedCount += 1;
  }

  return {
    ok: true,
    appliedCount,
    totalCount: views.length,
  };
}

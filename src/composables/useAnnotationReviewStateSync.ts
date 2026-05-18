import { annotationReviewStatesQuery, normalizeAnnotationReviewStateView } from '@/api/reviewApi';
import { useToolStore, type AnnotationType } from '@/composables/useToolStore';

const VALID_ANNOTATION_TYPES: ReadonlyArray<AnnotationType> = ['text', 'cloud', 'rect', 'obb'];

function isValidAnnotationType(value: unknown): value is AnnotationType {
  return typeof value === 'string'
    && (VALID_ANNOTATION_TYPES as readonly string[]).includes(value);
}

export type SyncAnnotationReviewStatesOptions = {
  formId?: string | null;
  taskId?: string | null;
  silent?: boolean;
};

export type SyncAnnotationReviewStatesResult = {
  ok: boolean;
  appliedCount: number;
  totalCount: number;
  errorMessage?: string;
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
 */
export async function syncAnnotationReviewStates(
  options: SyncAnnotationReviewStatesOptions,
): Promise<SyncAnnotationReviewStatesResult> {
  const formId = options.formId?.trim();
  if (!formId) {
    return { ok: false, appliedCount: 0, totalCount: 0, errorMessage: 'missing formId' };
  }

  let response: Awaited<ReturnType<typeof annotationReviewStatesQuery>>;
  try {
    response = await annotationReviewStatesQuery({
      formId,
      taskId: options.taskId?.trim() || undefined,
    });
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

  const store = useToolStore();
  const views = response.states ?? [];
  let appliedCount = 0;

  for (const view of views) {
    if (!view) continue;
    const annotationId = typeof view.annotationId === 'string' ? view.annotationId.trim() : '';
    if (!annotationId) continue;
    if (!isValidAnnotationType(view.annotationType)) continue;
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

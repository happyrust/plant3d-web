import type { AnnotationType } from '@/composables/useToolStore';
import type { AnnotationSeverity } from '@/types/auth';

import { annotationBasicFieldsUpdate, annotationSeverityUpdate, type AnnotationUpdateContext } from '@/api/reviewApi';
import { applyAnnotationReceiptByRoute, type ScopedPatchStore } from '@/composables/annotationReceiptRoute';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

type SaveAnnotationOptions = AnnotationUpdateContext & {
  silent?: boolean;
};

type StoreWithScopedPatch = ReturnType<typeof useToolStore> & ScopedPatchStore;

/**
 * U0 回滚落点：保存失败时要把乐观更新撤回——请求期间用户可能已切到别的任务，
 * 那时内存里是别的任务的记录，回滚只能写进出发时那个 scope 的本机容器（方案 §3.6 异步回执核对）。
 * 返回 true = 已按落点处理；false = 出发时那个容器里也找不到这条（比如已被清），什么都不动。
 */
const rollbackByRoute = applyAnnotationReceiptByRoute;

/**
 * Unified severity save: optimistic local update -> backend sync -> rollback on failure.
 * All severity modification entry points (AnnotationPanel, DesignerCommentHandlingPanel,
 * ReviewPanel) should call this instead of updating the store directly.
 */
export async function saveAnnotationSeverity(
  annotationType: AnnotationType,
  annotationId: string,
  severity: AnnotationSeverity | undefined,
  options?: SaveAnnotationOptions,
): Promise<boolean> {
  const store = useToolStore() as StoreWithScopedPatch;
  const draftSession = useAnnotationDraftSession();
  const records = store.getAnnotationRecordsByType(annotationType);
  const record = records.find((r) => r.id === annotationId) as { severity?: AnnotationSeverity } | undefined;
  const prev = record?.severity;

  store.updateAnnotationSeverity(annotationType, annotationId, severity);
  const scopeStamp = draftSession.currentStamp();

  const rollback = () => {
    const route = draftSession.routeDataReceipt(scopeStamp);
    rollbackByRoute(store, route, annotationType, annotationId, { severity: prev }, () => (
      store.updateAnnotationSeverity(annotationType, annotationId, prev)
    ));
    // 提示是瞬态的：人已经在别的任务里就不打扰
    return route.kind !== 'other-scope';
  };

  try {
    const resp = await annotationSeverityUpdate(annotationId, annotationType, severity ?? null, {
      formId: options?.formId,
      taskId: options?.taskId,
    });
    if (resp && resp.success === false) {
      const showToast = rollback();
      if (!options?.silent && showToast) {
        emitToast({ message: '严重度保存失败，已回滚', level: 'error' });
      }
      return false;
    }
    return true;
  } catch (err) {
    const showToast = rollback();
    if (!options?.silent && showToast) {
      emitToast({
        message: err instanceof Error ? err.message : '严重度保存失败',
        level: 'error',
      });
    }
    return false;
  }
}

export async function saveAnnotationBasicFields(
  annotationType: AnnotationType,
  annotationId: string,
  patch: { title?: string; description?: string },
  options?: SaveAnnotationOptions,
): Promise<boolean> {
  const store = useToolStore() as StoreWithScopedPatch;
  const draftSession = useAnnotationDraftSession();
  const records = store.getAnnotationRecordsByType(annotationType);
  const record = records.find((r) => r.id === annotationId) as {
    title?: string;
    description?: string;
  } | undefined;
  const prev = record
    ? {
      title: record.title,
      description: record.description,
    }
    : null;

  store.updateAnnotationBasicFields(annotationType, annotationId, patch);
  const scopeStamp = draftSession.currentStamp();

  const rollback = () => {
    const route = draftSession.routeDataReceipt(scopeStamp);
    if (prev) {
      rollbackByRoute(store, route, annotationType, annotationId, { ...prev }, () => (
        store.updateAnnotationBasicFields(annotationType, annotationId, prev)
      ));
    }
    return route.kind !== 'other-scope';
  };

  try {
    const resp = await annotationBasicFieldsUpdate(annotationId, annotationType, patch, {
      formId: options?.formId,
      taskId: options?.taskId,
    });
    if (resp && resp.success === false) {
      const showToast = rollback();
      if (!options?.silent && showToast) {
        emitToast({ message: '批注标题保存失败，已回滚', level: 'error' });
      }
      return false;
    }
    return true;
  } catch (err) {
    const showToast = rollback();
    if (!options?.silent && showToast) {
      emitToast({
        message: err instanceof Error ? err.message : '批注标题保存失败',
        level: 'error',
      });
    }
    return false;
  }
}

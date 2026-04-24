import type { AnnotationType } from '@/composables/useToolStore';
import { useToolStore } from '@/composables/useToolStore';
import { annotationSeverityUpdate } from '@/api/reviewApi';
import { emitToast } from '@/ribbon/toastBus';
import type { AnnotationSeverity } from '@/types/auth';

/**
 * Unified severity save: optimistic local update -> backend sync -> rollback on failure.
 * All severity modification entry points (AnnotationPanel, DesignerCommentHandlingPanel,
 * ReviewPanel) should call this instead of updating the store directly.
 */
export async function saveAnnotationSeverity(
  annotationType: AnnotationType,
  annotationId: string,
  severity: AnnotationSeverity | undefined,
  options?: { silent?: boolean },
): Promise<boolean> {
  const store = useToolStore();
  const records = store.getAnnotationRecordsByType(annotationType);
  const record = records.find((r) => r.id === annotationId) as { severity?: AnnotationSeverity } | undefined;
  const prev = record?.severity;

  store.updateAnnotationSeverity(annotationType, annotationId, severity);

  try {
    const resp = await annotationSeverityUpdate(annotationId, annotationType, severity ?? null);
    if (resp && resp.success === false) {
      store.updateAnnotationSeverity(annotationType, annotationId, prev);
      if (!options?.silent) {
        emitToast({ message: '严重度保存失败，已回滚', level: 'error' });
      }
      return false;
    }
    return true;
  } catch (err) {
    store.updateAnnotationSeverity(annotationType, annotationId, prev);
    if (!options?.silent) {
      emitToast({
        message: err instanceof Error ? err.message : '严重度保存失败',
        level: 'error',
      });
    }
    return false;
  }
}

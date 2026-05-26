import type { AnnotationType } from '@/composables/useToolStore';
import type { AnnotationScreenshot, AnnotationSeverity } from '@/types/auth';

import {
  annotationBasicFieldsUpdate,
  annotationScreenshotUpdate,
  annotationSeverityUpdate,
  type AnnotationUpdateContext,
} from '@/api/reviewApi';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

type SaveAnnotationOptions = AnnotationUpdateContext & {
  silent?: boolean;
  /**
   * Pending scene annotations do not exist in review_records yet. In that case
   * keep the local screenshot on the annotation and let confirmCurrentData
   * persist it with the full record payload.
   */
  persist?: boolean;
};

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
  const store = useToolStore();
  const records = store.getAnnotationRecordsByType(annotationType);
  const record = records.find((r) => r.id === annotationId) as { severity?: AnnotationSeverity } | undefined;
  const prev = record?.severity;

  store.updateAnnotationSeverity(annotationType, annotationId, severity);

  try {
    const resp = await annotationSeverityUpdate(annotationId, annotationType, severity ?? null, {
      formId: options?.formId,
      taskId: options?.taskId,
    });
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

export async function saveAnnotationBasicFields(
  annotationType: AnnotationType,
  annotationId: string,
  patch: { title?: string; description?: string },
  options?: SaveAnnotationOptions,
): Promise<boolean> {
  const store = useToolStore();
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

  try {
    const resp = await annotationBasicFieldsUpdate(annotationId, annotationType, patch, {
      formId: options?.formId,
      taskId: options?.taskId,
    });
    if (resp && resp.success === false) {
      if (prev) store.updateAnnotationBasicFields(annotationType, annotationId, prev);
      if (!options?.silent) {
        emitToast({ message: '批注标题保存失败，已回滚', level: 'error' });
      }
      return false;
    }
    return true;
  } catch (err) {
    if (prev) store.updateAnnotationBasicFields(annotationType, annotationId, prev);
    if (!options?.silent) {
      emitToast({
        message: err instanceof Error ? err.message : '批注标题保存失败',
        level: 'error',
      });
    }
    return false;
  }
}

export async function saveAnnotationScreenshot(
  annotationType: AnnotationType,
  annotationId: string,
  screenshot: AnnotationScreenshot,
  options?: SaveAnnotationOptions,
): Promise<boolean> {
  const store = useToolStore();
  const records = store.getAnnotationRecordsByType(annotationType);
  const record = records.find((r) => r.id === annotationId) as {
    screenshot?: AnnotationScreenshot;
  } | undefined;
  const prev = record?.screenshot;

  const updated = store.setAnnotationScreenshot(annotationType, annotationId, screenshot);
  if (!updated) {
    if (!options?.silent) {
      emitToast({ message: '截图关联失败，请重试', level: 'error' });
    }
    return false;
  }

  if (options?.persist === false) {
    return true;
  }

  try {
    const resp = await annotationScreenshotUpdate(annotationId, annotationType, screenshot, {
      formId: options?.formId,
      taskId: options?.taskId,
    });
    if (resp && resp.success === false) {
      if (prev) {
        store.setAnnotationScreenshot(annotationType, annotationId, prev);
      } else {
        store.clearAnnotationScreenshot(annotationType, annotationId);
      }
      if (!options?.silent) {
        emitToast({ message: '截图保存失败，已回滚', level: 'error' });
      }
      return false;
    }
    return true;
  } catch (err) {
    if (prev) {
      store.setAnnotationScreenshot(annotationType, annotationId, prev);
    } else {
      store.clearAnnotationScreenshot(annotationType, annotationId);
    }
    if (!options?.silent) {
      emitToast({
        message: err instanceof Error ? err.message : '截图保存失败',
        level: 'error',
      });
    }
    return false;
  }
}

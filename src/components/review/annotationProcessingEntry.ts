import { readonly, ref } from 'vue';

import type { AnnotationType } from '@/composables/useToolStore';

export type AnnotationProcessingEntryTarget = {
  annotationId: string;
  annotationType: AnnotationType;
  formId?: string | null;
  requestedAt: number;
};

const annotationProcessingEntryTargetRef = ref<AnnotationProcessingEntryTarget | null>(null);

export function useAnnotationProcessingEntryTarget() {
  return readonly(annotationProcessingEntryTargetRef);
}

export function setAnnotationProcessingEntryTarget(target: {
  annotationId: string;
  annotationType: AnnotationType;
  formId?: string | null;
}): void {
  annotationProcessingEntryTargetRef.value = {
    ...target,
    requestedAt: Date.now(),
  };
}

export function clearAnnotationProcessingEntryTarget(): void {
  annotationProcessingEntryTargetRef.value = null;
}

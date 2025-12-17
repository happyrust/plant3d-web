import { computed, ref, watch } from 'vue';

import type {
  AnnotationRecord,
  CloudAnnotationRecord,
  MeasurementRecord,
  ObbAnnotationRecord,
  RectAnnotationRecord,
} from './useToolStore';
import type { ReviewTask } from '@/types/auth';

export type ConfirmedRecord = {
  id: string;
  type: 'batch';
  annotations: AnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  measurements: MeasurementRecord[];
  confirmedAt: number;
  note: string;
};

type ReviewPersistedState = {
  version: 1;
  reviewMode: boolean;
  confirmedRecords: ConfirmedRecord[];
};

const STORAGE_KEY = 'plant3d-web-review-v1';

function loadPersisted(): ReviewPersistedState {
  if (typeof localStorage === 'undefined') {
    return { version: 1, reviewMode: false, confirmedRecords: [] };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReviewPersistedState;
      if (parsed && parsed.version === 1) {
        return {
          version: 1,
          reviewMode: parsed.reviewMode ?? false,
          confirmedRecords: Array.isArray(parsed.confirmedRecords) ? parsed.confirmedRecords : [],
        };
      }
    }
  } catch {
    // ignore
  }

  return { version: 1, reviewMode: false, confirmedRecords: [] };
}

const persisted = loadPersisted();

const reviewMode = ref<boolean>(persisted.reviewMode);
const confirmedRecords = ref<ConfirmedRecord[]>(persisted.confirmedRecords);
const currentTask = ref<ReviewTask | null>(null);

watch(
  () => ({
    reviewMode: reviewMode.value,
    confirmedRecords: confirmedRecords.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    const payload: ReviewPersistedState = {
      version: 1,
      reviewMode: state.reviewMode,
      confirmedRecords: state.confirmedRecords,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

function setReviewMode(mode: boolean) {
  reviewMode.value = mode;
}

function toggleReviewMode() {
  reviewMode.value = !reviewMode.value;
}

function addConfirmedRecord(record: Omit<ConfirmedRecord, 'id' | 'confirmedAt'>) {
  const newRecord: ConfirmedRecord = {
    ...record,
    id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    confirmedAt: Date.now(),
  };
  confirmedRecords.value = [...confirmedRecords.value, newRecord];
  return newRecord.id;
}

function removeConfirmedRecord(id: string) {
  confirmedRecords.value = confirmedRecords.value.filter((r) => r.id !== id);
}

function clearConfirmedRecords() {
  confirmedRecords.value = [];
}

function setCurrentTask(task: ReviewTask | null) {
  currentTask.value = task;
  if (task) {
    // 设置为审核模式
    reviewMode.value = true;
  }
}

function clearCurrentTask() {
  currentTask.value = null;
}

function exportReviewData(): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    records: confirmedRecords.value,
  };
  return JSON.stringify(payload, null, 2);
}

const confirmedRecordCount = computed(() => confirmedRecords.value.length);

const totalConfirmedAnnotations = computed(() => {
  return confirmedRecords.value.reduce((sum, r) => {
    return (
      sum +
      r.annotations.length +
      r.cloudAnnotations.length +
      r.rectAnnotations.length +
      r.obbAnnotations.length
    );
  }, 0);
});

const totalConfirmedMeasurements = computed(() => {
  return confirmedRecords.value.reduce((sum, r) => sum + r.measurements.length, 0);
});

const sortedConfirmedRecords = computed(() => {
  return [...confirmedRecords.value].sort((a, b) => b.confirmedAt - a.confirmedAt);
});

export function useReviewStore() {
  return {
    reviewMode,
    confirmedRecords,
    currentTask,

    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,

    setReviewMode,
    toggleReviewMode,
    addConfirmedRecord,
    removeConfirmedRecord,
    clearConfirmedRecords,
    exportReviewData,
    setCurrentTask,
    clearCurrentTask,
  };
}

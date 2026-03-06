import { computed, onMounted, ref, watch } from 'vue';

import type {
  AnnotationRecord,
  CloudAnnotationRecord,
  MeasurementRecord,
  ObbAnnotationRecord,
  RectAnnotationRecord,
} from './useToolStore';
import type { ReviewTask } from '@/types/auth';
import {
  reviewRecordCreate,
  reviewRecordDelete,
  reviewRecordGetByTaskId,
  reviewRecordClearByTaskId,
  reviewTaskGetHistory,
  getReviewUserWebSocketUrl,
  type ConfirmedRecordData,
  type ReviewHistoryItem,
} from '@/api/reviewApi';

export type ConfirmedRecord = {
  id: string;
  taskId?: string;
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
  version: 2;
  reviewMode: boolean;
  confirmedRecords: ConfirmedRecord[];
  useBackend: boolean;
};

const STORAGE_KEY = 'plant3d-web-review-v2';
const STORAGE_KEY_V1 = 'plant3d-web-review-v1';

// 配置：是否使用后端 API
const USE_BACKEND = ref(true);

function loadPersisted(): ReviewPersistedState {
  if (typeof localStorage === 'undefined') {
    return { version: 2, reviewMode: false, confirmedRecords: [], useBackend: true };
  }

  try {
    // 尝试加载 V2
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReviewPersistedState;
      if (parsed && parsed.version === 2) {
        return {
          version: 2,
          reviewMode: parsed.reviewMode ?? false,
          confirmedRecords: Array.isArray(parsed.confirmedRecords) ? parsed.confirmedRecords : [],
          useBackend: parsed.useBackend ?? true,
        };
      }
    }

    // 兼容 V1
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      if (parsed && parsed.version === 1) {
        return {
          version: 2,
          reviewMode: parsed.reviewMode ?? false,
          confirmedRecords: Array.isArray(parsed.confirmedRecords) ? parsed.confirmedRecords : [],
          useBackend: true,
        };
      }
    }
  } catch {
    // ignore
  }

  return { version: 2, reviewMode: false, confirmedRecords: [], useBackend: true };
}

const persisted = loadPersisted();
USE_BACKEND.value = persisted.useBackend;

const reviewMode = ref<boolean>(persisted.reviewMode);
const confirmedRecords = ref<ConfirmedRecord[]>(persisted.confirmedRecords);
const currentTask = ref<ReviewTask | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const reviewHistory = ref<ReviewHistoryItem[]>([]);

// WebSocket 连接状态
const wsConnected = ref(false);
const wsError = ref<string | null>(null);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectCount = 0;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = 3000;

// 本地持久化
watch(
  () => ({
    reviewMode: reviewMode.value,
    confirmedRecords: confirmedRecords.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    if (USE_BACKEND.value) return; // 使用后端时不本地保存

    const payload: ReviewPersistedState = {
      version: 2,
      reviewMode: state.reviewMode,
      confirmedRecords: state.confirmedRecords,
      useBackend: USE_BACKEND.value,
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

// ============ 确认记录操作 ============

async function addConfirmedRecord(
  record: Omit<ConfirmedRecord, 'id' | 'confirmedAt'>
): Promise<string> {
  const taskId = currentTask.value?.id;

  if (USE_BACKEND.value && taskId) {
    // 使用后端 API
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewRecordCreate({
        taskId,
        type: record.type,
        annotations: record.annotations,
        cloudAnnotations: record.cloudAnnotations,
        rectAnnotations: record.rectAnnotations,
        obbAnnotations: record.obbAnnotations,
        measurements: record.measurements,
        note: record.note,
      });

      if (response.success && response.record) {
        const newRecord: ConfirmedRecord = {
          id: response.record.id,
          taskId,
          type: 'batch',
          annotations: record.annotations,
          cloudAnnotations: record.cloudAnnotations,
          rectAnnotations: record.rectAnnotations,
          obbAnnotations: record.obbAnnotations,
          measurements: record.measurements,
          confirmedAt: response.record.confirmedAt,
          note: record.note,
        };
        confirmedRecords.value = [...confirmedRecords.value, newRecord];
        return newRecord.id;
      } else {
        throw new Error(response.error_message || '保存确认记录失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '保存确认记录失败';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  // 本地模式（无任务或未启用后端）
  const newRecord: ConfirmedRecord = {
    ...record,
    id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: taskId || undefined,
    confirmedAt: Date.now(),
  };
  confirmedRecords.value = [...confirmedRecords.value, newRecord];
  return newRecord.id;
}

async function removeConfirmedRecord(id: string): Promise<void> {
  let canRemoveLocal = true;

  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewRecordDelete(id);
      if (!response.success) {
        throw new Error(response.error_message || '删除确认记录失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除确认记录失败';
      canRemoveLocal = false;
    } finally {
      loading.value = false;
    }
  }

  if (canRemoveLocal) {
    confirmedRecords.value = confirmedRecords.value.filter((r) => r.id !== id);
  }
}

async function clearConfirmedRecords(): Promise<void> {
  const taskId = currentTask.value?.id;

  if (USE_BACKEND.value && taskId) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewRecordClearByTaskId(taskId);
      if (!response.success) {
        throw new Error(response.error_message || '清空确认记录失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '清空确认记录失败';
    } finally {
      loading.value = false;
    }
  }

  confirmedRecords.value = [];
}

async function loadConfirmedRecords(taskId: string): Promise<void> {
  if (!USE_BACKEND.value) return;

  loading.value = true;
  error.value = null;
  try {
    const response = await reviewRecordGetByTaskId(taskId);
    if (response.success && response.records) {
      confirmedRecords.value = response.records.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        type: 'batch' as const,
        annotations: r.annotations as AnnotationRecord[],
        cloudAnnotations: r.cloudAnnotations as CloudAnnotationRecord[],
        rectAnnotations: r.rectAnnotations as RectAnnotationRecord[],
        obbAnnotations: r.obbAnnotations as ObbAnnotationRecord[],
        measurements: r.measurements as MeasurementRecord[],
        confirmedAt: r.confirmedAt,
        note: r.note,
      }));
    } else if (response.error_message) {
      throw new Error(response.error_message);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载确认记录失败';
  } finally {
    loading.value = false;
  }
}

// ============ 审核历史 ============

async function loadReviewHistory(taskId: string): Promise<void> {
  if (!USE_BACKEND.value) {
    reviewHistory.value = [];
    return;
  }

  loading.value = true;
  try {
    const response = await reviewTaskGetHistory(taskId);
    if (response.success) {
      reviewHistory.value = response.history;
    }
  } catch (e) {
    console.error('Failed to load review history:', e);
  } finally {
    loading.value = false;
  }
}

// ============ 当前任务管理 ============

async function setCurrentTask(task: ReviewTask | null) {
  currentTask.value = task;
  if (task) {
    reviewMode.value = true;
    // 加载任务的确认记录和历史
    await Promise.all([
      loadConfirmedRecords(task.id),
      loadReviewHistory(task.id),
    ]);
    // 连接 WebSocket 获取实时更新
    connectWebSocket(task.reviewerId);
  } else {
    disconnectWebSocket();
    confirmedRecords.value = [];
    reviewHistory.value = [];
  }
}

function clearCurrentTask() {
  currentTask.value = null;
  disconnectWebSocket();
}

// ============ WebSocket 连接 ============

function connectWebSocket(userId: string) {
  if (!USE_BACKEND.value) return;
  if (ws) return;

  const url = getReviewUserWebSocketUrl(userId);

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      wsConnected.value = true;
      wsError.value = null;
      reconnectCount = 0;
      console.log('[ReviewStore] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (e) {
        console.error('[ReviewStore] Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = () => {
      wsError.value = 'WebSocket 连接错误';
    };

    ws.onclose = () => {
      wsConnected.value = false;
      ws = null;

      // 自动重连
      if (currentTask.value && reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        wsError.value = `连接断开，${RECONNECT_DELAY / 1000}秒后重试 (${reconnectCount}/${MAX_RECONNECT})`;
        reconnectTimer = setTimeout(() => {
          if (currentTask.value) {
            connectWebSocket(currentTask.value.reviewerId);
          }
        }, RECONNECT_DELAY);
      }
    };
  } catch (e) {
    console.error('[ReviewStore] Failed to connect WebSocket:', e);
  }
}

function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  wsConnected.value = false;
  reconnectCount = 0;
}

function handleWebSocketMessage(message: {
  type: string;
  data: unknown;
  timestamp: string;
}) {
  const taskId = currentTask.value?.id;
  if (!taskId) return;

  switch (message.type) {
    case 'record_saved': {
      // 其他用户保存了确认记录，刷新列表
      loadConfirmedRecords(taskId);
      break;
    }
    case 'task_updated':
    case 'task_approved':
    case 'task_rejected': {
      // 任务状态更新，刷新历史
      loadReviewHistory(taskId);
      break;
    }
    case 'comment_added': {
      // 新评论，可以触发通知
      console.log('[ReviewStore] New comment:', message.data);
      break;
    }
  }
}

// ============ 导出功能 ============

function exportReviewData(): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    taskId: currentTask.value?.id,
    taskTitle: currentTask.value?.title,
    records: confirmedRecords.value,
  };
  return JSON.stringify(payload, null, 2);
}

// ============ 计算属性 ============

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

// ============ 配置 ============

function setUseBackend(use: boolean) {
  USE_BACKEND.value = use;
  if (typeof localStorage !== 'undefined') {
    const payload: ReviewPersistedState = {
      version: 2,
      reviewMode: reviewMode.value,
      confirmedRecords: use ? [] : confirmedRecords.value,
      useBackend: use,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

export function useReviewStore() {
  return {
    // 状态
    reviewMode,
    confirmedRecords,
    currentTask,
    loading,
    error,
    reviewHistory,

    // WebSocket 状态
    wsConnected,
    wsError,

    // 配置
    useBackend: USE_BACKEND,
    setUseBackend,

    // 计算属性
    confirmedRecordCount,
    totalConfirmedAnnotations,
    totalConfirmedMeasurements,
    sortedConfirmedRecords,

    // 方法
    setReviewMode,
    toggleReviewMode,
    addConfirmedRecord,
    removeConfirmedRecord,
    clearConfirmedRecords,
    loadConfirmedRecords,
    loadReviewHistory,
    exportReviewData,
    setCurrentTask,
    clearCurrentTask,

    // WebSocket
    connectWebSocket,
    disconnectWebSocket,
  };
}

import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';

import type { AnnotationComment } from '@/types/auth';

import { reviewCommentGetByAnnotation } from '@/api/reviewApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore, type AnnotationType } from '@/composables/useToolStore';
import { buildCommentThreadKey } from '@/review/domain/commentThread';
import { liftAnnotationComment } from '@/review/domain/reviewSnapshot';
import {
  getCommentsFromStore,
  getReviewCommentThreadStore,
} from '@/review/services/sharedStores';

type CommentThreadRequest = {
  annotationType: AnnotationType | null;
  annotationId: string | null;
  formId?: string | null;
  taskId?: string | null;
  enabled?: boolean;
}

type CommentThreadRequestInput = MaybeRefOrGetter<CommentThreadRequest>;

type ActiveThread = {
  request: ResolvedCommentThreadRequest;
  consumers: number;
}

type ResolvedCommentThreadRequest = {
  annotationType: AnnotationType;
  annotationId: string;
  formId: string | null;
  taskId: string | null;
}

const activeThreads = new Map<string, ActiveThread>();
const inflightRefreshes = new Map<string, Promise<void>>();
let stopRealtimeListener: (() => void) | null = null;

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveRequest(input: CommentThreadRequest): ResolvedCommentThreadRequest | null {
  if (input.enabled === false) return null;
  if (!input.annotationType || !input.annotationId) return null;
  const annotationId = normalizeString(input.annotationId);
  if (!annotationId) return null;
  return {
    annotationType: input.annotationType,
    annotationId,
    formId: normalizeString(input.formId),
    taskId: normalizeString(input.taskId),
  };
}

function refreshKey(request: ResolvedCommentThreadRequest): string {
  return [
    request.annotationType,
    request.annotationId,
    request.formId ?? '',
    request.taskId ?? '',
  ].join('|');
}

function registerActiveThread(request: ResolvedCommentThreadRequest): () => void {
  const key = refreshKey(request);
  const existing = activeThreads.get(key);
  if (existing) {
    existing.consumers += 1;
  } else {
    activeThreads.set(key, { request, consumers: 1 });
  }
  return () => {
    const current = activeThreads.get(key);
    if (!current) return;
    if (current.consumers <= 1) {
      activeThreads.delete(key);
      return;
    }
    current.consumers -= 1;
  };
}

function extractIncomingComment(data: unknown): Partial<ResolvedCommentThreadRequest> | null {
  if (!data || typeof data !== 'object') return null;
  const source = 'comment' in data && data.comment && typeof data.comment === 'object'
    ? data.comment as Record<string, unknown>
    : data as Record<string, unknown>;
  const annotationType = normalizeString(source.annotationType);
  const annotationId = normalizeString(source.annotationId);
  if (!annotationType || !annotationId) return null;
  return {
    annotationType: annotationType as AnnotationType,
    annotationId,
    formId: normalizeString(source.formId ?? source.form_id),
    taskId: normalizeString(source.taskId ?? source.task_id),
  };
}

function matchesActiveThread(
  request: ResolvedCommentThreadRequest,
  incoming: Partial<ResolvedCommentThreadRequest>,
): boolean {
  if (incoming.annotationType !== request.annotationType) return false;
  if (incoming.annotationId !== request.annotationId) return false;
  if (incoming.formId && incoming.formId !== request.formId) return false;
  if (incoming.taskId && incoming.taskId !== request.taskId) return false;
  return true;
}

function ensureRealtimeListener(onCommentAdded: (callback: (data: unknown) => void) => () => void): void {
  if (stopRealtimeListener) return;
  stopRealtimeListener = onCommentAdded((data) => {
    const incoming = extractIncomingComment(data);
    if (!incoming) return;
    const matched = new Map<string, ResolvedCommentThreadRequest>();
    for (const thread of activeThreads.values()) {
      if (!matchesActiveThread(thread.request, incoming)) continue;
      matched.set(refreshKey(thread.request), thread.request);
    }
    for (const request of matched.values()) {
      void refreshCommentThread(request);
    }
  });
}

export async function refreshCommentThread(input: CommentThreadRequest): Promise<void> {
  const request = resolveRequest(input);
  if (!request) return;
  const key = refreshKey(request);
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const resp = await reviewCommentGetByAnnotation(request.annotationId, request.annotationType, {
      formId: request.formId ?? undefined,
      taskId: request.taskId ?? undefined,
    });
    if (!resp.success || !resp.comments) return;

    const seenCommentIds = new Set<string>();
    const comments = resp.comments
      .map((comment) => ({
        ...comment,
        annotationId: request.annotationId,
        annotationType: request.annotationType,
      }))
      .filter((comment) => {
        if (!comment.id) return true;
        if (seenCommentIds.has(comment.id)) return false;
        seenCommentIds.add(comment.id);
        return true;
      })
      .sort((a, b) => a.createdAt - b.createdAt);

    const threadKey = buildCommentThreadKey(
      request.annotationType,
      request.annotationId,
      request.formId,
      request.taskId,
    );
    getReviewCommentThreadStore().setThreadComments(
      threadKey,
      comments.map((comment) => liftAnnotationComment(comment, {
        annotationType: request.annotationType,
        formId: request.formId ?? undefined,
        taskId: request.taskId ?? undefined,
      })),
    );
    useToolStore().setAnnotationComments(
      request.annotationType,
      request.annotationId,
      comments,
      request.formId,
      request.taskId,
    );
  })().finally(() => {
    inflightRefreshes.delete(key);
  });

  inflightRefreshes.set(key, promise);
  return promise;
}

export function useCommentThread(input: CommentThreadRequestInput) {
  const reviewStore = useReviewStore();
  const storeVersion = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let unregisterActiveThread: (() => void) | null = null;
  let stopStoreListener: (() => void) | null = null;

  ensureRealtimeListener(reviewStore.onCommentAdded);

  const request = computed(() => resolveRequest(toValue(input)));
  const requestKey = computed(() => (request.value ? refreshKey(request.value) : null));

  async function refresh(): Promise<void> {
    if (!request.value) return;
    loading.value = true;
    error.value = null;
    try {
      await refreshCommentThread(request.value);
      storeVersion.value += 1;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载评论失败';
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    stopStoreListener = getReviewCommentThreadStore().subscribe(() => {
      storeVersion.value += 1;
    });
  });

  onUnmounted(() => {
    stopStoreListener?.();
    stopStoreListener = null;
    unregisterActiveThread?.();
    unregisterActiveThread = null;
  });

  watch(
    requestKey,
    () => {
      unregisterActiveThread?.();
      unregisterActiveThread = null;
      if (request.value) {
        unregisterActiveThread = registerActiveThread(request.value);
      }
      void refresh();
    },
    { immediate: true },
  );

  const comments = computed<AnnotationComment[]>(() => {
    void storeVersion.value;
    if (!request.value) return [];
    return getCommentsFromStore(
      request.value.annotationType,
      request.value.annotationId,
      request.value.formId,
      request.value.taskId,
    ).sort((a, b) => a.createdAt - b.createdAt);
  });

  return {
    comments,
    loading,
    error,
    refresh,
  };
}

export function __resetCommentThreadRefreshForTests(): void {
  stopRealtimeListener?.();
  stopRealtimeListener = null;
  activeThreads.clear();
  inflightRefreshes.clear();
}

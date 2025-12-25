// 校审管理 API 模块
// 提供提资单、审核任务、确认记录的 CRUD 操作

import type {
  ReviewTask,
  ReviewComponent,
  ReviewAttachment,
  AnnotationComment,
  User,
} from '@/types/auth';

// ============ 基础配置 ============

function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL;
  return (envBase && envBase.trim()) || 'http://localhost:8080';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  return (await resp.json()) as T;
}

// ============ 类型定义 ============

export type ReviewTaskCreateRequest = {
  title: string;
  description?: string;
  modelName: string;
  reviewerId: string;
  priority: ReviewTask['priority'];
  components: ReviewComponent[];
  dueDate?: number;
  attachments?: ReviewAttachment[];
};

export type ReviewTaskUpdateRequest = {
  title?: string;
  description?: string;
  priority?: ReviewTask['priority'];
  components?: ReviewComponent[];
  dueDate?: number | null;
  attachments?: ReviewAttachment[];
};

export type ReviewTaskListResponse = {
  success: boolean;
  tasks: ReviewTask[];
  total: number;
  error_message?: string;
};

export type ReviewTaskResponse = {
  success: boolean;
  task?: ReviewTask;
  error_message?: string;
};

export type ReviewActionResponse = {
  success: boolean;
  message?: string;
  error_message?: string;
};

// 确认记录类型
export type ConfirmedRecordData = {
  id?: string;
  taskId: string;
  type: 'batch';
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: unknown[];
  note: string;
};

export type ConfirmedRecordResponse = {
  success: boolean;
  record?: ConfirmedRecordData & { id: string; confirmedAt: number };
  records?: Array<ConfirmedRecordData & { id: string; confirmedAt: number }>;
  error_message?: string;
};

// 审核历史类型
export type ReviewHistoryItem = {
  id: string;
  taskId: string;
  action: 'created' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'cancelled';
  userId: string;
  userName: string;
  comment?: string;
  timestamp: number;
};

export type ReviewHistoryResponse = {
  success: boolean;
  history: ReviewHistoryItem[];
  error_message?: string;
};

// 用户列表响应
export type UserListResponse = {
  success: boolean;
  users: User[];
  error_message?: string;
};

// ============ 提资单 API ============

/**
 * 创建提资单
 * POST /api/review/tasks
 */
export async function reviewTaskCreate(
  request: ReviewTaskCreateRequest
): Promise<ReviewTaskResponse> {
  return await fetchJson<ReviewTaskResponse>('/api/review/tasks', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * 获取提资单列表
 * GET /api/review/tasks
 * 支持筛选参数
 */
export async function reviewTaskGetList(options?: {
  status?: ReviewTask['status'] | 'all';
  priority?: ReviewTask['priority'] | 'all';
  requesterId?: string;
  reviewerId?: string;
  limit?: number;
  offset?: number;
}): Promise<ReviewTaskListResponse> {
  const params = new URLSearchParams();
  if (options?.status && options.status !== 'all') params.set('status', options.status);
  if (options?.priority && options.priority !== 'all') params.set('priority', options.priority);
  if (options?.requesterId) params.set('requester_id', options.requesterId);
  if (options?.reviewerId) params.set('reviewer_id', options.reviewerId);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const query = params.toString();
  const path = query ? `/api/review/tasks?${query}` : '/api/review/tasks';
  return await fetchJson<ReviewTaskListResponse>(path);
}

/**
 * 获取单个提资单详情
 * GET /api/review/tasks/{taskId}
 */
export async function reviewTaskGetById(taskId: string): Promise<ReviewTaskResponse> {
  return await fetchJson<ReviewTaskResponse>(`/api/review/tasks/${encodeURIComponent(taskId)}`);
}

/**
 * 更新提资单
 * PATCH /api/review/tasks/{taskId}
 */
export async function reviewTaskUpdate(
  taskId: string,
  request: ReviewTaskUpdateRequest
): Promise<ReviewTaskResponse> {
  return await fetchJson<ReviewTaskResponse>(`/api/review/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(request),
  });
}

/**
 * 删除提资单
 * DELETE /api/review/tasks/{taskId}
 */
export async function reviewTaskDelete(taskId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(`/api/review/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

// ============ 审核操作 API ============

/**
 * 开始审核
 * POST /api/review/tasks/{taskId}/start-review
 */
export async function reviewTaskStartReview(taskId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/start-review`,
    { method: 'POST' }
  );
}

/**
 * 通过审核
 * POST /api/review/tasks/{taskId}/approve
 */
export async function reviewTaskApprove(
  taskId: string,
  comment?: string
): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }
  );
}

/**
 * 驳回审核
 * POST /api/review/tasks/{taskId}/reject
 */
export async function reviewTaskReject(
  taskId: string,
  comment: string
): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }
  );
}

/**
 * 取消提资单
 * POST /api/review/tasks/{taskId}/cancel
 */
export async function reviewTaskCancel(
  taskId: string,
  reason?: string
): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

// ============ 外部校审集成 API ============

export async function reviewGetEmbedUrl(projectId: string, userId: string): Promise<{ url: string }> {
  return await fetchJson<{ url: string }>('/api/review/embed-url', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, user_id: userId }),
  });
}

export async function reviewPreloadCache(projectId: string, initiator: string): Promise<{ success: boolean; message: string }> {
  return await fetchJson<{ success: boolean; message: string }>('/api/review/preload-cache', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, initiator }),
  });
}

// ============ 确认记录 API ============

/**
 * 保存确认记录
 * POST /api/review/records
 */
export async function reviewRecordCreate(
  record: ConfirmedRecordData
): Promise<ConfirmedRecordResponse> {
  return await fetchJson<ConfirmedRecordResponse>('/api/review/records', {
    method: 'POST',
    body: JSON.stringify(record),
  });
}

/**
 * 获取任务的确认记录
 * GET /api/review/records/{taskId}
 */
export async function reviewRecordGetByTaskId(taskId: string): Promise<ConfirmedRecordResponse> {
  return await fetchJson<ConfirmedRecordResponse>(
    `/api/review/records/${encodeURIComponent(taskId)}`
  );
}

/**
 * 删除确认记录
 * DELETE /api/review/records/{recordId}
 */
export async function reviewRecordDelete(recordId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/records/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' }
  );
}

/**
 * 清空任务的所有确认记录
 * DELETE /api/review/records/task/{taskId}
 */
export async function reviewRecordClearByTaskId(taskId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/records/task/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' }
  );
}

// ============ 审核历史 API ============

/**
 * 获取审核历史
 * GET /api/review/tasks/{taskId}/history
 */
export async function reviewTaskGetHistory(taskId: string): Promise<ReviewHistoryResponse> {
  return await fetchJson<ReviewHistoryResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/history`
  );
}

// ============ 评论 API ============

/**
 * 添加批注评论
 * POST /api/review/comments
 */
export async function reviewCommentCreate(
  comment: Omit<AnnotationComment, 'id' | 'createdAt'>
): Promise<{ success: boolean; comment?: AnnotationComment; error_message?: string }> {
  return await fetchJson('/api/review/comments', {
    method: 'POST',
    body: JSON.stringify(comment),
  });
}

/**
 * 获取批注评论
 * GET /api/review/comments/{annotationId}
 */
export async function reviewCommentGetByAnnotation(
  annotationId: string,
  annotationType: AnnotationComment['annotationType']
): Promise<{ success: boolean; comments: AnnotationComment[]; error_message?: string }> {
  const params = new URLSearchParams({ type: annotationType });
  return await fetchJson(`/api/review/comments/${encodeURIComponent(annotationId)}?${params}`);
}

/**
 * 删除评论
 * DELETE /api/review/comments/{commentId}
 */
export async function reviewCommentDelete(commentId: string): Promise<ReviewActionResponse> {
  return await fetchJson(`/api/review/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
}

// ============ 用户 API ============

/**
 * 获取用户列表
 * GET /api/users
 */
export async function userGetList(options?: {
  role?: string;
  status?: string;
}): Promise<UserListResponse> {
  const params = new URLSearchParams();
  if (options?.role) params.set('role', options.role);
  if (options?.status) params.set('status', options.status);

  const query = params.toString();
  const path = query ? `/api/users?${query}` : '/api/users';
  return await fetchJson<UserListResponse>(path);
}

/**
 * 获取当前用户
 * GET /api/users/me
 */
export async function userGetCurrent(): Promise<{ success: boolean; user?: User; error_message?: string }> {
  return await fetchJson('/api/users/me');
}

/**
 * 获取可用审核人员列表
 * GET /api/users/reviewers
 */
export async function userGetReviewers(): Promise<UserListResponse> {
  return await fetchJson<UserListResponse>('/api/users/reviewers');
}

// ============ 附件 API ============

/**
 * 上传附件
 * POST /api/review/attachments
 */
export async function reviewAttachmentUpload(
  taskId: string,
  file: File
): Promise<{ success: boolean; attachment?: ReviewAttachment; error_message?: string }> {
  const base = getBaseUrl().replace(/\/$/, '');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('taskId', taskId);

  const resp = await fetch(`${base}/api/review/attachments`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  return (await resp.json()) as { success: boolean; attachment?: ReviewAttachment; error_message?: string };
}

/**
 * 上传附件（支持进度回调）
 * POST /api/review/attachments
 * @param taskId 任务ID（可选，创建任务前上传时为空）
 * @param file 要上传的文件
 * @param onProgress 进度回调函数，参数为 0-100 的百分比
 */
export function reviewAttachmentUploadWithProgress(
  taskId: string | null,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; attachment?: ReviewAttachment; error_message?: string }> {
  return new Promise((resolve, reject) => {
    const base = getBaseUrl().replace(/\/$/, '');
    const formData = new FormData();
    formData.append('file', file);
    if (taskId) {
      formData.append('taskId', taskId);
    }

    const xhr = new XMLHttpRequest();

    // 进度事件
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    // 完成事件
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.statusText}`));
      }
    };

    // 错误事件
    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    // 中止事件
    xhr.onabort = () => {
      reject(new Error('Upload aborted'));
    };

    xhr.open('POST', `${base}/api/review/attachments`);
    xhr.send(formData);
  });
}

/**
 * 删除附件
 * DELETE /api/review/attachments/{attachmentId}
 */
export async function reviewAttachmentDelete(attachmentId: string): Promise<ReviewActionResponse> {
  return await fetchJson(`/api/review/attachments/${encodeURIComponent(attachmentId)}`, {
    method: 'DELETE',
  });
}

// ============ WebSocket URL 构建 ============

/**
 * 获取审核通知 WebSocket URL
 * WebSocket 端点: /ws/review
 */
export function getReviewWebSocketUrl(): string {
  const base = getBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/review`;
  }

  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/review`;
}

/**
 * 获取用户专属审核通知 WebSocket URL
 * WebSocket 端点: /ws/review/user/{userId}
 */
export function getReviewUserWebSocketUrl(userId: string): string {
  const base = getBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/review/user/${encodeURIComponent(userId)}`;
  }

  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/review/user/${encodeURIComponent(userId)}`;
}

// ============ 辅助函数 ============

/**
 * 规范化审核任务数据
 */
export function normalizeReviewTask(raw: Record<string, unknown>): ReviewTask {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || ''),
    description: String(raw.description || ''),
    modelName: String(raw.model_name || raw.modelName || ''),
    status: normalizeReviewStatus(raw.status),
    priority: normalizeReviewPriority(raw.priority),
    requesterId: String(raw.requester_id || raw.requesterId || ''),
    requesterName: String(raw.requester_name || raw.requesterName || ''),
    reviewerId: String(raw.reviewer_id || raw.reviewerId || ''),
    reviewerName: String(raw.reviewer_name || raw.reviewerName || ''),
    components: Array.isArray(raw.components) ? raw.components as ReviewComponent[] : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments as ReviewAttachment[] : undefined,
    reviewComment: raw.review_comment ? String(raw.review_comment) : undefined,
    createdAt: normalizeTimestamp(raw.created_at || raw.createdAt) || Date.now(),
    updatedAt: normalizeTimestamp(raw.updated_at || raw.updatedAt) || Date.now(),
    dueDate: raw.due_date ? normalizeTimestamp(raw.due_date) : undefined,
  };
}

function normalizeReviewStatus(status: unknown): ReviewTask['status'] {
  const statusStr = String(status || 'draft').toLowerCase();
  const validStatuses: ReviewTask['status'][] = [
    'draft', 'submitted', 'in_review', 'approved', 'rejected', 'cancelled'
  ];
  return validStatuses.includes(statusStr as ReviewTask['status'])
    ? (statusStr as ReviewTask['status'])
    : 'draft';
}

function normalizeReviewPriority(priority: unknown): ReviewTask['priority'] {
  const priorityStr = String(priority || 'medium').toLowerCase();
  const validPriorities: ReviewTask['priority'][] = ['low', 'medium', 'high', 'urgent'];
  return validPriorities.includes(priorityStr as ReviewTask['priority'])
    ? (priorityStr as ReviewTask['priority'])
    : 'medium';
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (!value) return undefined;
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  return undefined;
}

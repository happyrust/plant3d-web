// 校审管理 API 模块
// 提供提资单、审核任务、确认记录的 CRUD 操作

import {
  fromBackendRole,
  type ReviewTask,
  type ReviewComponent,
  type ReviewAttachment,
  type AnnotationComment,
  type User,
  UserRole,
} from '@/types/auth';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

// ============ 基础配置 ============

function getBaseUrl(): string {
  return getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' });
}

function getReviewWebBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_REVIEW_WEB_BASE_URL?: string })
    .VITE_REVIEW_WEB_BASE_URL;
  if (envBase && envBase.trim()) return envBase.trim();
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return getBaseUrl();
}

function getReviewWebSocketBaseUrl(): string | null {
  const env = import.meta.env as unknown as {
    VITE_REVIEW_WS_BASE_URL?: string;
    VITE_REVIEW_WEB_BASE_URL?: string;
  };

  const explicitWsBase = env.VITE_REVIEW_WS_BASE_URL?.trim();
  if (explicitWsBase) return explicitWsBase;

  const reviewWebBase = env.VITE_REVIEW_WEB_BASE_URL?.trim();
  if (reviewWebBase) return reviewWebBase;

  return null;
}

function toWebSocketBaseUrl(base: string): string {
  const normalized = base.replace(/\/$/, '');
  return normalized.startsWith('ws') ? normalized : normalized.replace(/^http/, 'ws');
}

// Token 存储 key
const TOKEN_STORAGE_KEY = 'review_auth_token';

/**
 * 获取存储的 JWT Token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * 设置 JWT Token
 */
export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/**
 * 清除 JWT Token
 */
export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  // 自动添加 Authorization Header（如果有 token）
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch(url, {
    ...init,
    headers,
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
  /** 校核人（第二段） */
  checkerId: string;
  /** 审核人（第三段） */
  approverId: string;
  /** 兼容旧接口字段（语义同 checkerId） */
  reviewerId?: string;
  /** 外部已创建单据时传入，后端会沿用；不传则由后端生成 */
  formId?: string;
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

export type EmbedUrlResponse = {
  code: number;
  message: string;
  data?: {
    relative_path?: string;
    relativePath?: string;
    token?: string;
    query?: {
      form_id?: string;
      formId?: string;
      is_reviewer?: boolean;
      isReviewer?: boolean;
    };
  };
  url?: string;
};

export type CachePreloadResponse = {
  code: number;
  message: string;
  data?: {
    task_id?: string;
  };
};

// 确认记录类型
export type ConfirmedRecordData = {
  id?: string;
  taskId: string;
  formId?: string;
  type: 'batch';
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  measurements: unknown[];
  note: string;
};

export type ConfirmedRecordResponse = {
  success: boolean;
  record?: ConfirmedRecordData & { id: string; confirmedAt: number };
  records?: (ConfirmedRecordData & { id: string; confirmedAt: number })[];
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

// 工作流历史响应类型
export type WorkflowHistoryResponse = {
  success: boolean;
  currentNode: string;
  currentNodeName: string;
  history: {
    node: string;
    action: string;
    operatorId: string;
    operatorName: string;
    comment?: string;
    timestamp: number;
  }[];
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
  checkerId?: string;
  approverId?: string;
  reviewerId?: string;
  limit?: number;
  offset?: number;
}): Promise<ReviewTaskListResponse> {
  const params = new URLSearchParams();
  if (options?.status && options.status !== 'all') params.set('status', options.status);
  if (options?.priority && options.priority !== 'all') params.set('priority', options.priority);
  if (options?.requesterId) params.set('requester_id', options.requesterId);
  if (options?.checkerId) params.set('checker_id', options.checkerId);
  if (options?.approverId) params.set('approver_id', options.approverId);
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

// ============ 多级审批流程 API ============

/**
 * 提交到下一节点
 * POST /api/review/tasks/{taskId}/submit
 */
export async function reviewTaskSubmitToNext(
  taskId: string,
  comment?: string
): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }
  );
}

/**
 * 驳回到指定节点
 * POST /api/review/tasks/{taskId}/return
 */
export async function reviewTaskReturn(
  taskId: string,
  targetNode: string,
  reason: string
): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/return`,
    {
      method: 'POST',
      body: JSON.stringify({ targetNode, reason }),
    }
  );
}

/**
 * 获取工作流历史
 * GET /api/review/tasks/{taskId}/workflow
 */
export async function reviewTaskGetWorkflow(
  taskId: string
): Promise<WorkflowHistoryResponse> {
  return await fetchJson<WorkflowHistoryResponse>(
    `/api/review/tasks/${encodeURIComponent(taskId)}/workflow`
  );
}

// ============ 外部校审集成 API ============

export async function reviewGetEmbedUrl(projectId: string, userId: string): Promise<{ url: string }> {
  const response = await fetchJson<EmbedUrlResponse>('/api/review/embed-url', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, user_id: userId }),
  });

  if (response.url) {
    return { url: response.url };
  }

  if (response.code !== 200 && response.code !== 0) {
    throw new Error(response.message || '获取校审地址失败');
  }

  const data = response.data;
  if (!data?.token) {
    throw new Error('校审地址缺少凭证信息');
  }

  const relativePath = data.relative_path || data.relativePath || '';
  if (!relativePath) {
    throw new Error('校审地址缺少路径信息');
  }

  const query = data.query || {};
  const formId = query.form_id || query.formId || '';
  const baseUrl = getReviewWebBaseUrl().replace(/\/$/, '');
  const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const params = new URLSearchParams();
  params.set('user_token', data.token);
  if (formId) params.set('form_id', formId);
  params.set('user_id', userId);
  params.set('project_id', projectId);
  params.set('output_project', projectId);

  return { url: `${baseUrl}${cleanPath}?${params.toString()}` };
}

export async function reviewPreloadCache(
  projectId: string,
  initiator: string
): Promise<CachePreloadResponse> {
  return await fetchJson<CachePreloadResponse>('/api/review/cache/preload', {
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
 * GET /api/review/records/by-task/{taskId}
 */
export async function reviewRecordGetByTaskId(taskId: string): Promise<ConfirmedRecordResponse> {
  return await fetchJson<ConfirmedRecordResponse>(
    `/api/review/records/by-task/${encodeURIComponent(taskId)}`
  );
}

/**
 * 删除确认记录
 * DELETE /api/review/records/item/{recordId}
 */
export async function reviewRecordDelete(recordId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/records/item/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' }
  );
}

/**
 * 清空任务的所有确认记录
 * DELETE /api/review/records/clear-task/{taskId}
 */
export async function reviewRecordClearByTaskId(taskId: string): Promise<ReviewActionResponse> {
  return await fetchJson<ReviewActionResponse>(
    `/api/review/records/clear-task/${encodeURIComponent(taskId)}`,
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
 * 更新批注评论
 * PATCH /api/review/comments/item/{commentId}
 */
export async function reviewCommentUpdate(
  commentId: string,
  content: string
): Promise<{ success: boolean; comment?: AnnotationComment; error_message?: string }> {
  return await fetchJson(`/api/review/comments/item/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

/**
 * 获取批注评论
 * GET /api/review/comments/by-annotation/{annotationId}
 */
export async function reviewCommentGetByAnnotation(
  annotationId: string,
  annotationType: AnnotationComment['annotationType']
): Promise<{ success: boolean; comments: AnnotationComment[]; error_message?: string }> {
  const params = new URLSearchParams({ type: annotationType });
  return await fetchJson(`/api/review/comments/by-annotation/${encodeURIComponent(annotationId)}?${params}`);
}

/**
 * 删除评论
 * DELETE /api/review/comments/item/{commentId}
 */
export async function reviewCommentDelete(commentId: string): Promise<ReviewActionResponse> {
  return await fetchJson(`/api/review/comments/item/${encodeURIComponent(commentId)}`, {
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

export type ReviewAttachmentUploadOptions = {
  formId?: string | null;
  modelRefnos?: string[];
  fileType?: string;
  description?: string;
};

/**
 * 上传附件
 * POST /api/review/attachments
 */
export async function reviewAttachmentUpload(
  taskId: string,
  file: File,
  options?: ReviewAttachmentUploadOptions
): Promise<{ success: boolean; attachment?: ReviewAttachment; error_message?: string }> {
  const base = getBaseUrl().replace(/\/$/, '');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('taskId', taskId);
  if (options?.formId) {
    formData.append('formId', options.formId);
  }
  if (options?.modelRefnos?.length) {
    formData.append('modelRefnos', JSON.stringify(options.modelRefnos));
  }
  if (options?.fileType) {
    formData.append('type', options.fileType);
  }
  if (options?.description) {
    formData.append('description', options.description);
  }

  const token = getAuthToken();
  const resp = await fetch(`${base}/api/review/attachments`, {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
  onProgress?: (percent: number) => void,
  options?: ReviewAttachmentUploadOptions
): Promise<{ success: boolean; attachment?: ReviewAttachment; error_message?: string }> {
  return new Promise((resolve, reject) => {
    const base = getBaseUrl().replace(/\/$/, '');
    const formData = new FormData();
    formData.append('file', file);
    if (taskId) {
      formData.append('taskId', taskId);
    }
    if (options?.formId) {
      formData.append('formId', options.formId);
    }
    if (options?.modelRefnos?.length) {
      formData.append('modelRefnos', JSON.stringify(options.modelRefnos));
    }
    if (options?.fileType) {
      formData.append('type', options.fileType);
    }
    if (options?.description) {
      formData.append('description', options.description);
    }

    const xhr = new XMLHttpRequest();
    const token = getAuthToken();

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
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
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
export function getReviewWebSocketUrl(): string | null {
  const base = getReviewWebSocketBaseUrl();
  if (!base) return null;

  return `${toWebSocketBaseUrl(base)}/ws/review`;
}

/**
 * 获取用户专属审核通知 WebSocket URL
 * WebSocket 端点: /ws/review/user/{userId}
 */
export function getReviewUserWebSocketUrl(userId: string): string | null {
  const base = getReviewWebSocketBaseUrl();
  if (!base) return null;

  return `${toWebSocketBaseUrl(base)}/ws/review/user/${encodeURIComponent(userId)}`;
}

// ============ 辅助函数 ============

/**
 * 规范化审核任务数据
 */
export function normalizeReviewTask(raw: Record<string, unknown>): ReviewTask {
  const checkerId = String(raw.checker_id || raw.checkerId || raw.reviewer_id || raw.reviewerId || '');
  const checkerName = String(raw.checker_name || raw.checkerName || raw.reviewer_name || raw.reviewerName || '');
  const approverId = String(raw.approver_id || raw.approverId || '');
  const approverName = String(raw.approver_name || raw.approverName || '');

  return {
    id: String(raw.id || ''),
    formId: raw.formId ? String(raw.formId) : (raw.form_id ? String(raw.form_id) : undefined),
    title: String(raw.title || ''),
    description: String(raw.description || ''),
    modelName: String(raw.model_name || raw.modelName || ''),
    status: normalizeReviewStatus(raw.status),
    priority: normalizeReviewPriority(raw.priority),
    requesterId: String(raw.requester_id || raw.requesterId || ''),
    requesterName: String(raw.requester_name || raw.requesterName || ''),
    checkerId,
    checkerName,
    approverId,
    approverName,
    // reviewer 字段兼容旧数据与旧界面语义（映射到校核人）
    reviewerId: checkerId,
    reviewerName: checkerName,
    components: Array.isArray(raw.components) ? raw.components as ReviewComponent[] : [],
    attachments: Array.isArray(raw.attachments)
      ? (raw.attachments as Record<string, unknown>[]).map(normalizeReviewAttachment)
      : undefined,
    reviewComment: raw.review_comment ? String(raw.review_comment) : undefined,
    createdAt: normalizeTimestamp(raw.created_at || raw.createdAt) || Date.now(),
    updatedAt: normalizeTimestamp(raw.updated_at || raw.updatedAt) || Date.now(),
    dueDate: raw.due_date ? normalizeTimestamp(raw.due_date) : undefined,
    // 多级审批流程字段
    currentNode: normalizeWorkflowNode(raw.current_node || raw.currentNode),
    workflowHistory: Array.isArray(raw.workflow_history || raw.workflowHistory)
      ? (raw.workflow_history || raw.workflowHistory) as ReviewTask['workflowHistory']
      : undefined,
    returnReason: raw.return_reason || raw.returnReason
      ? String(raw.return_reason || raw.returnReason)
      : undefined,
  };
}

export function normalizeReviewAttachment(raw: Record<string, unknown>): ReviewAttachment {
  return {
    id: String(raw.id || raw.file_id || ''),
    name: String(raw.name || raw.file_name || ''),
    url: String(raw.url || raw.download_url || ''),
    size: typeof raw.size === 'number'
      ? raw.size
      : (typeof raw.file_size === 'number' ? raw.file_size : undefined),
    type: raw.type ? String(raw.type) : undefined,
    mimeType: raw.mimeType ? String(raw.mimeType) : (raw.mime_type ? String(raw.mime_type) : undefined),
    uploadedAt: normalizeTimestamp(raw.uploaded_at || raw.uploadedAt || raw.created_at) || Date.now(),
  };
}

export function normalizeAnnotationComment(raw: Record<string, unknown>): AnnotationComment {
  return {
    id: String(raw.id || ''),
    annotationId: String(raw.annotationId || raw.annotation_id || ''),
    annotationType: normalizeAnnotationType(raw.annotationType || raw.annotation_type),
    authorId: String(raw.authorId || raw.author_id || ''),
    authorName: String(raw.authorName || raw.author_name || ''),
    authorRole: normalizeUserRole(raw.authorRole || raw.author_role),
    content: String(raw.content || ''),
    replyToId: raw.replyToId
      ? String(raw.replyToId)
      : (raw.reply_to_id ? String(raw.reply_to_id) : undefined),
    createdAt: normalizeTimestamp(raw.created_at || raw.createdAt) || Date.now(),
    updatedAt: normalizeTimestamp(raw.updated_at || raw.updatedAt),
  };
}

function normalizeAnnotationType(value: unknown): AnnotationComment['annotationType'] {
  const type = String(value || 'text').toLowerCase();
  const allowed: AnnotationComment['annotationType'][] = ['text', 'cloud', 'rect', 'obb'];
  return allowed.includes(type as AnnotationComment['annotationType'])
    ? (type as AnnotationComment['annotationType'])
    : 'text';
}

function normalizeUserRole(value: unknown): UserRole {
  const role = String(value || '').toLowerCase();
  const roleValues = Object.values(UserRole) as string[];
  if (roleValues.includes(role)) {
    return role as UserRole;
  }
  return fromBackendRole(role);
}

function normalizeWorkflowNode(node: unknown): ReviewTask['currentNode'] {
  const nodeStr = String(node || 'sj').toLowerCase();
  const validNodes = ['sj', 'jd', 'sh', 'pz'];
  return validNodes.includes(nodeStr)
    ? (nodeStr as ReviewTask['currentNode'])
    : 'sj';
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

// ============ 认证 API ============

export type TokenRequest = {
  projectId: string;
  userId: string;
  formId?: string;
  role?: string;
};

export type TokenResponse = {
  code: number;
  message: string;
  data?: {
    token: string;
    expiresAt: number;
    formId: string;
  };
};

export type VerifyResponse = {
  code: number;
  message: string;
  data?: {
    valid: boolean;
    claims?: {
      projectId: string;
      userId: string;
      formId: string;
      role?: string;
      exp: number;
      iat: number;
    };
    error?: string;
  };
};

/**
 * 获取 JWT Token
 * POST /api/auth/token
 */
export async function authGetToken(request: TokenRequest): Promise<TokenResponse> {
  const base = getBaseUrl().replace(/\/$/, '');
  const resp = await fetch(`${base}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: request.projectId,
      user_id: request.userId,
      form_id: request.formId,
      role: request.role,
    }),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as TokenResponse;

  // 自动保存 token
  if (data.code === 0 && data.data?.token) {
    setAuthToken(data.data.token);
  }

  return data;
}

/**
 * 验证 JWT Token
 * POST /api/auth/verify
 */
export async function authVerifyToken(token?: string, formId?: string): Promise<VerifyResponse> {
  const tokenToVerify = token || getAuthToken();
  if (!tokenToVerify) {
    return {
      code: -1,
      message: 'No token provided',
      data: { valid: false, error: 'No token' },
    };
  }

  const base = getBaseUrl().replace(/\/$/, '');
  const resp = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: tokenToVerify,
      ...(formId ? { form_id: formId } : {}),
    }),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  return (await resp.json()) as VerifyResponse;
}

/**
 * 登录并获取 Token（便捷方法）
 */
export async function login(
  projectId: string,
  userId: string,
  role?: string
): Promise<boolean> {
  try {
    const resp = await authGetToken({ projectId, userId, role });
    return resp.code === 0 && !!resp.data?.token;
  } catch {
    return false;
  }
}

/**
 * 登出（清除 Token）
 */
export function logout(): void {
  clearAuthToken();
}

/**
 * 检查是否已登录
 */
export function isLoggedIn(): boolean {
  return !!getAuthToken();
}

// ============ 同步 API ============

export type ExportRequest = {
  taskIds?: string[];
  includeAttachments?: boolean;
  includeComments?: boolean;
  includeRecords?: boolean;
};

export type ExportResponse = {
  success: boolean;
  tasks: ReviewTask[];
  comments?: unknown[];
  records?: unknown[];
  error_message?: string;
};

export type ImportRequest = {
  tasks: ReviewTask[];
  overwrite?: boolean;
};

export type ImportResponse = {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  error_message?: string;
};

/**
 * 导出校审数据
 * POST /api/review/sync/export
 */
export async function reviewSyncExport(
  request: ExportRequest = {}
): Promise<ExportResponse> {
  return await fetchJson<ExportResponse>('/api/review/sync/export', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * 导入校审数据
 * POST /api/review/sync/import
 */
export async function reviewSyncImport(
  request: ImportRequest
): Promise<ImportResponse> {
  return await fetchJson<ImportResponse>('/api/review/sync/import', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// ============ 辅助校审数据 API ============

export type CollisionQueryParams = {
  project_id?: string;
  refno?: string;
  limit?: number;
  offset?: number;
};

export type CollisionItem = {
  ObjectOneLoc: string;
  ObjectOne: string;
  ObjectTowLoc: string;
  ObjectTow: string;
  ErrorMsg: string;
  ObjectOneMajor: string;
  ObjectTwoMajor: string;
  CheckUsr: string;
  CheckDate: string;
  UpUsr?: string;
  UpTime?: string;
  ErrorStatus: string;
};

export type CollisionDataResponse = {
  success: boolean;
  data: CollisionItem[];
  total: number;
  error_message?: string;
};

/**
 * 查询碰撞数据
 * GET /api/review/collision-data
 */
export async function reviewGetCollisionData(params: CollisionQueryParams = {}): Promise<CollisionDataResponse> {
  const search = new URLSearchParams();
  if (params.project_id) search.set('project_id', params.project_id);
  if (params.refno) search.set('refno', params.refno);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  const path = qs ? `/api/review/collision-data?${qs}` : '/api/review/collision-data';
  return await fetchJson<CollisionDataResponse>(path, { method: 'GET' });
}

export type AuxDataRequest = {
  project_id: string;
  model_refnos: string[];
  major: string;
  requester_id: string;
  page: number;
  page_size: number;
  form_id: string;
  new_search?: boolean;
};

export type AuxDataResponse = {
  code: number;
  message: string;
  page: number;
  page_size: number;
  total: number;
  data: {
    collision: CollisionItem[];
    quality: unknown[];
    otverification: unknown[];
    rules: unknown[];
  };
};

/**
 * 获取辅助校审数据（当前后端使用 UCode/UKey Header 做简单鉴权）
 * POST /api/review/aux-data
 */
export async function reviewGetAuxData(
  request: AuxDataRequest,
  auth: { uCode: string; uKey: string }
): Promise<AuxDataResponse> {
  return await fetchJson<AuxDataResponse>('/api/review/aux-data', {
    method: 'POST',
    headers: {
      UCode: auth.uCode,
      UKey: auth.uKey,
    },
    body: JSON.stringify(request),
  });
}

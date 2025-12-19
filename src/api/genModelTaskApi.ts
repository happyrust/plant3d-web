// 任务管理 API 模块
// 基于后端 Rust/Axum 实现调整
// 后端不支持 pause/resume 功能，任务状态只有：Pending, Running, Completed, Failed, Cancelled

import type {
  Task,
  TaskCreationRequest,
  TaskCreationResponse,
  TaskListResponse,
  TaskResponse,
  TaskActionResponse,
  SystemMetricsResponse,
} from '@/types/task';

// ============ 基础配置 ============

function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL;
  return (envBase && envBase.trim()) || '';
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

/**
 * 下载导出文件
 * GET /api/tasks/{taskId}/download
 * 触发浏览器下载
 */
export async function taskDownloadExport(taskId: string): Promise<void> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}/api/tasks/${encodeURIComponent(taskId)}/download`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  const blob = await resp.blob();
  const contentDisposition = resp.headers.get('Content-Disposition');
  const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || `export-${taskId}.obj`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// ============ 任务查询 API ============

/**
 * 获取所有任务列表
 * GET /api/tasks
 * 支持 status 和 limit 查询参数
 */
export async function taskGetList(options?: {
  status?: Task['status'];
  limit?: number;
}): Promise<TaskListResponse> {
  let path = '/api/tasks';
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', String(options.limit));
  if (params.toString()) path += `?${params.toString()}`;
  return await fetchJson<TaskListResponse>(path);
}

/**
 * 获取任务详情
 * GET /api/tasks/{taskId}
 */
export async function taskGetById(taskId: string): Promise<TaskResponse> {
  return await fetchJson<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

/**
 * 获取任务错误详情
 * GET /api/tasks/{taskId}/error
 */
export async function taskGetError(
  taskId: string
): Promise<{ success: boolean; error_details?: { message: string; stack?: string }; error_message?: string }> {
  return await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/error`);
}

/**
 * 获取任务日志
 * GET /api/tasks/{taskId}/logs
 * 支持 level 和 search 查询参数
 */
export async function taskGetLogs(
  taskId: string,
  options?: { level?: string; search?: string }
): Promise<{ success: boolean; logs?: Array<{ level: string; message: string; timestamp: string }>; error_message?: string }> {
  let path = `/api/tasks/${encodeURIComponent(taskId)}/logs`;
  const params = new URLSearchParams();
  if (options?.level) params.set('level', options.level);
  if (options?.search) params.set('search', options.search);
  if (params.toString()) path += `?${params.toString()}`;
  return await fetchJson(path);
}

/**
 * 获取系统指标
 * GET /api/status
 * 返回 CPU 使用率、内存使用率、活动任务数
 */
export async function taskGetSystemMetrics(): Promise<SystemMetricsResponse> {
  type RawStatusResponse = {
    cpu_usage: number;
    memory_usage: number;
    active_task_count: number;
  };
  const raw = await fetchJson<RawStatusResponse>('/api/status');
  return {
    success: true,
    metrics: {
      cpuUsage: raw.cpu_usage,
      memoryUsage: raw.memory_usage,
      activeTaskCount: raw.active_task_count,
      queuedTaskCount: 0, // 后端不返回此字段
    },
  };
}

/**
 * 获取节点状态（包含 LiteFS 复制状态）
 * GET /api/node-status
 */
export async function taskGetNodeStatus(): Promise<{
  success: boolean;
  is_primary?: boolean;
  database_path?: string;
  litefs_status?: unknown;
  error_message?: string;
}> {
  return await fetchJson('/api/node-status');
}

// ============ 任务创建 API ============

/**
 * 创建新任务
 * POST /api/tasks
 */
export async function taskCreate(request: TaskCreationRequest): Promise<TaskCreationResponse> {
  return await fetchJson<TaskCreationResponse>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * 批量创建任务
 * POST /api/tasks/batch
 */
export async function taskCreateBatch(
  requests: TaskCreationRequest[]
): Promise<{ success: boolean; tasks?: Task[]; error_message?: string }> {
  return await fetchJson('/api/tasks/batch', {
    method: 'POST',
    body: JSON.stringify({ tasks: requests }),
  });
}

/**
 * 验证任务名称是否可用
 * GET /api/task-creation/validate-name
 * 注意：后端当前是 stub 实现，始终返回 available: true
 */
export async function taskValidateName(
  name: string
): Promise<{ success: boolean; available: boolean; error_message?: string }> {
  return await fetchJson<{ success: boolean; available: boolean; error_message?: string }>(
    `/api/task-creation/validate-name?name=${encodeURIComponent(name)}`
  );
}

/**
 * 预览任务配置（获取预估时长和资源需求）
 * POST /api/task-creation/preview
 */
export async function taskPreviewConfig(
  request: TaskCreationRequest
): Promise<{
  success: boolean;
  estimated_duration_ms?: number;
  resource_requirements?: { cpu: number; memory: number };
  error_message?: string;
}> {
  return await fetchJson('/api/task-creation/preview', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// ============ 任务操作 API ============

/**
 * 启动任务
 * POST /api/tasks/{taskId}/start
 * 将任务从 Pending 状态转换为 Running 状态
 */
export async function taskStart(taskId: string): Promise<TaskActionResponse> {
  return await fetchJson<TaskActionResponse>(`/api/tasks/${encodeURIComponent(taskId)}/start`, {
    method: 'POST',
  });
}

/**
 * 停止任务
 * POST /api/tasks/{taskId}/stop
 * 取消正在运行的任务，转换为 Cancelled 状态
 */
export async function taskStop(taskId: string): Promise<TaskActionResponse> {
  return await fetchJson<TaskActionResponse>(`/api/tasks/${encodeURIComponent(taskId)}/stop`, {
    method: 'POST',
  });
}

/**
 * 重启失败的任务
 * POST /api/tasks/{taskId}/restart
 * 为失败的任务创建新的任务实例
 */
export async function taskRestart(taskId: string): Promise<TaskActionResponse> {
  return await fetchJson<TaskActionResponse>(`/api/tasks/${encodeURIComponent(taskId)}/restart`, {
    method: 'POST',
  });
}

/**
 * 删除任务
 * DELETE /api/tasks/{taskId}
 * 从活动或历史列表中移除任务
 */
export async function taskDelete(taskId: string): Promise<TaskActionResponse> {
  return await fetchJson<TaskActionResponse>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

// ============ WebSocket URL 构建 ============

/**
 * 获取任务更新 WebSocket URL
 * WebSocket 端点: /ws/tasks
 */
export function getTaskWebSocketUrl(): string {
  const base = getBaseUrl();
  if (!base) {
    // 使用当前页面的 host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/tasks`;
  }

  // 转换 http(s) 为 ws(s)
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/tasks`;
}

/**
 * 获取单个任务进度 WebSocket URL
 * WebSocket 端点: /ws/progress/{taskId}
 */
export function getTaskProgressWebSocketUrl(taskId: string): string {
  const base = getBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/progress/${encodeURIComponent(taskId)}`;
  }

  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/progress/${encodeURIComponent(taskId)}`;
}

// ============ 辅助函数 ============

/**
 * 规范化任务数据（处理后端返回的不一致格式）
 */
export function normalizeTask(raw: Record<string, unknown>): Task {
  return {
    id: String(raw.id || raw.task_id || ''),
    name: String(raw.name || raw.task_name || ''),
    type: normalizeTaskType(raw.type || raw.task_type),
    status: normalizeTaskStatus(raw.status),
    progress: Number(raw.progress || 0),
    startTime: normalizeTimestamp(raw.start_time || raw.startTime),
    endTime: normalizeTimestamp(raw.end_time || raw.endTime),
    durationMs: raw.duration_ms != null ? Number(raw.duration_ms) : undefined,
    estimatedTimeMs: raw.estimated_time_ms != null ? Number(raw.estimated_time_ms) : undefined,
    priority: (raw.priority || 'normal') as Task['priority'],
    parameters: raw.parameters as Task['parameters'],
    result: raw.result as Task['result'],
    error: raw.error ? String(raw.error) : undefined,
  };
}

/**
 * 规范化任务类型
 * 后端支持: DataParsingWizard, ModelGeneration, SpatialTreeGeneration, FullSync, IncrementalSync
 */
function normalizeTaskType(type: unknown): Task['type'] {
  const typeStr = String(type || 'DataParsing');
  // 映射后端类型到前端类型
  const typeMap: Record<string, Task['type']> = {
    'DataParsingWizard': 'DataParsing',
    'DataParsing': 'DataParsing',
    'ModelGeneration': 'ModelGeneration',
    'SpatialTreeGeneration': 'ModelGeneration',
    'FullSync': 'DataParsing',
    'IncrementalSync': 'DataParsing',
  };
  return typeMap[typeStr] || 'DataParsing';
}

/**
 * 规范化任务状态
 * 后端状态: Pending, Running, Completed, Failed, Cancelled
 * 注意：后端不支持 Paused 状态
 */
function normalizeTaskStatus(status: unknown): Task['status'] {
  const statusStr = String(status || 'pending').toLowerCase();
  // 后端只有这5种状态，没有 paused
  const validStatuses: Task['status'][] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
  return validStatuses.includes(statusStr as Task['status'])
    ? (statusStr as Task['status'])
    : 'pending';
}

/**
 * 规范化时间戳（处理多种格式）
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (!value) return undefined;

  // 如果是数字（Unix 时间戳）
  if (typeof value === 'number') {
    // 如果是秒级时间戳，转换为毫秒
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }

  // 如果是字符串
  if (typeof value === 'string') {
    // 尝试解析为日期
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    return value;
  }

  return undefined;
}

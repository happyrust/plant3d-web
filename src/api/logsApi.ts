// 统一日志查询 API 客户端（spec 003-review-log-viewer T201）
// 对接后端 GET /api/logs/types 与 GET /api/logs（plant-model-gen logs_api.rs）。

import { getAuthToken } from './reviewApi';

import { getBackendApiBaseUrl } from '@/utils/apiBase';

// ============ 类型定义 ============

export type LogTypeInfo = {
  id: string;
  name: string;
  filters: string[];
  admin_only: boolean;
};

export type LogTypesResponse = {
  success: boolean;
  types: LogTypeInfo[];
};

export type LogCorrelation = {
  form_id?: string;
  task_id?: string;
  site_id?: string;
  request_id?: string;
};

export type LogEntry = {
  ts_ms?: number;
  type: string;
  level: 'info' | 'warn' | 'error' | string;
  summary: string;
  detail: unknown;
  correlation: LogCorrelation;
};

export type LogsResponse = {
  success: boolean;
  type: string;
  entries: LogEntry[];
  next_cursor: string | null;
};

export type LogsQuery = {
  type: string;
  formId?: string;
  taskId?: string;
  siteId?: string;
  level?: 'error' | 'warn';
  q?: string;
  fromMs?: number;
  toMs?: number;
  cursor?: string;
  limit?: number;
};

export class LogsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LogsApiError';
    this.status = status;
  }
}

// ============ 基础请求 ============

const DEFAULT_TIMEOUT_MS = 12_000;

function getBaseUrl(): string {
  return getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' });
}

function safeGetAuthToken(): string | null {
  try {
    return getAuthToken();
  } catch {
    // 非浏览器环境（测试/SSR）没有 localStorage
    return null;
  }
}

async function fetchLogsJson<T>(path: string): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = safeGetAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new LogsApiError(0, `GET ${url} 超时`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let message = text.trim() || `HTTP ${resp.status} ${resp.statusText}`;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // 非 JSON 错误体，保留原始文本
    }
    throw new LogsApiError(resp.status, message);
  }

  return (await resp.json()) as T;
}

// ============ API ============

/** 获取当前角色可见的日志类型目录。 */
export async function fetchLogTypes(): Promise<LogTypeInfo[]> {
  const resp = await fetchLogsJson<LogTypesResponse>('/api/logs/types');
  return resp.types ?? [];
}

/** 统一日志分页查询。 */
export async function fetchLogs(query: LogsQuery): Promise<LogsResponse> {
  const params = new URLSearchParams();
  params.set('type', query.type);
  if (query.formId) params.set('form_id', query.formId);
  if (query.taskId) params.set('task_id', query.taskId);
  if (query.siteId) params.set('site_id', query.siteId);
  if (query.level) params.set('level', query.level);
  if (query.q) params.set('q', query.q);
  if (query.fromMs !== undefined) params.set('from_ms', String(query.fromMs));
  if (query.toMs !== undefined) params.set('to_ms', String(query.toMs));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return await fetchLogsJson<LogsResponse>(`/api/logs?${params.toString()}`);
}

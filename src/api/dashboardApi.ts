/**
 * Dashboard (工作台概览) 相关的后端 API 定义
 * 当前仅保留后端缺失的活动流聚合接口。
 */

export interface DashboardActivityItem {
  id: string;
  source: 'review' | 'task';
  userId: string;
  userName: string;
  userType: 'human' | 'system_bot';
  actionTitle: string;
  targetName: string;
  actionDesc: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface DashboardActivitiesResponse {
  success: boolean;
  data: DashboardActivityItem[];
  error_message?: string;
}

function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL;
  return (envBase && envBase.trim()) || '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  // 尝试拼装 token（复用现有鉴权机制）
  const token = localStorage.getItem('review_auth_token');
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

/**
 * 获取首页的团队工作协作动态流
 */
export async function getDashboardActivities(limit = 10): Promise<DashboardActivitiesResponse> {
  return await fetchJson<DashboardActivitiesResponse>(`/api/dashboard/activities?limit=${limit}`);
}

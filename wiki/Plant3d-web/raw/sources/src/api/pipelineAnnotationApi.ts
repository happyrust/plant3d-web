import { getBackendApiBaseUrl } from '@/utils/apiBase';

/**
 * 管道标注 API 模块
 *
 * 提供管道分支（BRAN）的工程标注数据接口
 */

// 标注命令类型
export type AnnotationCommand =
    | { type: 'DimensionLine'; start: [number, number, number]; end: [number, number, number]; offset: number; text: string }
    | { type: 'TextLabel'; position: [number, number, number]; text: string; leader_end?: [number, number, number] }
    | { type: 'WeldSymbol'; position: [number, number, number]; weld_type: number }
    | { type: 'SupportSymbol'; position: [number, number, number]; support_type: string }
    | { type: 'SlopeAnnotation'; start: [number, number, number]; end: [number, number, number]; slope_value: number };

// 标注数据
export type AnnotationData = {
    refno: string;
    name: string;
    segments_count: number;
    welds_count: number;
    slopes_count: number;
    commands: AnnotationCommand[];
}

// API 响应
export type AnnotationResponse = {
    success: boolean;
    error_message?: string;
    data?: AnnotationData;
}

function getBaseUrl(): string {
  return getBackendApiBaseUrl();
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
 * 获取管道分支的标注数据
 * @param refno BRAN 的 refno，如 "24383_73962"
 */
export async function getPipelineAnnotations(refno: string): Promise<AnnotationResponse> {
  return await fetchJson<AnnotationResponse>(`/api/pipeline/annotation/${encodeURIComponent(refno)}`);
}

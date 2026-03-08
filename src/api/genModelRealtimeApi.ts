import { getBaseUrl } from '@/api/genModelTaskApi'
import type { InstanceEntry } from '@/utils/instances/instanceManifest'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`

  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`)
  }

  return (await resp.json()) as T
}

export type RealtimeInstancesByRefnosResponse = {
  success: boolean
  dbnum: number
  requested_count: number
  returned_count: number
  missing_refnos: string[]
  instances_by_refno: Record<string, InstanceEntry[]>
  message: string
}

export type ParquetIncrementalEnqueueResponse = {
  success: boolean
  dbnum: number
  enqueued_count: number
  pending_count: number
  running: boolean
  message: string
}

export type ParquetVersionResponse = {
  success: boolean
  dbnum: number
  revision: number
  updated_at?: string | null
  manifest_base_dir?: 'parquet' | 'instances' | null
  files_base_dir?: 'parquet' | 'instances' | null
  running: boolean
  pending_count: number
  last_error?: string | null
}

export async function realtimeInstancesByRefnos(
  dbno: number,
  refnos: string[],
  options?: { includeTubings?: boolean; enableHoles?: boolean }
): Promise<RealtimeInstancesByRefnosResponse> {
  return await fetchJson<RealtimeInstancesByRefnosResponse>('/api/model/realtime-instances-by-refnos', {
    method: 'POST',
    body: JSON.stringify({
      dbnum: dbno,
      refnos,
      include_tubings: options?.includeTubings ?? true,
      enable_holes: options?.enableHoles ?? true,
    }),
  })
}

export async function enqueueParquetIncremental(
  dbno: number,
  refnos: string[]
): Promise<ParquetIncrementalEnqueueResponse> {
  return await fetchJson<ParquetIncrementalEnqueueResponse>('/api/model/parquet-incr-enqueue', {
    method: 'POST',
    body: JSON.stringify({
      dbnum: dbno,
      refnos,
    }),
  })
}

export async function getParquetVersion(dbno: number): Promise<ParquetVersionResponse> {
  return await fetchJson<ParquetVersionResponse>(`/api/model/parquet-version/${encodeURIComponent(String(dbno))}`)
}

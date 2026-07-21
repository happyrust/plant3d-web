import { getBaseUrl } from '@/api/genModelTaskApi';

export type ModelUnitImpactKind = 'mesh' | 'placement' | 'delivery' | 'noop' | 'tombstone'

export type ModelUnitCommit = {
  dbnum: number
  unit_refno: string
  unit_noun: string
  sesno: number
  impact_kind: ModelUnitImpactKind
  artifact_sesno: number
  project_name: string
  manifest_path: string
  generated_at: string
}

export type ModelUnitCommitData = {
  manifest_url: string
  commit: ModelUnitCommit
}

export async function getModelUnitCommit(
  dbnum: number,
  unitRefno: string,
  sesno: number,
): Promise<ModelUnitCommitData> {
  const base = getBaseUrl().replace(/\/$/, '');
  const normalizedRefno = String(unitRefno || '').trim().replace(/\//g, '_');
  const path = `/api/model/units/${encodeURIComponent(normalizedRefno)}/versions/${encodeURIComponent(String(sesno))}?dbnum=${encodeURIComponent(String(dbnum))}`;
  const resp = await fetch(`${base}${path}`);
  const body = await resp.json().catch(() => null) as {
    success?: boolean
    data?: ModelUnitCommitData
    message?: string
  } | null;
  if (!resp.ok || !body?.success || !body.data) {
    throw new Error(body?.message || `加载模型提交失败: HTTP ${resp.status}`);
  }
  return body.data;
}

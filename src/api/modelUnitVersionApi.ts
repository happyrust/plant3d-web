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
  manifest_url: string | null
  commit: ModelUnitCommit
}

function validateModelUnitCommitData(data: ModelUnitCommitData): ModelUnitCommitData {
  const tombstone = data?.commit?.impact_kind === 'tombstone';
  if (tombstone && data.manifest_url !== null) {
    throw new Error(`tombstone 模型提交 ${data.commit.sesno} 不得包含 manifest`);
  }
  if (!tombstone && (typeof data?.manifest_url !== 'string' || !data.manifest_url.trim())) {
    throw new Error(`模型提交 ${data?.commit?.sesno ?? 'UNKNOWN'} 缺少 manifest`);
  }
  return data;
}

function modelUnitVersionsPath(dbnum: number, unitRefno: string): string {
  const normalizedRefno = String(unitRefno || '').trim().replace(/\//g, '_');
  return `/api/model/units/${encodeURIComponent(normalizedRefno)}/versions?dbnum=${encodeURIComponent(String(dbnum))}`;
}

export async function listModelUnitCommits(
  dbnum: number,
  unitRefno: string,
): Promise<ModelUnitCommitData[]> {
  const base = getBaseUrl().replace(/\/$/, '');
  const resp = await fetch(`${base}${modelUnitVersionsPath(dbnum, unitRefno)}`);
  const body = await resp.json().catch(() => null) as {
    success?: boolean
    data?: ModelUnitCommitData[]
    message?: string
  } | null;
  if (!resp.ok || !body?.success || !Array.isArray(body.data)) {
    throw new Error(body?.message || `加载模型提交列表失败: HTTP ${resp.status}`);
  }
  return body.data
    .map(validateModelUnitCommitData)
    .sort((a, b) => a.commit.sesno - b.commit.sesno);
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
  return validateModelUnitCommitData(body.data);
}

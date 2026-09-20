/**
 * 「点集可视化」这一次要显示哪些构件的哪些点：自身有 P 点就显示自身，自身没有就摊开直属成员
 * （BRAN / EQUI 这类容器本身没有 PTSE，点在成员上）。
 *
 * 取数一律走 `ModelSource.keypoints` 端口（gen-model-v1 `element/ptset`）；成员那一层用端口的 `memberPtsets`：
 * 成员的点随同一次响应回来，不用再逐个问。legacy 的「parquet 摘要再逐个取」那条路（`childSummaries`）2026-09-20 随其退役。
 */
import type { PtsetBatchItemResponse, PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { KeypointSource } from '@/model-source/ports';

export type PtsetEntry = { refno: string; response: PtsetResponse };

export type PtsetEntriesResult = {
  /** 要渲染的构件与它们的点；空 = 这条 refno 与它的直属成员都没有点 */
  entries: PtsetEntry[];
  /** 自身那一发的响应，错误提示优先用它 */
  self: PtsetResponse;
  /** 成员一层的失败原因（按成员原序），自身与成员都没点时用来拼提示 */
  memberErrors: string[];
};

export type PtsetEntriesDeps = {
  keypoints: Pick<KeypointSource, 'ptset' | 'memberPtsets'>;
};

function normalizeRefnoKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\//g, '_');
}

function hasPoints(response: Pick<PtsetResponse, 'success' | 'ptset'>): boolean {
  return response.success && (response.ptset?.length ?? 0) > 0;
}

/** 成员条目（`/api/pdms/ptset/children` 与 v1 `members[]` 同形）→ 渲染要的 `PtsetResponse` */
function memberToResponse(refno: string, item: PtsetBatchItemResponse): PtsetResponse {
  return {
    success: true,
    refno,
    noun: item.noun ?? null,
    ptset: item.ptset,
    world_transform: item.world_transform ?? null,
    unit_info: item.unit_info ?? null,
    error_code: null,
    error_message: null,
  };
}

export async function collectPtsetEntries(
  deps: PtsetEntriesDeps,
  dbno: number,
  refno: string,
): Promise<PtsetEntriesResult> {
  const key = normalizeRefnoKey(refno);
  const self = await deps.keypoints.ptset(dbno, key);
  if (hasPoints(self)) {
    return { entries: [{ refno: key, response: self }], self, memberErrors: [] };
  }

  const entries: PtsetEntry[] = [];
  const memberErrors: string[] = [];

  const members = await deps.keypoints.memberPtsets(dbno, key);
  for (const item of members.results ?? []) {
    const memberRefno = normalizeRefnoKey(item.refno || item.input_refno);
    if (item.success && (item.ptset?.length ?? 0) > 0) {
      entries.push({ refno: memberRefno, response: memberToResponse(memberRefno, item) });
    } else if (item.error_message) {
      memberErrors.push(item.error_message);
    }
  }
  if (entries.length === 0 && members.error_message) memberErrors.push(members.error_message);
  return { entries, self, memberErrors };
}

import type { ParquetPtsetChildSummary } from '@/composables/useDbnoInstancesParquetLoader';

import {
  pdmsGetPtsetChildrenWithContext,
  pdmsGetPtsetWithContext,
  type PtsetChildrenResponse,
  type PtsetQueryContext,
  type PtsetResponse,
} from '@/api/genModelPdmsAttrApi';

type PtsetParquetLookup = {
  queryPtsetByRefnoFromParquet: (
    dbno: number,
    refno: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<PtsetResponse>;
};

type PtsetChildrenParquetLookup = {
  queryDirectChildrenPtsetSummary: (
    dbno: number,
    ownerRefno: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<ParquetPtsetChildSummary[]>;
};

type RuntimeLookupOptions = {
  forceRefresh?: boolean;
  batchId?: string | null;
};

function normalizeRefnoKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\//g, '_');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureResponse(refno: string, message: string): PtsetResponse {
  return {
    success: false,
    refno,
    ptset: [],
    world_transform: null,
    unit_info: null,
    error_code: 'PTSET_QUERY_FAILED',
    error_message: message,
  };
}

function buildPtsetContext(dbno: number, options?: RuntimeLookupOptions): PtsetQueryContext {
  return {
    dbno,
    batchId: options?.batchId ?? undefined,
  };
}

export async function queryPtsetWithRuntimeFallback(
  loader: PtsetParquetLookup,
  dbno: number,
  refno: string,
  options?: RuntimeLookupOptions,
): Promise<PtsetResponse> {
  const normalizedRefno = normalizeRefnoKey(refno);
  let parquetResp: PtsetResponse | null = null;
  let parquetError: string | null = null;

  try {
    parquetResp = await loader.queryPtsetByRefnoFromParquet(dbno, normalizedRefno, {
      forceRefresh: options?.forceRefresh,
    });
    if (parquetResp.success && parquetResp.ptset.length > 0) return parquetResp;
  } catch (error) {
    parquetError = errorMessage(error);
  }

  try {
    // ponytail: API fallback is not snapshot-locked; remove when ptsets.parquet export is reliable.
    const apiResp = await pdmsGetPtsetWithContext(normalizedRefno, buildPtsetContext(dbno, options));
    if (apiResp.success && apiResp.ptset.length > 0) return apiResp;
    return {
      ...apiResp,
      error_message: apiResp.error_message || parquetResp?.error_message || parquetError || '当前构件没有可用 ptset',
    };
  } catch (error) {
    const apiError = errorMessage(error);
    if (parquetResp) {
      return {
        ...parquetResp,
        error_message: parquetResp.error_message || parquetError || apiError,
      };
    }
    return failureResponse(normalizedRefno, parquetError || apiError);
  }
}

function mergeApiChildSummary(
  result: PtsetChildrenResponse['results'][number],
  parquetByRefno: Map<string, ParquetPtsetChildSummary>,
): ParquetPtsetChildSummary {
  const refno = normalizeRefnoKey(result.refno || result.input_refno);
  const parquet = parquetByRefno.get(refno);
  const ptCount = result.ptset?.length ?? 0;
  const success = result.success && ptCount > 0;
  return {
    refno,
    noun: parquet?.noun || '',
    name: parquet?.name || '',
    success,
    ptCount: success ? ptCount : 0,
    errorMessage: result.error_message ?? (success ? null : parquet?.errorMessage ?? '未找到 ptset 数据'),
  };
}

export async function queryDirectChildrenPtsetSummaryWithRuntimeFallback(
  loader: PtsetChildrenParquetLookup,
  dbno: number,
  ownerRefno: string,
  options?: RuntimeLookupOptions,
): Promise<ParquetPtsetChildSummary[]> {
  const normalizedOwner = normalizeRefnoKey(ownerRefno);
  let parquetSummaries: ParquetPtsetChildSummary[] = [];
  try {
    parquetSummaries = await loader.queryDirectChildrenPtsetSummary(dbno, normalizedOwner, {
      forceRefresh: options?.forceRefresh,
    });
  } catch {
    parquetSummaries = [];
  }
  if (parquetSummaries.some((item) => item.success && item.ptCount > 0)) {
    return parquetSummaries;
  }

  try {
    const apiResp = await pdmsGetPtsetChildrenWithContext(normalizedOwner, buildPtsetContext(dbno, options));
    if (!apiResp.results.length) return parquetSummaries;
    const parquetByRefno = new Map(parquetSummaries.map((item) => [normalizeRefnoKey(item.refno), item]));
    const merged: ParquetPtsetChildSummary[] = [];
    const seenRefnos = new Set<string>();
    for (const result of apiResp.results) {
      const summary = mergeApiChildSummary(result, parquetByRefno);
      if (!summary.refno || seenRefnos.has(summary.refno)) continue;
      seenRefnos.add(summary.refno);
      merged.push(summary);
    }
    return merged;
  } catch {
    return parquetSummaries;
  }
}

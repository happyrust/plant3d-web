import type { APIRequestContext } from '@playwright/test';

const DEFAULT_REFNO = '24381_145018';
const DEFAULT_RADII = [5000, 10000, 20000];
const DEFAULT_NOUNS = ['PIPE', 'BRAN'];
const DEFAULT_URL = '/?output_project=AvevaMarineSample';
const DEFAULT_LIMIT = 100;
const DIRECT_BACKEND_BASE = 'http://127.0.0.1:3100';

export type SpatialQueryBranchFixture = {
  aabb: readonly [number, number, number, number, number, number];
};

export const KNOWN_REAL_BRANCH_FIXTURES: Record<string, SpatialQueryBranchFixture> = {
  '24381_145018': {
    aabb: [1415.72, 8056.67, 13193.23, 9869.75, 10320.18, 18764.8],
  },
  '24381_145712': {
    aabb: [13731.28, -16481.3, -2831.25, 14806.1, -14973.34, -1446.09],
  },
  '24381_145717': {
    aabb: [5732.1, -8989.84, 7579.3, 6350.0, -8165.95, 8434.0],
  },
};

type ProbeApiResultItem = {
  refno: string;
  noun?: string;
  spec_value?: number | null;
  distance?: number | null;
};

type ProbeApiResult = {
  success?: boolean;
  error?: string;
  error_message?: string | null;
  results?: ProbeApiResultItem[];
  truncated?: boolean;
};

type ProbeNodeResponse = {
  success?: boolean;
  node?: { refno?: string | null } | null;
  error_message?: string | null;
};

type ProbeSubtreeResponse = {
  success?: boolean;
  refnos?: string[];
  truncated?: boolean;
  error_message?: string | null;
};

type ProbeMbdPipeResponse = {
  success?: boolean;
  data?: {
    segments?: unknown[];
    fittings?: unknown[];
  } | null;
  error_message?: string | null;
};

type SpatialStatsResponse = {
  success?: boolean;
  total_elements?: number;
  error?: string | null;
};

export type SpatialQueryRealBranConfig = {
  refno: string;
  refnoSlash: string;
  radii: number[];
  nouns: string[];
  url: string;
  maxResults: number;
};

export function buildSpatialQueryRealBranConfig(
  refnoRaw: string,
  base: Partial<SpatialQueryRealBranConfig> = {},
): SpatialQueryRealBranConfig {
  const refno = normalizeRefnoUnderscore(refnoRaw);
  return {
    refno,
    refnoSlash: normalizeRefnoSlash(refno),
    radii: base.radii?.slice() ?? DEFAULT_RADII.slice(),
    nouns: base.nouns?.slice() ?? DEFAULT_NOUNS.slice(),
    url: base.url ?? DEFAULT_URL,
    maxResults: base.maxResults ?? DEFAULT_LIMIT,
  };
}

export type SpatialQueryProbeAttempt = {
  radius: number;
  requestPath: string;
  httpStatus: number;
  ok: boolean;
  totalResults: number;
  nonSelfResults: number;
  truncated: boolean;
  error: string | null;
  bodyPreview: string | null;
};

export type SpatialQueryProbeResult = {
  selectedRadius: number;
  selectedAttempt: SpatialQueryProbeAttempt;
  attempts: SpatialQueryProbeAttempt[];
};

function parseCsvList(raw: string | undefined, fallback: string[]): string[] {
  const value = String(raw || '').trim();
  if (!value) return fallback.slice();
  const parsed = value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback.slice();
}

function parseCsvNumbers(raw: string | undefined, fallback: number[]): number[] {
  const value = String(raw || '').trim();
  if (!value) return fallback.slice();
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
  return parsed.length > 0 ? parsed : fallback.slice();
}

function normalizeRefnoUnderscore(raw: string | undefined): string {
  const value = String(raw || '').trim();
  if (!value) return DEFAULT_REFNO;
  return value.replace(/\//g, '_');
}

function normalizeRefnoSlash(raw: string): string {
  return raw.replace(/_/g, '/');
}

function buildProbePath(config: SpatialQueryRealBranConfig, radius: number): string {
  const sp = new URLSearchParams();
  sp.set('mode', 'refno');
  sp.set('refno', config.refno);
  sp.set('distance', String(radius));
  sp.set('include_self', 'true');
  sp.set('max_results', String(config.maxResults));
  sp.set('shape', 'sphere');
  sp.set('nouns', config.nouns.join(','));
  return `${DIRECT_BACKEND_BASE}/api/sqlite-spatial/query?${sp.toString()}`;
}

async function fetchFailureHints(
  request: APIRequestContext,
  config: SpatialQueryRealBranConfig,
): Promise<string | null> {
  try {
    const nodeResp = await request.get(`${DIRECT_BACKEND_BASE}/api/e3d/node/${config.refno}`);
    const nodeText = await nodeResp.text();
    const nodePayload = nodeText ? JSON.parse(nodeText) as ProbeNodeResponse : null;
    if (!nodeResp.ok() || !nodePayload?.success || !nodePayload.node?.refno) {
      return null;
    }

    const subtreeResp = await request.get(`${DIRECT_BACKEND_BASE}/api/e3d/subtree-refnos/${config.refno}?include_self=true&limit=200`);
    const subtreeText = await subtreeResp.text();
    const subtreePayload = subtreeText ? JSON.parse(subtreeText) as ProbeSubtreeResponse : null;
    if (!subtreeResp.ok() || !subtreePayload?.success) {
      return 'E3D 树节点存在，但子树诊断失败；请检查 e3d/subtree-refnos 接口。';
    }

    const subtreeCount = Array.isArray(subtreePayload.refnos) ? subtreePayload.refnos.length : 0;
    return `E3D 树节点存在且子树共有 ${subtreeCount} 个 refno，但空间查询结果为空；本地可能缺 inst_relate 或 instances/spatial_index 产物。`;
  } catch {
    return null;
  }
}

async function hasUiQueryableBranchGeometry(
  request: APIRequestContext,
  config: SpatialQueryRealBranConfig,
): Promise<boolean> {
  if (KNOWN_REAL_BRANCH_FIXTURES[config.refno]) {
    return true;
  }
  try {
    const mbdResp = await request.get(`${DIRECT_BACKEND_BASE}/api/mbd/pipe/${config.refno}`);
    const mbdText = await mbdResp.text();
    const mbdPayload = mbdText ? JSON.parse(mbdText) as ProbeMbdPipeResponse : null;
    if (!mbdResp.ok() || !mbdPayload?.success || !mbdPayload.data) {
      return false;
    }

    const segmentCount = Array.isArray(mbdPayload.data.segments) ? mbdPayload.data.segments.length : 0;
    const fittingCount = Array.isArray(mbdPayload.data.fittings) ? mbdPayload.data.fittings.length : 0;
    return segmentCount > 0 || fittingCount > 0;
  } catch {
    return false;
  }
}

async function tryEnsureSpatialBackendReady(request: APIRequestContext): Promise<void> {
  if (process.env.SPATIAL_QUERY_E2E_SKIP_BACKEND_PREP === '1') {
    return;
  }
  const waitForHealth = async (): Promise<boolean> => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const healthResp = await request.get(`${DIRECT_BACKEND_BASE}/api/health`);
        if (healthResp.ok()) return true;
      } catch {
        // ignore and retry
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  };

  const healthy = await waitForHealth();
  if (!healthy) return;

  const readStats = async (): Promise<number | null> => {
    try {
      const statsResp = await request.get(`${DIRECT_BACKEND_BASE}/api/sqlite-spatial/stats`);
      const statsText = await statsResp.text();
      if (!statsResp.ok() || !statsText) return null;
      const payload = JSON.parse(statsText) as SpatialStatsResponse;
      return typeof payload.total_elements === 'number' ? payload.total_elements : null;
    } catch {
      return null;
    }
  };

  const before = await readStats();
  if (typeof before === 'number' && before > 0) {
    return;
  }

  const post = (request as unknown as { post?: (url: string) => Promise<{ ok: () => boolean }> }).post;
  if (typeof post !== 'function') {
    return;
  }

  try {
    const rebuildResp = await post.call(request, `${DIRECT_BACKEND_BASE}/api/sqlite-spatial/rebuild`);
    if (!rebuildResp.ok()) return;
    await readStats();
  } catch {
    // ignore: let downstream probe surface the real failure
  }
}

export function resolveSpatialQueryRealBranConfig(): SpatialQueryRealBranConfig {
  return buildSpatialQueryRealBranConfig(process.env.SPATIAL_QUERY_E2E_REFNO || DEFAULT_REFNO, {
    radii: parseCsvNumbers(process.env.SPATIAL_QUERY_E2E_RADII, DEFAULT_RADII),
    nouns: parseCsvList(process.env.SPATIAL_QUERY_E2E_NOUNS, DEFAULT_NOUNS),
    url: DEFAULT_URL,
    maxResults: DEFAULT_LIMIT,
  });
}

export async function probeSpatialQueryRadius(
  request: APIRequestContext,
  config: SpatialQueryRealBranConfig,
): Promise<SpatialQueryProbeResult> {
  await tryEnsureSpatialBackendReady(request);
  const attempts: SpatialQueryProbeAttempt[] = [];

  for (const radius of config.radii) {
    const requestPath = buildProbePath(config, radius);
    const response = await request.get(requestPath);
    let payload: ProbeApiResult | null = null;
    let payloadError: string | null = null;
    let bodyPreview: string | null = null;

    try {
      const rawText = await response.text();
      bodyPreview = rawText ? rawText.slice(0, 300) : null;
      payload = rawText ? JSON.parse(rawText) as ProbeApiResult : null;
    } catch (error) {
      payloadError = error instanceof Error ? error.message : String(error);
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const nonSelfResults = results.filter((item) => String(item.refno || '').trim() !== config.refno).length;
    const errorMessage = payload?.error
      || payload?.error_message
      || payloadError
      || (!response.ok() ? `HTTP ${response.status()}` : null);

    const attempt: SpatialQueryProbeAttempt = {
      radius,
      requestPath,
      httpStatus: response.status(),
      ok: response.ok() && payload?.success !== false,
      totalResults: results.length,
      nonSelfResults,
      truncated: payload?.truncated === true,
      error: errorMessage,
      bodyPreview,
    };
    attempts.push(attempt);

    if (attempt.ok && attempt.totalResults >= 2 && attempt.nonSelfResults >= 1) {
      return {
        selectedRadius: radius,
        selectedAttempt: attempt,
        attempts,
      };
    }
  }

  const detail = attempts
    .map((attempt) => {
      return `radius=${attempt.radius} status=${attempt.httpStatus} ok=${attempt.ok} total=${attempt.totalResults} non_self=${attempt.nonSelfResults} truncated=${attempt.truncated} error=${attempt.error ?? 'null'} body=${attempt.bodyPreview ?? '<empty>'}`;
    })
    .join('\n');
  const allServerUnavailable = attempts.every((attempt) => {
    return !attempt.ok && attempt.totalResults === 0 && attempt.httpStatus >= 500;
  });
  const allSpatialEmpty = attempts.every((attempt) => {
    return attempt.ok && attempt.totalResults === 0;
  });
  const failureHints = allSpatialEmpty ? await fetchFailureHints(request, config) : null;
  const canFallbackToUiCenter = allSpatialEmpty
    ? await hasUiQueryableBranchGeometry(request, config)
    : false;

  if (allSpatialEmpty && canFallbackToUiCenter) {
    const fallbackAttempt = attempts[attempts.length - 1] ?? {
      radius: config.radii[config.radii.length - 1],
      requestPath: buildProbePath(config, config.radii[config.radii.length - 1]),
      httpStatus: 200,
      ok: true,
      totalResults: 0,
      nonSelfResults: 0,
      truncated: false,
      error: null,
      bodyPreview: null,
    };
    return {
      selectedRadius: fallbackAttempt.radius,
      selectedAttempt: fallbackAttempt,
      attempts,
    };
  }

  throw new Error([
    `真实 BRAN ${config.refno} 预检失败：未找到满足条件的查询半径`,
    '判定条件：至少 2 条结果，且至少 1 条非自身结果',
    allServerUnavailable ? '提示：本地 /api/sqlite-spatial 似未就绪；请先确认 3100 后端与空间索引服务可用。' : null,
    failureHints,
    detail,
  ].filter(Boolean).join('\n'));
}

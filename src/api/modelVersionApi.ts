/**
 * 模型版本 / 历史查询只读 API 封装（specs/004-model-version-timeline）。
 *
 * 两个后端 API 家族的响应包装不同（契约 contracts/version-timeline-ui-contract.md）：
 * - `/api/model-version/*` → `{ success, message, data }`；`success === false` 视为业务失败。
 * - `/api/model-history/*` → 成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message } }`。
 *
 * 错误分类（FR-019/020/033）：
 * - `ExpiredError`：HTTP 410 / code `Expired`（snapshot 历史过期）。
 * - `AnchorMissingError`：HTTP 404 / code `AnchorMissing`（resolve-anchor 未命中）。
 * - 其余为 `ModelVersionApiError`。
 *
 * 本模块只做只读 GET 封装，不新增任何后端写路径调用（FR-035）。
 */

import { buildBackendUrl } from '@/utils/apiBase';

// ---------------------------------------------------------------------------
// 类型（与 specs/004 research/backend-api-facts.md 核实的后端结构一致）
// ---------------------------------------------------------------------------

/** 工作流轴（六态）。后端可能扩展枚举，消费方需容忍未知值。 */
export type ModelReleaseLifecycle =
  | 'staged'
  | 'validating'
  | 'assets_materialized'
  | 'indexed'
  | 'published'
  | 'failed';

/** 质量轴（五态）。后端可能扩展枚举，消费方需容忍未知值。 */
export type ModelReleaseQuality =
  | 'complete_visual'
  | 'quarantined_visual'
  | 'degraded_visual'
  | 'patch_only'
  | 'non_visual';

export type ModelReleaseRecord = {
  release_id: string;
  release_label?: string | null;
  project_name?: string;
  branch_id?: string | null;
  dbnum?: number;
  created_at?: string | null;
  registered_at?: string | null;
  release_lifecycle?: ModelReleaseLifecycle | string;
  release_quality?: ModelReleaseQuality | string;
  release_quality_reason?: string | null;
  validation_flags?: unknown;
  /** legacy 单轴字段，新逻辑不得使用（仅调试显示） */
  release_status?: string | null;
  rows_by_table?: Record<string, number> | null;
  baseline_state_manifest_path?: string | null;
  /** release_view 附加字段（MUST 容忍） */
  package_url?: string | null;
  manifest_url?: string | null;
  viewer_url?: string | null;
  release_viewer_url?: string | null;
  [key: string]: unknown;
};

export type ModelReleaseStatusEvent = {
  release_id?: string;
  release_status?: string;
  reason?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type ModelReleaseEvents = {
  release?: ModelReleaseRecord | null;
  events: ModelReleaseStatusEvent[];
};

export type ModelReleaseDiffRow = {
  change_type?: string;
  component_key?: string;
  dbnum?: number;
  noun?: string;
  refno_str?: string;
  refno_u64?: number;
  old_component_hash?: string | null;
  new_component_hash?: string | null;
  [key: string]: unknown;
};

export type ModelReleaseDiffSummary = {
  added?: number;
  changed?: number;
  deleted?: number;
  unchanged?: number;
  emitted?: number;
  total_old?: number;
  total_new?: number;
  [key: string]: unknown;
};

export type ModelReleaseDiff = {
  rows: ModelReleaseDiffRow[];
  summary: ModelReleaseDiffSummary;
  [key: string]: unknown;
};

/** 单元级 diff：结构以后端为准，前端只透传展示（不得臆造字段）。 */
export type ModelUnitDiff = Record<string, unknown>;

export type ModelReleasePairReadiness = {
  classification?: string;
  production_ready?: boolean;
  problems?: unknown[];
  warnings?: unknown[];
  recommended_action?: string;
  dbnum?: number;
  from?: Record<string, unknown> | null;
  to?: Record<string, unknown> | null;
  diff_summary?: ModelReleaseDiffSummary | null;
  [key: string]: unknown;
};

/** rs-core version_query::AnchorHit */
export type ModelHistoryAnchor = {
  dbnum: number;
  sesno: number;
  anchored_at?: string;
  source?: string | null;
  /** resolve-anchor：true=精确命中请求 sesno，false=回退到最近不大于的锚点 */
  exact?: boolean;
  [key: string]: unknown;
};

export type ModelHistoryAnchorList = {
  dbnum: number;
  count: number;
  anchors: ModelHistoryAnchor[];
};

/** 元素级历史快照（snapshot_at 返回值，结构以后端为准）。 */
export type ModelHistorySnapshot = Record<string, unknown>;

export type ModelReleaseRuntimeSceneComponent = {
  component_key?: string;
  refno_str?: string;
  refno_u64?: number;
  noun?: string;
  owner_refno_str?: string;
  owner_refno_u64?: number;
  owner_noun?: string;
  instance_matrix?: unknown;
  aabb?: { min?: unknown; max?: unknown };
  geometries?: unknown[];
  [key: string]: unknown;
};

export type ModelReleaseRuntimeScene = {
  release?: ModelReleaseRecord | null;
  scene?: {
    components?: ModelReleaseRuntimeSceneComponent[];
    [key: string]: unknown;
  } | null;
  mesh_base_url?: string;
  mesh_lod_tag?: string;
  /** 分页：MUST 暴露给整树拉取方（契约） */
  has_more?: boolean;
  next_offset?: number;
  offset?: number;
  limit?: number;
  total?: number;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

export class ModelVersionApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ModelVersionApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** 历史快照过期（HTTP 410 / code `Expired`），调用方走「历史已过期」降级（FR-019）。 */
export class ExpiredError extends ModelVersionApiError {
  constructor(message: string, status: number, payload?: unknown) {
    super(message, status, payload);
    this.name = 'ExpiredError';
  }
}

/** 锚点缺失（HTTP 404 / code `AnchorMissing`），调用方走「最近锚点/发布版本」回退（FR-020）。 */
export class AnchorMissingError extends ModelVersionApiError {
  constructor(message: string, status: number, payload?: unknown) {
    super(message, status, payload);
    this.name = 'AnchorMissingError';
  }
}

// ---------------------------------------------------------------------------
// 请求辅助
// ---------------------------------------------------------------------------

export type RequestOptions = {
  /** 全部请求支持取消（FR-033/034） */
  signal?: AbortSignal;
};

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function parseJsonPayload(resp: Response): Promise<unknown> {
  try {
    return await resp.json() as unknown;
  } catch (error) {
    // 取消请求时把 AbortError 原样抛出，不吞成"响应不可解析"
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return undefined;
  }
}

/** `/api/model-version/*` 家族：`{ success, message, data }` */
async function requestModelVersion<T>(path: string, options?: RequestOptions): Promise<T> {
  const resp = await fetch(buildBackendUrl(path), { signal: options?.signal });
  const payload = await parseJsonPayload(resp);
  const body = payload as { success?: boolean; message?: string; data?: T } | undefined;
  if (!resp.ok || body?.success === false) {
    throw new ModelVersionApiError(
      body?.message || `HTTP ${resp.status} ${resp.statusText}`,
      resp.status,
      payload,
    );
  }
  if (body === undefined) {
    throw new ModelVersionApiError('响应不是有效 JSON', resp.status, payload);
  }
  return body.data as T;
}

/** `/api/model-history/*` 家族：`{ ok, data }` / `{ ok: false, error: { code, message } }` */
async function requestModelHistory<T>(path: string, options?: RequestOptions): Promise<T> {
  const resp = await fetch(buildBackendUrl(path), { signal: options?.signal });
  const payload = await parseJsonPayload(resp);
  const body = payload as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  } | undefined;

  if (resp.ok && body !== undefined && body.ok !== false) {
    return body.data as T;
  }

  const code = body?.error?.code;
  const message = body?.error?.message || `HTTP ${resp.status} ${resp.statusText}`;
  if (resp.status === 410 || code === 'Expired') {
    throw new ExpiredError(message, resp.status, payload);
  }
  if (resp.status === 404 || code === 'AnchorMissing') {
    throw new AnchorMissingError(message, resp.status, payload);
  }
  throw new ModelVersionApiError(message, resp.status, payload);
}

// ---------------------------------------------------------------------------
// /api/model-version/*（发布版本家族）
// ---------------------------------------------------------------------------

export type ListReleasesParams = {
  project?: string;
  allProjects?: boolean;
  dbnum?: number;
  quality?: string;
  completeVisualOnly?: boolean;
};

export async function listReleases(
  params?: ListReleasesParams,
  options?: RequestOptions,
): Promise<ModelReleaseRecord[]> {
  const data = await requestModelVersion<{ releases?: ModelReleaseRecord[] }>(
    withQuery('/api/model-version/releases', {
      project: params?.project,
      all_projects: params?.allProjects,
      dbnum: params?.dbnum,
      quality: params?.quality,
      complete_visual_only: params?.completeVisualOnly,
    }),
    options,
  );
  return Array.isArray(data?.releases) ? data.releases : [];
}

export async function getRelease(
  releaseId: string,
  project?: string,
  options?: RequestOptions,
): Promise<ModelReleaseRecord> {
  const data = await requestModelVersion<{ release?: ModelReleaseRecord }>(
    withQuery(`/api/model-version/releases/${encodeURIComponent(releaseId)}`, { project }),
    options,
  );
  return (data?.release ?? data) as ModelReleaseRecord;
}

export async function getReleaseEvents(
  releaseId: string,
  project?: string,
  options?: RequestOptions,
): Promise<ModelReleaseEvents> {
  const data = await requestModelVersion<{ events?: unknown }>(
    withQuery(`/api/model-version/releases/${encodeURIComponent(releaseId)}/events`, { project }),
    options,
  );
  const rawEvents = data?.events;
  // 容忍两种包装：data.events 直接是数组，或 data.events = { release, events }
  if (Array.isArray(rawEvents)) {
    return { events: rawEvents as ModelReleaseStatusEvent[] };
  }
  const nested = rawEvents as { release?: ModelReleaseRecord | null; events?: unknown } | undefined;
  return {
    release: nested?.release ?? null,
    events: Array.isArray(nested?.events) ? nested.events as ModelReleaseStatusEvent[] : [],
  };
}

export type ReleaseDiffParams = {
  project: string;
  fromReleaseId: string;
  toReleaseId: string;
  /** 后端默认 200、上限 5000（model_version_api.rs:55-56） */
  limit?: number;
  changeType?: string;
  componentKey?: string;
};

function diffQuery(params: ReleaseDiffParams): Record<string, QueryValue> {
  return {
    project: params.project,
    from_release_id: params.fromReleaseId,
    to_release_id: params.toReleaseId,
    limit: params.limit,
    change_type: params.changeType,
    component_key: params.componentKey,
  };
}

export async function getReleaseDiff(
  params: ReleaseDiffParams,
  options?: RequestOptions,
): Promise<ModelReleaseDiff> {
  const data = await requestModelVersion<{ diff?: ModelReleaseDiff }>(
    withQuery('/api/model-version/diff', diffQuery(params)),
    options,
  );
  const diff = (data?.diff ?? data) as Partial<ModelReleaseDiff> | undefined;
  return {
    ...diff,
    rows: Array.isArray(diff?.rows) ? diff.rows : [],
    summary: (diff?.summary ?? {}) as ModelReleaseDiffSummary,
  };
}

export async function getUnitDiff(
  params: ReleaseDiffParams,
  options?: RequestOptions,
): Promise<ModelUnitDiff> {
  const data = await requestModelVersion<{ diff?: ModelUnitDiff }>(
    withQuery('/api/model-version/unit-diff', diffQuery(params)),
    options,
  );
  return (data?.diff ?? data ?? {}) as ModelUnitDiff;
}

export type CompareReadinessParams = {
  project: string;
  fromReleaseId: string;
  toReleaseId: string;
};

export async function getCompareReadiness(
  params: CompareReadinessParams,
  options?: RequestOptions,
): Promise<ModelReleasePairReadiness> {
  const data = await requestModelVersion<{ readiness?: ModelReleasePairReadiness }>(
    withQuery('/api/model-version/compare-readiness', {
      project: params.project,
      from_release_id: params.fromReleaseId,
      to_release_id: params.toReleaseId,
    }),
    options,
  );
  return (data?.readiness ?? data ?? {}) as ModelReleasePairReadiness;
}

export type RuntimeSceneParams = {
  project?: string;
  componentKey?: string;
  offset?: number;
  /** 后端默认 2000、上限 20000（model_version_api.rs:57-58） */
  limit?: number;
};

export async function getRuntimeScene(
  releaseId: string,
  params?: RuntimeSceneParams,
  options?: RequestOptions,
): Promise<ModelReleaseRuntimeScene> {
  const data = await requestModelVersion<ModelReleaseRuntimeScene>(
    withQuery(`/api/model-version/releases/${encodeURIComponent(releaseId)}/runtime-scene`, {
      project: params?.project,
      component_key: params?.componentKey,
      offset: params?.offset,
      limit: params?.limit,
    }),
    options,
  );
  return (data ?? {}) as ModelReleaseRuntimeScene;
}

// ---------------------------------------------------------------------------
// /api/model-history/*（会话锚点 / 元素快照家族）
// ---------------------------------------------------------------------------

export async function listAnchors(
  dbnum: number,
  limit?: number,
  options?: RequestOptions,
): Promise<ModelHistoryAnchorList> {
  const data = await requestModelHistory<Partial<ModelHistoryAnchorList>>(
    withQuery('/api/model-history/anchors', { dbnum, limit }),
    options,
  );
  return {
    dbnum: data?.dbnum ?? dbnum,
    count: data?.count ?? (Array.isArray(data?.anchors) ? data.anchors.length : 0),
    anchors: Array.isArray(data?.anchors) ? data.anchors : [],
  };
}

export async function resolveAnchor(
  dbnum: number,
  sesno: number,
  exactOnly?: boolean,
  options?: RequestOptions,
): Promise<ModelHistoryAnchor> {
  return await requestModelHistory<ModelHistoryAnchor>(
    withQuery('/api/model-history/resolve-anchor', {
      dbnum,
      sesno,
      exact_only: exactOnly,
    }),
    options,
  );
}

export async function getSnapshot(
  dbnum: number,
  sesno: number,
  refno: string,
  peKey?: string,
  options?: RequestOptions,
): Promise<ModelHistorySnapshot> {
  return await requestModelHistory<ModelHistorySnapshot>(
    withQuery('/api/model-history/snapshot', {
      dbnum,
      sesno,
      refno,
      pe_key: peKey,
    }),
    options,
  );
}

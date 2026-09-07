/**
 * gen-model `/api/v1` 客户端基座（plan `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` P1-1）。
 *
 * 这是模型树 / 三维模型「新数据源」的唯一 HTTP 出口：`src/model-source/genModelV1/` 的适配器只
 * 通过这里的函数说话，不自己拼 URL、不自己解错误信封。与旧后端（`:3100`，`genModelE3dApi.ts`
 * 等）完全分开：两套 base URL 变量名不重叠（`VITE_GEN_MODEL_V1_BASE_URL` vs
 * `VITE_GEN_MODEL_API_BASE_URL`），过渡期一个页面同时挂两个后端是预期形态（plan §8 R5）。
 *
 * 契约以 gen-model `docs/specs/web-service-api.md` §3 / §4.5 / §4.7 / §4.10 / §4.11 为准：
 * - 错误信封 `{ code, message, detail }`，HTTP 状态只是它的影子，分型看 `code`；
 * - refno 服务端**收** `a/b` 与 `a_b` 两种写法、**回** `a_b`（`RefU64` 序列化）或 `a/b`（`to_pdms_str`），
 *   本仓内部统一 `a_b`（`normalizeRefnoKey` 口径），这里提供双向转换；
 * - `model/ensure` 等待超过 120 s 回 `202 { code: "generation_pending" }`——它不是失败，但对调用方
 *   而言与 `504 timeout` 是同一条路（plan P3-c：不重试同一 refno，改为展开一层），所以统一走
 *   `GenModelV1ApiError` 通道，`retryAfterMs` 从 `Retry-After` 取。
 */
import { buildGenModelV1Url } from '@/utils/apiBase';

// ---------------------------------------------------------------------------
// 身份与错误
// ---------------------------------------------------------------------------

/** 请求可选携带的身份三元组；给了就必须与服务端一致，否则 422 `identity_mismatch`。 */
export type GenModelV1Identity = {
  project?: string;
  mdb?: string;
  namespace?: string;
};

/**
 * 服务端已知的 `code` 集合（spec §3 / §4.5）。`network` / `invalid_response` 是客户端自己的两档：
 * 前者是连都没连上（fetch 抛错 / 超时），后者是 2xx 但正文不是合法 JSON。
 */
export type GenModelV1ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'container'
  | 'precondition'
  | 'identity_mismatch'
  | 'initialization_not_ready'
  | 'timeout'
  | 'generation_pending'
  | 'ref0_affiliation_unavailable'
  | 'ref0_affiliation_conflict'
  | 'model_dependency_unavailable'
  | 'generation_failed'
  | 'internal'
  | 'network'
  | 'invalid_response'
  | (string & {});

export type GenModelV1ApiErrorInit = {
  code: GenModelV1ErrorCode;
  status: number;
  message: string;
  path: string;
  detail?: unknown;
  retryAfterMs?: number | null;
  cause?: unknown;
};

export class GenModelV1ApiError extends Error {
  readonly code: GenModelV1ErrorCode;
  readonly status: number;
  readonly path: string;
  readonly detail: unknown;
  /** 仅 `generation_pending` / `timeout` 一类带；毫秒，来自 `Retry-After` 响应头。 */
  readonly retryAfterMs: number | null;

  constructor(init: GenModelV1ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'GenModelV1ApiError';
    this.code = init.code;
    this.status = init.status;
    this.path = init.path;
    this.detail = init.detail;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }

  /** 库里确认没有这个 refno / 网格；只有这一档允许负缓存（spec §4.5）。 */
  get isNotFound(): boolean {
    return this.code === 'not_found';
  }

  /** WORL / SITE / ZONE 不能做生成根——不是失败，客户端该展开一层对子节点逐个 ensure。 */
  get isContainer(): boolean {
    return this.code === 'container';
  }

  /** 生成还在后台跑（202 `generation_pending` 或 504 `timeout`）；别对同一 refno 立刻重发。 */
  get isPending(): boolean {
    return this.code === 'generation_pending' || this.code === 'timeout';
  }

  /** 稍后重试有意义的一档（依赖暂时不可用 / 归属暂时解不出 / 网络）；不得负缓存。 */
  get isRetryable(): boolean {
    return (
      this.code === 'ref0_affiliation_unavailable' ||
      this.code === 'model_dependency_unavailable' ||
      this.code === 'initialization_not_ready' ||
      this.code === 'network'
    );
  }
}

export function isGenModelV1ApiError(error: unknown): error is GenModelV1ApiError {
  return error instanceof GenModelV1ApiError;
}

// ---------------------------------------------------------------------------
// refno 双向转换
// ---------------------------------------------------------------------------

const REFNO_PATTERN = /^\s*(\d+)\s*[/_]\s*(\d+)\s*$/;

/** `a_b` / `a/b`（允许两侧空白）→ 服务端请求用的 `a/b`。非 refno 形状原样返回（交给服务端 400）。 */
export function toV1Refno(key: string): string {
  const match = REFNO_PATTERN.exec(key);
  if (!match) return key.trim();
  return `${match[1]}/${match[2]}`;
}

/** 服务端回的 `a_b` / `a/b` → 本仓内部键 `a_b`。非 refno 形状原样返回。 */
export function fromV1Refno(value: string): string {
  const match = REFNO_PATTERN.exec(value);
  if (!match) return value.trim();
  return `${match[1]}_${match[2]}`;
}

export function isRefnoLike(value: string): boolean {
  return REFNO_PATTERN.test(value);
}

/** 与服务端 `mesh_glb::is_valid_geo_hash` 同一道门：`[0-9A-Za-z_]{1,128}`。 */
export function isValidGeoHash(geoHash: string): boolean {
  return /^[0-9A-Za-z_]{1,128}$/.test(geoHash);
}

// ---------------------------------------------------------------------------
// fetch 基座
// ---------------------------------------------------------------------------

export type GenModelV1RequestOptions = {
  identity?: GenModelV1Identity;
  signal?: AbortSignal;
  /** 客户端超时；`model/ensure` 的服务端等待预算是 120 s，这里默认给 130 s，其余 30 s。 */
  timeoutMs?: number;
  /** 测试注入；缺省用全局 `fetch`。 */
  fetchImpl?: typeof fetch;
  /** 测试注入；缺省走 `buildGenModelV1Url`。 */
  baseUrl?: string;
};

type QueryValue = string | number | boolean | null | undefined;

type InternalRequest = GenModelV1RequestOptions & {
  method?: 'GET' | 'POST';
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
/** spec §4.5：服务端同步等待预算 120 s，客户端不能设得比它更短。 */
export const ENSURE_TIMEOUT_MS = 130_000;

function joinUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${normalizedPath}`;
}

function appendQuery(url: string, query?: Record<string, QueryValue>): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

function identityEntries(identity?: GenModelV1Identity): Record<string, string> {
  const out: Record<string, string> = {};
  if (!identity) return out;
  if (identity.project?.trim()) out.project = identity.project.trim();
  if (identity.mdb?.trim()) out.mdb = identity.mdb.trim();
  if (identity.namespace?.trim()) out.namespace = identity.namespace.trim();
  return out;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

function statusFallbackCode(status: number): GenModelV1ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'precondition';
    case 504:
      return 'timeout';
    default:
      return 'internal';
  }
}

type ErrorEnvelope = { code?: unknown; message?: unknown; detail?: unknown };

function readEnvelope(payload: unknown): ErrorEnvelope | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as ErrorEnvelope;
}

async function readBody(resp: Response): Promise<{ text: string; json: unknown | undefined }> {
  const text = await resp.text().catch(() => '');
  if (!text) return { text, json: undefined };
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: undefined };
  }
}

/**
 * 发一次请求，2xx 回 JSON，其余全部抛 `GenModelV1ApiError`。
 *
 * - GET：身份三元组进 query；POST：身份并进 JSON body（服务端 `ProjectReq` 是 `serde(flatten)`）。
 * - 202 且正文 `code === 'generation_pending'`：抛错（见文件头）。
 * - 非 2xx：正文是 `{code,message,detail}` 就原样透出；不是（代理页、空正文）按 HTTP 状态兜一个 code。
 */
export async function genModelV1Fetch<T>(path: string, request: InternalRequest = {}): Promise<T> {
  const method = request.method ?? 'GET';
  const base = request.baseUrl ?? buildGenModelV1Url('');
  const identity = identityEntries(request.identity);
  const url = appendQuery(
    joinUrl(base, path),
    method === 'GET' ? { ...identity, ...(request.query ?? {}) } : request.query,
  );
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path,
      message: 'fetch 不可用（非浏览器环境且未注入 fetchImpl）',
    });
  }

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error(`gen-model 请求超时 ${timeoutMs} ms: ${path}`)), timeoutMs);
  const onOuterAbort = () => controller.abort(request.signal?.reason);
  if (request.signal) {
    if (request.signal.aborted) onOuterAbort();
    else request.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify({ ...identity, ...(request.body ?? {}) }) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path,
      message: `gen-model 请求失败 ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onOuterAbort);
  }

  const { text, json } = await readBody(resp);
  const envelope = readEnvelope(json);

  if (resp.status === 202 && envelope?.code === 'generation_pending') {
    throw new GenModelV1ApiError({
      code: 'generation_pending',
      status: 202,
      path,
      message:
        typeof envelope.message === 'string' && envelope.message
          ? envelope.message
          : `生成仍在后台进行: ${path}`,
      detail: json,
      retryAfterMs: parseRetryAfterMs(resp.headers.get('Retry-After')),
    });
  }

  if (!resp.ok) {
    const code =
      typeof envelope?.code === 'string' && envelope.code ? (envelope.code as GenModelV1ErrorCode) : statusFallbackCode(resp.status);
    const message =
      typeof envelope?.message === 'string' && envelope.message
        ? envelope.message
        : `HTTP ${resp.status} ${resp.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`;
    throw new GenModelV1ApiError({
      code,
      status: resp.status,
      path,
      message,
      detail: envelope?.detail ?? (json === undefined ? text || undefined : json),
      retryAfterMs: parseRetryAfterMs(resp.headers.get('Retry-After')),
    });
  }

  if (json === undefined) {
    throw new GenModelV1ApiError({
      code: 'invalid_response',
      status: resp.status,
      path,
      message: `gen-model 响应不是合法 JSON: ${text.slice(0, 200)}`,
      detail: text,
    });
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// DTO（与 spec 逐字段对齐；只声明前端会读的字段，其余以索引签名放行）
// ---------------------------------------------------------------------------

export type SessionVectorEntry = { dbnum: number; sesno: number };

/** `EleTreeNode` 原样序列化 + HTTP 层外包的 `dbnum`（spec §4.10）。`refno` / `owner` 是 `a_b`。 */
export type EleTreeNodeDto = {
  refno: string;
  noun: string;
  name: string;
  owner: string;
  order: number;
  children_count: number;
  /** Ref0 不在本 MDB 骨架里时为 `null`——「答不出」，不是 0 号库。 */
  dbnum?: number | null;
  op?: unknown;
  mod_cnt?: number | null;
  children_updated?: unknown;
  status_code?: number | null;
};

export type TreeRootsResponse = {
  source: string;
  project: string;
  mdb: string;
  nodes: EleTreeNodeDto[];
};

export type TreeChildrenResponse = {
  source: string;
  /** `a/b` */
  parent: string;
  nodes: EleTreeNodeDto[];
};

export type TreeAncestorsResponse = {
  source: string;
  /** 自己在前、向上到库顶；`a_b` */
  refnos: string[];
};

export type SearchItem = {
  name: string;
  /** `a/b` */
  refno: string;
  dbnum: number;
  /** 读不出来是空串，不是 null */
  noun: string;
};

export type SearchResponse = {
  source: string;
  epoch: number;
  session_vector: SessionVectorEntry[];
  items: SearchItem[];
  total: number;
  truncated: boolean;
  next_cursor: number | null;
};

export type ElementAttribute = {
  name: string;
  value_type: string;
  display: string;
  is_unset: boolean;
  editable: boolean;
  is_uda: boolean;
};

export type ElementAttributesResponse = {
  source: string;
  complete: boolean;
  attributes: ElementAttribute[];
  diagnostics?: { undecoded?: string[]; [key: string]: unknown } | null;
};

export type ModelEnsureStatus = 'Generated' | 'AlreadyAvailable' | 'NoRenderableGeometry';

export type ModelEnsureResponse = {
  status: ModelEnsureStatus | (string & {});
  /** `a/b` */
  generation_root?: string;
  /** 读透形态对容器节点解出的全部生成根（`a/b`）；空 / 缺省时用请求的 refno 自己 */
  generation_roots?: string[];
  model_available?: boolean;
  model_instance_count?: number;
  generated_instance_count?: number;
  snapshot_epoch?: number;
  publication_status?: unknown;
  [key: string]: unknown;
};

/** bevy `Transform` 的 JSON 形状 */
export type V1Transform = {
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
};

/** parry `Aabb` 的 JSON 形状 */
export type V1Aabb = {
  mins: [number, number, number];
  maxs: [number, number, number];
};

export type GeomInst = {
  geo_hash: string;
  transform: V1Transform;
  is_tubi: boolean;
  is_invalid_tubi: boolean;
};

/** 一个构件下的一组几何实例（`model/records` 的 item）。`owner` 填的是生成根，不是直接属主。 */
export type GeomInstQuery = {
  /** `a_b` */
  refno: string;
  old_refno: string | null;
  /** `a_b`，生成根 */
  owner: string;
  world_aabb: V1Aabb | null;
  world_trans: V1Transform;
  insts: GeomInst[];
  has_neg: boolean;
  generic: string;
  pts: unknown;
  date: unknown;
};

export type ModelRecordsResponse = {
  source: 'model-memory' | 'model-database' | (string & {});
  items: GeomInstQuery[];
  total: number;
  truncated: boolean;
  next_cursor: number | null;
  snapshot_epoch?: number;
  session_vector?: SessionVectorEntry[];
};

export type DbnumRow = {
  dbnum: number;
  db_type?: string;
  file_name?: string;
  /** 该库拥有的全部 Ref0（升序）；骨架没预热过的形态**整格不写**，不是空数组 */
  ref0s?: number[];
  model_verdict?: string;
  [key: string]: unknown;
};

export type DbnumsResponse = {
  dbnums: DbnumRow[];
  warnings?: unknown[];
  data_face?: string;
  snapshot_epoch?: number;
};

export type HealthInitialization = {
  status?: string;
  epoch_id?: number;
  current_phase?: string | null;
  data_ready?: boolean;
  model_ready?: boolean;
  model_phase_open?: boolean;
  [key: string]: unknown;
};

export type HealthResponse = {
  status: string;
  project?: string;
  mdb?: string;
  namespace?: string;
  version?: string;
  data_face?: string;
  delivery_unit_types?: string[];
  initialization?: HealthInitialization;
  static_assets?: boolean;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

export function genModelV1Health(options?: GenModelV1RequestOptions): Promise<HealthResponse> {
  return genModelV1Fetch<HealthResponse>('/api/v1/health', { ...options, timeoutMs: options?.timeoutMs ?? 10_000 });
}

export function genModelV1TreeRoots(options?: GenModelV1RequestOptions): Promise<TreeRootsResponse> {
  return genModelV1Fetch<TreeRootsResponse>('/api/v1/tree/roots', options);
}

export function genModelV1TreeChildren(refno: string, options?: GenModelV1RequestOptions): Promise<TreeChildrenResponse> {
  return genModelV1Fetch<TreeChildrenResponse>('/api/v1/tree/children', {
    ...options,
    query: { refno: toV1Refno(refno) },
  });
}

export function genModelV1TreeAncestors(refno: string, options?: GenModelV1RequestOptions): Promise<TreeAncestorsResponse> {
  return genModelV1Fetch<TreeAncestorsResponse>('/api/v1/tree/ancestors', {
    ...options,
    query: { refno: toV1Refno(refno) },
  });
}

export type GenModelV1SearchRequest = {
  query: string;
  /** 服务端夹在 1..=500，默认 100 */
  limit?: number;
  cursor?: number;
};

export function genModelV1Search(req: GenModelV1SearchRequest, options?: GenModelV1RequestOptions): Promise<SearchResponse> {
  return genModelV1Fetch<SearchResponse>('/api/v1/search', {
    ...options,
    query: { query: req.query, limit: req.limit, cursor: req.cursor },
  });
}

export function genModelV1ElementAttributes(
  refno: string,
  options?: GenModelV1RequestOptions,
): Promise<ElementAttributesResponse> {
  return genModelV1Fetch<ElementAttributesResponse>('/api/v1/element/attributes', {
    ...options,
    method: 'POST',
    body: { refno: toV1Refno(refno) },
  });
}

export type GenModelV1EnsureRequest = {
  refno: string;
  /** 只给「人明确要求重生成」用；显示补齐**不要**传（spec §4.5） */
  force?: boolean;
};

export function genModelV1ModelEnsure(req: GenModelV1EnsureRequest, options?: GenModelV1RequestOptions): Promise<ModelEnsureResponse> {
  return genModelV1Fetch<ModelEnsureResponse>('/api/v1/model/ensure', {
    ...options,
    timeoutMs: options?.timeoutMs ?? ENSURE_TIMEOUT_MS,
    method: 'POST',
    body: req.force ? { refno: toV1Refno(req.refno), force: true } : { refno: toV1Refno(req.refno) },
  });
}

export type GenModelV1RecordsRequest = {
  generationRoot: string;
  /** 服务端夹在 1..=5000，默认 1000 */
  limit?: number;
  cursor?: number;
};

export function genModelV1ModelRecords(req: GenModelV1RecordsRequest, options?: GenModelV1RequestOptions): Promise<ModelRecordsResponse> {
  return genModelV1Fetch<ModelRecordsResponse>('/api/v1/model/records', {
    ...options,
    method: 'POST',
    body: { generation_root: toV1Refno(req.generationRoot), limit: req.limit, cursor: req.cursor },
  });
}

export function genModelV1Dbnums(options?: GenModelV1RequestOptions): Promise<DbnumsResponse> {
  return genModelV1Fetch<DbnumsResponse>('/api/v1/dbnums', options);
}

/**
 * `GET /api/v1/meshes/{geo_hash}.glb` 的 URL（spec §4.11）。不发请求——网格由现有 DTX 加载链
 * 自己 fetch + `parseGlbGeometry`。字符集不合法直接抛（服务端也会 400，这里省一次往返）。
 */
export function genModelV1MeshUrl(geoHash: string, baseUrl?: string): string {
  if (!isValidGeoHash(geoHash)) {
    throw new GenModelV1ApiError({
      code: 'bad_request',
      status: 400,
      path: '/api/v1/meshes',
      message: `geo_hash 只允许字母、数字与下划线（1–128 位）: ${geoHash}`,
    });
  }
  const path = `/api/v1/meshes/${geoHash}.glb`;
  return baseUrl !== undefined ? joinUrl(baseUrl, path) : buildGenModelV1Url(path);
}

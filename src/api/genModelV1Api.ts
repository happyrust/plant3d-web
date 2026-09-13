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
 * 服务端已知的 `code` 集合（spec §3 / §4.5）。`network` / `cancelled` / `invalid_response`
 * 是客户端自己的三档：网络或请求预算失败、调用方主动取消、2xx 但正文不是合法 JSON。
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
  /** `spatial/*`：进程内空间树还没 Ready（Loading / Rebuilding / Degraded），503 + `Retry-After`（spec §4.13） */
  | 'spatial_not_ready'
  | 'internal'
  | 'network'
  | 'cancelled'
  | 'invalid_response'
  | (string & {});

export type GenModelV1AbortSource = 'caller' | 'timeout' | null;

export type GenModelV1ApiErrorInit = {
  code: GenModelV1ErrorCode;
  status: number;
  message: string;
  path: string;
  detail?: unknown;
  retryAfterMs?: number | null;
  cause?: unknown;
  abortSource?: GenModelV1AbortSource;
};

export class GenModelV1ApiError extends Error {
  readonly code: GenModelV1ErrorCode;
  readonly status: number;
  readonly path: string;
  readonly detail: unknown;
  readonly cause: unknown;
  readonly abortSource: GenModelV1AbortSource;
  /** 仅 `generation_pending` / `timeout` 一类带；毫秒，来自 `Retry-After` 响应头。 */
  readonly retryAfterMs: number | null;

  constructor(init: GenModelV1ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'GenModelV1ApiError';
    this.code = init.code;
    this.status = init.status;
    this.path = init.path;
    this.detail = init.detail;
    this.cause = init.cause;
    this.abortSource = init.abortSource ?? null;
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

  /** 调用方主动取消；不是服务断线，不进入 legacy 重连失效账。 */
  get isCancelled(): boolean {
    return this.code === 'cancelled';
  }

  /** 稍后重试有意义的一档（依赖暂时不可用 / 归属暂时解不出 / 空间树未就绪 / 网络）；不得负缓存。 */
  get isRetryable(): boolean {
    return (
      this.code === 'ref0_affiliation_unavailable' ||
      this.code === 'model_dependency_unavailable' ||
      this.code === 'initialization_not_ready' ||
      this.code === 'spatial_not_ready' ||
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
  const text = await resp.text();
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
  let abortSource: GenModelV1AbortSource = null;
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortSource = 'timeout';
    controller.abort(new Error(`gen-model 请求超时 ${timeoutMs} ms: ${path}`));
  }, timeoutMs);
  const onOuterAbort = () => {
    if (controller.signal.aborted) return;
    abortSource = 'caller';
    controller.abort(request.signal?.reason);
  };
  if (request.signal) {
    if (request.signal.aborted) onOuterAbort();
    else request.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  let resp: Response;
  let body: { text: string; json: unknown | undefined };
  try {
    resp = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify({ ...identity, ...(request.body ?? {}) }) : undefined,
      signal: controller.signal,
    });
    // fetch 在响应头到达后就会 resolve；正文仍属于同一次请求预算，也必须继续响应外部 abort。
    body = await readBody(resp);
  } catch (error) {
    const cancelledByCaller = abortSource === 'caller';
    throw new GenModelV1ApiError({
      code: cancelledByCaller ? 'cancelled' : 'network',
      status: 0,
      path,
      message: `gen-model 请求失败 ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
      abortSource,
    });
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onOuterAbort);
  }

  const { text, json } = body;
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
  /** 单根请求回显（`a/b`） */
  generation_root?: string;
  /** 批量请求回显（`a/b`，请求顺序）；spec §4.5.2 */
  generation_roots?: string[];
  /** 批量请求：整批逐根总数（每页都带），`total: 0` 的根显式在列 */
  roots?: { generation_root: string; total: number }[];
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

export type GenModelV1Capabilities = {
  dbnum_model_ensure?: boolean;
  dbnum_model_ready_roots?: boolean;
  model_records_batch_max_roots?: number;
  mesh_formats?: string[];
  [key: string]: unknown;
};

export type GenModelV1SulDbHealth = {
  medium?: string;
  durable?: boolean;
  [key: string]: unknown;
};

export type HealthResponse = {
  status: string;
  project?: string;
  mdb?: string;
  namespace?: string;
  version?: string;
  started_at?: string;
  data_face?: string;
  sul_db?: GenModelV1SulDbHealth;
  capabilities?: GenModelV1Capabilities;
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

/** `element/ptset` 里的一个 P 点：构件局部系，mm，`dir` 已归一化（spec §4.11.1）。 */
export type ElementPtsetPoint = {
  number: number;
  /** `PTAX` / `PTCA` / `PTMI` */
  noun: string;
  pt: [number, number, number];
  dir: [number, number, number];
  /** `PBOR`，求不出为 null */
  bore: number | null;
};

export type ElementPtsetUnresolved = {
  number: number;
  reason: string;
};

/** 一个构件的目录 P 点集（`element/ptset` 的顶层字段，也是 `members[]` 每一项的形状）。 */
export type ElementPtsetItem = {
  /** `a/b` */
  refno: string;
  dbnum: number;
  noun: string;
  name: string | null;
  /** 没有 `SPRE` 链 / 目录件没有 `PTRE` 时为 null——「这个构件没有 P 点」，不是错 */
  catalogue: { component: string; point_set: string | null } | null;
  /** 局部 → 世界，列主序 16 个数（THREE `Matrix4.fromArray` 布局，平移在 12–14），mm */
  world_transform: number[];
  unit: 'mm' | (string & {});
  /** `PTSE` 成员原序 */
  points: ElementPtsetPoint[];
  unresolved: ElementPtsetUnresolved[];
};

export type ElementPtsetResponse = ElementPtsetItem & {
  source: 'e3d-model' | (string & {});
  /** 仅 `include_members=true` 时出现：直属成员逐个一条 */
  members?: ElementPtsetItem[];
};

export type GenModelV1ElementPtsetRequest = {
  refno: string;
  /** 一并解直属成员的点集（BRAN / EQUI 这类容器自身没有 P 点，测量悬停显示的是成员的点） */
  includeMembers?: boolean;
};

/** `POST /api/v1/element/ptset`：直读 dabacon 的目录 P 点集（E3D PTSET），测量捕捉的 P-Point 来源。 */
export function genModelV1ElementPtset(
  req: GenModelV1ElementPtsetRequest,
  options?: GenModelV1RequestOptions,
): Promise<ElementPtsetResponse> {
  return genModelV1Fetch<ElementPtsetResponse>('/api/v1/element/ptset', {
    ...options,
    method: 'POST',
    body: req.includeMembers
      ? { refno: toV1Refno(req.refno), include_members: true }
      : { refno: toV1Refno(req.refno) },
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

/** spec §4.5.2：一次 `model/records` 最多打包几根（与服务端 `MAX_MODEL_RECORDS_ROOTS` 同值；多给 400）。 */
export const MAX_MODEL_RECORDS_ROOTS = 64;

/**
 * `model/records` 的客户端超时。服务端逐根取记录的长尾实测 0.5 s–4 min（母计划 §8.9），一批最多 64 根还要再长；
 * 缺省 30 s 会把慢根 / 大批误判成网络错误再逐根重打一遍。调用方仍可用 `signal` 提前取消。
 */
export const RECORDS_TIMEOUT_MS = 300_000;

export type GenModelV1RecordsRequest = {
  /** 单根（`a_b` / `a/b`）；与 `generationRoots` 必须且只能给一个 */
  generationRoot?: string;
  /**
   * 多根批量（spec §4.5.2，2026-09-09）：`1..=MAX_MODEL_RECORDS_ROOTS` 根、同库、不重复。响应 `items` **平铺**（按 `owner`
   * 分组即是按根）、`cursor` 跨根连续、`limit` 仍是总条数；回显 `generation_roots` 并多一格 `roots[]`（逐根总数）。
   * 旧服务端（如 0.1.21）不认识这个字段：JSON 反序列化就被拒（422，非信封），调用方据此退回逐根（`modelRecords.ts`）。
   */
  generationRoots?: string[];
  /** 服务端夹在 1..=5000，默认 1000；批量时仍是这一页的总条数 */
  limit?: number;
  cursor?: number;
};

export async function genModelV1ModelRecords(req: GenModelV1RecordsRequest, options?: GenModelV1RequestOptions): Promise<ModelRecordsResponse> {
  const path = '/api/v1/model/records';
  const single = typeof req.generationRoot === 'string' && req.generationRoot.trim() !== '';
  const batch = Array.isArray(req.generationRoots);
  if (single === batch) {
    throw new GenModelV1ApiError({
      code: 'bad_request',
      status: 400,
      path,
      message: 'model/records 的 generationRoot 与 generationRoots 必须且只能给一个',
    });
  }
  let body: Record<string, unknown>;
  if (batch) {
    const roots = req.generationRoots!;
    if (roots.length < 1 || roots.length > MAX_MODEL_RECORDS_ROOTS) {
      throw new GenModelV1ApiError({
        code: 'bad_request',
        status: 400,
        path,
        message: `model/records 一批只能 1..=${MAX_MODEL_RECORDS_ROOTS} 根，给了 ${roots.length}`,
      });
    }
    body = { generation_roots: roots.map(toV1Refno), limit: req.limit, cursor: req.cursor };
  } else {
    body = { generation_root: toV1Refno(req.generationRoot!), limit: req.limit, cursor: req.cursor };
  }
  return genModelV1Fetch<ModelRecordsResponse>(path, {
    ...options,
    timeoutMs: options?.timeoutMs ?? RECORDS_TIMEOUT_MS,
    method: 'POST',
    body,
  });
}

export function genModelV1Dbnums(options?: GenModelV1RequestOptions): Promise<DbnumsResponse> {
  return genModelV1Fetch<DbnumsResponse>('/api/v1/dbnums', options);
}

// ---------------------------------------------------------------------------
// 整库入口（读透 / kv-mem 形态，spec §4.5.3；收口计划 §17）
// ---------------------------------------------------------------------------

/** `POST /api/v1/dbnums/{dbnum}/model/ensure` 的 202 回执。`durable` 恒 false：投影活不过服务端进程重启。 */
export type DbnumModelEnsureResponse = {
  task_id: string;
  dbnum: number;
  /** 服务端真枚举出来的根数，不是估计——进度条的分母 */
  expected_roots: number;
  already_ready?: number;
  source_sesno?: number;
  state: string;
  model_source?: string;
  model_source_reason?: string | null;
  durable?: boolean;
  [key: string]: unknown;
};

/**
 * 整库按需生成：服务端解出该库全部生成根并投进进程内投影，202 先回、后台跑（spec §4.5.3）。
 *
 * 客户端超时按 `ENSURE_TIMEOUT_MS` 给：202 之前服务端要**同步**把根枚举完（大库几秒到几十秒），
 * 30 s 缺省会把它误判成网络错误。
 * 旧构建没有这条路由（404 `not_found`）、`database` 形态的库回 409——两者都由调用方退回逐 SITE ensure。
 */
export function genModelV1DbnumModelEnsure(
  dbnum: number,
  options?: GenModelV1RequestOptions,
): Promise<DbnumModelEnsureResponse> {
  return genModelV1Fetch<DbnumModelEnsureResponse>(`/api/v1/dbnums/${dbnum}/model/ensure`, {
    ...options,
    timeoutMs: options?.timeoutMs ?? ENSURE_TIMEOUT_MS,
    method: 'POST',
    body: {},
  });
}

export type DbnumModelRootsResponse = {
  source: string;
  task_id?: string | null;
  dbnum: number;
  source_sesno?: number;
  /** 该库全部根数（`?ready=1` 时也是全部，不是回了几条） */
  total: number;
  /** 其中已就绪（投影里有回执、`records` 现在就读得到）的根数；旧 §4.5.3 构建没有这一格 */
  ready_total?: number;
  /** 服务端回显：这次是不是只回了就绪的根；旧构建没有这一格 */
  only_ready?: boolean;
  /**
   * `generation_root` 是 `a/b`（服务端口径），调用方自己 `fromV1Refno`。
   * `ready`：投影里有这根的回执（判据与整库任务的进度同一个）；旧构建的行没有这一格。
   */
  roots: { generation_root: string; noun?: string; name?: string; ready?: boolean }[];
};

export type GenModelV1DbnumModelRootsOptions = GenModelV1RequestOptions & {
  /** 只要就绪的根（`?ready=1`）——整库任务在飞时每拍问一次，新就绪的立刻去取 `records`（plan 2026-09-10 §12） */
  ready?: boolean;
  /** 整库任务刚返回的 id；有它时 roots、进度与 expected_roots 消费同一冻结集合 */
  taskId?: string;
};

/**
 * 该库的全部生成根（只读，不生成）：拿它直接喂多根 `records`，不必靠逐 SITE ensure 的回执凑清单。
 * 每行的 `ready` 说这根的 `records` 现在读得到；`ready: true` 只回就绪的那些。
 */
export function genModelV1DbnumModelRoots(
  dbnum: number,
  options?: GenModelV1DbnumModelRootsOptions,
): Promise<DbnumModelRootsResponse> {
  const { ready, taskId, ...request } = options ?? {};
  return genModelV1Fetch<DbnumModelRootsResponse>(`/api/v1/dbnums/${dbnum}/model/roots`, {
    ...request,
    ...((ready || taskId) ? { query: { ...(ready ? { ready: '1' } : {}), ...(taskId ? { task_id: taskId } : {}) } } : {}),
  });
}

export type TaskEntryDto = {
  task_id: string;
  kind: string;
  /** `queued | running | succeeded | partial | yielded | failed` */
  state: string;
  units_done?: number | null;
  total_units?: number | null;
  current_stage?: string | null;
  detail?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * `GET /api/v1/tasks/{id}`。
 *
 * §12（决策 d-195）下线的是「拿服务端任务反推别人改了什么」那一套：`GET /tasks` 列表轮询、WS `model_drain`
 * 订阅、与已加载根求交后重载。这里只查**本会话自己刚发起的那一个 `task_id`**，问的是「我按下的这一发完了没」，
 * 不列表、不订阅、不据此重载任何已加载的根。
 */
export function genModelV1TaskGet(taskId: string, options?: GenModelV1RequestOptions): Promise<TaskEntryDto> {
  return genModelV1Fetch<TaskEntryDto>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, options);
}

// ---------------------------------------------------------------------------
// 空间邻近查询（spec §4.13；plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` §3.1）
// ---------------------------------------------------------------------------

export type SpatialShape = 'sphere' | 'cube';
/** 服务端排序；v1 没有专业维度，legacy 的 `spec_distance` 由适配器折成 `distance`。 */
export type SpatialSort = 'distance' | 'name';

export type SpatialPosition = { x: number; y: number; z: number };

export type GenModelV1SpatialNearbyRequest = {
  /** 与 `position` 二选一；`a_b` / `a/b`，中心取该构件（含子树）的 AABB */
  refno?: string;
  /** 与 `refno` 二选一；mm，世界坐标 */
  position?: SpatialPosition;
  /** mm，服务端要求 `0 < r ≤ 100000` */
  radius: number;
  /** 默认 sphere */
  shape?: SpatialShape;
  /** 大写比较；服务端收逗号分隔 */
  nouns?: string[];
  /** 分页前匹配 refno / noun（不匹配 name，§5-2 按 (a)） */
  keyword?: string;
  sort?: SpatialSort;
  /** refno 模式默认 false：剔除自身与 `ancestors` 含 target 的子树 */
  includeSelf?: boolean;
  /** 默认 false：按 `TOTAL_NEG_NOUN_NAMES` 过滤负实体 */
  includeNegative?: boolean;
  /** 限定库 */
  dbnums?: number[];
  /** 从 1 起 */
  page?: number;
  /** 默认 500，上限 1000 */
  perPage?: number;
};

/** 一条命中：盒是 mm 世界坐标的 min / max 三元组；`distance` 是 AABB 到中心（点或目标盒）的最小表面距离。 */
export type SpatialNearbyItem = {
  /** `a_b` */
  refno: string;
  dbnum: number;
  noun: string;
  /** 只对本页补（§5-2），解不出为 null */
  name: string | null;
  aabb: { min: [number, number, number]; max: [number, number, number] };
  distance: number;
  within_radius: boolean;
};

export type SpatialCenter = SpatialPosition & {
  source: 'position' | 'refno_aabb_center' | (string & {});
};

export type SpatialNearbyResponse = {
  results: SpatialNearbyItem[];
  center: SpatialCenter;
  radius: number;
  shape: SpatialShape | (string & {});
  total_count: number;
  returned_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
  candidate_count: number;
  truncated_candidates: boolean;
  candidate_cap: number;
  /** 全集按库分组的计数，不受分页影响 */
  groups: { dbnum: number; count: number }[];
  filter_options: { nouns: { value: string; count: number; is_negative: boolean }[] };
  /** `spatial_state` 字面值（`ready` / `ready_empty`…） */
  spatial_state: string;
  /** 第一版只覆盖全局树里的盒（§5-5 按 (a)） */
  coverage: 'global-tree' | (string & {});
  [key: string]: unknown;
};

export type SpatialNearbyRefnosResponse = {
  /** `a_b`，完整命中集合（未分页），上限 `result_cap` */
  refnos: string[];
  by_dbnum: Record<string, string[]>;
  total_count: number;
  truncated_results: boolean;
  result_cap: number;
  center: SpatialCenter;
  radius: number;
  shape: SpatialShape | (string & {});
  [key: string]: unknown;
};

export type SpatialNegativeNounsResponse = {
  nouns: string[];
};

function spatialNearbyQuery(req: GenModelV1SpatialNearbyRequest): Record<string, QueryValue> {
  return {
    refno: req.refno !== undefined && req.refno !== '' ? toV1Refno(req.refno) : undefined,
    x: req.position?.x,
    y: req.position?.y,
    z: req.position?.z,
    radius: req.radius,
    shape: req.shape,
    nouns: req.nouns && req.nouns.length > 0 ? req.nouns.join(',') : undefined,
    keyword: req.keyword,
    sort: req.sort,
    include_self: req.includeSelf,
    include_negative: req.includeNegative,
    dbnums: req.dbnums && req.dbnums.length > 0 ? req.dbnums.join(',') : undefined,
    page: req.page,
    per_page: req.perPage,
  };
}

/** `GET /api/v1/spatial/nearby`：按 refno 或点 + 半径在进程内 `GLOBAL_AABB_TREE` 里找周边构件，分页。 */
export function genModelV1SpatialNearby(
  req: GenModelV1SpatialNearbyRequest,
  options?: GenModelV1RequestOptions,
): Promise<SpatialNearbyResponse> {
  return genModelV1Fetch<SpatialNearbyResponse>('/api/v1/spatial/nearby', {
    ...options,
    query: spatialNearbyQuery(req),
  });
}

/** `GET /api/v1/spatial/nearby/refnos`：同参、不分页的完整命中 refno 集（`page / per_page` 不发）。 */
export function genModelV1SpatialNearbyRefnos(
  req: GenModelV1SpatialNearbyRequest,
  options?: GenModelV1RequestOptions,
): Promise<SpatialNearbyRefnosResponse> {
  const { page: _page, perPage: _perPage, ...rest } = req;
  return genModelV1Fetch<SpatialNearbyRefnosResponse>('/api/v1/spatial/nearby/refnos', {
    ...options,
    query: spatialNearbyQuery(rest),
  });
}

/** `GET /api/v1/spatial/negative-nouns`：负实体 noun 全量清单（`TOTAL_NEG_NOUN_NAMES`）。 */
export function genModelV1SpatialNegativeNouns(options?: GenModelV1RequestOptions): Promise<SpatialNegativeNounsResponse> {
  return genModelV1Fetch<SpatialNegativeNounsResponse>('/api/v1/spatial/negative-nouns', options);
}

/**
 * `GET /api/v1/meshes/{geo_hash}.mesh` 的 URL（spec §4.11）。不发请求——网格由现有 DTX
 * 加载链自己 fetch + `parseMeshGeometry`（rkyv 原样直连，2026-09-09 拍板：不再经服务端
 * 转 GLB；`.glb` 口径服务端保留一个发布周期）。字符集不合法直接抛（服务端也会 400，
 * 这里省一次往返）。
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
  const path = `/api/v1/meshes/${geoHash}.mesh`;
  return baseUrl !== undefined ? joinUrl(baseUrl, path) : buildGenModelV1Url(path);
}

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
  /** `DELETE` 只给 `model/history/{snapshot_key}` 释放历史投影用（2026-09-18，ADR 0065） */
  method?: 'GET' | 'POST' | 'DELETE';
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
    method === 'POST' ? request.query : { ...identity, ...(request.query ?? {}) },
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

/** `element/plines` 里的一条 p-line：世界系，mm（spec §4.11.2）。 */
export type ElementPlineItem = {
  /** `PKEY`，大写（`NA` / `TOS` / `BOS` …） */
  key: string;
  /** 在截面平面里、`JUSL` 对齐与 `LMIRR` 镜像之后的位置；`JUSL` 那条线恒为 `[0, 0]` */
  offset: [number, number];
  /** E3D `PLSTART pline`：p-line 在 `POSS` 截面平面上的点 */
  start: [number, number, number];
  /** E3D `PLEND pline`：p-line 在 `POSE` 截面平面上的点 */
  end: [number, number, number];
  /** `unit(end − start)` */
  dir: [number, number, number];
  length: number;
  /** E3D `PLSTCUT / PLENCUT`：按 `DRNS / DRNE` 斜切后的端点；平头端面时缺省 */
  start_cut?: [number, number, number];
  end_cut?: [number, number, number];
};

/** Pick Settings「Significant Snap Points」的三档（E3D `EDGPLINE.fitting / joint / node`）。 */
export type ElementPlineSnapPointKind = 'fitting' | 'joint' | 'node';

/**
 * `element/plines` 里的一个 Significant Snap 分段点来源：SCTN 名下的 FITT / SJOI / SUBJ / SNOD
 * （E3D `EDGPLINE.snapLine` 的 `COLLECT ALL (FITT | SJOI SUBJ | SNOD) FOR sctn`）。世界系，mm。
 */
export type ElementPlineSnapPoint = {
  /** `a/b` */
  refno: string;
  /** `FITT` / `SJOI` / `SUBJ` / `SNOD` */
  noun: string;
  kind: ElementPlineSnapPointKind | (string & {});
  /** 沿轴离 `POSS` 的距离（mm）；SJOI / SUBJ 取属主链上最近 SNOD 的 */
  zdis: number;
  /** SNOD / SJOI / SUBJ：对齐线上 z = ZDIS 的点；FITT：目录标架原点。前端按 E3D `LINE.near` 投到各 p-line 上 */
  position: [number, number, number];
};

/** `POST /api/v1/element/plines` 的响应：SCTN / GENSEC 的目录 p-line 线（E3D `EDGPLINE.line`）。 */
export type ElementPlinesResponse = {
  source: 'e3d-model' | (string & {});
  /** `a/b` */
  refno: string;
  dbnum: number;
  noun: string;
  name: string | null;
  unit: 'mm' | (string & {});
  /** 实际用到的对齐线名（`JUSL`，缺省 `NA`）；没走到截面时为 null */
  justification_line: string | null;
  /** `PSTR` 成员原序 */
  plines: ElementPlineItem[];
  /** SCTN 名下的 FITT / SJOI / SUBJ / SNOD，按 `zdis` 升序；GENSEC 与没有 p-line 时为空（老构建没有这一格） */
  snap_points?: ElementPlineSnapPoint[];
  /** `plines` 为空时的原因（不是 SCTN / GENSEC、无 SPRE、链断、无 PSTR、GENSEC 含弧）——E3D 同样没有 p-line 可拾 */
  reason?: string;
  notes: string[];
};

export type GenModelV1ElementPlinesRequest = {
  refno: string;
};

/** `POST /api/v1/element/plines`：型材（SCTN / GENSEC）的 PLINE 线，测量拾取层 Pline 过滤器的来源。 */
export function genModelV1ElementPlines(
  req: GenModelV1ElementPlinesRequest,
  options?: GenModelV1RequestOptions,
): Promise<ElementPlinesResponse> {
  return genModelV1Fetch<ElementPlinesResponse>('/api/v1/element/plines', {
    ...options,
    method: 'POST',
    body: { refno: toV1Refno(req.refno) },
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
// 模型版本（版本对比，ADR 0065 / gen-model-refactor ADR-081）
// ---------------------------------------------------------------------------

/** 与 legacy `impact_kind` 同一词表 */
export type ModelVersionImpactKindDto = 'mesh' | 'placement' | 'delivery' | 'noop' | 'tombstone';

export type ModelVersionRowDto = {
  sesno: number;
  /** RFC3339；会话页解不出时刻为 null */
  session_time: string | null;
  impact_kind: ModelVersionImpactKindDto;
};

/** `GET /api/v1/model/versions` 的回执：某最小交付单元的模型版本表（按链序旧 → 新） */
export type ModelVersionsResponse = {
  dbnum: number;
  /** `a/b` */
  unit_refno: string;
  unit_noun: string;
  file_latest_sesno: number;
  /** `limit` 截断了尾部；下一页用最后一条的 `sesno` 作 `since_sesno` */
  truncated: boolean;
  versions: ModelVersionRowDto[];
  cached?: boolean;
  elapsed_ms?: number;
  stats?: Record<string, unknown>;
  warnings?: string[];
  [key: string]: unknown;
};

export type GenModelV1ModelVersionsRequest = {
  dbnum: number;
  /** `a_b` / `a/b` */
  refno: string;
  /** 只列链序在它之后的会话（翻页游标） */
  sinceSesno?: number;
  /** 服务端缺省 500、上限 5000 */
  limit?: number;
};

/** 服务端整条链冷算是秒级（ams7997 332 会话 debug 1.9 s，大库更久）；给 120 s。 */
export const MODEL_VERSIONS_TIMEOUT_MS = 120_000;

/**
 * 某最小交付单元的模型版本表。`refno` 不是单元根 → 422 `NOT_A_DELIVERY_UNIT_ROOT`（`detail` 带 `noun` 与项目
 * `delivery_unit_types`）；整条链里没有它 → 404 `REFNO_NOT_FOUND`；`since_sesno` 不在链上 → 404 `SESSION_NOT_FOUND`。
 */
export function genModelV1ModelVersions(
  req: GenModelV1ModelVersionsRequest,
  options?: GenModelV1RequestOptions,
): Promise<ModelVersionsResponse> {
  return genModelV1Fetch<ModelVersionsResponse>('/api/v1/model/versions', {
    ...options,
    timeoutMs: options?.timeoutMs ?? MODEL_VERSIONS_TIMEOUT_MS,
    query: {
      dbnum: req.dbnum,
      refno: toV1Refno(req.refno),
      since_sesno: req.sinceSesno,
      limit: req.limit,
    },
  });
}

export type ElementVersionRowDto = {
  sesno: number;
  session_time: string | null;
  /** 该构件**自身记录**在这一会话的变化；`null` = 它自己没变 */
  element_impact: ModelVersionImpactKindDto | null;
  /** **所属单元**在这一会话的折叠影响；`null` = 单元表里没有这一会话 */
  unit_impact: ModelVersionImpactKindDto | null;
};

/** `GET /api/v1/element/versions` 的回执：某个构件的版本时间线（按链序旧 → 新），并排带所属单元那一列 */
export type ElementVersionsResponse = {
  dbnum: number;
  /** `a/b` */
  refno: string;
  noun: string;
  /** 所属最小交付单元根（`a/b`）；owner 链上没有就是 null（那种构件对不了几何） */
  unit_root: string | null;
  unit_noun: string | null;
  file_latest_sesno: number;
  truncated: boolean;
  versions: ElementVersionRowDto[];
  cached?: boolean;
  elapsed_ms?: number;
  stats?: Record<string, unknown>;
  warnings?: string[];
  [key: string]: unknown;
};

/**
 * 某个**构件**的版本时间线。与 `model/versions` 的分工：那条折整棵单元子树，这条只认这个 refno 自己的变化，
 * 并把所属单元那一列并排放在同一行。任意 refno 都受理（非单元根在这里不是错误）；整条链里没有它 → 404
 * `REFNO_NOT_FOUND`。服务端要带 `element/versions` 路由的构建，旧服务端回 404 由调用方回落。
 */
export function genModelV1ElementVersions(
  req: GenModelV1ModelVersionsRequest,
  options?: GenModelV1RequestOptions,
): Promise<ElementVersionsResponse> {
  return genModelV1Fetch<ElementVersionsResponse>('/api/v1/element/versions', {
    ...options,
    timeoutMs: options?.timeoutMs ?? MODEL_VERSIONS_TIMEOUT_MS,
    query: {
      dbnum: req.dbnum,
      refno: toV1Refno(req.refno),
      since_sesno: req.sinceSesno,
      limit: req.limit,
    },
  });
}

export type AttributeHistoryKindDto = 'created' | 'modified' | 'deleted';

export type AttributeHistoryChangeDto = {
  name: string;
  value_type: string;
  before: string | null;
  after: string | null;
  /** `CACHID` 一类编辑器缓存计数：跟着摆放一起跳，不是业务变化 */
  stamp: boolean;
};

export type AttributeHistoryEntryDto = {
  sesno: number;
  session_time: string | null;
  /** E3D 会话页记的保存人 */
  user: string;
  /** SAVEWORK 备注 */
  comment: string;
  kind: AttributeHistoryKindDto;
  impact: ModelVersionImpactKindDto;
  changed_count: number;
  changes: AttributeHistoryChangeDto[];
  members?: { added: string[]; removed: string[]; reordered: boolean };
  /** owner 改挂 `[before, after]`（`a/b`） */
  owner?: [string, string];
  attributes_unavailable?: string;
};

/** `GET /api/v1/element/attribute-history` 的回执：某节点的属性变化时间线（按链序旧 → 新） */
export type AttributeHistoryResponse = {
  dbnum: number;
  /** `a/b` */
  refno: string;
  noun: string;
  unit_root: string | null;
  unit_noun: string | null;
  file_latest_sesno: number;
  truncated: boolean;
  entries: AttributeHistoryEntryDto[];
  cached?: boolean;
  elapsed_ms?: number;
  stats?: Record<string, unknown>;
  warnings?: string[];
  [key: string]: unknown;
};

/**
 * 某节点的**属性变化时间线**（gen-model-refactor ADR-081 追记二；plant3d-web ADR 0066）：谁在哪一版改了什么。
 * 每行一个它自身记录被改过的会话，带会话 user / comment 与逐属性 before / after（与属性面板同一个渲染器出字）。
 * 任意 refno 都受理；整条链里没有它 → 404 `REFNO_NOT_FOUND`。旧服务端没有这条路由（无信封 404）由调用方回落。
 */
export function genModelV1ElementAttributeHistory(
  req: GenModelV1ModelVersionsRequest,
  options?: GenModelV1RequestOptions,
): Promise<AttributeHistoryResponse> {
  return genModelV1Fetch<AttributeHistoryResponse>('/api/v1/element/attribute-history', {
    ...options,
    timeoutMs: options?.timeoutMs ?? MODEL_VERSIONS_TIMEOUT_MS,
    query: {
      dbnum: req.dbnum,
      refno: toV1Refno(req.refno),
      since_sesno: req.sinceSesno,
      limit: req.limit,
    },
  });
}

export type NodeDiffScopeDto = 'self' | 'subtree';

export type NodeVersionDto = {
  sesno: number;
  session_time: string | null;
  /** 范围内折出来的影响（节点自身出现 / 被删压过一切，否则子树里最重的一档） */
  impact: ModelVersionImpactKindDto;
  /** 节点自身记录那一格；null = 只有子树变了 */
  self_impact: ModelVersionImpactKindDto | null;
  units_changed: number;
  units_touched: number;
};

/** `GET /api/v1/node/versions` 的回执：某节点按对比范围折叠的版本表（按链序旧 → 新） */
export type NodeVersionsResponse = {
  dbnum: number;
  /** `a/b` */
  refno: string;
  noun: string;
  scope: NodeDiffScopeDto;
  /** 节点自己所属的单元根（`a/b`）；容器为 null */
  unit_root: string | null;
  unit_noun: string | null;
  file_latest_sesno: number;
  truncated: boolean;
  versions: NodeVersionDto[];
  cached?: boolean;
  elapsed_ms?: number;
  stats?: Record<string, unknown>;
  warnings?: string[];
  [key: string]: unknown;
};

export type GenModelV1NodeVersionsRequest = GenModelV1ModelVersionsRequest & {
  scope: NodeDiffScopeDto;
};

/**
 * 某节点按对比范围折叠的**版本表**（gen-model-refactor ADR-081 追记三；plant3d-web ADR 0066 / CONTEXT「节点版本表」）。
 * `subtree` 每行 = 节点自身或其下整棵子树里任何记录变过的会话，附 `units_changed` / `units_touched`；`self` 每行 = 它自身变过的会话。
 * 任意 refno 都受理；整条链里没有它 → 404 `REFNO_NOT_FOUND`。旧服务端没有这条路由（无信封 404）由调用方回落。
 */
export function genModelV1NodeVersions(
  req: GenModelV1NodeVersionsRequest,
  options?: GenModelV1RequestOptions,
): Promise<NodeVersionsResponse> {
  return genModelV1Fetch<NodeVersionsResponse>('/api/v1/node/versions', {
    ...options,
    timeoutMs: options?.timeoutMs ?? MODEL_VERSIONS_TIMEOUT_MS,
    query: {
      dbnum: req.dbnum,
      refno: toV1Refno(req.refno),
      scope: req.scope,
      since_sesno: req.sinceSesno,
      limit: req.limit,
    },
  });
}

export type NodeDiffStatusDto = 'added' | 'deleted' | 'modified' | 'noop';

export type NodeDiffRowDto = {
  /** `a/b` */
  refno: string;
  noun: string | null;
  status: NodeDiffStatusDto;
  impact: ModelVersionImpactKindDto;
  is_node: boolean;
};

export type NodeDiffCountsDto = { added: number; deleted: number; modified: number; noop: number };

export type NodeDiffGroupDto = {
  /** `a/b`；null = 这些行不在任何最小交付单元下 */
  unit_root: string | null;
  unit_noun: string | null;
  unit_name: string | null;
  counts: NodeDiffCountsDto;
  geometry_changed: boolean;
  rows: NodeDiffRowDto[];
  rows_truncated: number;
};

/** `GET /api/v1/node/diff-summary` 的回执：节点 A→B 不生成几何的差异摘要，按最小交付单元分组 */
export type NodeDiffSummaryResponse = {
  dbnum: number;
  /** `a/b` */
  refno: string;
  noun: string | null;
  scope: NodeDiffScopeDto;
  a: number;
  b: number;
  units: { changed: number; unchanged: number; total: number; complete: boolean };
  elements: NodeDiffCountsDto;
  groups: NodeDiffGroupDto[];
  needs_confirm: boolean;
  estimated_projections: number;
  confirm_threshold_units: number;
  elapsed_ms?: number;
  stats?: Record<string, unknown>;
  warnings?: string[];
  [key: string]: unknown;
};

export type GenModelV1NodeDiffSummaryRequest = {
  dbnum: number;
  /** `a_b` / `a/b` */
  refno: string;
  a: number;
  b: number;
  scope: NodeDiffScopeDto;
};

/**
 * 节点 A→B 的**差异摘要**（ADR 0066 / 词条「差异摘要」）：一次索引差分 + 模型影响判定，按所属单元分组，不生成几何。
 * `A` 不早于 `B` → 400 `INVALID_VERSION_PAIR`；会话不在链上 → 404 `SESSION_NOT_FOUND`。旧服务端没有这条路由由调用方回落。
 */
export function genModelV1NodeDiffSummary(
  req: GenModelV1NodeDiffSummaryRequest,
  options?: GenModelV1RequestOptions,
): Promise<NodeDiffSummaryResponse> {
  return genModelV1Fetch<NodeDiffSummaryResponse>('/api/v1/node/diff-summary', {
    ...options,
    timeoutMs: options?.timeoutMs ?? MODEL_VERSIONS_TIMEOUT_MS,
    query: {
      dbnum: req.dbnum,
      refno: toV1Refno(req.refno),
      a: req.a,
      b: req.b,
      scope: req.scope,
    },
  });
}

export type GenModelV1HistoryGenerateRequest = {
  dbnum: number;
  /** `a_b` / `a/b`：单元根 */
  refno: string;
  sesno: number;
};

/** `POST /api/v1/model/history/generate` 的 202 回执；结果要轮询 `tasks/{task_id}`，成功时 `result.snapshot_key`。 */
export type HistoryGenerateResponse = {
  task_id: string;
  [key: string]: unknown;
};

/**
 * 把某单元子树在某会话的几何投进进程内 `Historical(<refno>@<sesno>)` 命名空间（不落库、重启即丢、
 * ≤ 100 000 元素 / 300 s）。202 先回，后台跑。
 */
export function genModelV1ModelHistoryGenerate(
  req: GenModelV1HistoryGenerateRequest,
  options?: GenModelV1RequestOptions,
): Promise<HistoryGenerateResponse> {
  return genModelV1Fetch<HistoryGenerateResponse>('/api/v1/model/history/generate', {
    ...options,
    method: 'POST',
    body: { dbnum: req.dbnum, refno: toV1Refno(req.refno), sesno: req.sesno },
  });
}

export type HistoryQueryTool = 'snapshot' | 'instances' | 'tubes' | 'geometry' | 'attributes';

/**
 * `history/query tool=attributes` 的回执（gen-model-refactor ADR-081 候选条，契约 2026-09-18）：某构件在该快照
 * 那个 sesno 下的属性，行与 `element/attributes` 同型、同一个渲染器。该 refno 在那个 sesno 不存在（还没建 / 已删）→
 * `exists: false`、`attributes: []`，不是 404。
 */
export type HistoryAttributesDto = {
  snapshot_key: string;
  dbnum: number;
  sesno: number;
  /** `a/b` */
  refno: string;
  exists: boolean;
  noun: string | null;
  attributes: ElementAttribute[];
  [key: string]: unknown;
};

/** `history/query tool=instances` 的一行：一条非直管的投影记录 */
export type HistoryInstanceRowDto = {
  id: string;
  snapshot_key: string;
  dbnum: number;
  /** noun */
  generic: string;
  /** `a_b` */
  source_refno: string;
  mesh_id: string;
  world_bounds: V1Aabb | null;
  world_transform: V1Transform;
  /** 「自身 → 顶层」的祖先链，每项是打包 refno `(word0 << 32) | word1`（< 2^53，JSON 数值安全） */
  anc?: number[];
  /** true = 烘焙网格（`booled_id` = `mesh_id`）；false = 规范基本体，带 `local_transform` */
  booled?: boolean;
  primitive_key?: string;
  local_transform?: V1Transform;
  local_bounds?: V1Aabb;
  [key: string]: unknown;
};

/** `history/query tool=tubes` 的一行：一段隐含直管 */
export type HistoryTubeRowDto = {
  id: string;
  snapshot_key: string;
  dbnum: number;
  /** `a_b`，所属 BRAN */
  container_refno: string;
  source_refno: string;
  leave_refno: string;
  arrive_refno: string;
  mesh_id: string;
  invalid?: boolean;
  world_bounds: V1Aabb | null;
  world_transform: V1Transform;
  /** 同 `HistoryInstanceRowDto.anc`（从所属 BRAN 起） */
  anc?: number[];
  [key: string]: unknown;
};

/** 打包 refno `(word0 << 32) | word1` → 本仓内部键 `a_b`；非法值给空串。 */
export function unpackRefno(packed: unknown): string {
  if (typeof packed !== 'number' || !Number.isFinite(packed) || packed < 0 || !Number.isInteger(packed)) return '';
  const word0 = Math.floor(packed / 2 ** 32);
  const word1 = packed - word0 * 2 ** 32;
  return word0 > 0 && word1 >= 0 ? `${word0}_${word1}` : '';
}

/**
 * `POST /api/v1/model/history/query`；`snapshot` 回回执对象（不存在为 `null`），`instances / tubes / geometry` 回数组，
 * `attributes` 回 `HistoryAttributesDto`（要 `arguments: { refno: "a/b" }`）。
 */
export function genModelV1ModelHistoryQuery<T = unknown>(
  snapshotKey: string,
  tool: HistoryQueryTool,
  options?: GenModelV1RequestOptions & { arguments?: Record<string, unknown> },
): Promise<T> {
  const { arguments: args, ...rest } = options ?? {};
  return genModelV1Fetch<T>('/api/v1/model/history/query', {
    ...rest,
    method: 'POST',
    body: args ? { snapshot_key: snapshotKey, tool, arguments: args } : { snapshot_key: snapshotKey, tool },
  });
}

/** `DELETE /api/v1/model/history/{snapshot_key}`：释放一份历史投影（共享网格不动）。 */
export function genModelV1ModelHistoryDelete(
  snapshotKey: string,
  options?: GenModelV1RequestOptions,
): Promise<{ snapshot_key: string; status: string }> {
  return genModelV1Fetch<{ snapshot_key: string; status: string }>(
    `/api/v1/model/history/${encodeURIComponent(snapshotKey)}`,
    { ...options, method: 'DELETE' },
  );
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
  /**
   * `bran_centerline`：沿这条 BRAN 的真实中心线（含隐式管身）逐段取候选，距离是段到盒的最小距离，
   * 自身 = 投影子树 ∪ BRAN 成员。只能与 `refno` 搭配。缺省按 AABB。
   */
  sourceMode?: 'bran_centerline';
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
  source: 'position' | 'refno_aabb_center' | 'bran_centerline' | (string & {});
};

/** 中心线模式独有的源描述；其它模式服务端不下发这一块。 */
export type SpatialCenterlineSource = {
  kind: 'bran_centerline' | (string & {});
  /** BRAN 的 `a_b` */
  refno: string;
  /** 走廊段数（含按 E3D 规则合成的隐式管身） */
  segment_count: number;
  centerline_bbox: { min: [number, number, number]; max: [number, number, number] };
  /** 首个给出外径的成员的外径（mm），取不到为 null */
  outside_diameter_mm: number | null;
};

export type SpatialNearbyResponse = {
  results: SpatialNearbyItem[];
  center: SpatialCenter;
  /** 只有 `source_mode=bran_centerline` 才有 */
  source?: SpatialCenterlineSource;
  /** 预取中心线时的非致命问题（有成员没成段之类） */
  warnings?: string[];
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
  /** 只有 `source_mode=bran_centerline` 才有 */
  source?: SpatialCenterlineSource;
  warnings?: string[];
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
    source_mode: req.sourceMode,
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

// ---------------------------------------------------------------------------
// BRAN 中心线最近净距（spec §4.13；plan `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` §3.2）
// ---------------------------------------------------------------------------

/** `bran_centerline`（缺省）：沿 BRAN 真实中心线（含隐式管身）量距；`aabb`：按源整盒量距，源不必是 BRAN。 */
export type SpatialClearanceSourceMode = 'bran_centerline' | 'aabb';
/** `target_groups`（缺省）：每个预置组一桶；`noun`：半径内每个 NOUN 自成一桶。 */
export type SpatialClearanceGroupBy = 'target_groups' | 'noun';
/** `all_loaded`（缺省）：不限库；`same_dbnum`：只看与源同库的候选。给了 `dbnums` 就按显式库号，这一格忽略。 */
export type SpatialClearanceScope = 'all_loaded' | 'same_dbnum';

export type GenModelV1SpatialNearestClearanceRequest = {
  /** 源构件，`a_b` / `a/b`。中心线模式必须是 BRAN（不是 → 422 `precondition`；库里没有 → 404）；`aabb` 模式任意有盒的构件 */
  sourceRefno: string;
  sourceMode?: SpatialClearanceSourceMode;
  /** 预置组：`wall` = WALL/PANE/GWALL/STWALL，`column` = COLU/SCTN/GENSEC；服务端收逗号分隔 */
  targetGroups?: string[];
  /** 直接点名的 NOUN 白名单，与 `targetGroups` 可并用。`target_groups` 分桶下两者都不给 → 400（与 legacy 同，默认值由调用方补） */
  targetNouns?: string[];
  groupBy?: SpatialClearanceGroupBy;
  /** 目标过滤之后再剔掉的噪声类型（`WELD,ATTA`），两种分桶方式都生效 */
  excludeNouns?: string[];
  /** mm；缺省 5000，上限同 `/nearby` */
  radius?: number;
  scope?: SpatialClearanceScope;
  dbnums?: number[];
  /** 每桶最多几条；缺省 1，服务端钳到 1..100 */
  maxPerGroup?: number;
  /** 缺省 **false**（与 `/nearby` 相反：净距场景没人要自己），自身 = 投影子树 ∪ BRAN 成员 */
  includeSelf?: boolean;
  /** 距离从管外表面起算（扣 `outside_diameter/2`，不小于 0）；只在中心线模式下有意义，`aabb` 下服务端忽略并出 warning。v1 独有 */
  surface?: boolean;
  debug?: boolean;
};

export type SpatialClearanceVector = { dx: number; dy: number; dz: number };
/** 净距接口的盒是 `{x,y,z}` 对象（与 `/nearby` 的三元组不同），尺寸系统直接吃。 */
export type SpatialClearanceAabb = { min: SpatialPosition; max: SpatialPosition };

export type SpatialClearanceNearest = {
  /** 中心线模式是命中的那一段（隐式管身为 `a_b~c_d`）；`aabb` 模式是源自己 */
  source_segment_refno: string;
  /** 段在成员序里的位置；`aabb` 模式为 null */
  source_segment_order: number | null;
  source_point: SpatialPosition;
  target_point: SpatialPosition;
  vector: SpatialClearanceVector;
};

/** 可以直接画的那条尺寸：两个端点 + 标注值（mm）。 */
export type SpatialClearanceAnnotation = {
  start_point: SpatialPosition;
  end_point: SpatialPosition;
  label_mm: number;
};

export type SpatialClearanceCandidate = {
  /** `a_b` */
  refno: string;
  noun: string;
  /** 答不出为 null */
  dbnum: number | null;
  distance_mm: number;
  /** 源与目标盒相交（距离 0） */
  intersects: boolean;
  aabb: SpatialClearanceAabb;
  nearest: SpatialClearanceNearest;
  annotation: SpatialClearanceAnnotation;
};

export type SpatialClearanceGroup = {
  /** `target_groups` 分桶是组名（`wall` / `column`），`noun` 分桶是 NOUN 名 */
  group: string;
  nouns: string[];
  /** 距离升序，已按 `max_per_group` 截断；`target_groups` 分桶下空桶保留（并出 warning） */
  candidates: SpatialClearanceCandidate[];
};

export type SpatialClearanceSource = {
  kind: SpatialClearanceSourceMode | (string & {});
  /** `a_b` */
  refno: string;
  dbnum: number | null;
  /** `aabb` 模式：源盒 */
  aabb: SpatialClearanceAabb | null;
  /** 中心线模式：走廊段数（含隐式管身） */
  segment_count: number | null;
  centerline_bbox: SpatialClearanceAabb | null;
  /** 管外径（mm）；`surface=1` 扣的就是它的一半，取不到为 null */
  outside_diameter_mm: number | null;
};

export type SpatialClearanceResolvedFilters = {
  /** 生效的 NOUN 白名单并集；空 = 不限 NOUN（只在 `group_by=noun` 且没给目标过滤时出现） */
  target_nouns: string[];
  target_groups: { name: string; nouns: string[] }[];
  group_by: SpatialClearanceGroupBy | (string & {});
  exclude_nouns: string[];
  scope: SpatialClearanceScope | 'explicit_dbnums' | (string & {});
  dbnums: number[] | null;
  radius: number;
  max_per_group: number;
  include_self: boolean;
  /** 实际生效值：`aabb` 模式下给了 `surface=1` 也回 false */
  surface: boolean;
};

export type SpatialClearanceDebug = {
  candidate_ids: number;
  rows_examined: number;
  scope_filtered: number;
  noun_filtered: number;
  distance_filtered: number;
  /** 因属于源自身被剔掉的候选数，与顶层 `excluded_self_members` 同源 */
  self_filtered: number;
  groups_with_hits: number;
  returned_candidates: number;
  truncated_candidates: boolean;
};

export type SpatialClearanceDistanceMethod =
  | 'centerline_aabb_clearance_mm'
  | 'centerline_surface_aabb_clearance_mm'
  | 'aabb_clearance_mm';

/**
 * 出参与 legacy `/api/sqlite-spatial/nearest-clearance` 同形（plan §3.2），`useSpatialCompute` /
 * `branExternalDimensions` 不做转换直接吃；多出来的 `dbnum` / `outside_diameter_mm` / `resolved_filters.surface` /
 * `spatial_state` / `coverage` 是 v1 独有。
 */
export type SpatialNearestClearanceResponse = {
  /** 恒为 true：失败走 HTTP 状态码 + 错误信封（`GenModelV1ApiError`），不在 200 里报错 */
  success: boolean;
  source: SpatialClearanceSource;
  distance_method: SpatialClearanceDistanceMethod | (string & {});
  unit: 'mm' | (string & {});
  /** 源盒 / 中心线盒外扩 `radius` 的查询盒 */
  query_bbox: SpatialClearanceAabb | null;
  resolved_filters: SpatialClearanceResolvedFilters;
  nearest_by_group: SpatialClearanceGroup[];
  /** 半径内、过完全部过滤的候选按 NOUN 计数（`max_per_group` 截断之前），可直接做类型 facet */
  noun_counts: Record<string, number>;
  /** 因属于源自身（BRAN + 投影子树 + `branch_query` 成员）被剔掉的候选数 */
  excluded_self_members: number;
  /** 非致命问题：BRAN 没外径、`aabb` 模式下给了 `surface`、组内无命中、库号限定答不出… */
  warnings: string[];
  spatial_state: string;
  coverage: 'global-tree' | (string & {});
  /** 仅 `debug=1` */
  debug?: SpatialClearanceDebug;
  [key: string]: unknown;
};

function joinCsv(values: readonly (string | number)[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

function spatialNearestClearanceQuery(req: GenModelV1SpatialNearestClearanceRequest): Record<string, QueryValue> {
  return {
    source_refno: toV1Refno(req.sourceRefno),
    source_mode: req.sourceMode,
    target_groups: joinCsv(req.targetGroups),
    target_nouns: joinCsv(req.targetNouns),
    group_by: req.groupBy,
    exclude_nouns: joinCsv(req.excludeNouns),
    radius: req.radius,
    scope: req.scope,
    dbnums: joinCsv(req.dbnums),
    max_per_group: req.maxPerGroup,
    include_self: req.includeSelf,
    surface: req.surface,
    debug: req.debug,
  };
}

/**
 * `GET /api/v1/spatial/nearest-clearance`：沿 BRAN 中心线（或按源包围盒）在进程内 `GLOBAL_AABB_TREE` 里找每组最近的
 * 目标，每条候选带可直接画尺寸的两个端点。只读，与 `/nearby` 同一条流水线。
 */
export function genModelV1SpatialNearestClearance(
  req: GenModelV1SpatialNearestClearanceRequest,
  options?: GenModelV1RequestOptions,
): Promise<SpatialNearestClearanceResponse> {
  return genModelV1Fetch<SpatialNearestClearanceResponse>('/api/v1/spatial/nearest-clearance', {
    ...options,
    query: spatialNearestClearanceQuery(req),
  });
}

// ---------------------------------------------------------------------------
// BRAN 中心线线段表（spec §4.13.3；plan `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` §3.3 ④）
// ---------------------------------------------------------------------------

/**
 * 中心线上的一段：一个成员从到达点到离开点（E3D 世界 mm，与 `/nearest-clearance` 的 `annotation` 端点同一坐标系）。
 * `implicit = true` 是按 E3D 规则合成的隐式管身（refno `a_b~c_d`，不是构件），`noun` 给 `TUBI`；其余段的 `noun` 是成员自身类型
 * （大写；成员没给 → `UNKNOWN`）。挑「直段」就靠这两格：隐式管身一定直，ELBO / BEND 的到达→离开是弦不是轴。
 */
export type SpatialCenterlineSegment = {
  refno: string;
  /** 成员序（`BranchMember.order`） */
  order: number;
  noun: string;
  implicit: boolean;
  start: SpatialPosition;
  end: SpatialPosition;
  length_mm: number;
  /** 这一段成员自己的外径（mm）；隐式管身为 null，用顶层 `outside_diameter_mm` */
  outside_diameter_mm: number | null;
};

export type SpatialCenterlineResponse = {
  /** `a_b` */
  refno: string;
  dbnum: number | null;
  /** 成段的成员数（穿过件 `start == end` 不成段，所以 ≤ 成员数） */
  segment_count: number;
  /** 首个给出外径的成员的外径（mm）；隐式管身按它算半径。取不到为 null */
  outside_diameter_mm: number | null;
  centerline_bbox: SpatialClearanceAabb | null;
  /** 按成员序排好 */
  segments: SpatialCenterlineSegment[];
  warnings: string[];
  [key: string]: unknown;
};

/**
 * `GET /api/v1/spatial/centerline`：一条 BRAN 的真实中心线线段表原样取回（成员到达→离开点 + 隐式管身）。
 * 只读库、不碰空间树（没有 503 `spatial_not_ready` 一档，库没 ensure 过也答得出）；不是 BRAN → 422 `precondition`、库里没有 → 404。
 */
export function genModelV1SpatialCenterline(
  refno: string,
  options?: GenModelV1RequestOptions,
): Promise<SpatialCenterlineResponse> {
  return genModelV1Fetch<SpatialCenterlineResponse>('/api/v1/spatial/centerline', {
    ...options,
    query: { refno: toV1Refno(refno) },
  });
}

// ---------------------------------------------------------------------------
// 构件 × 墙外表面净距（plan `docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md` §5；决策 d-428；
// gen-model `a0e307588`）
// ---------------------------------------------------------------------------

/** `wall`（缺省）：目标必须是墙族（CWALL / WALL / STWALL / GWALL / PANE），否则 422；`any`：任何有网格的构件都收。 */
export type SurfaceClearanceTargetKind = 'wall' | 'any';

export type GenModelV1SurfaceClearanceRequest = {
  /** 源构件，`a_b` / `a/b`；owner（BRAN / EQUI）也行——服务端取名下全部叶子网格 */
  sourceRefno: string;
  /** 目标构件；与源相同 → 400 */
  targetRefno: string;
  targetKind?: SurfaceClearanceTargetKind;
  /** 缺省 true：命中墙主面时附一条沿墙面法向的垂距射线 */
  perpendicular?: boolean;
  /** mm；缺省 50000，上限 1e6；超出即 `result: null` + warning `beyond_max_distance` */
  maxDistanceMm?: number;
  debug?: boolean;
};

/**
 * 命中墙面：直墙两侧对称只分得出 `side`；弧墙分 `inner`（凹）/ `outer`（凸）；`opening` 是洞壁（布尔掏出来的面，
 * 构件在洞里时命中的就是它，也是主面、带垂距；gen-model `eabd16d5c`，2026-09-18 口径）。
 */
export type SurfaceClearanceFaceKind = 'inner' | 'outer' | 'side' | 'opening' | 'top' | 'bottom' | 'end' | 'unknown';
/** `pca`：按墙的水平主轴分端 / 侧；`geometric`：按拟合的弧轴分内 / 外；`normal-only`：只有法向（顶 / 底）。 */
export type SurfaceClearanceFaceConfidence = 'pca' | 'geometric' | 'normal-only';

export type SurfaceClearanceEndpoint = {
  /** `a/b` */
  refno: string;
  noun: string;
  leaf_count: number;
  triangle_count: number;
};

export type SurfaceClearanceFace = {
  kind: SurfaceClearanceFaceKind | (string & {});
  /** 命中三角的法向，已翻成指向源侧 */
  normal: SpatialPosition;
  confidence: SurfaceClearanceFaceConfidence | (string & {});
};

/**
 * 垂距怎么来的（gen-model `7bcdd60df`，2026-09-18 口径）：`ray` 从源侧最近点沿面法向打到墙面；`contact` 贴合
 * （最近距离 ≤ 垂距容差 max(1%, 0.05 mm)，不打射线，垂距 = 距离、垂足 = 目标侧最近点）；`edge` 最近点在墙的棱 / 角上、
 * 射线落空，但两点连线与面法向几乎平行（偏差在同一容差内），取连线本身当垂距。旧二进制没有这一格。
 */
export type SurfaceClearancePerpendicularMethod = 'ray' | 'contact' | 'edge';

export type SurfaceClearancePerpendicular = {
  distance_mm: number;
  from: SpatialPosition;
  to: SpatialPosition;
  /** 缺失（`7bcdd60df` 之前的服务端）按 `ray` 读 */
  method?: SurfaceClearancePerpendicularMethod | (string & {});
};

export type SurfaceClearanceResult = {
  distance_mm: number;
  intersects: boolean;
  source_point: SpatialPosition;
  target_point: SpatialPosition;
  /** `target_point − source_point`，dx / dy / dz 即 E / N / U */
  vector: SpatialClearanceVector;
  /** `a/b`：两侧真正命中的叶子 */
  source_leaf_refno: string;
  target_leaf_refno: string;
  target_leaf_noun: string;
  target_face: SurfaceClearanceFace | null;
  perpendicular: SurfaceClearancePerpendicular | null;
  /** `closest-points`：精确最近点对；`aabb-overlap-center`：相交时 parry 不给点，取两叶子 AABB 交集中心占位 */
  witness: 'closest-points' | 'aabb-overlap-center' | (string & {});
};

export type SurfaceClearanceResponse = {
  /** 恒为 true：失败走 HTTP 状态码 + 错误信封（404 `not_found` detail.reason=no_model_mesh / 422 `precondition` detail.reason=target_not_wall） */
  success: boolean;
  unit: 'mm' | (string & {});
  method: 'surface_to_surface' | (string & {});
  accuracy_class: 'exact-surface' | (string & {});
  /** 弦高容差 `FACET_TOL_MM = 0.5`：网格与真实曲面的最大偏差 */
  error_bound_mm: number;
  target_kind: SurfaceClearanceTargetKind | (string & {});
  source: SurfaceClearanceEndpoint;
  target: SurfaceClearanceEndpoint;
  /** `null` = `max_distance_mm` 内两侧网格没有靠近到一起 */
  result: SurfaceClearanceResult | null;
  /** 参与叶子的 `model_sesno` 最大值；跨库两侧各有各的计数，不可比 */
  model: { source_sesno: number | null; target_sesno: number | null };
  timing_ms: { load: number; query: number; total: number };
  warnings: string[];
  debug?: unknown;
  [key: string]: unknown;
};

function surfaceClearanceQuery(req: GenModelV1SurfaceClearanceRequest): Record<string, QueryValue> {
  return {
    source_refno: toV1Refno(req.sourceRefno),
    target_refno: toV1Refno(req.targetRefno),
    target_kind: req.targetKind,
    perpendicular: req.perpendicular,
    max_distance_mm: req.maxDistanceMm,
    debug: req.debug,
  };
}

/**
 * `GET /api/v1/spatial/surface-clearance`：一对构件用两侧真实三角网格算外表面最近距离与两侧最近点
 * （parry `closest_points`），命中墙主面时附沿法向的垂距。只读，网格来自磁盘 `.mesh`，不碰空间树。
 */
export function genModelV1SurfaceClearance(
  req: GenModelV1SurfaceClearanceRequest,
  options?: GenModelV1RequestOptions,
): Promise<SurfaceClearanceResponse> {
  return genModelV1Fetch<SurfaceClearanceResponse>('/api/v1/spatial/surface-clearance', {
    ...options,
    query: surfaceClearanceQuery(req),
  });
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

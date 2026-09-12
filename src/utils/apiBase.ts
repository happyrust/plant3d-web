export type BackendApiBaseOptions = {
  fallbackUrl?: string;
};

export type ResolveBackendApiBaseUrlOptions = {
  envBase?: string | null;
  fallbackUrl?: string;
  isDev: boolean;
  browserOrigin?: string | null;
};

const LOCALHOST_MISCONFIGURED_PORTS = new Set(['8080', '3000', '3001']);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isMisconfiguredLocalhostApi(base: string): boolean {
  try {
    const parsed = new URL(base);
    if (!isLoopbackHostname(parsed.hostname)) return false;
    if (!parsed.port) return parsed.protocol === 'http:'; // 默认 80，不应作为生产后端地址
    return LOCALHOST_MISCONFIGURED_PORTS.has(parsed.port);
  } catch {
    return false;
  }
}

function sanitize(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

function hasBrowserOrigin(): boolean {
  return typeof window !== 'undefined' && !!window.location?.origin;
}

function getBrowserOrigin(): string | null {
  return hasBrowserOrigin() ? window.location.origin : null;
}

function shouldUseSameOriginProxyForLocalApi(base: string, browserOrigin?: string | null): boolean {
  if (!browserOrigin) return false;

  try {
    const parsed = new URL(base);
    new URL(browserOrigin);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveBackendApiBaseUrl(options: ResolveBackendApiBaseUrlOptions): string {
  const envBase = options.envBase?.trim();
  const fallbackUrl = options.fallbackUrl ?? '';
  const browserOrigin = options.browserOrigin?.trim() || null;
  const devFallback = options.isDev ? '' : fallbackUrl;

  if (!envBase) {
    // 生产构建若未注入环境变量，优先退回同源 /api，避免把请求打到浏览器所在机器的 localhost。
    if (browserOrigin) return '';
    return devFallback;
  }

  const normalized = sanitize(envBase);

  // 浏览器中访问时，env 的 loopback 地址指向访问者电脑；统一走同源相对路径，交给 Vite proxy。
  if (options.isDev && shouldUseSameOriginProxyForLocalApi(normalized, browserOrigin)) {
    return '';
  }

  // 常见开发环境误配置：将 localhost:8080（或 3000）写入 API 地址。
  // 这会在前端变成跨域并触发 CORS，因此统一降级为同源相对路径，走 Vite proxy。
  if (options.isDev && isMisconfiguredLocalhostApi(normalized)) {
    return '';
  }

  // 生产 bundle 若意外烘焙进 localhost，也退回同源 /api，避免请求落到用户本机。
  if (!options.isDev && browserOrigin && isMisconfiguredLocalhostApi(normalized)) {
    return '';
  }

  return normalized;
}

function getBackendOverrideFromQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const port = params.get('backendPort');
  if (port && /^\d+$/.test(port)) return `http://localhost:${port}`;
  const backend = params.get('backend');
  if (backend) {
    try {
      new URL(backend);
      return sanitize(backend);
    } catch {
      return null;
    }
  }
  return null;
}

export function getBackendApiBaseUrl(options: BackendApiBaseOptions = {}): string {
  const queryOverride = getBackendOverrideFromQuery();
  if (queryOverride) return queryOverride;

  return resolveBackendApiBaseUrl({
    envBase: (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
      .VITE_GEN_MODEL_API_BASE_URL,
    fallbackUrl: options.fallbackUrl,
    isDev: import.meta.env.DEV,
    browserOrigin: getBrowserOrigin(),
  });
}

export function buildBackendUrl(path: string, options: BackendApiBaseOptions = {}): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendApiBaseUrl(options).replace(/\/$/, '');
  return `${base}${normalizedPath}`;
}

// ---------------------------------------------------------------------------
// gen-model `/api/v1`（模型树 + 三维模型的新数据源；与上面的旧后端 `:3100` 是两套地址，互不覆盖）
// plan: docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md P1-2
// ---------------------------------------------------------------------------

/** gen-model `DbOption.toml` 的 `http_api_addr` 默认端口。 */
export const GEN_MODEL_V1_DEFAULT_BASE_URL = 'http://localhost:8022';
/** dev 同源代理前缀（`vite.config.ts` 里 `/gm` → gen-model，rewrite 去前缀）。 */
export const GEN_MODEL_V1_PROXY_PREFIX = '/gm';

export type ResolveGenModelV1BaseUrlOptions = {
  /** `window.location.search`；`?gm_backend=<url|/prefix|port>` 或 `?gm_backend_port=<port>` 覆盖 */
  search?: string | null;
  /** `VITE_GEN_MODEL_V1_BASE_URL`：绝对地址（直连，gen-model CORS 已放开）或 `/gm` 一类相对前缀（走代理） */
  envBase?: string | null;
  isDev: boolean;
  /** `window.location.origin`；从局域网地址打开页面时，loopback 的 gen-model 地址指的是访问者电脑，要折到 `/gm` */
  browserOrigin?: string | null;
};

function isLoopbackUrl(base: string): boolean {
  try {
    return isLoopbackHostname(new URL(base).hostname);
  } catch {
    return false;
  }
}

function normalizeGenModelV1Base(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return `http://localhost:${trimmed}`;
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '') || '/';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return sanitize(trimmed);
  } catch {
    return null;
  }
}

/**
 * 解析 gen-model `/api/v1` 的 base URL。优先级：URL 参数 > 环境变量 > 默认值。
 *
 * - 默认 **直连** `http://localhost:8022`（dev）——gen-model 的 CORS 是放开的，不必绕代理；
 *   生产构建没配环境变量时返回空串，直接请求同源 `/api/v1/*`。
 * - 显式写 `/gm`（或任何 `/` 开头的前缀）表示走 Vite 同源代理，给不想跨域的场景用。
 * - URL 参数是「人此刻明确要的」，原样用；环境变量 / 默认值给的 loopback 地址，在页面不是从
 *   loopback 打开时（局域网 IP 访问）折到 `/gm`——与旧后端 `resolveBackendApiBaseUrl` 同一条判据，
 *   否则请求会打到访问者自己的电脑。
 * - 生产包若误注入 loopback 地址且页面本身不在 loopback，也退回空串；禁止把访问者自己的
 *   `localhost:8022` 当生产服务。
 * - 与旧后端的 `?backend=` / `?backendPort=` 互不影响：两套地址各自独立。
 */
export function resolveGenModelV1BaseUrl(options: ResolveGenModelV1BaseUrlOptions): string {
  if (options.search) {
    const params = new URLSearchParams(options.search);
    const port = params.get('gm_backend_port');
    if (port && /^\d+$/.test(port)) return `http://localhost:${port}`;
    const backend = params.get('gm_backend');
    if (backend) {
      const normalized = normalizeGenModelV1Base(backend);
      if (normalized) return normalized;
    }
  }
  const fromEnv = options.envBase && normalizeGenModelV1Base(options.envBase);
  const resolved = fromEnv || (options.isDev ? GEN_MODEL_V1_DEFAULT_BASE_URL : '');
  if (options.isDev && options.browserOrigin && isLoopbackUrl(resolved)) {
    try {
      if (!isLoopbackHostname(new URL(options.browserOrigin).hostname)) return GEN_MODEL_V1_PROXY_PREFIX;
    } catch {
      // origin 解析不了就当作本机
    }
  }
  if (!options.isDev && options.browserOrigin && isLoopbackUrl(resolved)) {
    try {
      if (!isLoopbackHostname(new URL(options.browserOrigin).hostname)) return '';
    } catch {
      // origin 解析不了就保留显式配置
    }
  }
  return resolved;
}

export function getGenModelV1BaseUrl(): string {
  return resolveGenModelV1BaseUrl({
    search: typeof window !== 'undefined' ? window.location?.search : null,
    envBase: (import.meta.env as unknown as { VITE_GEN_MODEL_V1_BASE_URL?: string }).VITE_GEN_MODEL_V1_BASE_URL,
    isDev: import.meta.env.DEV,
    browserOrigin: getBrowserOrigin(),
  });
}

/** 拼 gen-model 的绝对（或同源相对）URL；`path` 形如 `/api/v1/tree/roots`。 */
export function buildGenModelV1Url(path: string): string {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const base = getGenModelV1BaseUrl().replace(/\/$/, '');
  return `${base}${normalizedPath}`;
}

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
    const origin = new URL(browserOrigin);
    return isLoopbackHostname(parsed.hostname) && isLoopbackHostname(origin.hostname);
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

  // 浏览器本机联调时，无论 env 写成 localhost 还是 127.0.0.1，都统一走同源相对路径，交给 Vite proxy。
  // 这样能避免 127.0.0.1 页面去请求 localhost 后端时触发的 CORS / preflight 问题。
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

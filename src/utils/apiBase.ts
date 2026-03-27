export type BackendApiBaseOptions = {
  fallbackUrl?: string;
};

const LOCALHOST_MISCONFIGURED_PORTS = new Set(['8080', '3000', '3001']);

function isMisconfiguredLocalhostApi(base: string): boolean {
  try {
    const parsed = new URL(base);
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return false;
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

export function getBackendApiBaseUrl(options: BackendApiBaseOptions = {}): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL?.trim();

  const fallbackUrl = options.fallbackUrl ?? '';
  const devFallback = import.meta.env.DEV ? '' : fallbackUrl;

  if (!envBase) {
    // 生产构建若未注入环境变量，优先退回同源 /api，避免把请求打到浏览器所在机器的 localhost。
    if (hasBrowserOrigin()) return '';
    return devFallback;
  }

  const normalized = sanitize(envBase);

  // 常见开发环境误配置：将 localhost:8080（或 3000）写入 API 地址。
  // 这会在前端变成跨域并触发 CORS，因此统一降级为同源相对路径，走 Vite proxy。
  if (import.meta.env.DEV && isMisconfiguredLocalhostApi(normalized)) {
    return '';
  }

  // 生产 bundle 若意外烘焙进 localhost，也退回同源 /api，避免请求落到用户本机。
  if (!import.meta.env.DEV && hasBrowserOrigin() && isMisconfiguredLocalhostApi(normalized)) {
    return '';
  }

  return normalized;
}

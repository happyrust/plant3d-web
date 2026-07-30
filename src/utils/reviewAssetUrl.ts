import { getBackendApiBaseUrl } from './apiBase';

export function resolveReviewAssetUrl(value: string): string {
  const url = value.trim();
  if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url;

  const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
  return base ? `${base}/${url.replace(/^\//, '')}` : url;
}

export type VersionInfo = {
  version: string;
  commit: string;
  buildDate: string;
};

export const UNKNOWN_VERSION_INFO: VersionInfo = {
  version: '未知',
  commit: '未知',
  buildDate: '未知',
};

/** 与后端/unknown 等兜底值统一为界面中文「未知」 */
export function displayVersionText(value: string): string {
  const t = value.trim();
  if (!t || /^unknown$/i.test(t)) return '未知';
  return value;
}

export function getDefaultFrontendVersion(): VersionInfo {
  return {
    version: __FRONTEND_APP_VERSION__,
    commit: __FRONTEND_GIT_COMMIT__,
    buildDate: formatBuildDateFromIso(__FRONTEND_BUILD_ISO__),
  };
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** 将构建时刻的 ISO 时间格式化为与后端相近的 UTC 文本 */
function formatBuildDateFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || '未知';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

function normalizeVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const version = pickString(obj, 'version');
  if (!version) return null;
  const commit = pickString(obj, 'commit') ?? '未知';
  const buildDate =
    pickString(obj, 'buildDate', 'build_date') ?? '未知';
  return { version, commit, buildDate };
}

export async function loadVersionInfo(url: string): Promise<VersionInfo | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) return null;

  return normalizeVersionInfo(await response.json());
}

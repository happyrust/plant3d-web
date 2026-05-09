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
    version: typeof __FRONTEND_APP_VERSION__ === 'undefined' ? '0.0.0' : __FRONTEND_APP_VERSION__,
    commit: typeof __FRONTEND_GIT_COMMIT__ === 'undefined' ? 'unknown' : __FRONTEND_GIT_COMMIT__,
    buildDate: formatBuildDateFromIso(typeof __FRONTEND_BUILD_ISO__ === 'undefined' ? '' : __FRONTEND_BUILD_ISO__),
  };
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** 将构建时刻的 ISO 时间格式化为北京时间显示 */
function formatBuildDateFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || '未知';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 北京时间`;
}

function normalizeVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const version = pickString(obj, 'version');
  if (!version) return null;
  const commit = pickString(obj, 'commit') ?? '未知';
  let buildDate = pickString(obj, 'buildDate', 'build_date') ?? '未知';
  
  // 如果后端返回的时间包含 UTC+8 或 UTC，转换为北京时间显示
  if (buildDate !== '未知' && (buildDate.includes('UTC') || buildDate.includes('UTC+8'))) {
    // 解析后端时间并转换为北京时间格式
    const utcMatch = buildDate.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (utcMatch) {
      const dateStr = utcMatch[1];
      const d = new Date(dateStr + (buildDate.includes('UTC+8') ? '' : ' UTC'));
      const p = (n: number) => String(n).padStart(2, '0');
      // 如果是UTC+8，直接使用；如果是UTC，转换为北京时间
      const beijingTime = buildDate.includes('UTC+8') ? d : new Date(d.getTime() + 8 * 60 * 60 * 1000);
      buildDate = `${beijingTime.getFullYear()}-${p(beijingTime.getMonth() + 1)}-${p(beijingTime.getDate())} ${p(beijingTime.getHours())}:${p(beijingTime.getMinutes())}:${p(beijingTime.getSeconds())} 北京时间`;
    }
  } else if (buildDate !== '未知' && !buildDate.includes('北京时间')) {
    // 对于其他格式的时间，尝试解析为ISO格式转换
    buildDate = formatBuildDateFromIso(buildDate);
  }
  
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

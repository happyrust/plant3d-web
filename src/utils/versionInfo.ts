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

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const TWO_DIGIT = (n: number) => String(n).padStart(2, '0');

/**
 * 把 UTC 毫秒时间戳格式化为固定的"北京时间"字符串。
 *
 * 做法：先把时间戳加 8 小时，再用 `getUTC*` 方法读出年月日时分秒——
 * 这样无论运行时机器的 local timezone 如何（UTC+0 的 CI / UTC+8 的工位 / UTC-5 的海外），
 * 输出都等价于 `Asia/Shanghai` 下的墙钟时间。避免以前 `getFullYear()` 在 CI 与本地各自拉出
 * 不同"北京时间"导致 version.json 解析测试跨机器红绿不一致的 bug。
 */
function formatMsAsBeijing(ms: number): string {
  const d = new Date(ms + BEIJING_OFFSET_MS);
  return `${d.getUTCFullYear()}-${TWO_DIGIT(d.getUTCMonth() + 1)}-${TWO_DIGIT(d.getUTCDate())} ${TWO_DIGIT(d.getUTCHours())}:${TWO_DIGIT(d.getUTCMinutes())}:${TWO_DIGIT(d.getUTCSeconds())} 北京时间`;
}

/** 将构建时刻的 ISO 时间格式化为北京时间显示（跨时区稳定） */
function formatBuildDateFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || '未知';
  return formatMsAsBeijing(t);
}

function normalizeVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const version = pickString(obj, 'version');
  if (!version) return null;
  const commit = pickString(obj, 'commit') ?? '未知';
  let buildDate = pickString(obj, 'buildDate', 'build_date') ?? '未知';
  
  // 如果后端返回的时间包含 UTC+8 或 UTC，转换为北京时间显示（跨时区稳定）
  if (buildDate !== '未知' && (buildDate.includes('UTC') || buildDate.includes('UTC+8'))) {
    const utcMatch = buildDate.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (utcMatch) {
      const dateStr = utcMatch[1];
      // UTC+8 → 字符串已经是北京墙钟时间，用 'Z' 作为 UTC 解析再直接 formatMsAsBeijing 保形
      // UTC    → 字符串是 UTC 时间，formatMsAsBeijing 会自动加 8 小时
      const isoLike = buildDate.includes('UTC+8')
        ? `${dateStr.replace(' ', 'T')}+08:00`
        : `${dateStr.replace(' ', 'T')}Z`;
      const parsed = Date.parse(isoLike);
      if (!Number.isNaN(parsed)) {
        buildDate = formatMsAsBeijing(parsed);
      }
    }
  } else if (buildDate !== '未知' && !buildDate.includes('北京时间')) {
    // 对于其他格式的时间，尝试解析为 ISO 格式转换
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

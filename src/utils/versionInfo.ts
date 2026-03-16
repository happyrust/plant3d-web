export type VersionInfo = {
  version: string;
  commit: string;
  buildDate: string;
};

export const UNKNOWN_VERSION_INFO: VersionInfo = {
  version: 'unknown',
  commit: 'unknown',
  buildDate: 'unknown',
};

export function getDefaultFrontendVersion(): VersionInfo {
  if (import.meta.env.DEV) {
    return {
      version: 'dev',
      commit: 'workspace',
      buildDate: 'local',
    };
  }
  return UNKNOWN_VERSION_INFO;
}

function normalizeVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<VersionInfo>;
  if (typeof value.version !== 'string') return null;
  return {
    version: value.version,
    commit: typeof value.commit === 'string' ? value.commit : 'unknown',
    buildDate: typeof value.buildDate === 'string' ? value.buildDate : 'unknown',
  };
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

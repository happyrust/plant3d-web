export const DASHBOARD_RECENT_PROJECTS_KEY = 'plant3d-dashboard-recent-projects';
const MAX_RECENT_PROJECTS = 8;

export type RecentProjectBase = {
  id: string;
  name: string;
  path: string;
  description?: string;
  updatedAt?: string;
  thumbnail?: string;
  showDbnum?: number;
};

export type RecentProjectRecord = RecentProjectBase & {
  lastOpenedAt: string;
};

function safeParseDate(value?: string): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function readStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function getProjectIdentity(project: Pick<RecentProjectBase, 'id' | 'path'>): string {
  return `${project.id}::${project.path}`;
}

export function readRecentProjects(): RecentProjectRecord[] {
  const storage = readStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(DASHBOARD_RECENT_PROJECTS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as RecentProjectRecord[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item.id === 'string' && typeof item.path === 'string')
      .sort((a, b) => safeParseDate(b.lastOpenedAt) - safeParseDate(a.lastOpenedAt));
  } catch {
    return [];
  }
}

export function recordRecentProject(project: RecentProjectBase): void {
  const storage = readStorage();
  if (!storage || !project.id || !project.path) return;

  const next: RecentProjectRecord = {
    ...project,
    lastOpenedAt: new Date().toISOString(),
  };

  const deduped = readRecentProjects().filter((item) => getProjectIdentity(item) !== getProjectIdentity(project));
  deduped.unshift(next);
  storage.setItem(DASHBOARD_RECENT_PROJECTS_KEY, JSON.stringify(deduped.slice(0, MAX_RECENT_PROJECTS)));
}

export function buildRecentProjectCards(
  projects: RecentProjectBase[],
  limit = 3,
): RecentProjectRecord[] {
  const normalizedProjects = Array.isArray(projects) ? projects : [];
  const projectMap = new Map<string, RecentProjectBase>();
  for (const project of normalizedProjects) {
    projectMap.set(getProjectIdentity(project), project);
  }

  const recent = readRecentProjects();
  const items: RecentProjectRecord[] = [];
  const seen = new Set<string>();

  for (const record of recent) {
    const key = getProjectIdentity(record);
    seen.add(key);
    const liveProject = projectMap.get(key);
    items.push({
      ...record,
      ...liveProject,
      lastOpenedAt: record.lastOpenedAt,
    });
  }

  if (items.length < limit) {
    const fallback = [...normalizedProjects]
      .filter((project) => !seen.has(getProjectIdentity(project)))
      .sort((a, b) => safeParseDate(b.updatedAt) - safeParseDate(a.updatedAt))
      .map((project) => ({
        ...project,
        lastOpenedAt: project.updatedAt || '',
      }));
    items.push(...fallback);
  }

  return items.slice(0, limit);
}

export type ResolvePmsLaunchFormIdOptions = {
  preferredFormId?: string | null;
  queryFormId?: string | null;
  directFormId?: string | null;
  tokenClaimFormId?: string | null;
};

export type BuildTokenPrimaryPmsLaunchSearchOptions = {
  directQuery?: URLSearchParams;
  outputProject?: string | null;
  workflowMode?: string | null;
  workflowRole?: string | null;
  formId?: string | null;
};

export type ApplyTokenPrimaryPmsLaunchUrlOptions = {
  token: string;
  formId?: string | null;
  pmsUserId?: string | null;
  includePmsUserId?: boolean;
};

const DEFAULT_SIMULATOR_PROJECT_ID = 'AvevaMarineSample';

const LEGACY_EMBED_IDENTITY_QUERY_KEYS = new Set([
  'output_project',
  'project_id',
  'user_id',
  'role',
  'user_role',
  'workflow_role',
  'user_token',
  'workflow_mode',
  'landing_role',
]);

function normalizeFormId(value?: string | null): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function resolveDefaultSimulatorProjectId(
  search: string | URLSearchParams,
  availableProjects: string[] = [],
): string {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;

  const normalizedProjects = Array.from(new Set(
    availableProjects
      .map((project) => project.trim())
      .filter(Boolean),
  ));
  const availableProjectSet = new Set(normalizedProjects);
  const pickAvailable = (value?: string | null): string | null => {
    const normalized = value?.trim() || null;
    if (!normalized) return null;
    if (normalizedProjects.length === 0 || availableProjectSet.has(normalized)) {
      return normalized;
    }
    return null;
  };

  const outputProject = pickAvailable(params.get('output_project'));
  if (outputProject) return outputProject;

  const explicitProject = pickAvailable(params.get('project'));
  if (explicitProject) return explicitProject;

  if (normalizedProjects.length > 0) {
    if (availableProjectSet.has(DEFAULT_SIMULATOR_PROJECT_ID)) {
      return DEFAULT_SIMULATOR_PROJECT_ID;
    }
    return normalizedProjects[0];
  }

  return params.get('project')?.trim() || DEFAULT_SIMULATOR_PROJECT_ID;
}

export function resolvePmsLaunchFormId(options: ResolvePmsLaunchFormIdOptions): string | null {
  const preferredFormId = normalizeFormId(options.preferredFormId);
  if (preferredFormId) return preferredFormId;

  const tokenClaimFormId = normalizeFormId(options.tokenClaimFormId);
  if (tokenClaimFormId) return tokenClaimFormId;

  const directFormId = normalizeFormId(options.directFormId);
  if (directFormId) return directFormId;

  const queryFormId = normalizeFormId(options.queryFormId);
  if (queryFormId) return queryFormId;

  return null;
}

export function buildTokenPrimaryPmsLaunchSearch(
  options: BuildTokenPrimaryPmsLaunchSearchOptions,
): URLSearchParams {
  const search = new URLSearchParams();

  for (const [key, value] of options.directQuery?.entries() || []) {
    if (!LEGACY_EMBED_IDENTITY_QUERY_KEYS.has(key)) {
      search.set(key, value);
    }
  }

  const outputProject = options.outputProject?.trim();
  if (outputProject) {
    search.set('output_project', outputProject);
  }

  const workflowMode = options.workflowMode?.trim();
  if (workflowMode) {
    search.set('workflow_mode', workflowMode);
  }

  const workflowRole = options.workflowRole?.trim();
  if (workflowRole) {
    search.set('workflow_role', workflowRole);
  }

  const formId = options.formId?.trim();
  if (formId && !search.has('form_id')) {
    search.set('form_id', formId);
  }

  return search;
}

export function applyTokenPrimaryPmsLaunchUrl(
  url: URL,
  options: ApplyTokenPrimaryPmsLaunchUrlOptions,
): URL {
  url.searchParams.set('user_token', options.token);

  const formId = normalizeFormId(options.formId);
  if (formId) {
    url.searchParams.set('form_id', formId);
  }

  if (options.includePmsUserId) {
    const pmsUserId = options.pmsUserId?.trim();
    if (pmsUserId) {
      url.searchParams.set('user_id', pmsUserId);
    }
  }

  return url;
}

type StorageLike = Pick<Storage, 'getItem'>;

type WorkflowModeEmbedParams = {
  workflowMode?: string | null;
  externalWorkflowMode?: boolean | null;
};

type ResolveWorkflowModeOptions = {
  verifiedWorkflowMode?: string | null;
  search?: string | null;
  sessionStorageLike?: StorageLike | null;
  localStorageLike?: StorageLike | null;
  embedParams?: WorkflowModeEmbedParams | null;
};

function normalizeWorkflowMode(value?: string | null): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function isInternalWorkflowMode(mode?: string | null): boolean {
  return mode === 'manual' || mode === 'internal';
}

export function resolveWorkflowMode(options: ResolveWorkflowModeOptions = {}): 'external' | 'manual' | 'internal' {
  const {
    verifiedWorkflowMode,
    search,
    sessionStorageLike,
    localStorageLike,
    embedParams,
  } = options;

  const fromVerified = normalizeWorkflowMode(verifiedWorkflowMode);
  if (fromVerified) return isInternalWorkflowMode(fromVerified) ? 'manual' : 'external';

  try {
    const query = new URLSearchParams(
      search ?? (typeof window !== 'undefined' ? window.location.search : '')
    );
    const fromQuery = normalizeWorkflowMode(query.get('workflow_mode'));
    if (fromQuery) return isInternalWorkflowMode(fromQuery) ? 'manual' : 'external';
  } catch {
    // ignore
  }

  try {
    const fromSession = normalizeWorkflowMode(
      sessionStorageLike?.getItem('plant3d_workflow_mode')
        ?? (typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem('plant3d_workflow_mode')
          : null)
    );
    if (fromSession) return isInternalWorkflowMode(fromSession) ? 'manual' : 'external';
  } catch {
    // ignore
  }

  try {
    const fromLocal = normalizeWorkflowMode(
      localStorageLike?.getItem('plant3d_workflow_mode')
        ?? (typeof localStorage !== 'undefined'
          ? localStorage.getItem('plant3d_workflow_mode')
          : null)
    );
    if (fromLocal) return isInternalWorkflowMode(fromLocal) ? 'manual' : 'external';
  } catch {
    // ignore
  }

  if (typeof embedParams?.externalWorkflowMode === 'boolean') {
    return embedParams.externalWorkflowMode ? 'external' : 'manual';
  }

  const fromEmbed = normalizeWorkflowMode(embedParams?.workflowMode);
  if (fromEmbed) return isInternalWorkflowMode(fromEmbed) ? 'manual' : 'external';

  return 'external';
}

export function resolvePassiveWorkflowMode(options: ResolveWorkflowModeOptions = {}): boolean {
  return resolveWorkflowMode(options) === 'external';
}

export function isMyTasksAvailableInWorkflowMode(options: ResolveWorkflowModeOptions = {}): boolean {
  return !resolvePassiveWorkflowMode(options);
}

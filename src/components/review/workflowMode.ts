type StorageLike = Pick<Storage, 'getItem'>;

type WorkflowModeEmbedParams = {
  workflowMode?: string | null;
  externalWorkflowMode?: boolean | null;
};

type ResolveWorkflowModeOptions = {
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

export function resolvePassiveWorkflowMode(options: ResolveWorkflowModeOptions = {}): boolean {
  const {
    search,
    sessionStorageLike,
    localStorageLike,
    embedParams,
  } = options;

  try {
    const query = new URLSearchParams(
      search ?? (typeof window !== 'undefined' ? window.location.search : '')
    );
    const fromQuery = normalizeWorkflowMode(query.get('workflow_mode'));
    if (fromQuery) return !isInternalWorkflowMode(fromQuery);
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
    if (fromSession) return !isInternalWorkflowMode(fromSession);
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
    if (fromLocal) return !isInternalWorkflowMode(fromLocal);
  } catch {
    // ignore
  }

  if (typeof embedParams?.externalWorkflowMode === 'boolean') {
    return embedParams.externalWorkflowMode;
  }

  const fromEmbed = normalizeWorkflowMode(embedParams?.workflowMode);
  if (fromEmbed) return !isInternalWorkflowMode(fromEmbed);

  return true;
}

export function isMyTasksAvailableInWorkflowMode(options: ResolveWorkflowModeOptions = {}): boolean {
  return !resolvePassiveWorkflowMode(options);
}

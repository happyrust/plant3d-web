import { getBackendApiBaseUrl } from '@/utils/apiBase';

export type IncrementalElementChange = {
  dbnum: number;
  project: string;
  file_path: string;
  sesno: number;
  refno: string;
  operation: 'add' | 'modify' | 'delete' | 'none' | string;
  noun: string;
  owner_refno?: string | null;
  classified: boolean;
  model_category?: 'prim' | 'loop_owner' | 'bran_hanger' | 'basic_cata' | 'delete' | string | null;
  model_refno?: string | null;
};

export type IncrementalFileSummary = {
  dbnum: number;
  project: string;
  file_path: string;
  requested_start_sesno: number;
  requested_end_sesno: number;
  actual_start_sesno: number;
  actual_end_sesno: number;
  latest_sesno: number;
  session_count: number;
  element_count: number;
  add_count: number;
  modify_count: number;
  delete_count: number;
  none_count: number;
};

export type IncrementalMonitorRecord = {
  id?: string;
  project: string;
  dbnum: number;
  db_name?: string | null;
  file_path?: string | null;
  from_sesno: number;
  to_sesno: number;
  latest_sesno?: number | null;
  session_count: number;
  element_count: number;
  add_count: number;
  modify_count: number;
  delete_count: number;
  model_change_count: number;
  status?: 'changed' | 'running' | 'generated' | 'failed' | 'unchanged' | string;
  detected_at?: string | null;
  updated_at?: string | null;
  generation_success?: boolean | null;
};

export type IncrementalMonitorSnapshot = {
  project?: string;
  root_path?: string | null;
  watched_at: string;
  source_count: number;
  changed_db_count: number;
  total_element_count: number;
  total_model_change_count: number;
  records: IncrementalMonitorRecord[];
};

export type IncrementalSummary = {
  from_sesno: number;
  to_sesno: number;
  source_count: number;
  file_count: number;
  session_count: number;
  element_count: number;
  db_meta_refreshed_files: number;
  data_persist: {
    file_count: number;
    session_count: number;
    upsert_count: number;
    delete_count: number;
    pe_rows: number;
    att_rows: number;
    uda_rows: number;
    dbnum_info_updates: number;
  };
  generation_dbnums: number[];
  generation_success: boolean | null;
  category_counts: {
    prim: number;
    loop_owner: number;
    bran_hanger: number;
    basic_cata: number;
    delete: number;
    total: number;
  };
  files: IncrementalFileSummary[];
  element_changes: IncrementalElementChange[];
  update_log: {
    prim_refnos: string[];
    loop_owner_refnos: string[];
    bran_hanger_refnos: string[];
    basic_cata_refnos: string[];
    delete_refnos: string[];
  };
};

export type IncrementalModelChange = {
  dbnum: number;
  model_refno: string;
  model_category: string;
  source_change_count: number;
  source_operations: string;
  source_nouns: string;
  pe_exists: boolean;
  pe_noun: string;
  inst_relate_count: number;
  geo_relate_count: number;
};

export type IncrementalRunRequest = {
  project?: string;
  dbnum: number;
  from_sesno: number;
  to_sesno?: number | null;
  generate_model?: boolean;
};

export type IncrementalGlobalWatchRequest = {
  project?: string;
  generate_model?: boolean;
};

export type IncrementalAttrDiffRequest = {
  dbnum: number;
  refno: string;
  from_sesno: number;
  to_sesno: number;
};

export type IncrementalAttrDiffRow = {
  name: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  status: 'added' | 'removed' | 'changed' | 'same';
};

export type IncrementalAttrDiffResponse = {
  success: boolean;
  refno: string;
  from_sesno: number;
  to_sesno: number;
  rows: IncrementalAttrDiffRow[];
  source?: 'backend' | 'demo';
  message?: string;
};

export type IncrementalApiResult<T> = {
  data: T;
  source: 'backend' | 'demo';
  message?: string;
};

const DEMO_SUMMARY_URL = '/incremental-demo/1112_896_897_incremental_summary.json';
const DEMO_MODEL_CHANGES_URL = '/incremental-demo/1112_896_897_model_changes.json';

function getBaseUrl(): string {
  return getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
}

async function fetchBackendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }
  return (await resp.json()) as T;
}

async function fetchStaticJson<T>(path: string): Promise<T> {
  const resp = await fetch(path, { cache: 'no-store' });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }
  return (await resp.json()) as T;
}

function shouldUseDemoFallback(params: Pick<IncrementalRunRequest, 'dbnum' | 'from_sesno' | 'to_sesno'>): boolean {
  return params.dbnum === 1112 && params.from_sesno === 896 && (params.to_sesno ?? 897) === 897;
}

export async function loadIncrementalMonitor(
  params: { project?: string } = {},
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalMonitorSnapshot>> {
  const search = new URLSearchParams();
  if (params.project) search.set('project', params.project);

  try {
    const data = await fetchBackendJson<IncrementalMonitorSnapshot>(`/api/model/incremental/monitor?${search.toString()}`);
    return { data: normalizeMonitorSnapshot(data, params.project), source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false) {
      const data = await buildDemoMonitorSnapshot(params.project);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function runGlobalIncrementalWatchOnce(
  params: IncrementalGlobalWatchRequest = {},
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalMonitorSnapshot>> {
  try {
    const data = await fetchBackendJson<IncrementalMonitorSnapshot>('/api/model/incremental/watch-once', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { data: normalizeMonitorSnapshot(data, params.project), source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false) {
      const data = await buildDemoMonitorSnapshot(params.project);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function loadIncrementalReport(
  params: IncrementalRunRequest,
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalSummary>> {
  const search = new URLSearchParams();
  if (params.project) search.set('project', params.project);
  search.set('dbnum', String(params.dbnum));
  search.set('from_sesno', String(params.from_sesno));
  if (params.to_sesno !== undefined && params.to_sesno !== null) {
    search.set('to_sesno', String(params.to_sesno));
  }

  try {
    const data = await fetchBackendJson<IncrementalSummary>(`/api/model/incremental/report?${search.toString()}`);
    return { data, source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false && shouldUseDemoFallback(params)) {
      const data = await fetchStaticJson<IncrementalSummary>(DEMO_SUMMARY_URL);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function runIncrementalUpdate(
  params: IncrementalRunRequest,
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalSummary>> {
  try {
    const data = await fetchBackendJson<IncrementalSummary>('/api/model/incremental/run', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { data, source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false && shouldUseDemoFallback(params)) {
      const data = await fetchStaticJson<IncrementalSummary>(DEMO_SUMMARY_URL);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function runIncrementalWatchOnce(
  params: IncrementalRunRequest,
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalSummary>> {
  try {
    const data = await fetchBackendJson<IncrementalSummary>('/api/model/incremental/watch-once', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { data, source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false && shouldUseDemoFallback(params)) {
      const data = await fetchStaticJson<IncrementalSummary>(DEMO_SUMMARY_URL);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function loadIncrementalModelChanges(
  params: IncrementalRunRequest,
  options: { allowDemoFallback?: boolean } = {},
): Promise<IncrementalApiResult<IncrementalModelChange[]>> {
  const search = new URLSearchParams();
  search.set('dbnum', String(params.dbnum));
  search.set('from_sesno', String(params.from_sesno));
  if (params.to_sesno !== undefined && params.to_sesno !== null) {
    search.set('to_sesno', String(params.to_sesno));
  }

  try {
    const data = await fetchBackendJson<IncrementalModelChange[]>(`/api/model/incremental/model-changes?${search.toString()}`);
    return { data, source: 'backend' };
  } catch (e) {
    if (options.allowDemoFallback !== false && shouldUseDemoFallback(params)) {
      const data = await fetchStaticJson<IncrementalModelChange[]>(DEMO_MODEL_CHANGES_URL);
      return {
        data,
        source: 'demo',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    throw e;
  }
}

export async function loadIncrementalAttrDiff(
  params: IncrementalAttrDiffRequest,
  change?: IncrementalElementChange,
): Promise<IncrementalAttrDiffResponse> {
  const search = new URLSearchParams({
    dbnum: String(params.dbnum),
    refno: params.refno,
    from_sesno: String(params.from_sesno),
    to_sesno: String(params.to_sesno),
  });

  try {
    const resp = await fetchBackendJson<IncrementalAttrDiffResponse>(`/api/model/incremental/attr-diff?${search.toString()}`);
    return { ...resp, source: 'backend' };
  } catch (e) {
    return {
      success: true,
      refno: params.refno,
      from_sesno: params.from_sesno,
      to_sesno: params.to_sesno,
      rows: buildDemoAttributeDiff(params, change),
      source: 'demo',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildDemoAttributeDiff(
  params: IncrementalAttrDiffRequest,
  change?: IncrementalElementChange,
): IncrementalAttrDiffRow[] {
  const noun = change?.noun || '';
  const owner = change?.owner_refno || null;
  const category = change?.model_category || null;
  const operation = change?.operation || 'modify';
  const isAdd = operation === 'add';
  const isDelete = operation === 'delete';

  return [
    {
      name: 'TYPE',
      before: isAdd ? null : noun || 'UNKNOWN',
      after: isDelete ? null : noun || 'UNKNOWN',
      status: isAdd ? 'added' : isDelete ? 'removed' : 'same',
    },
    {
      name: 'OWNER',
      before: isAdd ? null : owner,
      after: isDelete ? null : owner,
      status: isAdd ? 'added' : isDelete ? 'removed' : 'same',
    },
    {
      name: 'DBNUM',
      before: isAdd ? null : params.dbnum,
      after: isDelete ? null : params.dbnum,
      status: isAdd ? 'added' : isDelete ? 'removed' : 'same',
    },
    {
      name: 'MODEL_CATEGORY',
      before: isAdd ? null : category,
      after: isDelete ? null : category,
      status: isAdd ? 'added' : isDelete ? 'removed' : 'same',
    },
    {
      name: 'SESNO',
      before: params.from_sesno,
      after: params.to_sesno,
      status: params.from_sesno === params.to_sesno ? 'same' : 'changed',
    },
  ];
}

function normalizeMonitorSnapshot(
  data: IncrementalMonitorSnapshot,
  fallbackProject?: string,
): IncrementalMonitorSnapshot {
  const records = (data.records ?? []).map((record) => ({
    ...record,
    id: record.id || monitorRecordId(record),
    project: record.project || fallbackProject || '',
    status: record.status || (record.element_count > 0 ? 'changed' : 'unchanged'),
  }));
  return {
    project: data.project || fallbackProject,
    root_path: data.root_path ?? null,
    watched_at: data.watched_at || new Date().toISOString(),
    source_count: data.source_count ?? records.length,
    changed_db_count: data.changed_db_count ?? records.filter((record) => record.element_count > 0).length,
    total_element_count: data.total_element_count ?? records.reduce((sum, record) => sum + record.element_count, 0),
    total_model_change_count: data.total_model_change_count ?? records.reduce((sum, record) => sum + record.model_change_count, 0),
    records,
  };
}

async function buildDemoMonitorSnapshot(project?: string): Promise<IncrementalMonitorSnapshot> {
  const [summary, modelChanges] = await Promise.all([
    fetchStaticJson<IncrementalSummary>(DEMO_SUMMARY_URL),
    fetchStaticJson<IncrementalModelChange[]>(DEMO_MODEL_CHANGES_URL).catch(() => []),
  ]);
  const watchedAt = new Date().toISOString();
  const modelCountByDbnum = new Map<number, number>();
  for (const row of modelChanges) {
    modelCountByDbnum.set(row.dbnum, (modelCountByDbnum.get(row.dbnum) ?? 0) + 1);
  }
  const records = summary.files.map((file) => {
    const record: IncrementalMonitorRecord = {
      id: `${file.project || summary.element_changes[0]?.project || project || 'project'}:${file.dbnum}:${file.actual_start_sesno}:${file.actual_end_sesno}`,
      project: project || file.project || summary.element_changes[0]?.project || 'AvevaMarineSample',
      dbnum: file.dbnum,
      db_name: file.file_path.split(/[\\/]/).pop() || null,
      file_path: file.file_path,
      from_sesno: summary.from_sesno,
      to_sesno: summary.to_sesno,
      latest_sesno: file.latest_sesno,
      session_count: file.session_count,
      element_count: file.element_count,
      add_count: file.add_count,
      modify_count: file.modify_count,
      delete_count: file.delete_count,
      model_change_count: modelCountByDbnum.get(file.dbnum) ?? summary.category_counts.total,
      status: summary.generation_success ? 'generated' : 'changed',
      detected_at: watchedAt,
      updated_at: watchedAt,
      generation_success: summary.generation_success,
    };
    return record;
  });

  return {
    project: project || summary.element_changes[0]?.project || 'AvevaMarineSample',
    root_path: 'D:/AVEVA/Projects/E3D2.1/AvevaMarineSample',
    watched_at: watchedAt,
    source_count: summary.source_count,
    changed_db_count: records.length,
    total_element_count: summary.element_count,
    total_model_change_count: summary.category_counts.total,
    records,
  };
}

function monitorRecordId(record: IncrementalMonitorRecord): string {
  return `${record.project}:${record.dbnum}:${record.from_sesno}:${record.to_sesno}`;
}

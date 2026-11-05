/**
 * RVM 比对页的接口。身份三元组不从这里发：E3D 项目码走 `e3d_project`，
 * 发给 gen-model 的 `project` 会按服务端自己的项目名核对，填成 AMS 会 422。
 */

import { genModelV1Fetch } from '@/api/genModelV1Api';
import { buildGenModelV1Url } from '@/utils/apiBase';

export type RvmCheckDefaults = {
  projects_dir: string;
  project_name: string;
  project_dir: string;
  e3d_project: string | null;
  e3d_projects: string[];
  mdb: string;
  numeric_project_code: string;
  gen_ams_exe: string;
  gen_ams_found: boolean;
  rvm_compare_exe: string;
  rvm_compare_found: boolean;
  e3d_launcher: string;
  launcher_found: boolean;
  work_dir: string;
  alive_timeout_secs: number;
  timeout_secs: number;
};

export type RvmCheckConnection = {
  install_dir: string;
  projects_dir?: string;
  project_name?: string;
  e3d_project: string;
  username: string;
  password: string;
  e3d_mdb: string;
};

export type PreflightCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type PreflightReport = {
  ok: boolean;
  checks: PreflightCheck[];
  running_des: string[];
  login_ok: boolean | null;
  notes: string[];
};

export type RvmMismatch = {
  category: string;
  name: string;
  noun: string;
  max_axis_delta_mm: number | null;
  baseline_kinds: string[];
  generated_kinds: string[];
  baseline_aabb: number[] | null;
  generated_aabb: number[] | null;
};

export type RvmCounts = {
  both: number;
  exact: number;
  chord: number;
  reference_artifact: number;
  film: number;
  off: number;
  only_baseline: number;
  only_generated: number;
  kind_match: number;
  kind_differ: number;
  container_off: number;
  container_only_baseline: number;
  container_only_generated: number;
  centreline_only_baseline: number;
  unkeyable_baseline: number;
  unkeyable_generated: number;
};

export type RvmCheckReport = {
  verdict: 'pass' | 'kind_differ' | 'fail' | string;
  message: string;
  stage: string;
  refno: string;
  name: string | null;
  noun: string | null;
  dbnum: number | null;
  db_type: string | null;
  sesno: number | null;
  db_file: string | null;
  e3d_export_by: 'refno' | 'name' | string | null;
  counts: RvmCounts;
  mismatches: RvmMismatch[];
  mismatches_truncated: boolean;
  centreline_only_baseline: string[];
  timings_ms: {
    resolve: number;
    generate_ours: number;
    e3d_export: number;
    compare: number;
  };
  files: string[];
  warnings: string[];
};

export type RvmCheckRun = {
  task_id: string;
  state: string;
  stage: string | null;
  detail: Record<string, unknown> | null;
  result: RvmCheckReport | null;
  started_at: string | null;
  finished_at: string | null;
  /** 只有从任务列表 / 归档还原的快照带这一格 */
  created_at?: string | null;
  units_done: number | null;
  total_units: number | null;
  dbnum: number | null;
  db_type: string | null;
};

const PREFLIGHT_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 360_000;

export function fetchRvmCheckDefaults(): Promise<RvmCheckDefaults> {
  return genModelV1Fetch<RvmCheckDefaults>('/api/v1/rvm-check/defaults');
}

export function preflightRvmCheck(
  connection: RvmCheckConnection,
  tryLogin: boolean,
): Promise<PreflightReport> {
  return genModelV1Fetch<PreflightReport>('/api/v1/rvm-check/preflight', {
    method: 'POST',
    timeoutMs: tryLogin ? LOGIN_TIMEOUT_MS : PREFLIGHT_TIMEOUT_MS,
    body: { ...connection, try_login: tryLogin } as Record<string, unknown>,
  });
}

export function startRvmCheckRun(connection: RvmCheckConnection, refno: string): Promise<{ task_id: string }> {
  return genModelV1Fetch<{ task_id: string }>('/api/v1/rvm-check/runs', {
    method: 'POST',
    body: { ...connection, refno } as Record<string, unknown>,
  });
}

export function getRvmCheckRun(taskId: string): Promise<RvmCheckRun> {
  return genModelV1Fetch<RvmCheckRun>(`/api/v1/rvm-check/runs/${encodeURIComponent(taskId)}`);
}

export function rvmCheckFileUrl(taskId: string, name: string): string {
  return buildGenModelV1Url(
    `/api/v1/rvm-check/runs/${encodeURIComponent(taskId)}/files/${encodeURIComponent(name)}`,
  );
}

export const RVM_CHECK_E3D_LOG = 'e3d.log';

export async function fetchRvmCheckFileText(taskId: string, name: string): Promise<string> {
  const response = await fetch(rvmCheckFileUrl(taskId, name));
  if (!response.ok) throw new Error(`读 ${name} 失败（HTTP ${response.status}）`);
  return response.text();
}

export async function downloadRvmCheckFile(taskId: string, name: string): Promise<void> {
  const response = await fetch(rvmCheckFileUrl(taskId, name));
  if (!response.ok) {
    throw new Error(`下载 ${name} 失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

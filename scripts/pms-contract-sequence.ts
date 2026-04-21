#!/usr/bin/env npx tsx
/**
 * PMS 平台 API 契约序列验证脚本
 *
 * 使用方式：
 *   npx tsx scripts/pms-contract-sequence.ts [--base http://localhost:3100] [--project TEST_PROJECT] [--user SJ]
 *
 * 功能：
 *   依次调用 auth/token → embed-url → review/tasks(seed) → workflow/verify → workflow/sync(query) → cache/preload → delete，
 *   断言 HTTP 状态与响应 code，请求体由共享模块 pmsPlatformContractPayloads.ts 生成，
 *   与仿 PMS 模拟器使用同一份构建逻辑，确保契约不漂移。
 *
 * 环境变量（可选覆盖 CLI 参数）：
 *   PMS_CONTRACT_BASE_URL   后端地址（默认 http://localhost:3100）
 *   PMS_CONTRACT_PROJECT_ID 项目号
 *   PMS_CONTRACT_USER       PMS 用户（SJ/JH/SH/PZ）
 */

import {
  buildAuthLoginRequest,
  buildCachePreloadPayload,
  buildDeleteReviewPayload,
  buildEmbedUrlPayload,
  buildWorkflowSyncPayload,
  type SimulatorPmsUser,
  type WorkflowRole,
} from '../src/debug/pmsPlatformContractPayloads';

export type PmsContractSequenceOptions = {
  base: string;
  projectId: string;
  user: SimulatorPmsUser;
  workflowMode: string;
  verbose: boolean;
};

const ROLE_MAP: Record<SimulatorPmsUser, WorkflowRole> = {
  SJ: 'sj',
  JH: 'jd',
  SH: 'sh',
  PZ: 'pz',
};

const CONTRACT_CHECKER_ID = 'JH';
const CONTRACT_APPROVER_ID = 'SH';
const CONTRACT_COMPONENTS = [
  {
    id: 'contract-c1',
    refNo: '24381_145018',
    name: '管道A',
    type: 'PIPE',
  },
  {
    id: 'contract-c2',
    refNo: '24381_145020',
    name: '阀门B',
    type: 'VALVE',
  },
];

type JsonRecord = Record<string, unknown>;

export type StepResult = {
  step: string;
  ok: boolean;
  status: number;
  body: JsonRecord;
  elapsed: number;
  code: number | null;
  detail?: string | null;
  formId?: string | null;
  taskId?: string | null;
  passed?: boolean | null;
  reason?: string | null;
  recommendedAction?: string | null;
  errorCode?: string | null;
  seededTask?: boolean;
};

function parseArgs(): PmsContractSequenceOptions {
  const args = process.argv.slice(2);
  let base = process.env.PMS_CONTRACT_BASE_URL?.trim() || 'http://localhost:3100';
  let projectId = process.env.PMS_CONTRACT_PROJECT_ID?.trim() || 'TEST_PROJECT';
  let user: SimulatorPmsUser = (process.env.PMS_CONTRACT_USER?.trim() as SimulatorPmsUser) || 'SJ';
  let workflowMode = process.env.PMS_CONTRACT_WORKFLOW_MODE?.trim() || 'external';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) { base = args[++i]; }
    else if (args[i] === '--project' && args[i + 1]) { projectId = args[++i]; }
    else if (args[i] === '--user' && args[i + 1]) { user = args[++i] as SimulatorPmsUser; }
    else if (args[i] === '--mode' && args[i + 1]) { workflowMode = args[++i]; }
    else if (args[i] === '--verbose' || args[i] === '-v') { verbose = true; }
  }

  return { base: base.replace(/\/$/, ''), projectId, user, workflowMode, verbose };
}

async function postJson(
  url: string,
  payload: unknown,
  verbose: boolean,
  bearerToken?: string,
): Promise<{ status: number; body: JsonRecord; elapsed: number }> {
  const start = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - start;
  let body: JsonRecord;
  try {
    body = (await resp.json()) as JsonRecord;
  } catch {
    body = { _raw: await resp.text().catch(() => '(empty)') };
  }
  if (verbose) {
    console.error(`  → ${resp.status} (${elapsed}ms) ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { status: resp.status, body, elapsed };
}

function asRecord(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function readString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function hasExplicitSuccessFlag(body: JsonRecord): boolean | null {
  if (typeof body.success === 'boolean') {
    return body.success;
  }
  const data = asRecord(body.data);
  if (data && typeof data.success === 'boolean') {
    return data.success;
  }
  return null;
}

function buildStepResult(
  step: string,
  ok: boolean,
  response: { status: number; body: JsonRecord; elapsed: number },
  extra: Partial<StepResult> = {},
): StepResult {
  return {
    step,
    ok,
    status: response.status,
    body: response.body,
    elapsed: response.elapsed,
    code: readNumber(response.body.code),
    ...extra,
  };
}

function buildSyntheticFailureStep(
  step: string,
  detail: string,
  extra: Partial<StepResult> = {},
): StepResult {
  return {
    step,
    ok: false,
    status: 0,
    body: { message: detail },
    elapsed: 0,
    code: null,
    detail,
    ...extra,
  };
}

function collectStepFacts(result: StepResult): string[] {
  const facts: string[] = [];

  if (result.step !== 'workflow/verify' && result.code != null) {
    facts.push(`code=${result.code}`);
  }
  if (result.formId) {
    facts.push(`form_id=${result.formId}`);
  }
  if (result.taskId) {
    facts.push(`task_id=${result.taskId}`);
  }
  if (result.passed != null) {
    facts.push(`passed=${String(result.passed)}`);
  }
  if (result.recommendedAction) {
    facts.push(`recommended_action=${result.recommendedAction}`);
  }
  if (result.errorCode) {
    facts.push(`error_code=${result.errorCode}`);
  }
  if (result.reason) {
    facts.push(`reason=${result.reason}`);
  }
  if (result.detail) {
    facts.push(result.detail);
  }

  return facts;
}

function printResult(r: StepResult): void {
  const icon = r.ok ? '✓' : '✗';
  const httpLabel = r.status > 0 ? `HTTP ${r.status}` : 'HTTP -';
  const facts = collectStepFacts(r);
  console.log(`  ${icon} [${r.step}] ${httpLabel} (${r.elapsed}ms)${facts.length ? ` ${facts.join(' ')}` : ''}`);
}

function buildSeedTaskPayload(formId: string, projectId: string): JsonRecord {
  return {
    title: `workflow-contract-${Date.now()}`,
    description: 'workflow verify smoke seed task',
    modelName: projectId,
    checkerId: CONTRACT_CHECKER_ID,
    approverId: CONTRACT_APPROVER_ID,
    reviewerId: CONTRACT_CHECKER_ID,
    formId,
    priority: 'medium',
    components: CONTRACT_COMPONENTS,
  };
}

export async function runSequence(opts: PmsContractSequenceOptions): Promise<StepResult[]> {
  const role = ROLE_MAP[opts.user] || 'sj';
  const results: StepResult[] = [];

  console.log('\n[0/6] POST /api/auth/token (login)');
  const loginReq = buildAuthLoginRequest({
    projectId: opts.projectId,
    currentPmsUser: opts.user,
    currentWorkflowRole: role,
  });
  const authPayload = {
    project_id: loginReq.projectId,
    user_id: loginReq.userId,
    role: loginReq.role,
  };
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(authPayload)}`);
  const authResp = await postJson(`${opts.base}/api/auth/token`, authPayload, opts.verbose);
  const authData = asRecord(authResp.body.data) ?? authResp.body;
  const bearerToken = readString(authData.token) || '';
  const authOk = authResp.status === 200 && (authResp.body.code === 0 || authResp.body.code === 200) && !!bearerToken;
  results.push(buildStepResult('auth/token', authOk, authResp, {
    detail: bearerToken ? 'Bearer token 已获取' : '未返回 Bearer token',
  }));
  printResult(results[results.length - 1]);

  console.log('\n[1/6] POST /api/review/embed-url');
  const embedPayload = buildEmbedUrlPayload({
    projectId: opts.projectId,
    currentPmsUser: opts.user,
    currentWorkflowRole: role,
    workflowMode: opts.workflowMode,
    token: bearerToken || null,
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(embedPayload)}`);
  const embedResp = await postJson(`${opts.base}/api/review/embed-url`, embedPayload, opts.verbose, bearerToken);
  const embedOk = embedResp.status === 200 && (embedResp.body.code === 0 || embedResp.body.code === 200);
  const embedData = asRecord(embedResp.body.data) ?? embedResp.body;
  const token = readString(embedData.token) || readString(embedData.user_token) || '';
  const query = asRecord(embedData.query);
  const lineage = asRecord(embedData.lineage);
  const formId = readString(embedData.form_id)
    || readString(query?.form_id)
    || readString(query?.formId)
    || readString(lineage?.form_id)
    || readString(lineage?.formId)
    || '';
  results.push(buildStepResult('embed-url', embedOk, embedResp, {
    detail: formId ? '已返回嵌入上下文' : '未提取到 form_id',
    formId: formId || null,
  }));
  printResult(results[results.length - 1]);

  let seededTaskId: string | null = null;
  let seedStepOk = false;
  console.log('\n[2/6] POST /api/review/tasks (seed)');
  if (!formId || !bearerToken) {
    const detail = !formId ? '缺少 form_id，无法创建 seed task' : '缺少 Bearer token，无法创建 seed task';
    results.push(buildSyntheticFailureStep('review-task(seed)', detail, {
      formId: formId || null,
      seededTask: true,
    }));
  } else {
    const createPayload = buildSeedTaskPayload(formId, opts.projectId);
    if (opts.verbose) console.error(`  payload: ${JSON.stringify(createPayload)}`);
    const createResp = await postJson(`${opts.base}/api/review/tasks`, createPayload, opts.verbose, bearerToken);
    const taskRecord = asRecord(createResp.body.task) ?? asRecord(asRecord(createResp.body.data)?.task);
    seededTaskId = readString(taskRecord?.id);
    const seededFormId = readString(taskRecord?.formId) || readString(taskRecord?.form_id) || formId;
    seedStepOk = createResp.status === 200 && createResp.body.success === true && !!seededTaskId && seededFormId === formId;
    results.push(buildStepResult('review-task(seed)', seedStepOk, createResp, {
      detail: seedStepOk ? 'seed task 创建成功' : (readString(createResp.body.error_message) || 'seed task 创建失败'),
      formId: formId,
      taskId: seededTaskId,
      seededTask: true,
    }));
  }
  printResult(results[results.length - 1]);

  console.log('\n[3/6] POST /api/review/workflow/verify');
  if (!seedStepOk || !formId || !token) {
    const detail = !seedStepOk
      ? '已跳过：seed task 未创建成功'
      : '已跳过：embed-url 未返回 workflow token';
    results.push(buildSyntheticFailureStep('workflow/verify', detail, {
      formId: formId || null,
      taskId: seededTaskId,
      seededTask: true,
    }));
  } else {
    const verifyPayload = buildWorkflowSyncPayload({
      formId,
      token,
      action: 'active',
      comments: 'contract verify smoke',
      currentPmsUser: opts.user,
      currentWorkflowRole: role,
      nextStep: {
        assigneeId: CONTRACT_CHECKER_ID,
        name: CONTRACT_CHECKER_ID,
        roles: 'jd',
      },
    });
    if (opts.verbose) console.error(`  payload: ${JSON.stringify(verifyPayload)}`);
    const verifyResp = await postJson(`${opts.base}/api/review/workflow/verify`, verifyPayload, opts.verbose, bearerToken);
    const verifyBodyData = asRecord(verifyResp.body.data);
    const verifyPassed = readBoolean(verifyBodyData?.passed);
    const verifyReason = readString(verifyBodyData?.reason);
    const verifyRecommendedAction = readString(verifyBodyData?.recommended_action);
    const verifyErrorCode = readString(verifyResp.body.error_code);
    const verifyOk = verifyResp.status === 200
      && verifyPassed === true
      && !!verifyReason
      && !!verifyRecommendedAction;
    results.push(buildStepResult('workflow/verify', verifyOk, verifyResp, {
      formId,
      taskId: seededTaskId,
      passed: verifyPassed,
      reason: verifyReason,
      recommendedAction: verifyRecommendedAction,
      errorCode: verifyErrorCode,
      seededTask: true,
      detail: verifyPassed === false
        ? '业务阻塞'
        : verifyOk
          ? null
          : '未返回完整 verify 合同字段',
    }));
  }
  printResult(results[results.length - 1]);

  console.log('\n[4/6] POST /api/review/workflow/sync (action=query)');
  const syncPayload = buildWorkflowSyncPayload({
    formId: formId || 'contract-test-form',
    token: token || 'contract-test-token',
    action: 'query',
    comments: '',
    currentPmsUser: opts.user,
    currentWorkflowRole: role,
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(syncPayload)}`);
  const syncResp = await postJson(`${opts.base}/api/review/workflow/sync`, syncPayload, opts.verbose, bearerToken);
  const syncData = asRecord(syncResp.body.data) ?? syncResp.body;
  const syncCurrentNode = readString(syncData.current_node) || readString(syncData.currentNode);
  const syncTaskStatus = readString(syncData.task_status) || readString(syncData.taskStatus);
  const syncFormStatus = readString(syncData.form_status) || readString(syncData.formStatus);
  const syncSuccessFlag = hasExplicitSuccessFlag(syncResp.body);
  const syncSemanticOk = syncResp.status === 200
    && (syncSuccessFlag == null || syncSuccessFlag === true)
    && !!(syncCurrentNode || syncTaskStatus || syncFormStatus);
  const syncDetail = syncSemanticOk
    ? `node=${syncCurrentNode || '-'} task=${syncTaskStatus || '-'} form=${syncFormStatus || '-'}`
    : syncResp.status === 200
      ? 'HTTP 200 但响应缺少 current_node / task_status / form_status 语义字段'
      : null;
  results.push(buildStepResult('workflow/sync(query)', syncSemanticOk, syncResp, {
    formId: formId || null,
    taskId: seededTaskId,
    detail: syncDetail,
  }));
  printResult(results[results.length - 1]);

  console.log('\n[5/6] POST /api/review/cache/preload');
  const cachePayload = buildCachePreloadPayload({
    projectId: opts.projectId,
    initiator: opts.user,
    token: token || 'contract-test-token',
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(cachePayload)}`);
  const cacheResp = await postJson(`${opts.base}/api/review/cache/preload`, cachePayload, opts.verbose, bearerToken);
  const cacheOk = cacheResp.status === 200 || cacheResp.status === 202;
  results.push(buildStepResult('cache/preload', cacheOk, cacheResp, {
    formId: formId || null,
  }));
  printResult(results[results.length - 1]);

  console.log(`\n[6/6] POST /api/review/delete (${formId ? 'cleanup seeded form' : 'dry-run'})`);
  const deletePayload = buildDeleteReviewPayload({
    formIds: formId ? [formId] : [],
    operatorId: opts.user,
    token: token || 'contract-test-token',
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(deletePayload)}`);
  const deleteResp = await postJson(`${opts.base}/api/review/delete`, deletePayload, opts.verbose, bearerToken);
  const deleteSuccessFlag = hasExplicitSuccessFlag(deleteResp.body);
  const deleteOk = deleteResp.status === 200 && (deleteSuccessFlag == null || deleteSuccessFlag === true);
  results.push(buildStepResult('delete', deleteOk, deleteResp, {
    formId: formId || null,
    taskId: seededTaskId,
    detail: formId ? '已请求清理 seed form' : '未拿到 form_id，退回 dry-run',
  }));
  printResult(results[results.length - 1]);

  return results;
}

function summarizeStep(result: StepResult): string {
  const parts = [`[${result.step}] ${result.ok ? 'PASS' : 'FAIL'} HTTP ${result.status > 0 ? result.status : '-'}`];
  parts.push(...collectStepFacts(result));
  return parts.join(' ');
}

export function formatSequenceSummary(opts: PmsContractSequenceOptions, results: StepResult[]): string {
  const lines = [
    '═══════════════════════════════════════════════════════════',
    ' PMS 平台 API 契约序列验证',
    `  后端: ${opts.base}  用户: ${opts.user}  项目: ${opts.projectId}  模式: ${opts.workflowMode}`,
    '═══════════════════════════════════════════════════════════',
    '',
  ];
  for (const result of results) {
    lines.push(summarizeStep(result));
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────');
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const allOk = passed === total;
  lines.push(`  结果: ${passed}/${total} 步骤通过${allOk ? '' : ' ← 存在失败'}`);
  lines.push('───────────────────────────────────────────────────────────');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' PMS 平台 API 契约序列验证');
  console.log(`  后端: ${opts.base}  用户: ${opts.user}  项目: ${opts.projectId}  模式: ${opts.workflowMode}`);
  console.log('═══════════════════════════════════════════════════════════');

  const results = await runSequence(opts);

  console.log('\n───────────────────────────────────────────────────────────');
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const allOk = passed === total;
  console.log(`  结果: ${passed}/${total} 步骤通过${allOk ? '' : ' ← 存在失败'}`);
  console.log('───────────────────────────────────────────────────────────\n');

  if (!allOk) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('契约序列异常:', e);
    process.exit(1);
  });
}

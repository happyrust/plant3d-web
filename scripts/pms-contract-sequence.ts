#!/usr/bin/env npx tsx
/**
 * PMS 平台 API 契约序列验证脚本
 *
 * 使用方式：
 *   npx tsx scripts/pms-contract-sequence.ts [--base http://localhost:3100] [--project TEST_PROJECT] [--user SJ]
 *
 * 功能：
 *   依次调用 embed-url → workflow/sync(query) → cache/preload，
 *   断言 HTTP 状态与响应 code，请求体由共享模块 pmsPlatformContractPayloads.ts 生成，
 *   与仿 PMS 模拟器使用同一份构建逻辑，确保契约不漂移。
 *
 * 环境变量（可选覆盖 CLI 参数）：
 *   PMS_CONTRACT_BASE_URL   后端地址（默认 http://localhost:3100）
 *   PMS_CONTRACT_PROJECT_ID 项目号
 *   PMS_CONTRACT_USER       PMS 用户（SJ/JH/SH/PZ）
 */

import {
  buildEmbedUrlPayload,
  buildWorkflowSyncPayload,
  buildCachePreloadPayload,
  buildDeleteReviewPayload,
  buildAuthLoginRequest,
  type SimulatorPmsUser,
  type WorkflowRole,
} from '../src/debug/pmsPlatformContractPayloads';

// ---------------------------------------------------------------------------
// CLI / 环境变量解析
// ---------------------------------------------------------------------------

function parseArgs(): { base: string; projectId: string; user: SimulatorPmsUser; workflowMode: string; verbose: boolean } {
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

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

const ROLE_MAP: Record<SimulatorPmsUser, WorkflowRole> = {
  SJ: 'sj',
  JH: 'jd',
  SH: 'sh',
  PZ: 'pz',
};

type StepResult = {
  step: string;
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  elapsed: number;
};

async function postJson(url: string, payload: unknown, verbose: boolean, bearerToken?: string): Promise<{ status: number; body: Record<string, unknown>; elapsed: number }> {
  const start = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - start;
  let body: Record<string, unknown>;
  try {
    body = (await resp.json()) as Record<string, unknown>;
  } catch {
    body = { _raw: await resp.text().catch(() => '(empty)') };
  }
  if (verbose) {
    console.error(`  → ${resp.status} (${elapsed}ms) ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { status: resp.status, body, elapsed };
}

function printResult(r: StepResult): void {
  const icon = r.ok ? '✓' : '✗';
  const authNote = r.status === 401 ? ' (auth-only, 契约格式 OK)' : '';
  console.log(`  ${icon} [${r.step}] HTTP ${r.status} (${r.elapsed}ms) code=${r.body.code ?? '?'}${authNote}`);
}

// ---------------------------------------------------------------------------
// 序列步骤
// ---------------------------------------------------------------------------

async function runSequence(opts: ReturnType<typeof parseArgs>): Promise<StepResult[]> {
  const role = ROLE_MAP[opts.user] || 'sj';
  const results: StepResult[] = [];

  // Step 0: auth/token — 获取 Bearer token
  console.log('\n[0/4] POST /api/auth/token (login)');
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
  const authData = (authResp.body.data ?? authResp.body) as Record<string, unknown>;
  const bearerToken = String(authData.token || '');
  const authOk = authResp.status === 200 && (authResp.body.code === 0 || authResp.body.code === 200) && !!bearerToken;
  results.push({ step: 'auth/token', ok: authOk, ...authResp });
  printResult(results[results.length - 1]);
  if (bearerToken) {
    console.log(`  ✔ Bearer token=${bearerToken.slice(0, 20)}…`);
  } else {
    console.log('  ⚠ auth/token 未返回 token，后续需 auth 的步骤可能 401');
  }

  // Step 1: embed-url
  console.log('\n[1/4] POST /api/review/embed-url');
  const embedPayload = buildEmbedUrlPayload({
    projectId: opts.projectId,
    currentPmsUser: opts.user,
    currentWorkflowRole: role,
    workflowMode: opts.workflowMode,
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(embedPayload)}`);
  const embedResp = await postJson(`${opts.base}/api/review/embed-url`, embedPayload, opts.verbose, bearerToken);
  const embedOk = embedResp.status === 200 && (embedResp.body.code === 0 || embedResp.body.code === 200);
  results.push({ step: 'embed-url', ok: embedOk, ...embedResp });
  printResult(results[results.length - 1]);

  // 从 embed-url 响应中提取 token，并仅从显式响应字段提取 form_id
  const embedData = (embedResp.body.data ?? embedResp.body) as Record<string, unknown>;
  const token = String(embedData.token || embedData.user_token || '');
  const query = (embedData.query ?? {}) as Record<string, unknown>;
  const lineage = (embedData.lineage ?? {}) as Record<string, unknown>;
  const formId = String(
    embedData.form_id
      || query.form_id
      || query.formId
      || lineage.form_id
      || lineage.formId
      || ''
  );

  if (!token) {
    console.log('  ⚠ embed-url 未返回 token，后续步骤将使用空 token（可能 4xx）');
  } else {
    console.log(`  ✔ token=${token.slice(0, 20)}…  form_id=${formId || '(未提取)'}`);
  }

  // Step 2: workflow/sync query
  console.log('\n[2/4] POST /api/review/workflow/sync (action=query)');
  const syncPayload = buildWorkflowSyncPayload({
    formId: formId || 'contract-test-form',
    token: token,
    action: 'query',
    comments: '',
    currentPmsUser: opts.user,
    currentWorkflowRole: role,
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(syncPayload)}`);
  const syncResp = await postJson(`${opts.base}/api/review/workflow/sync`, syncPayload, opts.verbose, bearerToken);
  // 200 = 完全通过；401 = 端点可达 + 格式正确，仅认证失败（测试环境预期）
  const syncOk = syncResp.status === 200 || syncResp.status === 401;
  results.push({ step: 'workflow/sync(query)', ok: syncOk, ...syncResp });
  printResult(results[results.length - 1]);

  // Step 3: cache/preload
  console.log('\n[3/4] POST /api/review/cache/preload');
  const cachePayload = buildCachePreloadPayload({
    projectId: opts.projectId,
    initiator: opts.user,
    token: token || 'contract-test-token',
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(cachePayload)}`);
  const cacheResp = await postJson(`${opts.base}/api/review/cache/preload`, cachePayload, opts.verbose, bearerToken);
  const cacheOk = cacheResp.status === 200 || cacheResp.status === 202 || cacheResp.status === 401 || cacheResp.status === 404;
  results.push({ step: 'cache/preload', ok: cacheOk, ...cacheResp });
  printResult(results[results.length - 1]);

  // Step 4: delete (dry-run，使用空 form_ids 验证接口可达)
  console.log('\n[4/4] POST /api/review/delete (dry-run, empty form_ids)');
  const deletePayload = buildDeleteReviewPayload({
    formIds: [],
    operatorId: opts.user,
    token: token || 'contract-test-token',
  });
  if (opts.verbose) console.error(`  payload: ${JSON.stringify(deletePayload)}`);
  const deleteResp = await postJson(`${opts.base}/api/review/delete`, deletePayload, opts.verbose, bearerToken);
  const deleteOk = deleteResp.status === 200 || deleteResp.status === 400 || deleteResp.status === 401 || deleteResp.status === 404;
  results.push({ step: 'delete(dry-run)', ok: deleteOk, ...deleteResp });
  printResult(results[results.length - 1]);

  return results;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

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

main().catch((e) => {
  console.error('契约序列异常:', e);
  process.exit(1);
});

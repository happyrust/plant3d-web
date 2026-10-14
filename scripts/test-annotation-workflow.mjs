#!/usr/bin/env node
/**
 * 三维校审批注与驳回流程测试
 *
 * 测试内容：
 *   TC-1: 多种批注类型（文字/云线/矩形）针对同一BRAN + 正向流程
 *   TC-2: 完整驳回流程（JH添加批注→驳回→SJ处理→重提→JH同意→继续→批准）
 *
 * 使用：
 *   node scripts/test-annotation-workflow.mjs           # 运行全部
 *   node scripts/test-annotation-workflow.mjs tc1       # 只运行TC-1
 *   node scripts/test-annotation-workflow.mjs tc2       # 只运行TC-2
 *   node scripts/test-annotation-workflow.mjs --api-only  # 只测试API层（跳过UI）
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const WHICH = (args.find(a => ['tc1', 'tc2', 'all'].includes(a)) || 'all').toLowerCase();
const API_ONLY = args.includes('--api-only');

const BACKEND_BASE = process.env.BACKEND_BASE || 'http://127.0.0.1:8022';
const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://127.0.0.1';
const PROJECT = process.env.PROJECT || 'AvevaMarineSample';
const BRAN = process.env.BRAN || '24381_145018';
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

// 角色定义
const ROLES = {
  SJ: { id: 'SJ', name: 'SJ', role: 'sj' },
  JH: { id: 'JH', name: 'JH', role: 'jd' },
  SH: { id: 'SH', name: 'SH', role: 'sh' },
  PZ: { id: 'PZ', name: 'PZ', role: 'pz' },
};
const actorOf = (who) => ({ id: who.id, name: who.name, roles: who.role });

// 测试结果
let passCount = 0;
let failCount = 0;
const results = [];
const currentCase = { id: '', api: {}, ui: {} };

function log(...args) {
  console.log(`[annot-test]${currentCase.id ? ` [${currentCase.id}]` : ''}`, ...args);
}

function step(name, passed, detail = {}) {
  const icon = passed ? '[PASS]' : '[FAIL]';
  results.push({ case: currentCase.id, name, passed, detail });
  if (passed) passCount++; else failCount++;
  console.log(`  ${icon} ${name}${Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ''}`);
  return passed;
}

function begin(id, title) {
  currentCase.id = id;
  currentCase.api = {};
  currentCase.ui = {};
  console.log('');
  console.log(`=== ${id}: ${title} ===`);
}

// ============================================================
// API 辅助函数
// ============================================================
async function api(method, apiPath, body, token) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${BACKEND_BASE}${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: resp.status, json, raw: text };
}

async function getToken(userId, role) {
  const r = await api('POST', '/api/auth/token', { project_id: PROJECT, user_id: userId, role });
  if (r.status !== 200 || !r.json?.data?.token) throw new Error(`获取 ${userId} token 失败: ${r.status}`);
  return r.json.data.token;
}

async function embedUrlForm(sjToken) {
  const r = await api('POST', '/api/review/embed-url', {
    project_id: PROJECT, user_id: 'SJ', workflow_role: 'sj', token: sjToken,
  });
  const formId = r.json?.data?.query?.form_id;
  if (r.status !== 200 || !formId) throw new Error(`embed-url 失败: ${r.status}`);
  return { formId, url: r.json.url };
}

// 驳回到 SJ（设计）
const RETURN_TO_SJ = { id: 'SJ', name: 'SJ', role: 'sj' };

async function sync(formId, token, who, action, comments, nextStep) {
  const body = { form_id: formId, token, action, actor: actorOf(who), comments: comments || '' };
  // 所有非 query 操作都需要 next_step（包括 return）
  const target = nextStep || (action === 'return' ? RETURN_TO_SJ : null);
  if (target) body.next_step = { assignee_id: target.id, name: target.name, roles: target.role };
  return api('POST', '/api/review/workflow/sync', body);
}

async function verify(formId, token, who, action, nextStep) {
  const body = { form_id: formId, token, action, actor: actorOf(who), comments: `预验证 ${action}` };
  // verify 不强制要求 next_step，但传了也没关系
  const target = nextStep || (action === 'return' ? RETURN_TO_SJ : null);
  if (target) body.next_step = { assignee_id: target.id, name: target.name, roles: target.role };
  return api('POST', '/api/review/workflow/verify', body);
}

async function annotationStates(formId, taskId, token) {
  const params = new URLSearchParams({ form_id: formId });
  if (taskId) params.set('task_id', taskId);
  const r = await api('GET', `/api/review/annotation-states?${params.toString()}`, undefined, token);
  const s = r.json?.states || r.json?.data?.states || [];
  return { 
    http: r.status, 
    lines: s.map(x => `${x.annotationId || x.annotation_id} r${x.reviewRound || x.review_round} ${x.resolutionStatus || x.resolution_status}/${x.decisionStatus || x.decision_status}`), 
    raw: s 
  };
}

async function applyAnnotationState(formId, taskId, token, who, annotationId, annotationType, action, note) {
  // 根据后端 Rust 代码，请求体使用 camelCase
  const r = await api('POST', '/api/review/annotation-states/apply', {
    formId: formId,
    taskId: taskId,
    annotationId: annotationId,
    annotationType: annotationType,  // 'text' | 'cloud' | 'rect' | 'obb'
    action: action,  // 'fixed' | 'wont_fix' | 'agree' | 'reject'
    note: note || '',
  }, token);
  return r;
}

// 创建确认记录（包含批注），会自动同步到 review_annotation_states
// reviewState: 批注状态 { resolutionStatus: 'open'|'fixed'|'wont_fix', decisionStatus: 'pending'|'agreed'|'rejected' }
async function createAnnotationRecord(taskId, formId, token, who, annotations, measurements = [], reviewState = { resolutionStatus: 'open', decisionStatus: 'pending' }) {
  const buildAnn = (a) => ({
    id: a.id,
    title: a.title,
    description: a.content,
    refnos: [a.refno || BRAN],
    kind: a.type,  // 'text' | 'cloud' | 'rect' | 'obb'
    reviewState: a.reviewState || reviewState,
  });
  
  const r = await api('POST', '/api/review/records', {
    taskId: taskId,
    formId: formId,
    type: 'batch',
    annotations: annotations.filter(a => a.type === 'text').map(buildAnn),
    cloudAnnotations: annotations.filter(a => a.type === 'cloud').map(buildAnn),
    rectAnnotations: annotations.filter(a => a.type === 'rect').map(buildAnn),
    obbAnnotations: annotations.filter(a => a.type === 'obb').map(buildAnn),
    measurements: measurements,
    note: `${who.name} 的批注记录 (${reviewState.resolutionStatus}/${reviewState.decisionStatus})`,
  }, token);
  return r;
}

async function createTask(token, formId, packageName) {
  const r = await api('POST', '/api/review/tasks', {
    form_id: formId,
    title: `批注测试-${packageName}`,
    description: '批注与驳回流程测试任务',
    modelName: PROJECT,
    checkerId: 'JH',
    approverId: 'SH',
    priority: 'normal',
    package_name: packageName,
    components: [{ id: BRAN, refNo: BRAN, name: BRAN, type: 'BRAN' }],
    creator_id: 'SJ',
    creator_name: 'SJ',
  }, token);
  if (r.status !== 200 && r.status !== 201) throw new Error(`创建任务失败: ${r.status} ${r.raw?.slice(0, 200)}`);
  const task = r.json?.task || r.json?.data?.task || {};
  return {
    taskId: task.id,
    formId: task.formId || formId,
    packageName,
  };
}

async function history(taskId, token) {
  const r = await api('GET', `/api/review/tasks/${encodeURIComponent(taskId)}/workflow`, undefined, token);
  const h = r.json?.history || r.json?.data?.history || [];
  return { http: r.status, lines: h.map(x => `${x.node} ${x.action} by ${x.operatorId || x.operator_id || '?'}`) };
}

function snap(r) {
  const d = r.json?.data || {};
  return {
    http: r.status,
    form_status: d.form_status,
    task_status: d.task_status,
    current_node: d.current_node,
    task_id: d.task_id,
  };
}

const verifyPassed = (v) => v.status === 200 && v.json?.data?.passed !== false;
const verifyBlocked = (v) => v.status !== 200 || v.json?.data?.passed === false;

// ============================================================
// 确保服务运行
// ============================================================
async function checkBackendHealth() {
  // 使用 curl.exe 检查（Node.js fetch 在 Windows localhost 可能有问题）
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(`curl.exe -s -o nul -w "%{http_code}" ${BACKEND_BASE}/api/v1/health`, { encoding: 'utf-8', timeout: 10000 });
    return out.trim() === '200';
  } catch {
    return false;
  }
}

async function ensureServices() {
  log('检查服务状态...');
  
  // 检查后端（带重试，等待服务启动）
  let backendOk = false;
  for (let i = 0; i < 10; i++) {
    if (await checkBackendHealth()) {
      backendOk = true;
      break;
    }
    log(`  等待后端启动... (${i + 1}/10)`);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  if (!backendOk) {
    throw new Error('后端不可用: 无法连接到 ' + BACKEND_BASE);
  }
  log('  后端正常');
  
  // 启动前端 nginx
  if (!API_ONLY) {
    const nginxDir = path.resolve(PROJECT_ROOT, 'deploy/offline/nginx');
    const nginxExe = path.join(nginxDir, 'nginx.exe');
    if (existsSync(nginxExe)) {
      try { execSync('taskkill /F /IM nginx.exe', { stdio: 'ignore' }); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      const child = spawn(nginxExe, [], { cwd: nginxDir, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      await new Promise(r => setTimeout(r, 2000));
      log('  前端 nginx 已启动');
    }
  }
}

// ============================================================
// TC-1: 多种批注类型（文字/云线/矩形）+ 完整驳回流程
// ============================================================
async function tc1(tokens) {
  begin('TC1', '3种批注类型（文字/云线/矩形）+ 完整驳回流程');
  
  // 1. SJ 发起
  const { formId } = await embedUrlForm(tokens.SJ);
  step('SJ 获取嵌入地址（form_id）', !!formId, { formId });
  
  const pkg = `ANNOT-TC1-${STAMP}`;
  const task = await createTask(tokens.SJ, formId, pkg);
  const activeFormId = task.formId;
  currentCase.api = { formId: activeFormId, taskId: task.taskId, packageName: pkg };
  step('SJ 创建编校审任务', !!task.taskId, { taskId: task.taskId, formId: activeFormId });
  
  // 2. 流程推进到 JH
  let q = snap(await sync(activeFormId, tokens.SJ, ROLES.SJ, 'query'));
  step('query: 建单后 draft/sj', q.task_status === 'draft' && q.current_node === 'sj', q);
  
  const v1 = await verify(activeFormId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('SJ 预校验 active 通过', verifyPassed(v1), { http: v1.status });
  
  let r = snap(await sync(activeFormId, tokens.SJ, ROLES.SJ, 'active', '送审（批注测试TC1）', ROLES.JH));
  step('SJ 送审 → submitted/jd', r.task_status === 'submitted' && r.current_node === 'jd', r);
  
  // 3. JH 创建3种类型批注（文字/云线/矩形）针对同一BRAN
  log('JH 创建3种批注（文字/云线/矩形）针对 BRAN ' + BRAN);
  
  const annotations = [
    { id: `ann-tc1-text-${STAMP}`, type: 'text', title: '文字批注-尺寸问题', content: `针对 ${BRAN}：法兰尺寸不符合规范`, refno: BRAN },
    { id: `ann-tc1-cloud-${STAMP}`, type: 'cloud', title: '云线批注-位置偏移', content: `针对 ${BRAN}：管道位置偏移 50mm`, refno: BRAN },
    { id: `ann-tc1-rect-${STAMP}`, type: 'rect', title: '矩形批注-碰撞风险', content: `针对 ${BRAN}：与相邻管道存在碰撞风险`, refno: BRAN },
  ];
  
  const measurements = [
    { id: `meas-tc1-${STAMP}`, type: 'distance', value: 1000, unit: 'mm', description: '批注测试-测量证据', entityId: `${BRAN}:origin` },
  ];
  
  const recResult = await createAnnotationRecord(
    task.taskId, activeFormId, tokens.JH, ROLES.JH, annotations, measurements
  );
  
  const createdAnnotations = annotations.map(a => ({ ...a, annotationId: a.id }));
  step('JH 创建确认记录（含3种批注+1条测量）', 
    recResult.status === 200 || recResult.status === 201, 
    { status: recResult.status, recordId: recResult.json?.record?.id || recResult.json?.data?.id }
  );
  
  // 4. 查询批注状态（应该都是 open/pending）
  await new Promise(r => setTimeout(r, 1500));
  const states1 = await annotationStates(activeFormId, task.taskId, tokens.JH);
  step('查询批注状态（3条待处理 open/pending）', 
    states1.http === 200 && states1.raw?.length >= 3, 
    { count: states1.raw?.length, lines: states1.lines }
  );
  
  // 5. JH 预校验同意（有待处理批注，应该被拦截）
  const v2 = await verify(activeFormId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  const blocked = verifyBlocked(v2);
  const blockCode = v2.json?.data?.block_code || v2.json?.block_code || v2.json?.error_code;
  step('JH 预校验同意被拦截（ANNOTATION_CHECK_FAILED）', blocked, { 
    http: v2.status,
    block_code: blockCode,
    message: v2.json?.data?.message || v2.json?.message,
  });
  
  // 6. JH 驳回（return）到 SJ
  const vReturn = await verify(activeFormId, tokens.JH, ROLES.JH, 'return');
  step('JH 预校验驳回通过', verifyPassed(vReturn), { http: vReturn.status });
  
  r = snap(await sync(activeFormId, tokens.JH, ROLES.JH, 'return', '驳回：请处理3条批注后重提'));
  step('JH 驳回 → sj', r.current_node === 'sj', r);
  
  // 7. SJ 处理所有批注（标记已修改 fixed）
  // 注意：由于后端 load_annotation_states_by_task 返回所有轮次状态，
  // 且 overlay_independent_states 可能用旧轮次(r1:open)覆盖新轮次(r2:fixed)，
  // 导致门禁检查仍然拦截。这里我们测试批注状态处理 API 本身。
  log('SJ 处理3条批注（标记已修改）...');
  for (const ann of createdAnnotations) {
    const applyR = await applyAnnotationState(
      activeFormId, task.taskId, tokens.SJ, ROLES.SJ,
      ann.annotationId, ann.type, 'fixed',
      `已修复：${ann.title}`
    );
    step(`SJ 处理${ann.type}批注「${ann.title}」→ fixed`, 
      applyR.status === 200 && applyR.json?.success !== false, 
      { status: applyR.status }
    );
  }
  
  // 8. 查询批注状态（HTTP接口返回所有轮次，门禁检查只使用最新轮次）
  await new Promise(r => setTimeout(r, 1000));
  const states2 = await annotationStates(activeFormId, task.taskId, tokens.SJ);
  const fixedCount = states2.raw?.filter(s => 
    (s.resolutionStatus || s.resolution_status) === 'fixed'
  ).length || 0;
  // HTTP查询接口返回所有轮次（含历史），门禁检查内部只使用最新轮次（已修复）
  const latestRound = Math.max(...(states2.raw || []).map(s => s.reviewRound || s.review_round || 0));
  const latestFixedCount = states2.raw?.filter(s => 
    (s.reviewRound || s.review_round) === latestRound && 
    (s.resolutionStatus || s.resolution_status) === 'fixed'
  ).length || 0;
  step('批注状态更新为 fixed/pending（最新轮次3条fixed）', 
    fixedCount >= 3 && latestFixedCount === 3, {
    fixedCount, latestRound, latestFixedCount, total: states2.raw?.length, lines: states2.lines,
  });
  
  // 9. SJ 重新提交（修复后应直接通过，无需创建新记录）
  const v3 = await verify(activeFormId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('SJ 重提预校验通过（修复验证：直接通过）', verifyPassed(v3), { 
    http: v3.status, 
    passed: v3.json?.data?.passed,
    block_code: v3.json?.data?.block_code,
  });
  
  r = snap(await sync(activeFormId, tokens.SJ, ROLES.SJ, 'active', '已处理3条批注，重新送审', ROLES.JH));
  step('SJ 重提 → submitted/jd', r.current_node === 'jd', r);
  
  // 10. JH 二轮：同意所有批注
  log('JH 二轮同意3条批注...');
  for (const ann of createdAnnotations) {
    const applyR = await applyAnnotationState(
      activeFormId, task.taskId, tokens.JH, ROLES.JH,
      ann.annotationId, ann.type, 'agree',
      `同意处理结果：${ann.title}`
    );
    step(`JH 同意${ann.type}批注「${ann.title}」→ agreed`, 
      applyR.status === 200 && applyR.json?.success !== false, 
      { status: applyR.status }
    );
  }
  
  // 11. 查询批注状态（应为 agreed）
  await new Promise(r => setTimeout(r, 1000));
  const states3 = await annotationStates(activeFormId, task.taskId, tokens.JH);
  const agreedCount = states3.raw?.filter(s => 
    (s.decisionStatus || s.decision_status) === 'agreed'
  ).length || 0;
  step('批注状态更新为 agreed（3条）', agreedCount >= 3, {
    agreedCount, total: states3.raw?.length, lines: states3.lines,
  });
  
  // 12. JH 同意流程 → SH → PZ → approved
  const v4 = await verify(activeFormId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  step('JH 预校验同意通过（批注已全部同意）', verifyPassed(v4), { http: v4.status });
  
  r = snap(await sync(activeFormId, tokens.JH, ROLES.JH, 'agree', '批注已处理，同意送审', ROLES.SH));
  step('JH 同意 → sh', r.current_node === 'sh', r);
  
  r = snap(await sync(activeFormId, tokens.SH, ROLES.SH, 'agree', '审核同意', ROLES.PZ));
  step('SH 同意 → pz', r.current_node === 'pz', r);
  
  r = snap(await sync(activeFormId, tokens.PZ, ROLES.PZ, 'agree', '最终批准'));
  step('PZ 批准 → approved', r.form_status === 'approved' && r.task_status === 'approved', r);
  
  // 13. 查询完整历史（应为6条）
  const h = await history(task.taskId, tokens.SJ);
  step('历史流转记录完整（6条）', h.lines?.length === 6, { 
    count: h.lines?.length, lines: h.lines 
  });
  
  log('TC-1 完成:', `3种批注类型全流程通过，最终 approved`);
  return { task, activeFormId, createdAnnotations };
}

// ============================================================
// TC-2: 完整驳回流程（JH批注→驳回→SJ处理→重提→JH同意→继续→批准）
// ============================================================
async function tc2(tokens) {
  begin('TC2', '完整驳回流程：JH批注→驳回→SJ处理→重提→JH同意→继续→批准');
  
  // 1. SJ 发起
  const { formId } = await embedUrlForm(tokens.SJ);
  step('SJ 获取嵌入地址', !!formId, { formId });
  
  const pkg = `ANNOT-TC2-${STAMP}`;
  const task = await createTask(tokens.SJ, formId, pkg);
  const activeFormId = task.formId;
  currentCase.api = { formId: activeFormId, taskId: task.taskId, packageName: pkg };
  step('SJ 创建编校审任务', !!task.taskId, { taskId: task.taskId, formId: activeFormId });
  
  // 2. 送审到 JH
  await sync(activeFormId, tokens.SJ, ROLES.SJ, 'query');
  await verify(activeFormId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  let r = snap(await sync(activeFormId, tokens.SJ, ROLES.SJ, 'active', '送审（驳回流程测试）', ROLES.JH));
  step('SJ 送审 → submitted/jd', r.current_node === 'jd', r);
  
  // 3. JH 创建批注（针对同一BRAN的多种批注）
  log('JH 创建批注（文字+云线）针对 BRAN ' + BRAN);
  const annotations = [
    { id: `ann-tc2-text-${STAMP}`, type: 'text', title: '问题1-尺寸不符', content: `BRAN ${BRAN} 法兰尺寸不符合设计规范`, refno: BRAN },
    { id: `ann-tc2-cloud-${STAMP}`, type: 'cloud', title: '问题2-位置偏移', content: `BRAN ${BRAN} 安装位置偏移50mm`, refno: BRAN },
  ];
  
  const measurements = [
    { id: `meas-tc2-${STAMP}`, type: 'distance', value: 500, unit: 'mm', description: '驳回流程测试-测量', entityId: `${BRAN}:origin` },
  ];
  
  const recResult = await createAnnotationRecord(
    task.taskId, activeFormId, tokens.JH, ROLES.JH, annotations, measurements
  );
  
  const createdAnnotations = annotations.map(a => ({ ...a, annotationId: a.id }));
  step('JH 创建确认记录（含2条批注）', 
    recResult.status === 200 || recResult.status === 201, 
    { status: recResult.status, recordId: recResult.json?.record?.id || recResult.json?.data?.id }
  );
  
  // 等待批注状态同步
  await new Promise(r => setTimeout(r, 1500));
  
  // 4. 查询批注状态（应为 open/pending）
  const states1 = await annotationStates(activeFormId, task.taskId, tokens.JH);
  const openCount = states1.raw?.filter(s => 
    (s.resolutionStatus || s.resolution_status) === 'open'
  ).length || 0;
  step('查询批注状态（2条 open/pending）', 
    states1.http === 200 && states1.raw?.length >= 2, 
    { count: states1.raw?.length, lines: states1.lines }
  );
  
  // 5. JH 预校验同意（应该被拦截，有待处理批注）
  const v1 = await verify(activeFormId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  const blocked1 = verifyBlocked(v1);
  const blockCode1 = v1.json?.data?.block_code || v1.json?.block_code || v1.json?.error_code;
  step('JH 预校验同意被拦截（ANNOTATION_CHECK）', blocked1, {
    http: v1.status,
    block_code: blockCode1,
  });
  
  // 6. JH 驳回（return）
  const vReturn = await verify(activeFormId, tokens.JH, ROLES.JH, 'return');
  step('JH 预校验驳回通过', verifyPassed(vReturn), { http: vReturn.status });
  
  r = snap(await sync(activeFormId, tokens.JH, ROLES.JH, 'return', '驳回：请处理批注后重提'));
  step('JH 驳回 → sj', r.current_node === 'sj', r);
  
  // 7. SJ 查询批注状态（应为 open/pending）
  const states2 = await annotationStates(activeFormId, task.taskId, tokens.SJ);
  step('SJ 查询批注状态（open/pending）', 
    states2.http === 200 && states2.raw?.length >= 2, 
    { count: states2.raw?.length, lines: states2.lines }
  );
  
  // 8. SJ 尝试直接重提（应该被拦截，未处理批注）
  const v2 = await verify(activeFormId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  const blocked2 = verifyBlocked(v2);
  const blockCode2 = v2.json?.data?.block_code || v2.json?.block_code || v2.json?.error_code;
  step('SJ 直接重提被拦截（未处理批注）', blocked2, {
    http: v2.status,
    block_code: blockCode2,
  });
  
  // 9. SJ 处理批注（标记已修改 fixed）
  log('SJ 处理批注（标记已修改）...');
  let fixedOk = 0;
  for (const ann of createdAnnotations) {
    const applyR = await applyAnnotationState(
      activeFormId,
      task.taskId,
      tokens.SJ,
      ROLES.SJ,
      ann.annotationId,
      ann.type,  // 'text' or 'cloud'
      'fixed',   // 标记已修改
      `已修复：${ann.title} - 修改完成`
    );
    const ok = applyR.status === 200 && (applyR.json?.success !== false);
    if (ok) fixedOk++;
    step(`SJ 处理批注「${ann.title}」→ fixed`, ok, { 
      status: applyR.status,
      success: applyR.json?.success,
      response: applyR.raw?.slice(0, 200) 
    });
  }
  
  // 10. 查询批注状态（HTTP接口返回所有轮次，门禁检查只使用最新轮次）
  await new Promise(r => setTimeout(r, 1000));
  const states3 = await annotationStates(activeFormId, task.taskId, tokens.SJ);
  const fixedCount = states3.raw?.filter(s => 
    (s.resolutionStatus || s.resolution_status) === 'fixed'
  ).length || 0;
  // HTTP查询接口返回所有轮次（含历史），门禁检查内部只使用最新轮次（已修复）
  const latestRound = Math.max(...(states3.raw || []).map(s => s.reviewRound || s.review_round || 0));
  const latestFixedCount = states3.raw?.filter(s => 
    (s.reviewRound || s.review_round) === latestRound && 
    (s.resolutionStatus || s.resolution_status) === 'fixed'
  ).length || 0;
  step('批注状态更新为 fixed/pending（最新轮次2条fixed）', 
    fixedCount >= 2 && latestFixedCount === 2, {
    fixedCount, latestRound, latestFixedCount,
    total: states3.raw?.length,
    lines: states3.lines,
  });
  
  // 11. SJ 重新提交（修复后应直接通过，无需创建新记录）
  const v3 = await verify(activeFormId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('SJ 重提预校验通过（修复验证：直接通过）', verifyPassed(v3), { 
    http: v3.status,
    passed: v3.json?.data?.passed,
    block_code: v3.json?.data?.block_code,
  });
  
  r = snap(await sync(activeFormId, tokens.SJ, ROLES.SJ, 'active', '已处理批注，重新送审', ROLES.JH));
  step('SJ 重提 → submitted/jd', r.current_node === 'jd', r);
  
  // 12. JH 二轮：同意批注（agree）
  log('JH 二轮确认（同意批注）...');
  for (const ann of createdAnnotations) {
    const applyR = await applyAnnotationState(
      activeFormId, task.taskId, tokens.JH, ROLES.JH,
      ann.annotationId, ann.type, 'agree',
      `同意处理结果：${ann.title}`
    );
    step(`JH 同意批注「${ann.title}」→ agreed`, 
      applyR.status === 200 && applyR.json?.success !== false, 
      { status: applyR.status }
    );
  }
  
  // 13. 查询批注状态（应为 fixed/agreed）
  await new Promise(r => setTimeout(r, 1000));
  const states4 = await annotationStates(activeFormId, task.taskId, tokens.JH);
  const agreedCount = states4.raw?.filter(s => 
    (s.decisionStatus || s.decision_status) === 'agreed'
  ).length || 0;
  step('批注状态更新为 agreed（2条）', agreedCount >= 2, {
    agreedCount,
    total: states4.raw?.length,
    lines: states4.lines,
  });
  
  // 14. JH 同意流程 → SH → PZ → approved
  const v4 = await verify(activeFormId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  step('JH 预校验同意通过（批注已全部同意）', verifyPassed(v4), { 
    http: v4.status,
    passed: v4.json?.data?.passed,
  });
  
  r = snap(await sync(activeFormId, tokens.JH, ROLES.JH, 'agree', '批注已处理，同意送审', ROLES.SH));
  step('JH 同意 → sh', r.current_node === 'sh', r);
  
  // 15. SH 审核 → PZ 批准
  r = snap(await sync(activeFormId, tokens.SH, ROLES.SH, 'agree', '审核同意', ROLES.PZ));
  step('SH 同意 → pz', r.current_node === 'pz', r);
  
  r = snap(await sync(activeFormId, tokens.PZ, ROLES.PZ, 'agree', '最终批准'));
  step('PZ 批准 → approved', r.form_status === 'approved' && r.task_status === 'approved', r);
  
  // 16. 查询完整历史（应为6条：submit→return→submit→agree→agree→agree）
  const h = await history(task.taskId, tokens.SJ);
  step('历史流转记录完整（6条）', 
    h.lines?.length === 6, { 
      count: h.lines?.length,
      lines: h.lines 
    });
  
  log('TC-2 完成:', `驳回流程全链路通过，最终 approved`);
  return { task, activeFormId, createdAnnotations };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('========================================');
  console.log('  三维校审批注与驳回流程测试');
  console.log('========================================');
  console.log(`  后端: ${BACKEND_BASE}`);
  console.log(`  前端: ${FRONTEND_BASE}`);
  console.log(`  项目: ${PROJECT}`);
  console.log(`  BRAN: ${BRAN}`);
  console.log(`  模式: ${API_ONLY ? 'API Only' : 'API + UI'}`);
  console.log('');

  await ensureServices();

  // 获取所有角色 token
  log('获取角色 Token...');
  const tokens = {};
  for (const [name, role] of Object.entries(ROLES)) {
    tokens[name] = await getToken(role.id, role.role);
    log(`  ${name} (${role.role}): token 获取成功`);
  }
  console.log('');

  // 运行测试用例
  if (WHICH === 'tc1' || WHICH === 'all') {
    await tc1(tokens);
  }
  if (WHICH === 'tc2' || WHICH === 'all') {
    await tc2(tokens);
  }

  // ============================================================
  // 测试报告
  // ============================================================
  console.log('');
  console.log('========================================');
  console.log('  测试报告');
  console.log('========================================');
  console.log('');
  
  // 按测试用例分组显示
  const cases = [...new Set(results.map(r => r.case))];
  for (const caseId of cases) {
    console.log(`--- ${caseId} ---`);
    const caseResults = results.filter(r => r.case === caseId);
    for (const r of caseResults) {
      const icon = r.passed ? '[PASS]' : '[FAIL]';
      console.log(`  ${icon} ${r.name}`);
    }
    const casePass = caseResults.filter(r => r.passed).length;
    console.log(`  小计: ${casePass}/${caseResults.length} 通过`);
    console.log('');
  }
  
  console.log(`  总计: 通过 ${passCount}  失败 ${failCount}  总计 ${results.length}`);
  const passRate = results.length > 0 ? Math.round(passCount / results.length * 100) : 0;
  console.log(`  通过率: ${passRate}%`);
  console.log('');
  
  if (failCount === 0) {
    console.log('  [SUCCESS] 所有批注与驳回流程测试通过！');
  } else {
    console.log(`  [FAILED] ${failCount} 个测试失败`);
  }
  
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[annot-test] 测试执行失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});

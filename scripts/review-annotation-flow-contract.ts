#!/usr/bin/env npx tsx
/**
 * 批注状态独立真源 - HTTP 合同验证脚本
 *
 * 使用方式：
 *   PLANT3D_API_BASE=http://127.0.0.1:3910 npx tsx scripts/review-annotation-flow-contract.ts
 *
 * 验证场景：
 *   1. 获取 JWT token
 *   2. 创建任务（含 form_id）
 *   3. 保存带批注的确认记录（触发 reviewState 同步）
 *   4. 查询独立批注状态
 *   5. 创建评论（带上下文字段）
 *   6. 查询评论（带上下文过滤）
 *   7. 写入批注状态（fixed）
 *   8. annotation check 应阻塞（jd 节点 pending）
 *   9. 写入批注状态（agree）
 *  10. annotation check 应通过
 *  11. 非作者删除评论 → 403
 *  12. 作者删除评论 → 200
 *  13. 两个 form 同 annotation_id 评论隔离
 *  14. 清理测试数据
 */

const BASE = (process.env.PLANT3D_API_BASE || 'http://127.0.0.1:3910').replace(/\/$/, '');
const PROJECT_ID = process.env.PMS_CONTRACT_PROJECT_ID || 'TEST_PROJECT';
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

type JsonRecord = Record<string, unknown>;
let token = '';
let taskId = '';
let formId = '';
let commentId = '';
let passed = 0;
let failed = 0;

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: JsonRecord }> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  if (VERBOSE) console.error(`  → ${method} ${url}`);
  const resp = await fetch(url, opts);
  let json: JsonRecord;
  try {
    json = (await resp.json()) as JsonRecord;
  } catch {
    json = { _raw: await resp.text().catch(() => '(empty)') };
  }
  if (VERBOSE) console.error(`  ← ${resp.status} ${JSON.stringify(json).slice(0, 300)}`);
  return { status: resp.status, body: json };
}

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function getToken(userId: string, userName: string, role: string): Promise<string> {
  const resp = await request('POST', '/api/auth/token', {
    project_id: PROJECT_ID,
    user_id: userId,
    user_name: userName,
    role,
  });
  if (resp.status === 200) {
    const data = resp.body.data as JsonRecord | undefined;
    return (data?.token as string) || (resp.body as { token?: string }).token || '';
  }
  return '';
}

async function step1_getToken() {
  console.log('\n[1] 获取 JWT token (SJ)');
  token = await getToken('SJ', '设计人员', 'sj');
  if (!token) {
    console.log('  ⚠ 无法获取 token，可能 auth 处于 debug 模式，继续测试');
  } else {
    assert('token 非空', token.length > 0);
  }
}

async function step2_createTask() {
  console.log('\n[2] 创建校审任务');
  formId = `CONTRACT-ANNO-${Date.now()}`;
  const resp = await request('POST', '/api/review/tasks', {
    title: '批注合同测试任务',
    description: '用于验证批注状态独立真源',
    modelName: 'TestModel',
    checkerId: 'JH',
    checkerName: '校核人员',
    approverId: 'SH',
    approverName: '审核人员',
    reviewerId: 'JH',
    formId,
    components: [{ id: 'c1', refNo: 'REF001', name: '测试管道', type: 'PIPE' }],
  });
  assert('HTTP 200', resp.status === 200);
  const task = resp.body.task as JsonRecord | undefined;
  taskId = (task?.id as string) || '';
  assert('taskId 非空', taskId.length > 0);
  assert('formId 匹配', (task?.formId as string) === formId);
}

async function step3_saveRecord() {
  console.log('\n[3] 保存确认记录（含批注 reviewState）');
  const resp = await request('POST', '/api/review/records', {
    taskId,
    formId,
    type: 'batch',
    annotations: [
      {
        id: 'anno-test-001',
        title: '测试批注1',
        description: '需要处理',
        refnos: ['REF001'],
        reviewState: {
          resolutionStatus: 'open',
          decisionStatus: 'pending',
        },
      },
    ],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    note: '合同测试',
  });
  assert('HTTP 200', resp.status === 200);
  assert('record 保存成功', resp.body.success === true);
}

async function step4_queryStates() {
  console.log('\n[4] 查询独立批注状态');
  const resp = await request('GET', `/api/review/annotation-states?form_id=${formId}&task_id=${taskId}`);
  assert('HTTP 200', resp.status === 200);
  assert('查询成功', resp.body.success === true);
  const states = resp.body.states as JsonRecord[] | undefined;
  assert('states 列表非空', Array.isArray(states) && states.length > 0, `got ${states?.length ?? 0}`);
}

async function step5_createComment() {
  console.log('\n[5] 创建评论（带上下文）');
  const resp = await request('POST', '/api/review/comments', {
    annotationId: 'anno-test-001',
    annotationType: 'text',
    authorId: 'SJ',
    authorName: '设计人员',
    authorRole: 'designer',
    content: '合同测试评论',
    formId,
    taskId,
    workflowNode: 'sj',
    reviewRound: 1,
  });
  assert('HTTP 200', resp.status === 200);
  assert('评论创建成功', resp.body.success === true);
  const comment = resp.body.comment as JsonRecord | undefined;
  commentId = (comment?.id as string) || '';
  assert('commentId 非空', commentId.length > 0);
}

async function step6_queryComments() {
  console.log('\n[6] 查询评论（带上下文过滤）');
  const resp = await request(
    'GET',
    `/api/review/comments/by-annotation/anno-test-001?type=text&form_id=${formId}&task_id=${taskId}`,
  );
  assert('HTTP 200', resp.status === 200);
  const comments = resp.body.comments as JsonRecord[] | undefined;
  assert('评论列表非空', Array.isArray(comments) && comments.length > 0);
}

async function step7_applyFixed() {
  console.log('\n[7] 设计侧标记批注已修改 (fixed)');
  const resp = await request('POST', '/api/review/annotation-states/apply', {
    formId,
    taskId,
    annotationId: 'anno-test-001',
    annotationType: 'text',
    action: 'fixed',
    note: '已按意见调整',
  });
  assert('HTTP 200', resp.status === 200);
  assert('apply 成功', resp.body.success === true);
  const state = resp.body.state as JsonRecord | undefined;
  assert('resolutionStatus=fixed', state?.resolutionStatus === 'fixed');
  assert('decisionStatus=pending', state?.decisionStatus === 'pending');
}

async function step8_checkShouldBlockJd() {
  console.log('\n[8] 提交到 jd → submit_to_next 推进节点');
  const submitResp = await request('POST', `/api/review/tasks/${encodeURIComponent(taskId)}/submit`, {
    comment: '提交校核',
    operatorId: 'SJ',
    operatorName: '设计人员',
  });
  assert('提交 HTTP 200', submitResp.status === 200);

  console.log('  切换到 JH token');
  const jhToken = await getToken('JH', '校核人员', 'jd');
  if (jhToken) token = jhToken;

  console.log('  annotation check (jd 节点, pending_review 应阻塞)');
  const checkResp = await request('POST', '/api/review/annotations/check', {
    formId,
    taskId,
    currentNode: 'jd',
    intent: 'submit_next',
  });
  assert('check HTTP 200', checkResp.status === 200);
  const data = checkResp.body.data as JsonRecord | undefined;
  assert('check passed=false', data?.passed === false, `got passed=${data?.passed}`);
  assert('recommended_action=block', data?.recommendedAction === 'block' || data?.recommended_action === 'block');
}

async function step9_applyAgree() {
  console.log('\n[9] 校核侧同意批注 (agree)');
  const jhToken2 = await getToken('JH', '校核人员', 'jd');
  if (jhToken2) token = jhToken2;

  const resp = await request('POST', '/api/review/annotation-states/apply', {
    formId,
    taskId,
    annotationId: 'anno-test-001',
    annotationType: 'text',
    action: 'agree',
    note: '同意',
  });
  assert('HTTP 200', resp.status === 200);
  assert('apply 成功', resp.body.success === true);
  const state = resp.body.state as JsonRecord | undefined;
  assert('decisionStatus=agreed', state?.decisionStatus === 'agreed');
}

async function step10_checkShouldPass() {
  console.log('\n[10] annotation check (jd 节点, 全部 agreed 应通过)');
  const resp = await request('POST', '/api/review/annotations/check', {
    formId,
    taskId,
    currentNode: 'jd',
    intent: 'submit_next',
  });
  assert('HTTP 200', resp.status === 200);
  const data = resp.body.data as JsonRecord | undefined;
  assert('check passed=true', data?.passed === true, `got passed=${data?.passed}`);
}

async function step11_nonAuthorDelete() {
  console.log('\n[11] 非作者删除评论 → 应 403');
  const jhToken3 = await getToken('JH', '校核人员', 'jd');
  if (jhToken3) {
    const savedToken = token;
    token = jhToken3;
    const resp = await request('DELETE', `/api/review/comments/item/${encodeURIComponent(commentId)}`);
    assert('HTTP 403', resp.status === 403, `got ${resp.status}`);
    token = savedToken;
  } else {
    console.log('  ⚠ auth 处于 debug 模式，无法测试非作者删除权限，跳过');
  }
}

async function step12_authorDelete() {
  console.log('\n[12] 作者删除评论 → 应 200');
  const sjToken = await getToken('SJ', '设计人员', 'sj');
  if (sjToken) token = sjToken;

  const resp = await request('DELETE', `/api/review/comments/item/${encodeURIComponent(commentId)}`);
  assert('HTTP 200', resp.status === 200);
  assert('删除成功', resp.body.success === true);

  console.log('  验证软删后查询不返回');
  const queryResp = await request(
    'GET',
    `/api/review/comments/by-annotation/anno-test-001?type=text&form_id=${formId}`,
  );
  const comments = queryResp.body.comments as JsonRecord[] | undefined;
  assert('评论列表为空', Array.isArray(comments) && comments.length === 0, `got ${comments?.length ?? 'null'}`);
}

async function step13_commentIsolation() {
  console.log('\n[13] 两个 form 同 annotation_id 评论隔离');
  const formId2 = `CONTRACT-ANNO-ISO-${Date.now()}`;

  const createResp = await request('POST', '/api/review/comments', {
    annotationId: 'anno-test-001',
    annotationType: 'text',
    authorId: 'SJ',
    authorName: '设计人员',
    authorRole: 'designer',
    content: '第二张单据的评论',
    formId: formId2,
    taskId: 'fake-task-2',
  });
  assert('创建评论成功', createResp.body.success === true);

  const q1 = await request(
    'GET',
    `/api/review/comments/by-annotation/anno-test-001?type=text&form_id=${formId}`,
  );
  const q2 = await request(
    'GET',
    `/api/review/comments/by-annotation/anno-test-001?type=text&form_id=${formId2}`,
  );
  const c1 = (q1.body.comments as JsonRecord[]) || [];
  const c2 = (q2.body.comments as JsonRecord[]) || [];
  assert('form1 评论数=0（已删除）', c1.length === 0, `got ${c1.length}`);
  assert('form2 评论数=1', c2.length === 1, `got ${c2.length}`);
}

async function step14_cleanup() {
  console.log('\n[14] 清理测试数据');
  const resp = await request('DELETE', `/api/review/tasks/${encodeURIComponent(taskId)}`);
  assert('删除任务 HTTP 200', resp.status === 200);
}

async function main() {
  console.log(`\n━━━━ 批注状态独立真源 - HTTP 合同验证 ━━━━`);
  console.log(`  BASE: ${BASE}`);
  console.log(`  PROJECT: ${PROJECT_ID}`);

  try {
    await step1_getToken();
    await step2_createTask();
    await step3_saveRecord();
    await step4_queryStates();
    await step5_createComment();
    await step6_queryComments();
    await step7_applyFixed();
    await step8_checkShouldBlockJd();
    await step9_applyAgree();
    await step10_checkShouldPass();
    await step11_nonAuthorDelete();
    await step12_authorDelete();
    await step13_commentIsolation();
    await step14_cleanup();
  } catch (err) {
    console.error('\n❌ 脚本执行异常:', err);
    failed++;
  }

  console.log(`\n━━━━ 结果: ${passed} passed / ${failed} failed ━━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

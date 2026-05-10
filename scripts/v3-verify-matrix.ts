#!/usr/bin/env npx tsx
/**
 * v3 verify 矩阵专项验证
 *
 * 目标：在 plant-model-gen 的 web_server (默认 127.0.0.1:3100) 上，
 * 覆盖 v3 检查矩阵的全部组合，分别验证 verify "通过 / 不通过" 两种结果。
 *
 * 使用：
 *   npx tsx scripts/v3-verify-matrix.ts
 *   PLANT3D_API_BASE=http://127.0.0.1:3100 npx tsx scripts/v3-verify-matrix.ts
 *   PLANT3D_API_BASE=http://127.0.0.1:3100 npx tsx scripts/v3-verify-matrix.ts --verbose
 *
 * 矩阵设计（共 15 case）：
 *   组 A · sj 节点（直接创建后任务在 sj）
 *     A1 active · 无批注 → pass
 *     A2 active · 有 1 open 批注 → block "未处理批注"
 *     A3 active · 有 pending+approved+rejected（open=0） → pass
 *     A4 agree · 节点不匹配 → block "agree 仅允许在 jd/sh/pz"
 *     A5 stop · 节点不匹配 → block "stop 仅允许在 jd/sh/pz"
 *
 *   组 B · jd 节点（先 active 流转到 jd）
 *     B1 active · 节点不匹配 → block "active 仅允许从 sj"
 *     B2 agree · 0 批注 → pass
 *     B3 agree · 有 pending → block "待确认批注"
 *     B4 agree · 有 rejected → block recommend "return"
 *     B5 agree · 有 open → block
 *     B6 return · 0 批注 → block "无未处理或被驳回"
 *     B7 return · 全 approved → block "无问题不允许驳回"
 *     B8 return · 有 open → pass
 *     B9 return · 有 rejected → pass
 *     B10 stop · 任意状态 → pass（不查 annotation）
 */

const BASE = (process.env.PLANT3D_API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
const PROJECT_ID = process.env.PMS_CONTRACT_PROJECT_ID || 'AvevaMarineSample';
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

type JsonRecord = Record<string, unknown>;

let tokenCache: Record<string, string> = {};
let pass = 0;
let fail = 0;
const failures: string[] = [];

async function http(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; body: JsonRecord }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const url = `${BASE}${path}`;
  if (VERBOSE) console.error(`  → ${method} ${url}`);
  const resp = await fetch(url, opts);
  let json: JsonRecord;
  try {
    json = (await resp.json()) as JsonRecord;
  } catch {
    json = { _raw: await resp.text().catch(() => '(empty)') };
  }
  if (VERBOSE) console.error(`  ← ${resp.status} ${JSON.stringify(json).slice(0, 220)}`);
  return { status: resp.status, body: json };
}

async function getToken(userId: string, role: string): Promise<string> {
  const cacheKey = `${userId}:${role}`;
  if (tokenCache[cacheKey]) return tokenCache[cacheKey];
  const resp = await http('POST', '/api/auth/token', {
    project_id: PROJECT_ID,
    user_id: userId,
    user_name: userId,
    role,
  });
  const data = (resp.body.data as JsonRecord | undefined) || {};
  const token = (data.token as string) || (resp.body as { token?: string }).token || '';
  tokenCache[cacheKey] = token;
  return token;
}

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

type AnnotationSeed = {
  id: string;
  text?: string;
  resolutionStatus?: 'open' | 'fixed' | 'wont_fix' | null;
  decisionStatus?: 'pending' | 'agreed' | 'rejected' | null;
};

async function seedFormAndTask(formId: string, sjToken: string): Promise<{ taskId: string }> {
  const embed = await http(
    'POST',
    '/api/review/embed-url',
    { project_id: PROJECT_ID, user_id: 'SJ', workflow_role: 'sj', form_id: formId, token: sjToken },
    sjToken,
  );
  if (embed.status !== 200) throw new Error(`embed-url failed: ${embed.status}`);

  const taskResp = await http(
    'POST',
    '/api/review/tasks',
    {
      title: `v3-matrix ${formId}`,
      description: 'v3 verify matrix seed task',
      modelName: 'TestModel',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'SH',
      approverName: 'SH',
      reviewerId: 'JH',
      formId,
      components: [{ id: 'c1', refNo: 'REF-V3', name: 'demo', type: 'PIPE' }],
    },
    sjToken,
  );
  const task = taskResp.body.task as JsonRecord | undefined;
  const taskId = (task?.id as string) || '';
  if (!taskId) throw new Error(`create task failed: ${JSON.stringify(taskResp.body).slice(0, 200)}`);
  return { taskId };
}

async function seedAnnotations(
  taskId: string,
  formId: string,
  annotations: AnnotationSeed[],
  bearer: string,
): Promise<void> {
  if (annotations.length === 0) return;
  const seeded = annotations.map((a) => {
    const reviewState =
      a.resolutionStatus === undefined && a.decisionStatus === undefined
        ? null
        : {
            ...(a.resolutionStatus !== undefined ? { resolutionStatus: a.resolutionStatus } : {}),
            ...(a.decisionStatus !== undefined ? { decisionStatus: a.decisionStatus } : {}),
          };
    return {
      id: a.id,
      title: a.id,
      description: a.text || a.id,
      refnos: ['REF-V3'],
      ...(reviewState ? { reviewState } : {}),
    };
  });

  const resp = await http(
    'POST',
    '/api/review/records',
    {
      taskId,
      formId,
      type: 'batch',
      annotations: seeded,
      cloudAnnotations: [],
      rectAnnotations: [],
      obbAnnotations: [],
      measurements: [],
      note: 'v3 matrix seed',
    },
    bearer,
  );
  if (resp.body.success !== true) {
    throw new Error(`seed annotations failed: ${JSON.stringify(resp.body).slice(0, 200)}`);
  }
}

async function activateToJd(formId: string, sjToken: string): Promise<void> {
  const resp = await http(
    'POST',
    '/api/review/workflow/sync',
    {
      form_id: formId,
      token: sjToken,
      action: 'active',
      actor: { id: 'SJ', name: 'SJ', roles: 'sj' },
      next_step: { assignee_id: 'JH', name: 'JH', roles: 'jd' },
    },
    sjToken,
  );
  if (resp.status !== 200) {
    throw new Error(`sync(active) failed: HTTP ${resp.status} ${JSON.stringify(resp.body).slice(0, 200)}`);
  }
}

async function cleanup(formId: string, sjToken: string): Promise<void> {
  await http(
    'POST',
    '/api/review/delete',
    { form_ids: [formId], operator_id: 'SJ', token: sjToken },
    sjToken,
  ).catch(() => undefined);
}

type VerifyExpectation = {
  passed: boolean;
  recommendedAction?: 'proceed' | 'block' | 'return';
  reasonContains?: string;
};

async function verifyAndAssert(
  caseLabel: string,
  formId: string,
  token: string,
  action: 'active' | 'agree' | 'return' | 'stop',
  expect: VerifyExpectation,
): Promise<void> {
  const resp = await http(
    'POST',
    '/api/review/workflow/verify',
    { form_id: formId, token, action },
    token,
  );

  check(`${caseLabel} HTTP 200`, resp.status === 200, `got HTTP ${resp.status}`);
  const data = resp.body.data as JsonRecord | undefined;
  if (!data) {
    check(`${caseLabel} 有 data 字段`, false, JSON.stringify(resp.body).slice(0, 200));
    return;
  }
  check(`${caseLabel} passed=${expect.passed}`, data.passed === expect.passed, `got passed=${data.passed}`);
  check(`${caseLabel} action=${action}`, data.action === action, `got action=${data.action}`);
  if (expect.recommendedAction) {
    check(
      `${caseLabel} recommended_action=${expect.recommendedAction}`,
      data.recommended_action === expect.recommendedAction,
      `got ${data.recommended_action}`,
    );
  }
  if (expect.reasonContains) {
    const reason = String(data.reason || '');
    check(
      `${caseLabel} reason 含 "${expect.reasonContains}"`,
      reason.includes(expect.reasonContains),
      `got reason="${reason}"`,
    );
  }
}

// ============================================================================
// 测试用例
// ============================================================================

async function caseA1_active_sj_empty(): Promise<void> {
  const formId = `V3-A1-${Date.now()}`;
  console.log(`\n[A1] sj+active+无批注 → 期望 pass`);
  const sjToken = await getToken('SJ', 'sj');
  await seedFormAndTask(formId, sjToken);
  try {
    await verifyAndAssert('A1', formId, sjToken, 'active', { passed: true, recommendedAction: 'proceed' });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseA2_active_sj_with_open(): Promise<void> {
  const formId = `V3-A2-${Date.now()}`;
  console.log(`\n[A2] sj+active+1 条 open 批注 → 期望 block "未处理批注"`);
  const sjToken = await getToken('SJ', 'sj');
  const { taskId } = await seedFormAndTask(formId, sjToken);
  await seedAnnotations(taskId, formId, [{ id: 'a2-open' }], sjToken); // 不传 reviewState → Open
  try {
    await verifyAndAssert('A2', formId, sjToken, 'active', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: '未处理批注',
    });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseA3_active_sj_all_replied(): Promise<void> {
  const formId = `V3-A3-${Date.now()}`;
  console.log(`\n[A3] sj+active+pending+approved+rejected (open=0) → 期望 pass`);
  const sjToken = await getToken('SJ', 'sj');
  const { taskId } = await seedFormAndTask(formId, sjToken);
  await seedAnnotations(
    taskId,
    formId,
    [
      { id: 'a3-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
      { id: 'a3-approved', resolutionStatus: 'fixed', decisionStatus: 'agreed' },
      { id: 'a3-rejected', resolutionStatus: 'fixed', decisionStatus: 'rejected' },
    ],
    sjToken,
  );
  try {
    await verifyAndAssert('A3', formId, sjToken, 'active', { passed: true, recommendedAction: 'proceed' });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseA4_agree_on_sj_node(): Promise<void> {
  const formId = `V3-A4-${Date.now()}`;
  console.log(`\n[A4] sj 节点 + agree → 期望 block "agree 仅允许在 jd/sh/pz"`);
  const sjToken = await getToken('SJ', 'sj');
  await seedFormAndTask(formId, sjToken);
  try {
    await verifyAndAssert('A4', formId, sjToken, 'agree', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: 'agree 仅允许在 jd/sh/pz',
    });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseA5_stop_on_sj_node(): Promise<void> {
  const formId = `V3-A5-${Date.now()}`;
  console.log(`\n[A5] sj 节点 + stop → 期望 block "stop 仅允许在 jd/sh/pz"`);
  const sjToken = await getToken('SJ', 'sj');
  await seedFormAndTask(formId, sjToken);
  try {
    await verifyAndAssert('A5', formId, sjToken, 'stop', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: 'stop 仅允许在 jd/sh/pz',
    });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function setupJdTask(formId: string, annotations: AnnotationSeed[]): Promise<string> {
  const sjToken = await getToken('SJ', 'sj');
  const { taskId } = await seedFormAndTask(formId, sjToken);
  if (annotations.length > 0) {
    await seedAnnotations(taskId, formId, annotations, sjToken);
  }
  // 必须先把 active 推到 jd，否则任务在 sj
  // 注意：active 也走 v3 annotation 门，所以这里 seed 的批注必须 open=0
  // 我们专门在 caseB* 里调用 setupJdTask 时，seed 的批注都是已回复过的（不会有 open）
  await activateToJd(formId, sjToken);
  return taskId;
}

async function caseB1_active_on_jd_node(): Promise<void> {
  const formId = `V3-B1-${Date.now()}`;
  console.log(`\n[B1] jd 节点 + active → 期望 block "active 仅允许从 sj"`);
  await setupJdTask(formId, [
    { id: 'b1-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' }, // 让 sj→jd active 通过
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B1', formId, jhToken, 'active', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: 'active 仅允许从 sj',
    });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB2_agree_jd_empty(): Promise<void> {
  const formId = `V3-B2-${Date.now()}`;
  console.log(`\n[B2] jd 节点 + agree + 0 批注 → 期望 pass`);
  // setupJdTask 不传批注，但 active 跑到 jd 时也要批注 open=0；空批注满足
  await setupJdTask(formId, []);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B2', formId, jhToken, 'agree', { passed: true, recommendedAction: 'proceed' });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB3_agree_jd_pending(): Promise<void> {
  const formId = `V3-B3-${Date.now()}`;
  console.log(`\n[B3] jd 节点 + agree + 1 pending → 期望 block "待确认批注"`);
  await setupJdTask(formId, [
    { id: 'b3-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B3', formId, jhToken, 'agree', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: '待确认批注',
    });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB4_agree_jd_rejected(): Promise<void> {
  const formId = `V3-B4-${Date.now()}`;
  console.log(`\n[B4] jd 节点 + agree + 1 rejected → 期望 recommend "return"`);
  await setupJdTask(formId, [
    { id: 'b4-rejected', resolutionStatus: 'fixed', decisionStatus: 'rejected' },
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B4', formId, jhToken, 'agree', {
      passed: false,
      recommendedAction: 'return',
      reasonContains: '已驳回',
    });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB5_agree_jd_open(): Promise<void> {
  const formId = `V3-B5-${Date.now()}`;
  console.log(`\n[B5] jd 节点 + agree + 1 open → 期望 block`);
  // 这里 trick：sj→jd active 时不能有 open，所以要先用一个 pending seed 跑过 active，再二次 seed 一条 open
  const sjToken = await getToken('SJ', 'sj');
  const { taskId } = await seedFormAndTask(formId, sjToken);
  await seedAnnotations(taskId, formId, [
    { id: 'b5-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
  ], sjToken);
  await activateToJd(formId, sjToken);
  // 此时任务在 jd，再追加一条 open 批注（jd 加新批注是常见场景）
  const jhToken = await getToken('JH', 'jd');
  await seedAnnotations(taskId, formId, [
    { id: 'b5-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
    { id: 'b5-open' }, // 新追加的 open 批注
  ], jhToken);
  try {
    await verifyAndAssert('B5', formId, jhToken, 'agree', {
      passed: false,
      recommendedAction: 'block',
    });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseB6_return_jd_empty(): Promise<void> {
  const formId = `V3-B6-${Date.now()}`;
  console.log(`\n[B6] jd 节点 + return + 0 批注 → 期望 block "无未处理或被驳回"`);
  await setupJdTask(formId, []);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B6', formId, jhToken, 'return', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: '不允许驳回',
    });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB7_return_jd_only_approved(): Promise<void> {
  const formId = `V3-B7-${Date.now()}`;
  console.log(`\n[B7] jd 节点 + return + 全 approved → 期望 block "无问题不允许驳回"`);
  await setupJdTask(formId, [
    { id: 'b7-approved', resolutionStatus: 'fixed', decisionStatus: 'agreed' },
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B7', formId, jhToken, 'return', {
      passed: false,
      recommendedAction: 'block',
      reasonContains: '不允许驳回',
    });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB8_return_jd_open(): Promise<void> {
  const formId = `V3-B8-${Date.now()}`;
  console.log(`\n[B8] jd 节点 + return + 1 open → 期望 pass`);
  const sjToken = await getToken('SJ', 'sj');
  const { taskId } = await seedFormAndTask(formId, sjToken);
  // 先满足 active 条件（pending）
  await seedAnnotations(taskId, formId, [
    { id: 'b8-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
  ], sjToken);
  await activateToJd(formId, sjToken);
  const jhToken = await getToken('JH', 'jd');
  // jd 追加 open 批注
  await seedAnnotations(taskId, formId, [
    { id: 'b8-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
    { id: 'b8-open' },
  ], jhToken);
  try {
    await verifyAndAssert('B8', formId, jhToken, 'return', { passed: true, recommendedAction: 'proceed' });
  } finally {
    await cleanup(formId, sjToken);
  }
}

async function caseB9_return_jd_rejected(): Promise<void> {
  const formId = `V3-B9-${Date.now()}`;
  console.log(`\n[B9] jd 节点 + return + 1 rejected → 期望 pass`);
  await setupJdTask(formId, [
    { id: 'b9-rejected', resolutionStatus: 'fixed', decisionStatus: 'rejected' },
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B9', formId, jhToken, 'return', { passed: true, recommendedAction: 'proceed' });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function caseB10_stop_jd_with_pending(): Promise<void> {
  const formId = `V3-B10-${Date.now()}`;
  console.log(`\n[B10] jd 节点 + stop + 有 pending → 期望 pass（stop 不查 annotation）`);
  await setupJdTask(formId, [
    { id: 'b10-pending', resolutionStatus: 'fixed', decisionStatus: 'pending' },
  ]);
  const jhToken = await getToken('JH', 'jd');
  try {
    await verifyAndAssert('B10', formId, jhToken, 'stop', { passed: true, recommendedAction: 'proceed' });
  } finally {
    const sjToken = await getToken('SJ', 'sj');
    await cleanup(formId, sjToken);
  }
}

async function main(): Promise<void> {
  console.log('━━━━ v3 verify 矩阵专项验证 ━━━━');
  console.log(`  BASE: ${BASE}`);
  console.log(`  PROJECT: ${PROJECT_ID}`);

  const cases = [
    caseA1_active_sj_empty,
    caseA2_active_sj_with_open,
    caseA3_active_sj_all_replied,
    caseA4_agree_on_sj_node,
    caseA5_stop_on_sj_node,
    caseB1_active_on_jd_node,
    caseB2_agree_jd_empty,
    caseB3_agree_jd_pending,
    caseB4_agree_jd_rejected,
    caseB5_agree_jd_open,
    caseB6_return_jd_empty,
    caseB7_return_jd_only_approved,
    caseB8_return_jd_open,
    caseB9_return_jd_rejected,
    caseB10_stop_jd_with_pending,
  ];

  for (const fn of cases) {
    try {
      await fn();
    } catch (err) {
      console.error(`  ✗ ${fn.name} 抛异常: ${err instanceof Error ? err.message : err}`);
      fail++;
      failures.push(`${fn.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n━━━━ 结果: ${pass} passed / ${fail} failed ━━━━`);
  if (failures.length > 0) {
    console.log('\n失败明细：');
    for (const item of failures) console.log(`  - ${item}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(2);
});

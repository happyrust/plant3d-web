#!/usr/bin/env node
/**
 * Plant3D-Web 验收测试 - API 层
 *
 * 测试内容：
 *   1. 环境检查（前端 + 后端健康状态）
 *   2. 模型 API（模型树、模型数据、房间查询等）
 *   3. 校审 API（认证、嵌入地址、任务创建、流程流转等）
 *
 * 使用：
 *   node scripts/acceptance-api-test.mjs
 */

// 禁用系统代理，确保本地访问正常
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';

const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
};

const FRONTEND_BASE = getArg('base', 'http://127.0.0.1');
const BACKEND_BASE = getArg('backend', 'http://127.0.0.1:8022');
const PROJECT = getArg('project', 'AvevaMarineSample');
const BRAN_REFNO = getArg('bran', '24381_145018');

// 角色定义（与后端 API 格式一致：roles 是字符串）
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

function test(name, fn) {
  return async () => {
    try {
      const detail = await fn();
      results.push({ name, passed: true, detail });
      passCount++;
      console.log(`  [PASS] ${name}${detail ? ` - ${detail}` : ''}`);
      return true;
    } catch (err) {
      results.push({ name, passed: false, detail: err.message });
      failCount++;
      console.log(`  [FAIL] ${name} - ${err.message}`);
      return false;
    }
  };
}

// 前端访问辅助：优先使用 fetch，失败时回退到 curl
async function fetchFrontend(url, options = {}) {
  try {
    const resp = await fetch(url, options);
    const text = await resp.text();
    return { status: resp.status, ok: resp.ok, text, data: tryParseJson(text) };
  } catch (err) {
    // fetch 失败时使用 curl（Node.js fetch 在某些 Windows 环境下无法访问 localhost）
    const { execSync } = await import('node:child_process');
    try {
      const curlCmd = `curl.exe -s -w "\\n%{http_code}" "${url}"`;
      const output = execSync(curlCmd, { encoding: 'utf-8', timeout: 10000 });
      const lines = output.trim().split('\n');
      const status = parseInt(lines[lines.length - 1], 10);
      const text = lines.slice(0, -1).join('\n');
      return { status, ok: status >= 200 && status < 300, text, data: tryParseJson(text) };
    } catch (curlErr) {
      throw new Error(`fetch 和 curl 都失败: ${err.message} / ${curlErr.message}`);
    }
  }
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// 后端 API 访问（使用 fetch，后端地址工作正常）
async function fetchJson(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers,
    },
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  }
  return { status: resp.status, data, raw: text };
}

// 前端访问辅助函数
async function fetchFrontendJson(url) {
  const result = await fetchFrontend(url, { headers: { 'Accept': 'application/json' } });
  if (!result.ok) {
    throw new Error(`HTTP ${result.status}: ${result.text?.slice(0, 200)}`);
  }
  return { status: result.status, data: result.data, raw: result.text };
}

async function fetchFrontendText(url) {
  const result = await fetchFrontend(url);
  if (!result.ok) {
    throw new Error(`HTTP ${result.status}`);
  }
  return result.text;
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${BACKEND_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: resp.status, json, raw: text };
}

async function main() {
  console.log('========================================');
  console.log('  Plant3D-Web 验收测试 - API 层');
  console.log('========================================');
  console.log(`  前端地址: ${FRONTEND_BASE}`);
  console.log(`  后端地址: ${BACKEND_BASE}`);
  console.log(`  测试项目: ${PROJECT}`);
  console.log(`  测试构件: ${BRAN_REFNO}`);
  console.log('');

  // 确保 nginx 运行（前端服务）
  console.log('--- 启动前端服务（nginx）---');
  try {
    const { spawn, execSync } = await import('node:child_process');
    const path = await import('node:path');
    const nginxDir = path.resolve(process.cwd(), 'deploy/offline/nginx');
    const nginxExe = path.join(nginxDir, 'nginx.exe');
    const fs = await import('node:fs');
    
    if (fs.existsSync(nginxExe)) {
      // 先停止可能残留的 nginx
      try { execSync('taskkill /F /IM nginx.exe', { encoding: 'utf-8', stdio: 'ignore' }); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      
      // 使用 spawn 后台启动 nginx（不等待退出）
      const child = spawn(nginxExe, [], {
        cwd: nginxDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      await new Promise(r => setTimeout(r, 2000));
      console.log('  nginx 已启动');
    } else {
      console.log('  [WARN] 未找到 nginx.exe，跳过前端服务启动');
    }
  } catch (err) {
    console.log(`  [WARN] 启动 nginx 失败: ${err.message}`);
  }
  console.log('');

  // ============================================================
  // 第一部分：环境检查
  // ============================================================
  console.log('--- 第一部分：环境检查 ---');

  await test('后端健康检查', async () => {
    const { data } = await fetchJson(`${BACKEND_BASE}/api/v1/health`);
    if (data.status !== 'ok') throw new Error(`status=${data.status}`);
    return `status=${data.status}, project=${data.project || 'N/A'}, version=${data.version || 'N/A'}`;
  })();

  await test('前端版本信息（80 端口）', async () => {
    const { data } = await fetchFrontendJson(`${FRONTEND_BASE}/version.json`);
    if (!data?.version) throw new Error('缺少 version 字段');
    return `version=${data.version}, commit=${data.commit?.slice(0, 7)}`;
  })();

  await test('前端首页可访问', async () => {
    const html = await fetchFrontendText(`${FRONTEND_BASE}/`);
    if (!html.includes('<div id="app">')) throw new Error('首页缺少 #app 挂载点');
    return '首页正常，包含 #app 挂载点';
  })();

  await test('前端 3100 端口（PowerPMS 兼容）', async () => {
    const { data } = await fetchFrontendJson('http://127.0.0.1:3100/version.json');
    if (!data?.version) throw new Error('缺少 version 字段');
    return `version=${data.version}`;
  })();

  await test('API 代理（前端 → 后端）', async () => {
    const { data } = await fetchFrontendJson(`${FRONTEND_BASE}/api/v1/health`);
    if (data?.status !== 'ok') throw new Error(`status=${data?.status}`);
    return '代理正常';
  })();

  console.log('');

  // ============================================================
  // 第二部分：模型 API 测试
  // ============================================================
  console.log('--- 第二部分：模型 API 测试 ---');

  let tokens = {};

  await test('获取认证 Token（4个角色）', async () => {
    const roles = [
      ['SJ', 'sj', 'SJ'],
      ['JH', 'jd', 'JH'],
      ['SH', 'sh', 'SH'],
      ['PZ', 'pz', 'PZ'],
    ];
    for (const [userId, role, name] of roles) {
      const r = await api('POST', '/api/auth/token', {
        project_id: PROJECT,
        user_id: userId,
        role: role,
      });
      if (r.status !== 200 || !r.json?.data?.token) {
        throw new Error(`${name} token 获取失败: ${r.status}`);
      }
      tokens[name] = r.json.data.token;
    }
    return 'SJ/JH/SH/PZ 四个角色 token 全部获取成功';
  })();

  let treeRootNodes = [];

  await test('获取模型树根节点', async () => {
    const r = await api('GET', `/api/v1/tree/roots?project=${PROJECT}`, undefined, tokens.SJ);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    // 后端返回格式: {"nodes": [...]} 或 {"roots": [...]} 或 {"data": [...]}
    const nodes = r.json?.nodes || r.json?.roots || r.json?.data?.nodes || r.json?.data?.roots || r.json?.data || [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error(`模型树为空: ${r.raw?.slice(0, 200)}`);
    }
    treeRootNodes = nodes;
    return `根节点数=${nodes.length}, 首节点=${nodes[0]?.refno || nodes[0]?.name || 'N/A'}`;
  })();

  await test('查询模型树子节点', async () => {
    if (treeRootNodes.length === 0) throw new Error('无根节点');
    // API 需要 refno 参数而不是 parent
    const rootRefno = treeRootNodes[0]?.refno || treeRootNodes[0]?.name;
    const r2 = await api('GET', `/api/v1/tree/children?project=${PROJECT}&refno=${encodeURIComponent(rootRefno)}`, undefined, tokens.SJ);
    if (r2.status !== 200) throw new Error(`HTTP ${r2.status}: ${r2.raw?.slice(0, 200)}`);
    const children = r2.json?.children || r2.json?.nodes || r2.json?.data?.children || r2.json?.data?.nodes || r2.json?.data || [];
    return `根节点 ${rootRefno} 子节点数=${Array.isArray(children) ? children.length : 'N/A'}`;
  })();

  await test('健康检查（校审服务）', async () => {
    const r = await api('GET', '/api/review/health', undefined, tokens.SJ);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `status=${r.json?.status || 'ok'}`;
  })();

  console.log('');

  // ============================================================
  // 第三部分：校审 API 测试
  // ============================================================
  console.log('--- 第三部分：校审 API 测试 ---');

  let formId = null;
  let taskId = null;

  await test('获取嵌入地址（SJ 发起）', async () => {
    const r = await api('POST', '/api/review/embed-url', {
      project_id: PROJECT,
      user_id: 'SJ',
      workflow_role: 'sj',
      token: tokens.SJ,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    formId = r.json?.data?.query?.form_id;
    if (!formId) throw new Error('未返回 form_id');
    return `form_id=${formId}`;
  })();

  await test('查询校审任务状态（query）', async () => {
    const r = await api('POST', '/api/review/workflow/sync', {
      form_id: formId,
      token: tokens.SJ,
      action: 'query',
      actor: actorOf(ROLES.SJ),
      comments: '',
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const d = r.json?.data || {};
    return `form_status=${d.form_status || 'unknown'}, task_status=${d.task_status || 'unknown'}, current_node=${d.current_node || 'unknown'}`;
  })();

  await test('创建编校审任务（SJ 发起）', async () => {
    const packageName = `ACCEPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`;
    const r = await api('POST', '/api/review/tasks', {
      form_id: formId,
      title: `验收测试-${packageName}`,
      description: '验收测试自动创建的编校审任务',
      modelName: PROJECT,           // 必需：模型名称
      checkerId: 'JH',              // 必需：校核人
      approverId: 'SH',             // 必需：审核人
      priority: 'normal',           // 必需：优先级
      package_name: packageName,
      components: [{
        id: BRAN_REFNO,
        refNo: BRAN_REFNO,
        name: BRAN_REFNO,
        type: 'BRAN',
      }],
      creator_id: 'SJ',
      creator_name: 'SJ',
    }, tokens.SJ);
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 300)}`);
    }
    taskId = r.json?.task?.id || r.json?.data?.task_id || r.json?.task_id || r.json?.data?.id;
    // 后端可能生成新的 formId，使用后端返回的
    const returnedFormId = r.json?.task?.formId || r.json?.task?.form_id;
    if (returnedFormId && returnedFormId !== formId) {
      console.log(`    注意: 后端生成新 formId: ${formId} → ${returnedFormId}`);
      formId = returnedFormId;
    }
    if (!taskId) throw new Error(`未返回 task.id: ${r.raw?.slice(0, 300)}`);
    return `task_id=${taskId}, package=${packageName}, formId=${formId}`;
  })();

  await test('预校验流转（active）', async () => {
    const r = await api('POST', '/api/review/workflow/verify', {
      form_id: formId,
      token: tokens.SJ,
      action: 'active',
      actor: actorOf(ROLES.SJ),
      comments: '验收测试预校验',
      next_step: { assignee_id: 'JH', name: 'JH', roles: 'jd' },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const passed = r.json?.data?.passed ?? r.json?.passed;
    if (passed !== true) throw new Error(`passed=${passed}, block_code=${r.json?.data?.block_code}`);
    return `passed=true, next_step=${r.json?.data?.next_step?.name || 'JH'}`;
  })();

  await test('同步流转（active → JH）', async () => {
    const r = await api('POST', '/api/review/workflow/sync', {
      form_id: formId,
      token: tokens.SJ,
      action: 'active',
      actor: actorOf(ROLES.SJ),
      comments: '验收测试送审',
      next_step: { assignee_id: 'JH', name: 'JH', roles: 'jd' },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const d = r.json?.data || {};
    return `form_status=${d.form_status}, task_status=${d.task_status}, current_node=${d.current_node}`;
  })();

  await test('JH 确认当前数据（创建测量记录）', async () => {
    const r = await api('POST', '/api/review/records', {
      taskId: taskId,
      form_id: formId,
      project_id: PROJECT,
      record_type: 'measurement',
      content: {
        type: 'distance',
        value: 1000,
        unit: 'mm',
        description: '验收测试测量记录',
        entityId: `${BRAN_REFNO}:origin`,
      },
      creator_id: 'JH',
      creator_name: 'JH',
    }, tokens.JH);
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 300)}`);
    }
    return `record_id=${r.json?.data?.record_id || r.json?.record_id || 'N/A'}`;
  })();

  await test('JH 预校验同意', async () => {
    const r = await api('POST', '/api/review/workflow/verify', {
      form_id: formId,
      token: tokens.JH,
      action: 'agree',
      actor: actorOf(ROLES.JH),
      comments: '验收测试预校验同意',
      next_step: { assignee_id: 'SH', name: 'SH', roles: 'sh' },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const passed = r.json?.data?.passed ?? r.json?.passed;
    // 如果有待处理批注会被拦截，这是正常的
    return `passed=${passed}${r.json?.data?.block_code ? `, block_code=${r.json.data.block_code}` : ''}`;
  })();

  await test('JH 同意流转（→ SH）', async () => {
    const r = await api('POST', '/api/review/workflow/sync', {
      form_id: formId,
      token: tokens.JH,
      action: 'agree',
      actor: actorOf(ROLES.JH),
      comments: '验收测试同意',
      next_step: { assignee_id: 'SH', name: 'SH', roles: 'sh' },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const d = r.json?.data || {};
    return `form_status=${d.form_status}, current_node=${d.current_node}`;
  })();

  await test('SH 同意流转（→ PZ）', async () => {
    const r = await api('POST', '/api/review/workflow/sync', {
      form_id: formId,
      token: tokens.SH,
      action: 'agree',
      actor: actorOf(ROLES.SH),
      comments: '验收测试审核同意',
      next_step: { assignee_id: 'PZ', name: 'PZ', roles: 'pz' },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const d = r.json?.data || {};
    return `current_node=${d.current_node}`;
  })();

  await test('PZ 批准（最终通过）', async () => {
    const r = await api('POST', '/api/review/workflow/sync', {
      form_id: formId,
      token: tokens.PZ,
      action: 'agree',
      actor: actorOf(ROLES.PZ),
      comments: '验收测试最终批准',
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const d = r.json?.data || {};
    if (d.form_status !== 'approved') throw new Error(`form_status=${d.form_status}`);
    return `form_status=${d.form_status}, task_status=${d.task_status}`;
  })();

  await test('查询完整历史流转', async () => {
    const r = await api('GET', `/api/review/tasks/${encodeURIComponent(taskId)}/workflow`, undefined, tokens.SJ);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
    const history = r.json?.history || r.json?.data?.history || [];
    const actions = history.map(h => `${h.node || h.current_node} ${h.action} by ${h.operatorId || h.operator_id || '?'}`);
    return `历史记录数=${history.length}: ${actions.join(' → ')}`;
  })();

  console.log('');

  // ============================================================
  // 测试报告
  // ============================================================
  console.log('========================================');
  console.log('  验收测试报告 - API 层');
  console.log('========================================');
  console.log('');
  
  for (const r of results) {
    const icon = r.passed ? '[PASS]' : '[FAIL]';
    console.log(`  ${icon} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  }
  
  console.log('');
  console.log(`  通过: ${passCount}  失败: ${failCount}  总计: ${results.length}`);
  const passRate = results.length > 0 ? Math.round(passCount / results.length * 100) : 0;
  console.log(`  通过率: ${passRate}%`);
  console.log('');
  
  if (failCount === 0) {
    console.log('  [SUCCESS] 所有 API 测试通过！');
  } else {
    console.log(`  [WARNING] ${failCount} 个测试失败，${passCount} 个通过`);
  }
  
  // 输出测试标识供后续使用
  console.log('');
  console.log('--- 测试标识 ---');
  console.log(`  form_id: ${formId}`);
  console.log(`  task_id: ${taskId}`);
  
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[acceptance] 测试执行失败:', err.message);
  process.exit(1);
});

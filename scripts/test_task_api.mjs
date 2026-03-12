#!/usr/bin/env node
/**
 * API 测试脚本：模拟任务创建、启动、状态轮询
 * 
 * 用法：
 *   node scripts/test_task_api.mjs                    # 运行全部测试
 *   node scripts/test_task_api.mjs --parse             # 仅测试数据解析任务
 *   node scripts/test_task_api.mjs --gen               # 仅测试模型生成任务
 *   node scripts/test_task_api.mjs --base http://localhost:8080  # 指定后端地址
 * 
 * 前提：后端 gen_model-dev web_server 已启动
 */

const args = process.argv.slice(2);
const BASE_URL = args.find(a => a.startsWith('http')) 
  || args[args.indexOf('--base') + 1] 
  || 'http://localhost:8080';

const runParse = args.includes('--parse') || (!args.includes('--gen'));
const runGen = args.includes('--gen') || (!args.includes('--parse'));

// ============ 工具函数 ============

async function fetchJson(path, init) {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(prefix, msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${prefix} ${msg}`);
}

// ============ Step 1: 获取服务器配置 ============

async function getConfig() {
  log('CONFIG', '获取服务器当前配置...');
  try {
    const config = await fetchJson('/api/config');
    log('CONFIG', `项目: ${config.project_name} | 路径: ${config.project_path}`);
    log('CONFIG', `数据库: ${config.db_ip}:${config.db_port} (ns=${config.surreal_ns})`);
    return config;
  } catch (e) {
    log('CONFIG', `⚠ 获取配置失败: ${e.message}，使用默认值`);
    return null;
  }
}

// ============ Step 2: 创建任务 ============

async function createTask(name, taskType, config, overrides = {}) {
  log('CREATE', `创建任务: "${name}" (${taskType})`);
  const request = {
    name,
    task_type: taskType,
    config: { ...config, name, ...overrides },
  };

  const resp = await fetchJson('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(request),
  });

  if (resp.success && resp.taskId) {
    log('CREATE', `✅ 任务创建成功, ID: ${resp.taskId}`);
    return resp.taskId;
  } else {
    throw new Error(`创建失败: ${JSON.stringify(resp)}`);
  }
}

// ============ Step 3: 启动任务 ============

async function startTask(taskId) {
  log('START', `启动任务 ${taskId}...`);
  const resp = await fetchJson(`/api/tasks/${taskId}/start`, { method: 'POST' });
  if (resp.success) {
    log('START', '✅ 任务已启动');
  } else {
    log('START', `⚠ 启动响应: ${JSON.stringify(resp)}`);
  }
  return resp;
}

// ============ Step 4: 轮询状态 ============

async function pollTaskStatus(taskId, maxWaitSec = 30) {
  log('POLL', `开始轮询任务状态 (最长 ${maxWaitSec}s)...`);
  const startTime = Date.now();

  while (true) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > maxWaitSec) {
      log('POLL', `⏰ 轮询超时 (${maxWaitSec}s)，任务可能仍在运行`);
      return 'timeout';
    }

    try {
      const resp = await fetchJson(`/api/tasks/${taskId}`);
      const task = resp.task || resp;
      const status = task.status || 'unknown';
      const progress = task.progress;
      const pct = typeof progress === 'object' ? progress.percentage : progress;
      const step = typeof progress === 'object' ? progress.current_step : '';

      const statusLine = step 
        ? `状态: ${status} | 进度: ${pct?.toFixed(1)}% | 步骤: ${step}`
        : `状态: ${status} | 进度: ${pct?.toFixed(1)}%`;
      log('POLL', statusLine);

      if (['Completed', 'completed', 'Failed', 'failed', 'Cancelled', 'cancelled'].includes(status)) {
        if (status.toLowerCase() === 'completed') {
          log('POLL', '✅ 任务完成！');
        } else if (status.toLowerCase() === 'failed') {
          log('POLL', `❌ 任务失败: ${task.error || '未知错误'}`);
        } else {
          log('POLL', '⚠ 任务已取消');
        }
        return status.toLowerCase();
      }
    } catch (e) {
      log('POLL', `⚠ 查询失败: ${e.message}`);
    }

    await sleep(3000);
  }
}

// ============ Step 5: 获取任务列表 ============

async function listTasks() {
  log('LIST', '获取当前任务列表...');
  try {
    const resp = await fetchJson('/api/tasks');
    const tasks = resp.tasks || [];
    log('LIST', `共 ${tasks.length} 个任务:`);
    for (const t of tasks.slice(0, 10)) {
      const name = t.name || t.task_name || 'unnamed';
      const status = t.status || 'unknown';
      const type = t.task_type || t.type || 'unknown';
      log('LIST', `  - [${status}] ${name} (${type})`);
    }
  } catch (e) {
    log('LIST', `⚠ 获取列表失败: ${e.message}`);
  }
}

// ============ 测试流程 ============

async function testDataParsingTask(serverConfig) {
  console.log('\n' + '='.repeat(60));
  log('TEST', '📋 测试 1: 数据解析任务 (DataParsingWizard)');
  console.log('='.repeat(60));

  const cfg = serverConfig || {};
  const config = {
    manual_db_nums: [],
    manual_refnos: [],
    project_name: cfg.project_name || 'AvevaMarineSample',
    project_path: cfg.project_path || '',
    project_code: cfg.project_code || 1516,
    mdb_name: cfg.mdb_name || 'ALL',
    module: cfg.module || 'DESI',
    db_type: cfg.db_type || 'surrealdb',
    surreal_ns: cfg.surreal_ns || 1516,
    db_ip: cfg.db_ip || 'localhost',
    db_port: cfg.db_port || '8020',
    db_user: cfg.db_user || 'root',
    db_password: cfg.db_password || 'root',
    gen_model: true,
    gen_mesh: false,
    gen_spatial_tree: true,
    apply_boolean_operation: true,
    mesh_tol_ratio: 3.0,
    room_keyword: cfg.room_keyword || '-RM',
  };

  const taskName = `API测试-数据解析-${Date.now()}`;
  const taskId = await createTask(taskName, 'DataParsingWizard', config);
  await startTask(taskId);
  const finalStatus = await pollTaskStatus(taskId, 30);
  return { taskId, status: finalStatus };
}

async function testModelGenerationTask(serverConfig) {
  console.log('\n' + '='.repeat(60));
  log('TEST', '📋 测试 2: 模型生成任务 (DataGeneration)');
  console.log('='.repeat(60));

  const cfg = serverConfig || {};
  const config = {
    manual_db_nums: [],
    manual_refnos: [],
    project_name: cfg.project_name || 'AvevaMarineSample',
    project_path: cfg.project_path || '',
    project_code: cfg.project_code || 1516,
    mdb_name: cfg.mdb_name || 'ALL',
    module: cfg.module || 'DESI',
    db_type: cfg.db_type || 'surrealdb',
    surreal_ns: cfg.surreal_ns || 1516,
    db_ip: cfg.db_ip || 'localhost',
    db_port: cfg.db_port || '8020',
    db_user: cfg.db_user || 'root',
    db_password: cfg.db_password || 'root',
    gen_model: true,
    gen_mesh: true,
    gen_spatial_tree: false,
    apply_boolean_operation: false,
    mesh_tol_ratio: 3.0,
    room_keyword: cfg.room_keyword || '-RM',
  };

  const taskName = `API测试-模型生成-${Date.now()}`;
  const taskId = await createTask(taskName, 'DataGeneration', config);
  await startTask(taskId);
  const finalStatus = await pollTaskStatus(taskId, 30);
  return { taskId, status: finalStatus };
}

// ============ 主入口 ============

async function main() {
  console.log('='.repeat(60));
  log('MAIN', '🚀 任务 API 测试脚本');
  log('MAIN', `后端地址: ${BASE_URL}`);
  console.log('='.repeat(60));

  // 获取服务器配置
  const serverConfig = await getConfig();

  // 显示当前任务列表
  await listTasks();

  const results = [];

  // 测试 1: 数据解析任务
  if (runParse) {
    try {
      const r = await testDataParsingTask(serverConfig);
      results.push({ test: '数据解析', ...r });
    } catch (e) {
      log('ERROR', `数据解析测试失败: ${e.message}`);
      results.push({ test: '数据解析', status: 'error', error: e.message });
    }
  }

  // 测试 2: 模型生成任务
  if (runGen) {
    try {
      const r = await testModelGenerationTask(serverConfig);
      results.push({ test: '模型生成', ...r });
    } catch (e) {
      log('ERROR', `模型生成测试失败: ${e.message}`);
      results.push({ test: '模型生成', status: 'error', error: e.message });
    }
  }

  // 最终任务列表
  console.log('\n');
  await listTasks();

  // 汇总
  console.log('\n' + '='.repeat(60));
  log('MAIN', '📊 测试结果汇总:');
  for (const r of results) {
    const icon = r.status === 'completed' ? '✅' : r.status === 'timeout' ? '⏰' : '❌';
    log('MAIN', `  ${icon} ${r.test}: ${r.status}${r.taskId ? ` (ID: ${r.taskId})` : ''}`);
  }
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('脚本执行失败:', e);
  process.exit(1);
});

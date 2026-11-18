// 沙箱后端（127.0.0.1:9199）的只读小工具：树、模型记录、库水位、任务。
// 用法：node sbx.mjs tree <refno> [深度] | records <refno> | dbnums [库号…] | status <refno> | tasks [条数] | health
const BASE = process.env.SBX_BASE ?? 'http://127.0.0.1:9199';

export async function getJson(path) {
  const response = await fetch(`${BASE}${path}`);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

export async function postJson(path, payload) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

export const slash = (refno) => String(refno).replace('_', '/');

export async function children(refno) {
  const { status, body } = await getJson(`/api/v1/tree/children?refno=${encodeURIComponent(slash(refno))}`);
  if (status !== 200) return { status, nodes: null, error: body };
  return { status, nodes: body.nodes ?? [] };
}

/** 以一个节点为祖先分页读完 model/records；回 { status, items }。 */
export async function records(refno) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    const payload = { generation_root: slash(refno), limit: 5000 };
    if (cursor !== null) payload.cursor = cursor;
    const { status, body } = await postJson('/api/v1/model/records', payload);
    if (status !== 200) return { status, items, error: body };
    items.push(...(body.items ?? body.records ?? []));
    cursor = body.next_cursor ?? null;
    if (cursor === null) return { status, items, raw: page === 0 ? body : undefined };
  }
  return { status: 0, items, error: '翻页太多' };
}

export async function dbnumRows(wanted) {
  const { body } = await getJson('/api/v1/dbnums');
  const rows = body.dbnums ?? [];
  return wanted && wanted.length ? rows.filter((row) => wanted.includes(row.dbnum)) : rows;
}

async function printTree(refno, depth, indent = '') {
  const { status, nodes, error } = await children(refno);
  if (!nodes) { console.log(`${indent}[${status}] ${JSON.stringify(error).slice(0, 200)}`); return; }
  for (const node of nodes) {
    console.log(`${indent}${node.noun} ${node.name} ${slash(node.refno)} 子 ${node.children_count}`);
    if (depth > 1 && node.children_count > 0) await printTree(node.refno, depth - 1, `${indent}  `);
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'tree') await printTree(rest[0], Number(rest[1] ?? 1));
  else if (command === 'records') {
    const result = await records(rest[0]);
    console.log(`[${result.status}] ${result.items.length} 条`);
    if (result.raw) console.log('回包的键：', Object.keys(result.raw).join(','));
    if (result.items[0]) console.log('第一条：', JSON.stringify(result.items[0]).slice(0, 900));
    const byOwner = new Map();
    for (const item of result.items) {
      const key = item.owner_refno ?? item.owner ?? '?';
      byOwner.set(key, (byOwner.get(key) ?? 0) + 1);
    }
    console.log('按生成根：', [...byOwner].map(([key, count]) => `${key}×${count}`).join(' '));
    if (result.error) console.log('错误：', JSON.stringify(result.error).slice(0, 300));
  } else if (command === 'dbnums') {
    for (const row of await dbnumRows(rest.map(Number))) {
      console.log(`${row.dbnum} 文件 ${row.file_latest_sesno} 数据 ${row.applied_sesno} 模型 ${row.model_sesno} 初始化 ${row.initialized} 排除 ${row.excluded}${row.excluded ? `（${row.excluded_reason}）` : ''} ${row.model_verdict ?? ''} 源 ${row.model_source ?? ''}`);
    }
  } else if (command === 'status') {
    const { status, body } = await getJson(`/api/v1/node/model-status?refno=${encodeURIComponent(slash(rest[0]))}`);
    console.log(`[${status}] ${JSON.stringify(body).slice(0, 1200)}`);
  } else if (command === 'tasks') {
    const { status, body } = await getJson(`/api/v1/tasks?limit=${Number(rest[0] ?? 10)}`);
    console.log(`[${status}] 键：${typeof body === 'object' ? Object.keys(body).join(',') : ''}`);
    for (const task of (body.tasks ?? body.items ?? []).slice(0, Number(rest[0] ?? 10))) console.log(JSON.stringify(task).slice(0, 700));
  } else if (command === 'health') {
    const { body } = await getJson('/api/v1/health');
    console.log(JSON.stringify({ status: body.status, started_at: body.started_at, version: body.version, build_id: body.build_id, watch_dbnums: body.watch_dbnums, sul_db: body.sul_db, project: body.project }, null, 1));
  } else {
    console.log('用法：node sbx.mjs tree <refno> [深度] | records <refno> | dbnums [库号…] | status <refno> | tasks [条数] | health');
  }
}

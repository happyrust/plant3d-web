/**
 * 隔离后端的只读接口：模型树、模型记录、库水位、等后端跟上；外加按后端在存盘前后的差算「取最新」回执该是什么数
 * （规格 W2：预期用后端接口在存盘前后的差算，不取页面自己的说法）。
 *
 * 脚本自己问后端只走这里。地址必须是本机回环、端口不能是 8022 / 8009；只发 GET 和 `POST /api/v1/model/records`
 * （只读的翻页查询），别的一律抛错、不发出去。
 */
import { LIVE_PORTS, refnoKey } from './judge.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `a_b` → 后端接口用的 `a/b` */
export function slashRefno(refno) {
  return refnoKey(refno).replace('_', '/');
}

/**
 * 核对一个地址是不是「本机回环上的、不是现网端口的」http 地址：是就回它的 origin，不是就抛错。
 * 页面服务和隔离后端的地址都过这一关。
 */
export function loopbackOrigin(address, what = '地址') {
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error(`${what}不是地址：${address}`);
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
    throw new Error(`${what}必须是 http://127.0.0.1:<端口>：${address}`);
  }
  if (LIVE_PORTS.includes(Number(url.port))) {
    throw new Error(`${what}指向现网端口 ${url.port}，不连`);
  }
  return url.origin;
}

/** 平移、四元数（先归一）、缩放合成一个列主序 4×4，和 three.js 的 `Matrix4.compose` 同一条公式 */
export function composeMatrix(transform) {
  const t = transform ?? {};
  const [px, py, pz] = t.translation ?? [0, 0, 0];
  const [sx, sy, sz] = t.scale ?? [1, 1, 1];
  let [x, y, z, w] = t.rotation ?? [0, 0, 0, 1];
  const length = Math.hypot(x, y, z, w);
  if (length === 0) {
    [x, y, z, w] = [0, 0, 0, 1];
  } else {
    [x, y, z, w] = [x / length, y / length, z / length, w / length];
  }
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    px, py, pz, 1,
  ];
}

/** 列主序 4×4 相乘：a × b */
export function multiplyMatrices(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * 一条模型记录的几何实例：世界矩阵是 `compose(world_trans) × compose(inst.transform)`（与前端装载时同一条公式）；
 * 没有几何（`geo_hash` 为空）的实例不算。
 */
export function recordInstances(item) {
  const out = [];
  for (const inst of item.insts ?? []) {
    const geo = String(inst.geo_hash ?? '').trim();
    if (!geo) continue;
    out.push({ geo, m: multiplyMatrices(composeMatrix(item.world_trans), composeMatrix(inst.transform)) });
  }
  return out;
}

export function libraryBrief(row) {
  if (!row) return null;
  return {
    dbnum: row.dbnum,
    file: row.file_latest_sesno ?? null,
    applied: row.applied_sesno ?? null,
    model: row.model_sesno ?? null,
    initialized: row.initialized ?? null,
    excluded: row.excluded ?? null,
    excludedReason: row.excluded_reason ?? null,
    verdict: row.model_verdict ?? null,
  };
}

const READ_ONLY_POSTS = new Set(['/api/v1/model/records']);
const RECORDS_PAGE = 5000;
const RECORDS_MAX_PAGES = 100;

function messageOf(body) {
  if (body !== null && typeof body === 'object') return body.message ?? null;
  return String(body).slice(0, 200);
}

/**
 * @param {string} address 隔离后端的地址（`http://127.0.0.1:<端口>`）
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createBackend(address, { fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  const origin = loopbackOrigin(address, '隔离后端的地址');
  const stats = { requests: 0, byPath: {} };

  async function request(pathAndQuery, { method = 'GET', body } = {}) {
    const url = new URL(pathAndQuery, origin);
    if (url.origin !== origin) throw new Error(`只问隔离后端 ${origin}，不问 ${url.origin}`);
    if (method !== 'GET' && !(method === 'POST' && READ_ONLY_POSTS.has(url.pathname))) {
      throw new Error(`脚本对隔离后端只读：不发 ${method} ${url.pathname}`);
    }
    stats.requests += 1;
    const tag = `${method} ${url.pathname}`;
    stats.byPath[tag] = (stats.byPath[tag] ?? 0) + 1;
    const init = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  }

  /** 健康接口。`status: degraded` 不是报错（隔离后端上有两节本来就不起），调用方按自己要的字段看 */
  async function health() {
    const { status, body } = await request('/api/v1/health');
    if (status !== 200) throw new Error(`健康接口回 ${status}：${messageOf(body)}`);
    return body;
  }

  /** 各库的三枚水位：库文件到的会话、数据入库到的会话、模型生成到的会话 */
  async function libraries() {
    const { status, body } = await request('/api/v1/dbnums');
    if (status !== 200) throw new Error(`库水位接口回 ${status}：${messageOf(body)}`);
    const out = {};
    for (const row of body.dbnums ?? []) out[row.dbnum] = libraryBrief(row);
    return out;
  }

  /** 模型树的一层。后端已经没有这个节点时 `nodes` 是 `null`（接口回 404） */
  async function children(refno) {
    const { status, body } = await request(`/api/v1/tree/children?refno=${encodeURIComponent(slashRefno(refno))}&resolved=1`);
    if (status !== 200) return { status, nodes: null, message: messageOf(body) };
    return {
      status,
      nodes: (body.nodes ?? []).map((node) => ({
        id: refnoKey(node.refno),
        name: node.name ?? '',
        noun: node.noun ?? '',
        owner: node.owner === null || node.owner === undefined ? null : refnoKey(node.owner),
        children: node.children_count ?? 0,
      })),
    };
  }

  /** 几层一起取：层的参考号 → 成员（没有这一层了是 `null`） */
  async function layers(ids) {
    const out = {};
    for (const id of ids) out[refnoKey(id)] = (await children(id)).nodes;
    return out;
  }

  async function exists(refno) {
    return (await children(refno)).status === 200;
  }

  /** 一个根名下的全部模型记录（翻页取完） */
  async function records(root) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < RECORDS_MAX_PAGES; page += 1) {
      const payload = { generation_root: slashRefno(root), limit: RECORDS_PAGE };
      if (cursor !== null) payload.cursor = cursor;
      const { status, body } = await request('/api/v1/model/records', { method: 'POST', body: payload });
      if (status !== 200) return { status, items, complete: null, modelSource: null, pending: null, message: messageOf(body) };
      items.push(...(body.items ?? []));
      cursor = body.next_cursor ?? null;
      if (cursor === null) {
        return { status, items, complete: body.complete ?? null, modelSource: body.model_source ?? null, pending: body.pending ?? null, message: null };
      }
    }
    return { status: 0, items, complete: null, modelSource: null, pending: null, message: '翻页太多' };
  }

  /**
   * 一个根名下带几何的构件：构件 → 各实例的世界矩阵（`components`）和几何标识（`geometry`，与矩阵一一对应）。
   * `complete` 不是 `true` 的不能拿来当真值。
   */
  async function components(root) {
    const result = await records(root);
    const byComponent = {};
    const geometry = {};
    for (const item of result.items) {
      const instances = recordInstances(item);
      if (instances.length === 0) continue;
      const id = refnoKey(item.refno);
      (byComponent[id] ??= []).push(...instances.map((instance) => instance.m));
      (geometry[id] ??= []).push(...instances.map((instance) => instance.geo));
    }
    return {
      status: result.status,
      message: result.message,
      complete: result.complete,
      modelSource: result.modelSource,
      pending: result.pending,
      records: result.items.length,
      components: byComponent,
      geometry,
    };
  }

  /** 后端此刻的样子：这几个根的构件和各库的水位 */
  async function snapshot(roots) {
    const at = Date.now();
    const out = {};
    for (const root of roots) out[refnoKey(root)] = await components(root);
    return { at, roots: out, libraries: await libraries() };
  }

  async function nodeStatus(refno) {
    const { status, body } = await request(`/api/v1/node/model-status?refno=${encodeURIComponent(slashRefno(refno))}`);
    return { status, verdict: body?.verdict ?? null, reason: body?.verdict_reason ?? null, units: body?.units ?? null, code: body?.code ?? null };
  }

  async function tasks(limit = 40) {
    const { status, body } = await request(`/api/v1/tasks?limit=${limit}`);
    if (status !== 200) throw new Error(`任务接口回 ${status}：${messageOf(body)}`);
    return body.tasks ?? [];
  }

  /**
   * 等一个库的三枚水位都到 `to`；不知道会到哪个会话时给 `above`：等库文件比它新、且三枚齐平。
   * 各枚用了多久从 `since` 算起，只记录。
   */
  async function waitCaughtUp(dbnum, { to = null, above = null, since = Date.now(), timeoutMs = 240_000, intervalMs = 250 } = {}) {
    if (to === null && above === null) throw new TypeError('waitCaughtUp：要给 to 或 above');
    const marks = { fileSeenMs: null, appliedMs: null, modelMs: null };
    let last = null;
    while (Date.now() - since < timeoutMs) {
      last = (await libraries())[dbnum] ?? null;
      const elapsed = Date.now() - since;
      const target = to ?? (last && last.file > above ? last.file : null);
      if (last && target !== null) {
        if (marks.fileSeenMs === null && last.file === target) marks.fileSeenMs = elapsed;
        if (marks.appliedMs === null && last.applied === target) marks.appliedMs = elapsed;
        if (marks.modelMs === null && last.model === target) marks.modelMs = elapsed;
        if (last.file === target && last.applied === target && last.model === target) return { ok: true, target, ...marks, library: last };
      }
      await sleep(intervalMs);
    }
    return { ok: false, target: to, ...marks, library: last };
  }

  return { origin, stats, request, health, libraries, children, layers, exists, records, components, snapshot, nodeStatus, tasks, waitCaughtUp };
}

function instancesOf(entry, id) {
  const matrices = entry.components[id] ?? [];
  const geometry = entry.geometry?.[id] ?? [];
  return matrices.map((m, index) => ({ geo: geometry[index] ?? '', m }));
}

/** 同一个构件前后的实例是不是一样（不看次序）：几何标识相同、矩阵只差浮点误差 */
function sameInstances(a, b) {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const item of a) {
    const index = rest.findIndex((other) => (
      other.geo === item.geo && item.m.every((value, i) => Math.abs(value - other.m[i]) <= 1e-6 + 1e-9 * Math.abs(value))
    ));
    if (index < 0) return false;
    rest.splice(index, 1);
  }
  return true;
}

/**
 * 按后端记录在存盘前后的差，算回执里模型那一半该是什么数。数法和「取最新」自己的一样（`src/composables/modelGetWork.ts` 的 `refreshModels`）：
 *
 * - 名下的记录前后有差的根（构件增减、位置或几何变了）该重载：新增 = 之后有、之前没有的构件数，撤下 = 之前有、之后没有的，现有 = 之后的；
 * - 之后名下一个带几何的构件都没有了的根该撤下：库里还有它是 `empty`，库里已经没有它是 `deleted`，个数是之前名下的构件数；
 * - 合计：新增 = 各根新增的并集减去各根撤下的并集；撤下 = 各根撤下的并集，减去新增的，再减去之后仍在某个已装的根名下的
 *   （构件在两个已装的根之间挪动，两边都不算）。
 *
 * 名下记录前后一样的根列在 `unchanged`，不在该重载的集合里——页面若把它也重载了，由判定函数按已知缺口或不过处理。
 *
 * @param {object} input
 * @param {string[]} input.roots 页面上装着的根
 * @param {Record<string, object>} input.before 存盘之前各根的 `components()` 结果
 * @param {Record<string, object>} input.after 后端跟上之后各根的 `components()` 结果
 * @param {Record<string, boolean>} [input.exists] 之后库里还有没有这个根（缺省有）
 */
export function expectedModels({ roots, before, after, exists = {} }) {
  const reload = {};
  const withdrawn = {};
  const unchanged = [];
  const detail = {};
  const addedAll = new Set();
  const removedAll = new Set();
  const present = new Set();
  for (const raw of roots) {
    const root = refnoKey(raw);
    const was = before[root];
    const gone = exists[root] === false;
    const now = gone ? { complete: true, components: {}, geometry: {} } : after[root];
    if (!was || !now) throw new Error(`算预期：${root} 缺存盘${was ? '之后' : '之前'}的后端记录`);
    if (was.complete !== true || now.complete !== true) throw new Error(`算预期：${root} 的后端记录没有收齐，不能当真值`);
    const wasIds = Object.keys(was.components).sort();
    const nowIds = Object.keys(now.components).sort();
    for (const id of nowIds) present.add(id);
    if (nowIds.length === 0 && wasIds.length > 0) {
      withdrawn[root] = { why: gone ? 'deleted' : 'empty', refnos: wasIds.length };
      for (const id of wasIds) removedAll.add(id);
      detail[root] = { added: [], removed: wasIds, changed: [] };
      continue;
    }
    const wasSet = new Set(wasIds);
    const nowSet = new Set(nowIds);
    const added = nowIds.filter((id) => !wasSet.has(id));
    const removed = wasIds.filter((id) => !nowSet.has(id));
    const changed = nowIds.filter((id) => wasSet.has(id) && !sameInstances(instancesOf(was, id), instancesOf(now, id)));
    if (added.length + removed.length + changed.length === 0) {
      unchanged.push(root);
      continue;
    }
    for (const id of added) addedAll.add(id);
    for (const id of removed) removedAll.add(id);
    reload[root] = { added: added.length, removed: removed.length, total: nowIds.length };
    detail[root] = { added, removed, changed };
  }
  return {
    reload,
    withdrawn,
    unchanged,
    detail,
    componentsAdded: [...addedAll].filter((id) => !removedAll.has(id)).length,
    componentsRemoved: [...removedAll].filter((id) => !addedAll.has(id) && !present.has(id)).length,
  };
}

/**
 * 页面树上取过的那些层，在后端前后各是什么成员 → 回执里模型树该报的四个名单（没展开的层页面不知道，不算）。
 *
 * - 新增：之后在某一层里、之前哪一层都没有的；改名：前后都在、名字不同的；挪位置：前后都在、换了层的，
 *   或者从这些层里消失了、但库里还有它的（挪到了没展开的地方）；删除：消失了、库里也没有了的，只列被删子树的根。
 *
 * @param {object} input
 * @param {Record<string, { id: string, name: string }[] | null>} input.before 层 → 成员（`backend.layers()`）
 * @param {Record<string, { id: string, name: string }[] | null>} input.after
 * @param {(id: string) => Promise<boolean> | boolean} input.existsAfter 之后库里还有没有这个节点
 */
export async function expectedTree({ before, after, existsAfter }) {
  const index = (layers) => {
    const out = new Map();
    for (const [layer, nodes] of Object.entries(layers)) {
      for (const node of nodes ?? []) out.set(node.id, { name: node.name, layer: refnoKey(layer) });
    }
    return out;
  };
  const was = index(before);
  const now = index(after);
  const added = [...now.keys()].filter((id) => !was.has(id)).sort();
  const renamed = [];
  const moved = [];
  const deleted = [];
  for (const [id, node] of was) {
    const current = now.get(id);
    if (current) {
      if (current.name !== node.name) renamed.push(id);
      if (current.layer !== node.layer) moved.push(id);
      continue;
    }
    // 上级也从这些层里消失了：算在上级那棵子树里，不单列
    if (was.has(node.layer) && !now.has(node.layer)) continue;
    if (await existsAfter(id)) moved.push(id);
    else deleted.push(id);
  }
  return { added, deleted: deleted.sort(), renamed: renamed.sort(), moved: moved.sort() };
}

#!/usr/bin/env node
/**
 * MBD 扫描结果逐对象比（只读）。
 *
 * 换了求解器或服务端之后回答：哪些对象变了、变在哪一类、改前改后各是什么。两边（基准、当前）各给一份：
 *   - 标注包目录：一个对象一个 `<refno>.json`（离线端点 `mbd_object_respond` 的输出，或 `mbd-live-sweep.mjs
 *     --save-payloads` 存下的 `payloads/`）；目录里有 `index.jsonl` 就按它认状态码与候选，没有就按目录里的文件；
 *   - 扫描输出目录：`mbd-live-sweep.mjs --out` 的目录（`results.jsonl`，里面有 `payloads/` 时一并比标注包）。
 * 标注包配上扫描结果（--baseline-results、--current-results）比得最全：结局按过前端的算，扫描指标也一起比。
 *
 * 怎么算相同：剪掉 `meta.source_version`（读过的库清单，取决于怎么开库）与顶层 `input_refno`（同一个支架的 STRU、
 * REST 两个候选只差它）；数值按 f32 比（两边各取 Math.fround 后相等）；键序无关。图元与诊断按内容配对：去掉 `id`
 * 后内容相同的算同一条，所以只换了 id（例如前面滤掉几个房间号，后面的序号整体前移）或只换了排列顺序的不算内容
 * 变化，单独归类。
 *
 * 每个可标注候选归到一类（按顺序取第一个成立的）：
 *   只在基准里、只在当前里
 *   结局变了          两边都有扫描结果时比过前端的结局（走通、契约拒收、空包……）；只有标注包时只看得出状态码与
 *                     有没有图元——契约、映射拒收要过前端才知道
 *   图元变了          配对后有少了、多了的图元，或同一个 id 的内容变了
 *   别的字段变了      `meta`、`subject`、状态码等
 *   只有诊断变了      `issues`（错误信封里是 `detail.issues`）配对后有增减或改字
 *   只有扫描指标变了  标注包相同（或没有标注包），扫描记下的指标不同
 *   只有 id 平移      内容全同，有图元或诊断换了 id
 *   只有顺序变了      内容与 id 全同，数组顺序或键序不同
 *   相同              其中「只差 f32 以下的数值」（字面不同、按 f32 相同）单列个数
 * 扫描指标：结局、reason、httpStatus、记录数、图元数、契约诊断条数、error 条数，关掉 LOD 画出 / 画不出 / 非有限数，
 * 带 LOD 画出、被 LOD 藏起来的条数（带 LOD 的两项相机按整包包围盒摆，不是页面上的判断）。
 *
 * 报数两种口径：可标注候选（一个入口算一个）与归属对象（按 `subject.refno` 去重）。归属对象的结局与扫描脚本汇总里
 * 的定义相同：取它的候选里最差的那个结局；最差结局变了记「结局变了」，否则记它的候选里排得最靠前的那一类。
 *
 * 只读：不连后端，不改两边的目录；输出写到 --out，不能落在两边的目录里面：
 *   summary.md     结局分布与变化矩阵（两种口径）、分类、扫描指标、带 LOD 画出的条数变了的对象、id 平移、逐个变化
 *   summary.json   同上的数与全部清单
 *   changed.jsonl  每个变了的候选一行，每处变化的改前 / 改后（少了、多了的图元记 id、种类、功能、文字）
 *
 * 用法（仓库根目录）：
 *   node scripts/mbd-sweep-compare.mjs <基准目录> <当前目录>
 *   node scripts/mbd-sweep-compare.mjs --baseline <目录> --current <目录> --out .scratch/mbd-sweep-compare/换版之后
 *   node scripts/mbd-sweep-compare.mjs --baseline <标注包目录> --baseline-results <扫描输出目录> \
 *     --current <标注包目录> --current-results <扫描输出目录>        # 标注包配上过前端的结局
 *
 * 选项：
 *   --baseline <dir>          基准：标注包目录或扫描输出目录（也可以写成第一个位置参数）
 *   --current <dir>           当前：同上（第二个位置参数）
 *   --baseline-results <p>    给基准配一份扫描结果（扫描输出目录或其中的 results.jsonl），结局按它取
 *   --current-results <p>     给当前配一份扫描结果
 *   --out <dir>               输出目录（缺省 .scratch/mbd-sweep-compare/<时间戳>）
 *   --list <n>                summary.md 里每一类最多列多少个对象（缺省 40；summary.json 与 changed.jsonl 里列全）
 *   --detail <n>              summary.md 里每个对象每种变化最多举几条（缺省 3；changed.jsonl 里列全）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help === true) {
  // 用法就是文件头那段注释：原样打出来，不另维护一份
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const header = source.slice(source.indexOf('/**'), source.indexOf('*/') + 2);
  console.log(header.split('\n').map((line) => line.replace(/^\/\*\*|^ \*\/|^ \* ?/, '')).join('\n').trim());
  process.exit(0);
}
const baselineArg = typeof args.baseline === 'string' ? args.baseline : args._[0];
const currentArg = typeof args.current === 'string' ? args.current : args._[1];
if (!baselineArg || !currentArg) {
  console.error('[mbd-compare] 要两个目录：基准与当前（--help 看用法）');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const outDir = path.resolve(repoRoot, String(args.out ?? path.join('.scratch', 'mbd-sweep-compare', stamp)));
const listLimit = Math.max(1, Number(args.list ?? 40) || 40);
const detailLimit = Math.max(0, Number.isFinite(Number(args.detail)) ? Number(args.detail) : 3);
/** 汇总里写相对仓库根的路径，汇总文件拷进文档时不带本机目录。 */
const shownPath = (target) => path.relative(repoRoot, target).split(path.sep).join('/') || '.';

// ---------------------------------------------------------------------------
// 读两边
// ---------------------------------------------------------------------------

const REFNO_FILE = /^\d+_\d+\.json$/;

function readJsonl(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

/** 一边：标注包目录或扫描输出目录，另可配一份扫描结果。 */
function loadSide(label, dirArg, resultsArg) {
  const dir = path.resolve(repoRoot, dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${label}不是目录：${dirArg}`);
  const side = { label, dir, payloadDir: null, resultsFile: null, statuses: null, rows: new Map(), refnos: new Set() };
  if (existsSync(path.join(dir, 'results.jsonl'))) {
    side.resultsFile = path.join(dir, 'results.jsonl');
    if (existsSync(path.join(dir, 'payloads'))) side.payloadDir = path.join(dir, 'payloads');
  } else {
    side.payloadDir = dir;
  }
  if (typeof resultsArg === 'string') {
    const resolved = path.resolve(repoRoot, resultsArg);
    side.resultsFile = statSync(resolved).isDirectory() ? path.join(resolved, 'results.jsonl') : resolved;
  }
  if (side.resultsFile) for (const row of readJsonl(side.resultsFile)) side.rows.set(String(row.refno), row);
  if (side.payloadDir && existsSync(path.join(side.payloadDir, 'index.jsonl'))) {
    side.statuses = new Map();
    for (const row of readJsonl(path.join(side.payloadDir, 'index.jsonl'))) {
      side.statuses.set(String(row.file ?? `${row.refno}.json`).replace(/\.json$/, ''), row);
    }
  }
  if (side.statuses) for (const refno of side.statuses.keys()) side.refnos.add(refno);
  else if (side.payloadDir) for (const name of readdirSync(side.payloadDir)) if (REFNO_FILE.test(name)) side.refnos.add(name.slice(0, -5));
  for (const refno of side.rows.keys()) side.refnos.add(refno);
  return side;
}

function describeSide(side) {
  const parts = [];
  if (side.payloadDir) {
    parts.push(`标注包 ${shownPath(side.payloadDir)}（状态码${side.statuses ? '按 index.jsonl' : '按正文认：有 primitives 的是数据包，否则是错误信封'}）`);
  }
  if (side.resultsFile) parts.push(`扫描结果 ${shownPath(side.resultsFile)}`);
  return `${parts.join('；')}；候选 ${side.refnos.size} 个`;
}

function readCandidate(side, refno) {
  const row = side.rows.get(refno) ?? null;
  const indexRow = side.statuses?.get(refno) ?? null;
  let body = null;
  let bodyError = null;
  if (side.payloadDir) {
    const file = path.join(side.payloadDir, `${refno}.json`);
    if (existsSync(file)) {
      try {
        body = JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        bodyError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return { refno, row, indexRow, body, bodyError };
}

// ---------------------------------------------------------------------------
// 相同的判法
// ---------------------------------------------------------------------------

/** 规范形：键排序；数值取 f32（exact 时保留原值）；dropId 时去掉这一层的 `id`。 */
function normalize(value, exact = false, dropId = false) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return exact ? value : Math.fround(value);
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, exact));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (dropId && key === 'id') continue;
      out[key] = normalize(value[key], exact);
    }
    return out;
  }
  return value;
}
const signature = (value, exact = false, dropId = false) => JSON.stringify(normalize(value, exact, dropId)) ?? 'undefined';
const sameValue = (a, b) => signature(a) === signature(b);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const idOf = (item) => (isObject(item) && (typeof item.id === 'string' || typeof item.id === 'number') ? String(item.id) : null);

/**
 * 两份图元（或诊断）配对：先配 id 与内容都相同的，再把剩下的只按内容配（id 不同就是 id 平移），再把剩下的里
 * id 相同的两条当成「同一条改了」；其余是少了、多了。
 */
function matchList(before, after) {
  const listA = (Array.isArray(before) ? before : []).map((item) => ({ item, id: idOf(item), sig: signature(item, false, true) }));
  const listB = (Array.isArray(after) ? after : []).map((item) => ({ item, id: idOf(item), sig: signature(item, false, true) }));
  const takenA = listA.map(() => false);
  const takenB = listB.map(() => false);
  const pairUp = (keyOf, onPair) => {
    const pool = new Map();
    listB.forEach((entry, index) => {
      const key = takenB[index] ? null : keyOf(entry);
      if (key === null) return;
      const bucket = pool.get(key);
      if (bucket) bucket.push(index);
      else pool.set(key, [index]);
    });
    listA.forEach((entry, index) => {
      const key = takenA[index] ? null : keyOf(entry);
      const bucket = key === null ? null : pool.get(key);
      if (!bucket?.length) return;
      const other = bucket.shift();
      takenA[index] = true;
      takenB[other] = true;
      onPair(entry, listB[other]);
    });
  };
  const shifted = [];
  const modified = [];
  pairUp((entry) => `${entry.sig}\u0000${entry.id}`, () => {});
  pairUp((entry) => entry.sig, (a, b) => {
    if (a.id !== b.id) shifted.push({ from: a.id, to: b.id, item: b.item });
  });
  pairUp((entry) => entry.id, (a, b) => modified.push({ id: b.id, before: a.item, after: b.item }));
  const removed = listA.filter((_, index) => !takenA[index]).map((entry) => entry.item);
  const added = listB.filter((_, index) => !takenB[index]).map((entry) => entry.item);
  const changed = removed.length + added.length + modified.length > 0;
  const orderChanged = !changed && shifted.length === 0
    && listA.some((entry, index) => entry.sig !== listB[index].sig || entry.id !== listB[index].id);
  return { countBefore: listA.length, countAfter: listB.length, removed, added, modified, shifted, orderChanged, changed };
}

/** 同一条改了：哪几个字段、改前改后。 */
function fieldChanges(before, after) {
  const out = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (!sameValue(before?.[key], after?.[key])) out[key] = [before?.[key] ?? null, after?.[key] ?? null];
  }
  return out;
}

const isPayload = (body) => Array.isArray(body?.primitives);

/** 剪掉读过的库清单与输入 refno。 */
function stripped(body) {
  if (!isObject(body)) return body;
  const { input_refno: _inputRefno, ...rest } = body;
  if (isObject(rest.meta)) {
    const { source_version: _sourceVersion, ...meta } = rest.meta;
    rest.meta = meta;
  }
  return rest;
}

/** 拆成图元、诊断与其余字段。错误信封的诊断在 `detail.issues`。 */
function partsOf(body) {
  const rest = { ...stripped(body) };
  if (isPayload(body)) {
    const { primitives, issues, ...others } = rest;
    return { kind: 'payload', primitives, issues: Array.isArray(issues) ? issues : [], rest: others };
  }
  const { detail, ...others } = rest;
  const { issues, ...detailRest } = isObject(detail) ? detail : {};
  return { kind: `envelope:${body?.code ?? '?'}`, primitives: null, issues: Array.isArray(issues) ? issues : [], rest: { ...others, detail: detailRest } };
}

/** 只有标注包时的结局：看状态码与有没有图元。 */
function coarseOutcome(candidate) {
  if (candidate.body) {
    if (isPayload(candidate.body)) return candidate.body.primitives.length > 0 ? '有图元' : 'empty';
    return candidate.body.code === 'not_annotatable' ? 'not_annotatable' : 'http_error';
  }
  if (candidate.row) {
    const outcome = String(candidate.row.outcome);
    if (['not_annotatable', 'http_error', 'empty', 'transport_error', 'bad_json', 'sweep_error'].includes(outcome)) return outcome;
    return (candidate.row.primitiveCount ?? 0) > 0 ? '有图元' : outcome;
  }
  return candidate.bodyError ? 'bad_json' : '?';
}

const ruleOf = (issue) => issue?.rule_id || issue?.ruleId || issue?.category || '（没有规则号）';

function ruleBag(issues) {
  const bag = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const key = `${issue?.severity ?? '?'} ${ruleOf(issue)}`;
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

/** 规则号的条数：只留两边不同的，值是 [改前, 改后]。 */
function bagDelta(before, after) {
  const delta = new Map();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key) ?? 0;
    const b = after.get(key) ?? 0;
    if (a !== b) delta.set(key, [a, b]);
  }
  return delta;
}

/** 扫描结果里比的指标：键、中文名、怎么取、是不是条数（条数才在汇总里求和）。 */
const SCAN_FIELDS = [
  ['outcome', '结局', (row) => row.outcome ?? null, false],
  ['reason', '原因', (row) => row.reason ?? null, false],
  ['httpStatus', '状态码', (row) => row.httpStatus ?? null, false],
  ['recordCount', '登记的记录', (row) => row.recordCount ?? null, true],
  ['primitiveCount', '图元数', (row) => row.primitiveCount ?? null, true],
  ['contractDiagnostics', '契约诊断', (row) => row.contractDiagnostics ?? null, true],
  ['errors', 'error 诊断', (row) => row.issues?.bySeverity?.error ?? 0, true],
  ['drawnNoLod', '关掉 LOD 画出', (row) => row.layout?.drawnNoLod ?? null, true],
  ['emptyNoLod', '关掉 LOD 画不出', (row) => row.layout?.emptyNoLod ?? null, true],
  ['nonFinite', '非有限数', (row) => row.layout?.nonFinite ?? null, true],
  ['drawn', '带 LOD 画出', (row) => row.layout?.drawn ?? null, true],
  ['lodHidden', '被 LOD 藏起来', (row) => row.layout?.lodHidden ?? null, true],
];
const SCAN_LABEL = new Map(SCAN_FIELDS.map(([field, label]) => [field, label]));

/** 类在表里的顺序与中文名；一个对象记排得最靠前的那一类。 */
const CLASSES = [
  ['only_baseline', '只在基准里'],
  ['only_current', '只在当前里'],
  ['outcome', '结局变了'],
  ['primitives', '图元变了'],
  ['other', '别的字段变了'],
  ['issues', '只有诊断变了'],
  ['scan', '只有扫描指标变了'],
  ['id_shift', '只有 id 平移'],
  ['order', '只有顺序变了'],
  ['same_f32', '相同（只差 f32 以下的数值）'],
  ['same', '相同'],
];
const CLASS_LABEL = new Map(CLASSES);
const classRank = (cls) => CLASSES.findIndex(([key]) => key === cls);
const UNCHANGED = new Set(['same', 'same_f32']);
const CONTENT = new Set(['only_baseline', 'only_current', 'outcome', 'primitives', 'other', 'issues']);

function compareCandidate(base, curr) {
  const fine = Boolean(base.row && curr.row);
  const result = {
    fine,
    outcomeBase: fine ? String(base.row.outcome) : coarseOutcome(base),
    outcomeCurr: fine ? String(curr.row.outcome) : coarseOutcome(curr),
    scan: {},
    scanValues: null,
    other: {},
    primitives: null,
    issues: null,
    rules: new Map(),
    literal: null,
  };
  if (fine) {
    result.scanValues = {};
    for (const [field, , pick] of SCAN_FIELDS) {
      const pair = [pick(base.row), pick(curr.row)];
      result.scanValues[field] = pair;
      if (!sameValue(pair[0], pair[1])) result.scan[field] = pair;
    }
  }
  const statusBase = base.indexRow?.status ?? null;
  const statusCurr = curr.indexRow?.status ?? null;
  if (base.indexRow && curr.indexRow && statusBase !== statusCurr) result.other.status = [statusBase, statusCurr];
  if (base.body && curr.body) {
    const a = partsOf(base.body);
    const b = partsOf(curr.body);
    if (a.kind !== b.kind) result.other.kind = [a.kind, b.kind];
    if (a.primitives || b.primitives) result.primitives = matchList(a.primitives, b.primitives);
    result.issues = matchList(a.issues, b.issues);
    result.rules = bagDelta(ruleBag(a.issues), ruleBag(b.issues));
    for (const key of new Set([...Object.keys(a.rest), ...Object.keys(b.rest)])) {
      if (isObject(a.rest[key]) && isObject(b.rest[key]) && (key === 'meta' || key === 'detail')) {
        Object.assign(result.other, Object.fromEntries(Object.entries(fieldChanges(a.rest[key], b.rest[key])).map(([sub, pair]) => [`${key}.${sub}`, pair])));
      } else if (!sameValue(a.rest[key], b.rest[key])) {
        result.other[key] = [a.rest[key] ?? null, b.rest[key] ?? null];
      }
    }
    const literalA = JSON.stringify(stripped(base.body));
    const literalB = JSON.stringify(stripped(curr.body));
    if (literalA !== literalB || result.other.status) {
      result.literal = signature(stripped(base.body), true) === signature(stripped(curr.body), true) ? 'keys' : 'differs';
    }
  } else if (fine) {
    // 没有标注包：只比扫描记下的摘要
    const kindsA = base.row.kinds ?? null;
    const kindsB = curr.row.kinds ?? null;
    if (!sameValue(kindsA, kindsB) || base.row.primitiveCount !== curr.row.primitiveCount) {
      result.primitives = { summaryOnly: true, countBefore: base.row.primitiveCount ?? null, countAfter: curr.row.primitiveCount ?? null, kinds: [kindsA, kindsB], changed: true };
    }
    result.rules = bagDelta(ruleBag(base.row.issues?.list), ruleBag(curr.row.issues?.list));
  }

  const idShifts = (result.primitives?.shifted?.length ?? 0) + (result.issues?.shifted?.length ?? 0);
  let contentCls = 'same';
  if (result.primitives?.changed) contentCls = 'primitives';
  else if (Object.keys(result.other).some((field) => field !== 'kind')) contentCls = 'other';
  else if (result.issues?.changed || result.rules.size > 0) contentCls = 'issues';
  else if (Object.keys(result.scan).some((field) => field !== 'outcome')) contentCls = 'scan';
  else if (idShifts > 0) contentCls = 'id_shift';
  else if (result.primitives?.orderChanged || result.issues?.orderChanged || result.literal === 'keys') contentCls = 'order';
  else if (result.literal === 'differs') contentCls = 'same_f32';
  const outcomeChanged = result.outcomeBase !== result.outcomeCurr || Boolean(result.other.kind);
  return { ...result, idShifts, contentCls, cls: outcomeChanged ? 'outcome' : contentCls };
}

// ---------------------------------------------------------------------------
// 归属对象、类型与结局
// ---------------------------------------------------------------------------

const normRefno = (value) => (typeof value === 'string' && value.trim() ? value.trim().replace('/', '_') : null);

function subjectOf(candidate) {
  return normRefno(candidate.body?.subject?.refno) ?? normRefno(candidate.row?.subjectRefno) ?? normRefno(candidate.row?.subject?.refno);
}

function typeOf(candidate) {
  const annotationType = candidate.body?.annotation_type ?? candidate.row?.annotationType;
  if (typeof annotationType === 'string' && annotationType) return annotationType;
  const noun = candidate.indexRow?.noun ?? candidate.row?.noun ?? candidate.body?.detail?.noun
    ?? (candidate.body?.detail?.branch_refno ? 'BRAN' : null);
  return `(${noun && noun !== '?' ? String(noun).toUpperCase() : '没有标注包'})`;
}

/** 结局在表里的顺序与中文名；没列出的排在后面、只写原名。 */
const OUTCOME_LABELS = new Map([
  ['ok', '走通'],
  ['有图元', '有图元（没过前端）'],
  ['ok_with_error_issues', '带 error 诊断'],
  ['contract_rejected', '契约拒收'],
  ['contract_threw', '契约抛错'],
  ['mapping_rejected', '映射拒收'],
  ['mapping_threw', '映射抛错'],
  ['commit_failed', '登记失败'],
  ['layout_failed', '排版失败'],
  ['layout_threw', '排版抛错'],
  ['layout_nonfinite', '排版出非有限数'],
  ['layout_draws_nothing', '关掉 LOD 一条不画'],
  ['http_error', 'HTTP 错误'],
  ['transport_error', '取数失败'],
  ['bad_json', '不是 JSON'],
  ['page_timeout', '超页面时限'],
  ['page_too_large', '超页面体积'],
  ['empty', '空包'],
  ['degenerate', '退化'],
  ['not_annotatable', '不可标注'],
  ['sweep_error', '脚本出错'],
  ['（没有）', '（没有）'],
]);
const outcomeLabel = (outcome) => OUTCOME_LABELS.get(outcome) ?? outcome;
const OUTCOME_ORDER = [...OUTCOME_LABELS.keys()];
const outcomeIndex = (outcome) => (OUTCOME_ORDER.includes(outcome) ? OUTCOME_ORDER.indexOf(outcome) : OUTCOME_ORDER.length - 1);
const byOutcome = (a, b) => outcomeIndex(a) - outcomeIndex(b) || a.localeCompare(b);

/**
 * 归属对象记哪个结局：越靠前越差，没列出的算最差。须与 `mbd-live-sweep.mjs` 汇总用的顺序一致，两边按归属对象
 * 的结局分布才对得上；「有图元」是只有标注包时的结局，与走通同级。
 */
const OUTCOME_SEVERITY = [
  'sweep_error', 'transport_error', 'bad_json', 'contract_threw', 'contract_rejected', 'mapping_threw',
  'mapping_rejected', 'commit_failed', 'layout_threw', 'layout_failed', 'layout_nonfinite', 'layout_draws_nothing',
  'http_error', 'page_timeout', 'page_too_large', 'degenerate', 'ok_with_error_issues', 'empty', 'not_annotatable', 'ok',
];
const severityRank = (outcome) => OUTCOME_SEVERITY.indexOf(outcome === '有图元' ? 'ok' : outcome);
const worstOf = (outcomes) => outcomes.reduce((kept, outcome) => (kept === null || severityRank(outcome) < severityRank(kept) ? outcome : kept), null);

// ---------------------------------------------------------------------------
// 文字
// ---------------------------------------------------------------------------

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function byTypeText(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) => `${type} ${count}`).join('、');
}

function show(value, max = 80) {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const primitiveGroup = (item) => item?.function ?? item?.kind ?? '?';
const issueGroup = (item) => `${item?.severity ?? '?'} ${ruleOf(item)}`;

function primitiveBrief(item) {
  return { id: idOf(item), kind: item?.kind ?? null, function: item?.function ?? null, ...(typeof item?.text === 'string' ? { text: item.text } : {}) };
}

function issueBrief(item) {
  return { id: idOf(item), severity: item?.severity ?? null, rule: ruleOf(item), message: show(item?.message ?? '', 200) };
}

function primitiveText(item) {
  return `${item?.kind ?? '?'}${item?.function ? ` ${item.function}` : ''}${typeof item?.text === 'string' ? ` ${show(item.text, 40)}` : ''}（${idOf(item) ?? '没有 id'}）`;
}

function issueText(item) {
  return `${issueGroup(item)}（${idOf(item) ?? '没有 id'}）`;
}

function groupText(items, groupOf, limit = 4) {
  const counts = new Map();
  for (const item of items) bump(counts, groupOf(item));
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return `${sorted.slice(0, limit).map(([key, count]) => `${key} ${count}`).join('、')}${sorted.length > limit ? '…' : ''}`;
}

function changesText(changes) {
  return Object.entries(changes).map(([field, [a, b]]) => `${field} ${show(a)} → ${show(b)}`).join('，');
}

/** 一份配对结果写成一句：少了、多了、改了、id 平移、顺序，各举几条。 */
function matchText(match, groupOf, textOf) {
  const bits = [];
  if (match.removed.length) bits.push(`少 ${match.removed.length}（${groupText(match.removed, groupOf)}）`);
  if (match.added.length) bits.push(`多 ${match.added.length}（${groupText(match.added, groupOf)}）`);
  if (match.modified.length) bits.push(`同一个 id 改了 ${match.modified.length}（${groupText(match.modified.map(({ after }) => after), groupOf)}）`);
  if (match.shifted.length) bits.push(`id 平移 ${match.shifted.length}（${groupText(match.shifted.map(({ item }) => item), groupOf)}）`);
  if (match.orderChanged) bits.push('顺序变了');
  const examples = [
    ...match.removed.slice(0, detailLimit).map((item) => `少 ${textOf(item)}`),
    ...match.added.slice(0, detailLimit).map((item) => `多 ${textOf(item)}`),
    ...match.modified.slice(0, detailLimit).map(({ id, before, after }) => `改 ${id}：${changesText(fieldChanges(before, after))}`),
    ...match.shifted.slice(0, detailLimit).map(({ from, to }) => `${from} → ${to}`),
  ];
  return `${bits.join('、')}${examples.length ? `。例：${examples.join('；')}` : ''}`;
}

const touched = (match) => Boolean(match && !match.summaryOnly && (match.changed || match.shifted.length || match.orderChanged));

/** summary.md 里一个对象的一行：每处变化的改前 → 改后。 */
function describeRow(row) {
  if (!row.inBase || !row.inCurr) return `只在${row.inBase ? '基准' : '当前'}里，结局 ${outcomeLabel(row.inBase ? row.outcomeBase : row.outcomeCurr)}`;
  const parts = [];
  if (row.outcomeBase !== row.outcomeCurr) parts.push(`结局 ${outcomeLabel(row.outcomeBase)} → ${outcomeLabel(row.outcomeCurr)}`);
  for (const [field, [a, b]] of Object.entries(row.scan ?? {})) if (field !== 'outcome') parts.push(`${SCAN_LABEL.get(field)} ${show(a)} → ${show(b)}`);
  if (row.primitives?.summaryOnly) {
    parts.push(`图元 ${row.primitives.countBefore} → ${row.primitives.countAfter}（种类 ${show(row.primitives.kinds[0])} → ${show(row.primitives.kinds[1])}）`);
  } else if (touched(row.primitives)) {
    parts.push(`图元 ${row.primitives.countBefore} → ${row.primitives.countAfter}：${matchText(row.primitives, primitiveGroup, primitiveText)}`);
  }
  if (row.rules?.size) parts.push(`诊断 ${[...row.rules].map(([key, [a, b]]) => `${key} ${a} → ${b}`).join('，')}`);
  if (touched(row.issues)) parts.push(`诊断配对：${matchText(row.issues, issueGroup, issueText)}`);
  for (const [field, [a, b]] of Object.entries(row.other ?? {})) parts.push(`${field} ${show(a)} → ${show(b)}`);
  if (row.cls === 'order' && row.literal === 'keys') parts.push('只有键序不同');
  return parts.join('；') || '（只看得出字面不同）';
}

/** changed.jsonl 里一个对象：全部改前 / 改后。 */
function entryOf(row) {
  const entry = { refno: row.refno, subject: row.subject, type: row.type, class: row.cls };
  if (row.cls === 'outcome' && !UNCHANGED.has(row.contentCls)) entry.alsoChanged = row.contentCls;
  if (row.inBase && row.inCurr) entry.outcome = [row.outcomeBase, row.outcomeCurr];
  if (row.scan && Object.keys(row.scan).length) entry.scan = row.scan;
  const listOf = (match, brief) => (match.summaryOnly
    ? { count: [match.countBefore, match.countAfter], kinds: match.kinds }
    : {
      count: [match.countBefore, match.countAfter],
      ...(match.removed.length ? { removed: match.removed.map(brief) } : {}),
      ...(match.added.length ? { added: match.added.map(brief) } : {}),
      ...(match.modified.length ? { modified: match.modified.map(({ id, before, after }) => ({ id, changes: fieldChanges(before, after) })) } : {}),
      ...(match.shifted.length ? { idShifted: match.shifted.map(({ from, to, item }) => ({ ...brief(item), id: undefined, from, to })) } : {}),
      ...(match.orderChanged ? { orderChanged: true } : {}),
    });
  if (row.primitives?.summaryOnly || touched(row.primitives)) entry.primitives = listOf(row.primitives, primitiveBrief);
  if (touched(row.issues) || row.rules?.size) {
    entry.issues = {
      ...(row.rules?.size ? { rules: Object.fromEntries(row.rules) } : {}),
      ...(touched(row.issues) ? listOf(row.issues, issueBrief) : {}),
    };
  }
  if (row.other && Object.keys(row.other).length) entry.other = row.other;
  if (row.literal === 'keys' && row.cls === 'order') entry.note = '只有键序不同';
  return entry;
}

function matrixLines(matrix) {
  const froms = [...matrix.keys()].sort(byOutcome);
  const tos = [...new Set([...matrix.values()].flatMap((row) => [...row.keys()]))].sort(byOutcome);
  const lines = [`| 基准 ＼ 当前 | ${tos.map(outcomeLabel).join(' | ')} | 合计 |`, `|---|${tos.map(() => '---|').join('')}---|`];
  const columnTotals = new Map();
  let total = 0;
  for (const from of froms) {
    const row = matrix.get(from);
    let rowTotal = 0;
    const cells = tos.map((to) => {
      const count = row.get(to) ?? 0;
      rowTotal += count;
      bump(columnTotals, to, count);
      if (count === 0) return '';
      return from === to ? String(count) : `**${count}**`;
    });
    total += rowTotal;
    lines.push(`| ${outcomeLabel(from)} | ${cells.join(' | ')} | ${rowTotal} |`);
  }
  lines.push(`| 合计 | ${tos.map((to) => columnTotals.get(to) ?? 0).join(' | ')} | ${total} |`);
  return lines;
}

const matrixObject = (matrix) => Object.fromEntries([...matrix].sort((a, b) => byOutcome(a[0], b[0])).map(([from, row]) => [from, Object.fromEntries([...row].sort((a, b) => byOutcome(a[0], b[0])))]));

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const baseline = loadSide('基准', baselineArg, args['baseline-results']);
  const current = loadSide('当前', currentArg, args['current-results']);
  for (const side of [baseline, current]) {
    const relative = path.relative(side.dir, outDir);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error(`--out 不能落在${side.label}目录里：${shownPath(outDir)}`);
  }
  const refnos = [...new Set([...baseline.refnos, ...current.refnos])].sort();
  const rows = [];
  let fineCount = 0;
  let payloadCount = 0;
  for (const refno of refnos) {
    const inBase = baseline.refnos.has(refno);
    const inCurr = current.refnos.has(refno);
    const base = inBase ? readCandidate(baseline, refno) : null;
    const curr = inCurr ? readCandidate(current, refno) : null;
    const subject = (curr && subjectOf(curr)) ?? (base && subjectOf(base)) ?? refno;
    // 标注类型先取当前的；当前是错误信封、基准是数据包时（或反过来）取有类型的那一边
    const typeCurr = curr ? typeOf(curr) : null;
    const typeBase = base ? typeOf(base) : null;
    const type = [typeCurr, typeBase].find((value) => value && !value.startsWith('(')) ?? typeCurr ?? typeBase;
    if (!inBase || !inCurr) {
      const only = inBase ? base : curr;
      const outcome = only.row ? String(only.row.outcome) : coarseOutcome(only);
      const cls = inBase ? 'only_baseline' : 'only_current';
      rows.push({ refno, subject, type, inBase, inCurr, cls, contentCls: cls, outcomeBase: inBase ? outcome : null, outcomeCurr: inCurr ? outcome : null });
      continue;
    }
    const result = compareCandidate(base, curr);
    if (result.fine) fineCount += 1;
    if (base.body && curr.body) payloadCount += 1;
    rows.push({ refno, subject, type, inBase, inCurr, ...result });
  }

  // 按候选：分类、结局分布与矩阵
  const candidateClasses = new Map();
  const candidateTypes = new Map();
  const outcomesBase = new Map();
  const outcomesCurr = new Map();
  const candidateMatrix = new Map();
  for (const row of rows) {
    bump(candidateClasses, row.cls);
    if (!candidateTypes.has(row.cls)) candidateTypes.set(row.cls, new Map());
    bump(candidateTypes.get(row.cls), row.type);
    if (row.inBase) bump(outcomesBase, row.outcomeBase);
    if (row.inCurr) bump(outcomesCurr, row.outcomeCurr);
    const from = row.inBase ? row.outcomeBase : '（没有）';
    if (!candidateMatrix.has(from)) candidateMatrix.set(from, new Map());
    bump(candidateMatrix.get(from), row.inCurr ? row.outcomeCurr : '（没有）');
  }

  // 按归属对象：最差结局变了记「结局变了」，否则记候选里排得最靠前的一类
  const groups = new Map();
  for (const row of rows) {
    if (groups.has(row.subject)) groups.get(row.subject).push(row);
    else groups.set(row.subject, [row]);
  }
  const subjects = [];
  const subjectClasses = new Map();
  const subjectTypes = new Map();
  const subjectOutcomesBase = new Map();
  const subjectOutcomesCurr = new Map();
  const subjectMatrix = new Map();
  for (const [subject, members] of groups) {
    const worstBase = worstOf(members.filter((member) => member.inBase).map((member) => member.outcomeBase));
    const worstCurr = worstOf(members.filter((member) => member.inCurr).map((member) => member.outcomeCurr));
    let cls;
    if (members.every((member) => member.cls === 'only_baseline')) cls = 'only_baseline';
    else if (members.every((member) => member.cls === 'only_current')) cls = 'only_current';
    else if (worstBase !== worstCurr) cls = 'outcome';
    else cls = CLASSES[Math.min(...members.map((member) => classRank(member.cls.startsWith('only_') ? 'other' : member.contentCls)))][0];
    const typed = members.find((member) => member.inCurr && member.outcomeCurr === worstCurr) ?? members[0];
    subjects.push({ subject, cls, type: typed.type, worstBase, worstCurr, members: members.map((member) => member.refno) });
    bump(subjectClasses, cls);
    if (!subjectTypes.has(cls)) subjectTypes.set(cls, new Map());
    bump(subjectTypes.get(cls), typed.type);
    if (worstBase !== null) bump(subjectOutcomesBase, worstBase);
    if (worstCurr !== null) bump(subjectOutcomesCurr, worstCurr);
    const from = worstBase ?? '（没有）';
    if (!subjectMatrix.has(from)) subjectMatrix.set(from, new Map());
    bump(subjectMatrix.get(from), worstCurr ?? '（没有）');
  }

  // 扫描指标、带 LOD 画出、id 平移、诊断增减、图元数
  const scanStats = new Map(SCAN_FIELDS.map(([field, , , isCount]) => [field, { changed: 0, before: 0, after: 0, numeric: isCount }]));
  const lodChanged = [];
  const idShiftRows = [];
  const shiftedByGroup = new Map();
  let shiftedPrimitives = 0;
  let shiftedIssues = 0;
  const issueTotals = new Map();
  const issueOnlyTotals = new Map();
  let primitivesUp = 0;
  let primitivesDown = 0;
  let primitivesSameCount = 0;
  for (const row of rows) {
    if (row.scanValues) {
      for (const [field, [a, b]] of Object.entries(row.scanValues)) {
        const stats = scanStats.get(field);
        if (!sameValue(a, b)) stats.changed += 1;
        if (typeof a === 'number') stats.before += a;
        if (typeof b === 'number') stats.after += b;
      }
      if (row.scan.drawn) {
        const values = row.scanValues;
        lodChanged.push({ refno: row.refno, type: row.type, drawn: values.drawn, lodHidden: values.lodHidden, primitiveCount: values.primitiveCount, drawnNoLod: values.drawnNoLod });
      }
    }
    if (row.idShifts) {
      const primitives = row.primitives?.shifted?.length ?? 0;
      const issues = row.issues?.shifted?.length ?? 0;
      shiftedPrimitives += primitives;
      shiftedIssues += issues;
      for (const { item } of row.primitives?.shifted ?? []) bump(shiftedByGroup, `${item?.kind ?? '?'} ${primitiveGroup(item)}`);
      idShiftRows.push({ refno: row.refno, type: row.type, class: row.cls, primitives, issues });
    }
    for (const [key, [a, b]] of row.rules ?? []) {
      bump(issueTotals, key, b - a);
      if (row.cls === 'issues') bump(issueOnlyTotals, key, b - a);
    }
    if (row.cls === 'primitives' && row.primitives) {
      const { countBefore: before, countAfter: after } = row.primitives;
      if (before === null || after === null || before === after) primitivesSameCount += 1;
      else if (after > before) primitivesUp += 1;
      else primitivesDown += 1;
    }
  }

  mkdirSync(outDir, { recursive: true });
  const changedRows = rows.filter((row) => !UNCHANGED.has(row.cls));
  writeFileSync(path.join(outDir, 'changed.jsonl'), changedRows.map((row) => JSON.stringify(entryOf(row))).join('\n') + (changedRows.length ? '\n' : ''));

  const compared = rows.length - (candidateClasses.get('only_baseline') ?? 0) - (candidateClasses.get('only_current') ?? 0);
  const method = payloadCount === compared && compared > 0
    ? '两边都有标注包：剪掉 meta.source_version 与 input_refno，数值按 f32 比、键序无关；图元与诊断去掉 id 按内容配对'
    : `${payloadCount} 个候选两边都有标注包、按标注包比（数值按 f32、图元与诊断按内容配对）；其余 ${compared - payloadCount} 个只比扫描摘要（结局、图元数与种类、诊断规则号、扫描指标）`;
  const outcomeBasis = fineCount === compared && compared > 0
    ? '过前端的结局（两边的扫描结果）'
    : fineCount === 0
      ? '只看状态码与有没有图元（没有扫描结果；契约、映射拒收看不出来）'
      : `${fineCount} 个候选用过前端的结局，其余只看状态码与有没有图元`;
  const count = (map, keys) => keys.reduce((sum, key) => sum + (map.get(key) ?? 0), 0);
  const changedCount = rows.length - count(candidateClasses, [...UNCHANGED]);
  const contentCount = count(candidateClasses, [...CONTENT]);
  const literalCount = rows.filter((row) => row.literal).length;
  const changedSubjects = subjects.filter((entry) => !UNCHANGED.has(entry.cls)).length;
  const scanFieldsObject = Object.fromEntries([...scanStats].map(([field, stats]) => [field, stats.numeric ? stats : { changed: stats.changed }]));
  const summary = {
    baseline: describeSide(baseline),
    current: describeSide(current),
    method,
    outcomeBasis,
    candidates: rows.length,
    subjects: subjects.length,
    changedCandidates: changedCount,
    contentChangedCandidates: contentCount,
    changedSubjects,
    literallyDifferentCandidates: literalCount,
    outcomes: {
      baseline: { byCandidate: Object.fromEntries(outcomesBase), bySubject: Object.fromEntries(subjectOutcomesBase) },
      current: { byCandidate: Object.fromEntries(outcomesCurr), bySubject: Object.fromEntries(subjectOutcomesCurr) },
    },
    outcomeMatrix: { byCandidate: matrixObject(candidateMatrix), bySubject: matrixObject(subjectMatrix) },
    byCandidate: Object.fromEntries(CLASSES.map(([key]) => [key, candidateClasses.get(key) ?? 0])),
    bySubject: Object.fromEntries(CLASSES.map(([key]) => [key, subjectClasses.get(key) ?? 0])),
    byCandidateType: Object.fromEntries([...candidateTypes].map(([cls, map]) => [cls, Object.fromEntries(map)])),
    bySubjectType: Object.fromEntries([...subjectTypes].map(([cls, map]) => [cls, Object.fromEntries(map)])),
    scanFields: scanFieldsObject,
    lodDrawnChanged: lodChanged,
    idShift: {
      candidates: idShiftRows.length,
      onlyIdShift: candidateClasses.get('id_shift') ?? 0,
      primitives: shiftedPrimitives,
      primitivesByKindAndFunction: Object.fromEntries([...shiftedByGroup].sort((a, b) => b[1] - a[1])),
      issues: shiftedIssues,
      list: idShiftRows,
    },
    issueRuleDelta: Object.fromEntries([...issueTotals].filter(([, change]) => change !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))),
    issueRuleDeltaInIssuesOnly: Object.fromEntries([...issueOnlyTotals].filter(([, change]) => change !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))),
    primitivesChanged: { more: primitivesUp, fewer: primitivesDown, sameCountDifferentContent: primitivesSameCount },
    lists: Object.fromEntries(CLASSES.filter(([key]) => key !== 'same').map(([key]) => [key, rows.filter((row) => row.cls === key).map((row) => row.refno)])),
    subjectLists: Object.fromEntries(CLASSES.filter(([key]) => key !== 'same').map(([key]) => [key, subjects.filter((entry) => entry.cls === key).map((entry) => entry.subject)])),
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));

  const classCount = (key) => candidateClasses.get(key) ?? 0;
  const lines = [];
  lines.push(`# MBD 扫描结果逐对象比 ${new Date().toISOString()}`, '');
  lines.push(`- 基准：${summary.baseline}`);
  lines.push(`- 当前：${summary.current}`);
  lines.push(`- 比法：${method}；结局：${outcomeBasis}`);
  lines.push(`- 候选 ${rows.length} 个 = 归属对象 ${subjects.length} 个（按 subject.refno 去重；归属对象的结局取它的候选里最差的）`);
  lines.push(`- 变了的候选 ${changedCount} 个（归属对象 ${changedSubjects} 个）：内容变了 ${contentCount}（结局 ${classCount('outcome')}、图元 ${classCount('primitives')}、`
    + `别的字段 ${classCount('other')}、只有诊断 ${classCount('issues')}${classCount('only_baseline') + classCount('only_current') ? `、只在一边 ${classCount('only_baseline') + classCount('only_current')}` : ''}），`
    + `只有扫描指标 ${classCount('scan')}，只有 id 平移 ${classCount('id_shift')}，只有顺序 ${classCount('order')}`);
  if (payloadCount > 0) {
    lines.push(`- 字面不同的候选 ${literalCount} 个（剪掉同样两处后按 JSON 原文比，键序、数组顺序、数值都按字面，状态码一起比）：`
      + `上面变了的里两边都有标注包的那些，加只差 f32 以下数值的 ${classCount('same_f32')} 个`);
  }

  lines.push('', '## 结局分布', '', '| 结局 | 基准·候选 | 当前·候选 | 基准·归属对象 | 当前·归属对象 |', '|---|---|---|---|---|');
  const outcomeKeys = [...new Set([...outcomesBase.keys(), ...outcomesCurr.keys()])].sort(byOutcome);
  for (const key of outcomeKeys) {
    lines.push(`| ${outcomeLabel(key)} | ${outcomesBase.get(key) ?? 0} | ${outcomesCurr.get(key) ?? 0} | ${subjectOutcomesBase.get(key) ?? 0} | ${subjectOutcomesCurr.get(key) ?? 0} |`);
  }
  lines.push(`| 合计 | ${count(outcomesBase, outcomeKeys)} | ${count(outcomesCurr, outcomeKeys)} | ${count(subjectOutcomesBase, outcomeKeys)} | ${count(subjectOutcomesCurr, outcomeKeys)} |`);
  lines.push('', '## 结局变化矩阵：按可标注候选（行是基准、列是当前；对角线是没变的，加粗的是变了的）', '', ...matrixLines(candidateMatrix));
  lines.push('', '## 结局变化矩阵：按归属对象（各取候选里最差的结局）', '', ...matrixLines(subjectMatrix));

  for (const [title, classes, types, total] of [
    [`分类：按可标注候选（${rows.length}）`, candidateClasses, candidateTypes, rows.length],
    [`分类：按归属对象（${subjects.length}；最差结局变了记「结局变了」，否则记候选里排得最靠前的一类）`, subjectClasses, subjectTypes, subjects.length],
  ]) {
    lines.push('', `## ${title}`, '', '| 类 | 个数 | 按类型 |', '|---|---|---|');
    for (const [key, label] of CLASSES) {
      const classTotal = classes.get(key) ?? 0;
      if (classTotal === 0 && (key.startsWith('only_') || key === 'scan' || key === 'same_f32')) continue;
      lines.push(`| ${label} | ${classTotal} | ${key === 'same' ? '' : byTypeText(types.get(key) ?? new Map())} |`);
    }
    lines.push(`| 合计 | ${total} | |`);
  }

  if (fineCount > 0) {
    lines.push('', `## 扫描指标（两边都有扫描结果的 ${fineCount} 个候选；没排版的对象排版几项为空，不计入合计）`, '', '| 指标 | 变了的候选 | 基准合计 | 当前合计 |', '|---|---|---|---|');
    for (const [field, label] of SCAN_FIELDS) {
      const stats = scanStats.get(field);
      lines.push(`| ${label}（${field}） | ${stats.changed} | ${stats.numeric ? stats.before : ''} | ${stats.numeric ? stats.after : ''} |`);
    }
    lines.push('', `### 带 LOD 画出的条数变了的对象（${lodChanged.length}；相机按整包包围盒摆，不是页面上的判断）`, '');
    for (const entry of lodChanged.slice(0, listLimit)) {
      lines.push(`- \`${entry.refno}\`（${entry.type}）：带 LOD 画出 ${entry.drawn[0]} → ${entry.drawn[1]}，被 LOD 藏起来 ${entry.lodHidden[0]} → ${entry.lodHidden[1]}，`
        + `关掉 LOD 画出 ${entry.drawnNoLod[0]} → ${entry.drawnNoLod[1]}，图元 ${entry.primitiveCount[0]} → ${entry.primitiveCount[1]}`);
    }
    if (lodChanged.length > listLimit) lines.push('- …（全量在 summary.json 的 lodDrawnChanged）');
  }

  if (idShiftRows.length > 0) {
    lines.push('', '## id 平移（内容全同、只换了 id；不算内容变化）', '');
    lines.push(`有 id 平移的候选 ${idShiftRows.length} 个（其中只有 id 平移的 ${classCount('id_shift')} 个，其余另有内容变化、记在那一类）；`
      + `图元换 id ${shiftedPrimitives} 条，诊断换 id ${shiftedIssues} 条。`);
    lines.push('', `图元按「种类 功能」：${[...shiftedByGroup].sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key} ${value}`).join('、')}`);
    lines.push('', ...idShiftRows.slice(0, listLimit).map((entry) => `- \`${entry.refno}\`（${entry.type}，${CLASS_LABEL.get(entry.class)}）：图元 ${entry.primitives}、诊断 ${entry.issues}`));
    if (idShiftRows.length > listLimit) lines.push('- …（全量在 summary.json 的 idShift.list）');
  }

  if (primitivesUp + primitivesDown + primitivesSameCount > 0) {
    lines.push('', `图元变了的候选里：图元变多 ${primitivesUp}、变少 ${primitivesDown}、个数不变但内容不同 ${primitivesSameCount}。`);
  }
  if (issueTotals.size > 0) {
    lines.push('', '## 诊断按「级别 规则号」的增减（全部变了的候选合计；括号里是只有诊断变了的那一类）', '');
    for (const [key, change] of [...issueTotals].filter(([, value]) => value !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 60)) {
      const only = issueOnlyTotals.get(key);
      lines.push(`- ${change > 0 ? '+' : ''}${change} ${key}${only ? `（${only > 0 ? '+' : ''}${only}）` : ''}`);
    }
  }

  lines.push('', `## 逐个变化（每类最多 ${listLimit} 个、每种变化最多举 ${detailLimit} 条；全量在 changed.jsonl）`);
  for (const [key, label] of CLASSES) {
    if (UNCHANGED.has(key)) continue;
    const list = rows.filter((row) => row.cls === key);
    if (list.length === 0) continue;
    lines.push('', `### ${label}（${list.length}）`, '');
    for (const row of list.slice(0, listLimit)) lines.push(`- \`${row.refno}\`（${row.type}${row.subject !== row.refno ? `，归属 ${row.subject}` : ''}）：${describeRow(row)}`);
    if (list.length > listLimit) lines.push(`- …另 ${list.length - listLimit} 个`);
  }
  const sameF32 = rows.filter((row) => row.cls === 'same_f32');
  if (sameF32.length > 0) {
    lines.push('', `### 只差 f32 以下的数值（${sameF32.length}，算相同）`, '', sameF32.slice(0, listLimit).map((row) => `\`${row.refno}\``).join('、'));
  }
  writeFileSync(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
  const headEnd = lines.findIndex((line) => line.startsWith('## 扫描指标') || line.startsWith('## id 平移') || line.startsWith('## 逐个变化'));
  console.log(lines.slice(0, headEnd > 0 ? headEnd : lines.length).join('\n'));
  console.log(`\n[mbd-compare] 输出 ${shownPath(outDir)}（summary.md、summary.json、changed.jsonl）`);
}

try {
  main();
} catch (error) {
  console.error('[mbd-compare] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

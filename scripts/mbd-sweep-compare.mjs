#!/usr/bin/env node
/**
 * MBD 扫描结果逐对象比（只读）。
 *
 * 换了求解器或服务端之后回答一个问题：哪些对象变了、变在哪一类。两边（基准、当前）各给一份：
 *   - 标注包目录：一个对象一个 `<refno>.json`（离线端点 `mbd_object_respond` 的输出，或 `mbd-live-sweep.mjs
 *     --save-payloads` 存下的 `payloads/`）；目录里有 `index.jsonl` 就按它认状态码与候选，没有就按目录里的文件；
 *   - 扫描输出目录：`mbd-live-sweep.mjs --out` 的目录（`results.jsonl`，里面有 `payloads/` 时一并比标注包）。
 *
 * 每个可标注候选归到一类（按顺序取第一个成立的）：
 *   结局变了      两边的结局不同。两边都有扫描结果时用过前端的结局（走通、契约拒收、空包……）；只有标注包时
 *                 只看得出状态码与有没有图元——契约、映射拒收要过前端才知道
 *   图元变了      `primitives` 不同
 *   别的字段变了  图元与结局相同，`meta` 等字段不同（可能连带诊断）
 *   只有诊断变了  只有 `issues`（错误信封里是 `detail.issues`）不同
 *   相同、只在基准里、只在当前里
 * 比标注包时剪掉 `meta.source_version`（读过的库清单，取决于怎么开库）与顶层 `input_refno`（同一个支架的 STRU、REST
 * 两个候选只差它），其余深比较：键序无关，数值按字面相等、不给容差。两边都只有扫描结果、没有标注包时，只比扫描记下的
 * 摘要（结局、图元数与种类、诊断的规则号、登记的记录数），汇总里写明。
 *
 * 报数两种口径：可标注候选（一个入口算一个）与归属对象（按 `subject.refno` 去重，一个归属对象记它的候选里最重的
 * 那一类）。
 *
 * 只读：不连后端，不改两边的目录；输出写到 --out，不能落在两边的目录里面。
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
 *   --out <dir>               输出目录（缺省 .scratch/mbd-sweep-compare/<时间戳>）：summary.md、summary.json、changed.jsonl
 *   --list <n>                summary.md 里每一类最多列多少个对象（缺省 40；summary.json 与 changed.jsonl 里列全）
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
// 比一个对象
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

const isPayload = (body) => Array.isArray(body?.primitives);

/** 拆成图元、诊断与其余字段；剪掉读过的库清单与输入 refno。错误信封的诊断在 `detail.issues`。 */
function partsOf(body) {
  if (isPayload(body)) {
    const { primitives, issues, input_refno: _inputRefno, meta, ...rest } = body;
    const metaRest = meta && typeof meta === 'object' ? { ...meta } : meta;
    if (metaRest && typeof metaRest === 'object') delete metaRest.source_version;
    return { kind: 'payload', primitives, issues: Array.isArray(issues) ? issues : [], rest: { ...rest, meta: metaRest } };
  }
  const { detail, ...rest } = body ?? {};
  const { issues, ...detailRest } = detail && typeof detail === 'object' ? detail : {};
  return { kind: `envelope:${body?.code ?? '?'}`, primitives: null, issues: Array.isArray(issues) ? issues : [], rest: { ...rest, detail: detailRest } };
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

function ruleBag(issues) {
  const bag = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const rule = issue?.rule_id || issue?.ruleId || issue?.category || '（没有规则号）';
    const key = `${issue?.severity ?? '?'} ${rule}`;
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

function bagDelta(before, after) {
  const delta = new Map();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const change = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (change !== 0) delta.set(key, change);
  }
  return delta;
}

/** 两边的 `meta` 哪几个键不同。 */
function metaKeysDiffer(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return deepEqual(a, b) ? [] : ['meta'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !deepEqual(a[key], b[key])).map((key) => `meta.${key}`);
}

function compareCandidate(base, curr) {
  const fine = Boolean(base.row && curr.row);
  const outcomeBase = fine ? String(base.row.outcome) : coarseOutcome(base);
  const outcomeCurr = fine ? String(curr.row.outcome) : coarseOutcome(curr);
  const fields = [];
  let issueDelta = new Map();
  let primitiveDelta = null;
  if (outcomeBase !== outcomeCurr) fields.push('outcome');
  if (base.body && curr.body) {
    const a = partsOf(base.body);
    const b = partsOf(curr.body);
    if (a.kind !== b.kind) fields.push('kind');
    if (!deepEqual(a.primitives, b.primitives)) {
      fields.push('primitives');
      primitiveDelta = [a.primitives?.length ?? null, b.primitives?.length ?? null];
    }
    if (!deepEqual(a.issues, b.issues)) {
      fields.push('issues');
      issueDelta = bagDelta(ruleBag(a.issues), ruleBag(b.issues));
    }
    for (const key of new Set([...Object.keys(a.rest), ...Object.keys(b.rest)])) {
      if (deepEqual(a.rest[key], b.rest[key])) continue;
      if (key === 'meta') fields.push(...metaKeysDiffer(a.rest.meta, b.rest.meta));
      else fields.push(key);
    }
  } else if (base.row && curr.row) {
    if (base.row.primitiveCount !== curr.row.primitiveCount || !deepEqual(base.row.kinds ?? null, curr.row.kinds ?? null)) {
      fields.push('primitives');
      primitiveDelta = [base.row.primitiveCount ?? null, curr.row.primitiveCount ?? null];
    }
    const before = ruleBag(base.row.issues?.list);
    const after = ruleBag(curr.row.issues?.list);
    issueDelta = bagDelta(before, after);
    if (issueDelta.size > 0) fields.push('issues');
    if (base.row.recordCount !== curr.row.recordCount) fields.push('records');
  }
  let cls = 'same';
  if (fields.includes('outcome') || fields.includes('kind')) cls = 'outcome';
  else if (fields.includes('primitives')) cls = 'primitives';
  else if (fields.length > 0) cls = fields.every((field) => field === 'issues') ? 'issues' : 'other';
  return { cls, fine, fields, outcomeBase, outcomeCurr, issueDelta, primitiveDelta };
}

// ---------------------------------------------------------------------------
// 归属对象与类型
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

/** 类在表里的顺序与中文名；一个归属对象取它的候选里排得最靠前的那一类。 */
const CLASSES = [
  ['only_baseline', '只在基准里'],
  ['only_current', '只在当前里'],
  ['outcome', '结局变了'],
  ['primitives', '图元变了'],
  ['other', '别的字段变了'],
  ['issues', '只有诊断变了'],
  ['same', '相同'],
];
const CLASS_LABEL = new Map(CLASSES);
const classRank = (cls) => CLASSES.findIndex(([key]) => key === cls);

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function byTypeText(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) => `${type} ${count}`).join('、');
}

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
      rows.push({ refno, subject, type, cls: inBase ? 'only_baseline' : 'only_current', fields: [] });
      continue;
    }
    const result = compareCandidate(base, curr);
    if (result.fine) fineCount += 1;
    if (base.body && curr.body) payloadCount += 1;
    rows.push({ refno, subject, type, ...result });
  }

  // 两种口径
  const candidateClasses = new Map();
  const candidateTypes = new Map();
  const subjects = new Map();
  for (const row of rows) {
    bump(candidateClasses, row.cls);
    if (!candidateTypes.has(row.cls)) candidateTypes.set(row.cls, new Map());
    bump(candidateTypes.get(row.cls), row.type);
    const kept = subjects.get(row.subject);
    if (!kept || classRank(row.cls) < classRank(kept.cls)) subjects.set(row.subject, { cls: row.cls, type: row.type, refno: row.refno });
  }
  const subjectClasses = new Map();
  const subjectTypes = new Map();
  for (const entry of subjects.values()) {
    bump(subjectClasses, entry.cls);
    if (!subjectTypes.has(entry.cls)) subjectTypes.set(entry.cls, new Map());
    bump(subjectTypes.get(entry.cls), entry.type);
  }

  // 结局迁移、诊断增减、图元数
  const transitions = new Map();
  const subjectTransitions = new Map();
  const seenSubjects = new Set();
  const issueTotals = new Map();
  const issueOnlyTotals = new Map();
  let primitivesUp = 0;
  let primitivesDown = 0;
  let primitivesSameCount = 0;
  for (const row of rows) {
    if (row.cls === 'outcome') {
      const key = `${row.outcomeBase} → ${row.outcomeCurr}`;
      bump(transitions, key);
      if (!seenSubjects.has(row.subject)) {
        seenSubjects.add(row.subject);
        bump(subjectTransitions, key);
      }
    }
    for (const [key, change] of row.issueDelta ?? []) {
      bump(issueTotals, key, change);
      if (row.cls === 'issues') bump(issueOnlyTotals, key, change);
    }
    if (row.cls === 'primitives' && row.primitiveDelta) {
      const [before, after] = row.primitiveDelta;
      if (before === null || after === null || before === after) primitivesSameCount += 1;
      else if (after > before) primitivesUp += 1;
      else primitivesDown += 1;
    }
  }
  const fieldCounts = new Map();
  for (const row of rows) for (const field of new Set(row.fields ?? [])) bump(fieldCounts, field);

  mkdirSync(outDir, { recursive: true });
  const changed = rows.filter((row) => row.cls !== 'same');
  writeFileSync(path.join(outDir, 'changed.jsonl'), changed.map((row) => JSON.stringify({
    refno: row.refno,
    subject: row.subject,
    type: row.type,
    class: row.cls,
    fields: row.fields,
    outcome: row.outcomeBase === undefined ? undefined : [row.outcomeBase, row.outcomeCurr],
    primitives: row.primitiveDelta ?? undefined,
    issues: row.issueDelta?.size ? Object.fromEntries(row.issueDelta) : undefined,
  })).join('\n') + (changed.length ? '\n' : ''));

  const compared = rows.length - (candidateClasses.get('only_baseline') ?? 0) - (candidateClasses.get('only_current') ?? 0);
  const method = payloadCount === compared && compared > 0
    ? '两边都有标注包：剪掉 meta.source_version 与 input_refno 后深比较'
    : `${payloadCount} 个候选两边都有标注包、按标注包比；其余 ${compared - payloadCount} 个只比扫描摘要（结局、图元数与种类、诊断规则号、记录数）`;
  const outcomeBasis = fineCount === compared && compared > 0
    ? '过前端的结局（两边的扫描结果）'
    : fineCount === 0
      ? '只看状态码与有没有图元（没有扫描结果；契约、映射拒收看不出来）'
      : `${fineCount} 个候选用过前端的结局，其余只看状态码与有没有图元`;
  const summary = {
    baseline: describeSide(baseline),
    current: describeSide(current),
    method,
    outcomeBasis,
    candidates: rows.length,
    subjects: subjects.size,
    byCandidate: Object.fromEntries(CLASSES.map(([key]) => [key, candidateClasses.get(key) ?? 0])),
    bySubject: Object.fromEntries(CLASSES.map(([key]) => [key, subjectClasses.get(key) ?? 0])),
    byCandidateType: Object.fromEntries([...candidateTypes].map(([cls, map]) => [cls, Object.fromEntries(map)])),
    bySubjectType: Object.fromEntries([...subjectTypes].map(([cls, map]) => [cls, Object.fromEntries(map)])),
    outcomeTransitions: Object.fromEntries(transitions),
    outcomeTransitionsBySubject: Object.fromEntries(subjectTransitions),
    fieldsDiffering: Object.fromEntries([...fieldCounts].sort((a, b) => b[1] - a[1])),
    issueRuleDelta: Object.fromEntries([...issueTotals].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))),
    issueRuleDeltaInIssuesOnly: Object.fromEntries([...issueOnlyTotals].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))),
    primitivesChanged: { more: primitivesUp, fewer: primitivesDown, sameCountDifferentContent: primitivesSameCount },
    lists: Object.fromEntries(CLASSES.filter(([key]) => key !== 'same').map(([key]) => [key, rows.filter((row) => row.cls === key).map((row) => row.refno)])),
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));

  const lines = [];
  lines.push(`# MBD 扫描结果逐对象比 ${new Date().toISOString()}`, '');
  lines.push(`- 基准：${summary.baseline}`);
  lines.push(`- 当前：${summary.current}`);
  lines.push(`- 比法：${method}；结局：${outcomeBasis}`);
  lines.push(`- 候选 ${rows.length} 个 = 归属对象 ${subjects.size} 个（归属对象按 subject.refno 去重，记它的候选里最重的一类）`);
  for (const [title, classes, types, total] of [
    ['按可标注候选', candidateClasses, candidateTypes, rows.length],
    ['按归属对象', subjectClasses, subjectTypes, subjects.size],
  ]) {
    lines.push('', `## ${title}（${total}）`, '', '| 类 | 个数 | 按类型 |', '|---|---|---|');
    for (const [key, label] of CLASSES) {
      const count = classes.get(key) ?? 0;
      if (count === 0 && key.startsWith('only_')) continue;
      lines.push(`| ${label} | ${count} | ${key === 'same' ? '' : byTypeText(types.get(key) ?? new Map())} |`);
    }
  }
  if (transitions.size > 0) {
    lines.push('', '## 结局迁移（基准 → 当前；候选 / 归属对象）', '');
    for (const [key, count] of [...transitions].sort((a, b) => b[1] - a[1])) lines.push(`- ${key}：${count} / ${subjectTransitions.get(key) ?? 0}`);
  }
  if (fieldCounts.size > 0) {
    lines.push('', '## 哪些字段不同（候选数）', '');
    lines.push([...fieldCounts].sort((a, b) => b[1] - a[1]).map(([field, count]) => `${field} ${count}`).join('、'));
  }
  if (primitivesUp + primitivesDown + primitivesSameCount > 0) {
    lines.push('', `图元变了的候选里：图元变多 ${primitivesUp}、变少 ${primitivesDown}、个数不变但内容不同 ${primitivesSameCount}。`);
  }
  if (issueTotals.size > 0) {
    lines.push('', '## 诊断按「级别 规则号」的增减（全部变了的候选合计；括号里是只有诊断变了的那一类）', '');
    for (const [key, change] of [...issueTotals].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 60)) {
      const only = issueOnlyTotals.get(key);
      lines.push(`- ${change > 0 ? '+' : ''}${change} ${key}${only ? `（${only > 0 ? '+' : ''}${only}）` : ''}`);
    }
  }
  lines.push('', `## 清单（每类最多 ${listLimit} 个，全量在 summary.json / changed.jsonl）`, '');
  for (const [key, label] of CLASSES) {
    if (key === 'same') continue;
    const list = rows.filter((row) => row.cls === key);
    if (list.length === 0) continue;
    lines.push(`- ${label}（${list.length}）：${list.slice(0, listLimit).map((row) => `${row.refno}（${row.type}${row.fields?.length ? `；${row.fields.join(' ')}` : ''}）`).join('，')}${list.length > listLimit ? ' …' : ''}`);
  }
  writeFileSync(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
  const headEnd = lines.findIndex((line, index) => index > 5 && line.startsWith('## ') && !line.startsWith('## 按'));
  console.log(lines.slice(0, headEnd > 0 ? headEnd : lines.length).join('\n'));
  console.log(`\n[mbd-compare] 输出 ${shownPath(outDir)}（summary.md、summary.json、changed.jsonl）`);
}

try {
  main();
} catch (error) {
  console.error('[mbd-compare] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

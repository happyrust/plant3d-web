#!/usr/bin/env node
/**
 * MBD 尺寸标注全量联调扫描（真实后端，只读）。
 *
 * 回答一个问题：这个项目里的对象，MBD 尺寸标注现在出不出得来——逐个过，不是挑十几个样本看。
 * 逐个对象走页面同一条链路，但不开浏览器：
 *   1. 沿模型树枚举候选对象（管道 BRAN、设备 EQUI、支架 SUPPO / ZONE 直属的 STRU 与 REST、
 *      土建 / 建筑 WALL / GWALL / STWALL / FLOOR）。页面右键入口还收 NOZZ / HANG / FRMW / SCTN / PANE / PCLA
 *      （`mbdAnnotatableNouns.ts`），它们由服务端归到上面这些对象，这里不逐个当入口扫；
 *   2. `GET /api/mbd/v2/object/{refno}`（页面 `fetchMbdV2ObjectData` 走的端点），记状态码、耗时、体积；
 *   3. 用**前端的真代码**过一遍：契约解析 `parseMbdV2PipeData` → 映射 `mbdV2ToExternalRecords`
 *      （有一条映射不出就整包拒绝，ADR 0046）→ 登记进 `ExternalDimensionRegistry`
 *      → 内核排版 `layoutViewport`（three 相机 + `ThreeViewportProjector`，与页面同一个投影器）；
 *   4. 汇总：按标注类型 × 结局计数，失败原因、求解器 issues、排版、页面护栏（15 秒超时 / 20 MB）各自分组。
 *
 * 个数有两种口径，汇总里并列：
 *   - 候选：上面枚举出的入口，一个算一个；
 *   - 归属对象：按答复里的 `subject.refno` 去重。ZONE 直属的 STRU 与配对的 REST 归到同一个支架，只算一次；
 *     没有数据包的答复（422、取数失败）按候选自己的 refno 算。同一个归属对象的几个候选结局不同时取最差的那个，
 *     并在汇总里逐个列出。
 *
 * `ok` 的意思是「链路走通」：200、契约与映射通过、登记成功、排版不抛错不出非有限数、至少一个图元、没有 error
 * 级诊断、没有 `degenerate` 那几种一眼看得出的退化。它**不是**「画得对」：位置、内容、是否互相遮挡都没看。
 * 相机也不是页面上的相机：脚本把整包标注装进一个视口（包围盒只取位置字段），带 LOD、关掉 LOD 各排一遍；
 * 带 LOD 一条都不画的对象、关掉 LOD 仍有记录画不出来的对象在汇总里单列，要到页面上对着看才算数。
 *
 * 只发 GET，不写库、不生成模型；重放（`--payload-dir`）不连后端。并发缺省 4（页面 `MBD_FETCH_CONCURRENCY` 同值）。
 * 结局里有失败也照常退出 0（这是普查，不是门禁）；只有脚本自己跑不下去才退出 1。
 *
 * 用法（仓库根目录）：
 *   node scripts/mbd-live-sweep.mjs                              # 全量：缺省 http://127.0.0.1:8022
 *   node scripts/mbd-live-sweep.mjs --enumerate-only             # 只枚举候选对象，看规模
 *   node scripts/mbd-live-sweep.mjs --refnos 24381_145018,24383_69033
 *   node scripts/mbd-live-sweep.mjs --nouns BRAN --limit 200     # 每类最多 200 个
 *   node scripts/mbd-live-sweep.mjs --include-sites "INST"       # 只扫名字匹配的 SITE
 *   node scripts/mbd-live-sweep.mjs --save-payloads all --out .scratch/mbd-live-sweep/full   # 每个答复都存下来
 *   node scripts/mbd-live-sweep.mjs --payload-dir .scratch/mbd-live-sweep/full/payloads      # 重放存下来的答复
 *   node scripts/mbd-sweep-compare.mjs <基准目录> <这次的 --out 目录>   # 换版之后与一份基准逐对象比（用法见它的 --help）
 *
 * 选项：
 *   --base <url>            模型树所在的 gen-model（缺省 GEN_MODEL_V1_BASE_URL 或 http://127.0.0.1:8022）
 *   --mbd-base <url>        MBD 端点所在的后端（缺省同 --base）
 *   --out <dir>             输出目录（缺省 .scratch/mbd-live-sweep/<时间戳>）
 *   --concurrency <n>       MBD 请求并发（缺省 4）
 *   --tree-concurrency <n>  枚举模型树的并发（缺省 6）
 *   --timeout-ms <n>        单个 MBD 请求最多等多久（缺省 120000；页面只等 15 秒，超过的另记一类）
 *   --nouns <a,b>           只扫这些类型的候选对象
 *   --limit <n>             每种类型最多扫 n 个（均匀抽样）
 *   --include-sites <re>    只扫名字匹配的 SITE
 *   --exclude-sites <re>    跳过名字匹配的 SITE（缺省 ^/MDS|template：MDS 支架模板 / 标准件站点）
 *   --refnos <a,b>          不枚举，直接扫这些对象
 *   --no-layout             不做内核排版那一步
 *   --save-payloads <mode>  failed（缺省：只留结局不是 ok / 空包 / 不可标注的答复）| all | none。存下的答复旁边写一份
 *                           index.jsonl（状态码与候选信息），这个目录可以直接拿来 --payload-dir 重放
 *   --payload-dir <dir>     不向后端取数，改读 <dir>/<refno>.json（重放存下来的答复，例如离线端点重算的）。
 *                           <dir>/index.jsonl 在时按里面的 status 处理（422 的错误信封照 422 走），没有时都当 200；
 *                           不给 --refnos 时候选就是 index.jsonl 里的对象（没有它时是目录里的 <refno>.json）。
 *                           重放不连后端、不枚举模型树：--base / --mbd-base / --include-sites / --exclude-sites 不起作用
 *   --vite-cache-dir <dir>  装前端代码用的 Vite 缓存目录（缺省 .scratch/mbd-live-sweep/vite-cache）。工作树的
 *                           node_modules 常是指向主检出的目录联接，缓存不能落在它下面共享的 .vite 里
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
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
const trimBase = (value) => String(value).trim().replace(/\/+$/, '');
const base = trimBase(args.base ?? process.env.GEN_MODEL_V1_BASE_URL ?? 'http://127.0.0.1:8022');
const mbdBase = trimBase(args['mbd-base'] ?? base);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const outDir = path.resolve(repoRoot, String(args.out ?? path.join('.scratch', 'mbd-live-sweep', stamp)));
const concurrency = Math.max(1, Number(args.concurrency ?? 4) || 4);
const treeConcurrency = Math.max(1, Number(args['tree-concurrency'] ?? 6) || 6);
const timeoutMs = Math.max(1000, Number(args['timeout-ms'] ?? 120_000) || 120_000);
const nounFilter = typeof args.nouns === 'string'
  ? new Set(args.nouns.split(',').map((noun) => noun.trim().toUpperCase()).filter(Boolean))
  : null;
const limitPerNoun = args.limit !== undefined ? Math.max(1, Number(args.limit) || 1) : null;
const includeSites = typeof args['include-sites'] === 'string' ? new RegExp(args['include-sites'], 'i') : null;
const excludeSites = new RegExp(typeof args['exclude-sites'] === 'string' ? args['exclude-sites'] : '^/MDS|template', 'i');
const explicitRefnos = typeof args.refnos === 'string'
  ? args.refnos.split(',').map((refno) => refno.trim().replace('/', '_')).filter(Boolean)
  : null;
const enumerateOnly = args['enumerate-only'] === true;
const layoutEnabled = args['no-layout'] !== true;
const savePayloads = typeof args['save-payloads'] === 'string' ? args['save-payloads'] : 'failed';
const payloadDir = typeof args['payload-dir'] === 'string' ? path.resolve(repoRoot, args['payload-dir']) : null;
const viteCacheDir = path.resolve(repoRoot, String(args['vite-cache-dir'] ?? path.join('.scratch', 'mbd-live-sweep', 'vite-cache')));
/** 汇总里写相对仓库根的路径，汇总文件拷进文档时不带本机目录。 */
const shownPath = (target) => path.relative(repoRoot, target).split(path.sep).join('/') || '.';

/** 页面取数通道的两道护栏（`src/api/mbdV2Api.ts`）：超过就是页面上的失败。 */
const PAGE_FETCH_TIMEOUT_MS = 15_000;
const PAGE_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

async function runPool(items, limit, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }));
}

async function httpGet(url, limitMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text, ms: performance.now() - startedAt, error: null };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      status: 0,
      text: '',
      ms: performance.now() - startedAt,
      error: timedOut ? `超过 ${limitMs} 毫秒没有回来` : (error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const upper = (value) => String(value ?? '').trim().toUpperCase();

/** 把一句话里因对象而异的部分抹掉，同一类原因才能数到一起。 */
function normalizeMessage(message) {
  return String(message ?? '')
    .replace(/[=]?\d+[_/]\d+/g, '<refno>')
    .replace(/\/[^\s，,。；;（）()「」"']+/g, '<name>')
    .replace(/-?\d+(\.\d+)?/g, '<n>')
    .slice(0, 220);
}

/** `count` 按候选数，`subjects` 按归属对象去重。 */
function bump(map, key, sample, subject) {
  let entry = map.get(key);
  if (!entry) {
    entry = { count: 0, subjects: new Set(), samples: [] };
    map.set(key, entry);
  }
  entry.count += 1;
  if (subject !== undefined) entry.subjects.add(subject);
  if (sample !== undefined && entry.samples.length < 5 && !entry.samples.includes(sample)) entry.samples.push(sample);
}

const sortedEntries = (map) => [...map.entries()].sort((a, b) => b[1].count - a[1].count);

// ---------------------------------------------------------------------------
// 1. 枚举候选对象
// ---------------------------------------------------------------------------

/** 往下走的容器（墙在组合墙 CWALL 里、楼板可能在组合楼板 CFLOOR 里：STRU › FRMW › CWALL › WALL / GWALL） */
const CONTAINER_NOUNS = new Set(['SITE', 'ZONE', 'PIPE', 'STRU', 'FRMW', 'SBFR', 'CWALL', 'CFLOOR']);
/** 归属对象：遇到就记、不再往下 */
const SUBJECT_NOUNS = new Set(['BRAN', 'EQUI', 'SUPPO', 'WALL', 'GWALL', 'STWALL', 'FLOOR']);
/** ZONE 直接下面的这两种可能是支架（在不在支架区由服务端判，这里照记） */
const SUPPORT_ROOT_NOUNS = new Set(['STRU', 'REST']);

async function treeChildren(refno) {
  const got = await httpGet(`${base}/api/v1/tree/children?refno=${encodeURIComponent(refno)}`, 60_000);
  if (got.status !== 200) throw new Error(`tree/children ${refno}: ${got.status || got.error}`);
  const parsed = safeJson(got.text);
  if (!parsed.ok) throw new Error(`tree/children ${refno}: 不是 JSON`);
  return Array.isArray(parsed.value?.nodes) ? parsed.value.nodes : [];
}

async function enumerateCandidates() {
  const got = await httpGet(`${base}/api/v1/tree/roots`, 60_000);
  if (got.status !== 200) throw new Error(`tree/roots: ${got.status || got.error}`);
  const roots = safeJson(got.text);
  if (!roots.ok) throw new Error('tree/roots: 不是 JSON');
  const sites = (roots.value.nodes ?? []).filter((node) => upper(node.noun) === 'SITE');
  const skippedSites = [];
  let frontier = [];
  for (const site of sites) {
    const name = String(site.name ?? '');
    if ((includeSites && !includeSites.test(name)) || (!includeSites && excludeSites.test(name))) {
      skippedSites.push(name);
      continue;
    }
    frontier.push({ refno: String(site.refno), noun: 'SITE', name, site: name, zone: null });
  }
  const candidates = [];
  const seen = new Set();
  const errors = [];
  let requests = 0;
  while (frontier.length > 0) {
    const nextFrontier = [];
    await runPool(frontier, treeConcurrency, async (node) => {
      let children;
      try {
        requests += 1;
        children = await treeChildren(node.refno);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return;
      }
      for (const child of children) {
        const noun = upper(child.noun);
        const refno = String(child.refno ?? '').replace('/', '_');
        if (!refno) continue;
        const name = String(child.name ?? '');
        const zone = noun === 'ZONE' ? name : node.zone;
        const isSubject = SUBJECT_NOUNS.has(noun) || (node.noun === 'ZONE' && SUPPORT_ROOT_NOUNS.has(noun));
        if (isSubject && !seen.has(refno)) {
          seen.add(refno);
          candidates.push({ refno, noun, name, site: node.site, zone, parentNoun: node.noun });
        }
        if (CONTAINER_NOUNS.has(noun) && child.children_count !== 0) {
          nextFrontier.push({ refno, noun, name, site: node.site, zone });
        }
      }
    });
    frontier = nextFrontier;
  }
  return { candidates, skippedSites, treeRequests: requests, treeErrors: errors, siteCount: sites.length };
}

function sampleEvenly(list, limit) {
  if (list.length <= limit) return list;
  const out = [];
  for (let i = 0; i < limit; i += 1) out.push(list[Math.floor((i * list.length) / limit)]);
  return out;
}

// ---------------------------------------------------------------------------
// 2. 前端真代码（契约、映射、登记、排版）
// ---------------------------------------------------------------------------

async function loadFrontend() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: repoRoot,
    cacheDir: viteCacheDir,
    logLevel: 'error',
    appType: 'custom',
    resolve: { alias: { '@': path.join(repoRoot, 'src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = (file) => server.ssrLoadModule(file);
  let modules;
  try {
    modules = await Promise.all([
      load('/src/dimension/adapters/mbdV2Contract.ts'),
      load('/src/dimension/adapters/mbdV2ExternalAnnotations.ts'),
      load('/src/dimension/adapters/normalizeExternalDimensions.ts'),
      load('/src/dimension/services/externalDimensionRegistry.ts'),
      load('/src/dimension/kernel/index.ts'),
      load('/src/dimension/viewport/threeViewportProjector.ts'),
      import('three'),
    ]);
  } catch (error) {
    // 前端代码装不进来（改坏了、路径变了）：先把 Vite 关掉，不然进程挂着不退
    await server.close();
    throw error;
  }
  const [contract, mapper, normalize, registry, kernel, projector, three] = modules;
  const font = kernel.LffFont.fromText(
    gunzipSync(readFileSync(path.join(repoRoot, 'public', 'fonts', 'unicode.lff.bin'))).toString('utf8'),
  );
  return {
    close: () => server.close(),
    parseMbdV2PipeData: contract.parseMbdV2PipeData,
    mbdV2ToExternalRecords: mapper.mbdV2ToExternalRecords,
    normalizeExternalDimension: normalize.normalizeExternalDimension,
    ExternalDimensionRegistry: registry.ExternalDimensionRegistry,
    layoutViewport: kernel.layoutViewport,
    theme: kernel.SOLVESPACE_DIMENSION_THEME,
    format: kernel.DEFAULT_DIMENSION_FORMAT,
    ThreeViewportProjector: projector.ThreeViewportProjector,
    three,
    font,
  };
}

/**
 * 整包标注在 Design Space（米）里的包围盒，只取位置字段：线与箭头的端点、标签锚点、弧心（按半径外扩）、标记、
 * 附加文字、卡片引线指的点、三维尺寸的管道点。方向（`labelAlong`、`normal`、`axis`、`direction`、`away`…）
 * 也是三元组，但不是点，不算。一个有限的点都没有时返回 null。
 */
function annotationBounds(inputs) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const add = (point, padM = 0) => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) return;
    found = true;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis] - padM);
      max[axis] = Math.max(max[axis], point[axis] + padM);
    }
  };
  for (const input of inputs) {
    if ('lines' in input) {
      add(input.labelAnchor);
      for (const line of [...(input.lines ?? []), ...(input.arrowLines ?? [])]) {
        add(line.from);
        add(line.to);
      }
      for (const arrow of input.arrows ?? []) {
        add(arrow.tip);
        add(arrow.towards);
      }
      for (const arc of input.arcs ?? []) add(arc.center, Number.isFinite(arc.radiusM) ? Math.abs(arc.radiusM) : 0);
      for (const marker of input.markers ?? []) add(marker.at);
      for (const text of input.texts ?? []) add(text.anchor);
      add(input.tag?.target);
      add(input.dimension3d?.from);
      add(input.dimension3d?.to);
    } else if (input.kind === 'angular') {
      add(input.vertex);
      add(input.rayA);
      add(input.rayB);
    } else if (input.kind === 'radial') {
      add(input.center);
      add(input.rim);
    } else {
      add(input.a);
      add(input.b);
    }
  }
  return found ? { min, max } : null;
}

/** 递归数非有限数（NaN / ±Infinity）。 */
function countNonFinite(value, depth = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? 0 : 1;
  if (depth > 12 || value === null || typeof value !== 'object') return 0;
  let total = 0;
  if (Array.isArray(value)) {
    for (const item of value) total += countNonFinite(item, depth + 1);
    return total;
  }
  for (const item of Object.values(value)) total += countNonFinite(item, depth + 1);
  return total;
}

/** 把整包标注装进一个 1920×1080 的透视视口（斜上方俯视，Z 向上）。 */
function fitProjector(frontend, inputs) {
  const bounds = annotationBounds(inputs);
  if (!bounds) return null;
  const { min, max } = bounds;
  const { PerspectiveCamera, Matrix4, Vector3 } = frontend.three;
  const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const radius = Math.max(0.05, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const fovDeg = 45;
  const distance = (radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.15;
  const camera = new PerspectiveCamera(fovDeg, 1920 / 1080, Math.max(distance - radius * 2, distance * 0.01), distance + radius * 4);
  camera.up.set(0, 0, 1);
  camera.position.copy(center).add(new Vector3(1, 1, 0.8).normalize().multiplyScalar(distance));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return {
    projector: new frontend.ThreeViewportProjector({
      camera,
      designToWorld: new Matrix4(),
      widthCssPx: 1920,
      heightCssPx: 1080,
      dpr: 1,
    }),
    radiusM: radius,
  };
}

function withoutLod(input) {
  if (!input || typeof input !== 'object' || !('lod' in input)) return input;
  const { lod: _lod, ...rest } = input;
  return rest;
}

function layoutPass(frontend, inputs, projector) {
  const batch = frontend.layoutViewport(
    inputs,
    { projector, font: frontend.font, theme: frontend.theme, format: frontend.format },
    new Map(),
  );
  let drawn = 0;
  let lodHidden = 0;
  let nonFinite = 0;
  const empty = [];
  for (const layout of batch.layouts) {
    const scene = layout.scenePrimitives?.length ?? 0;
    if (scene > 0) drawn += 1;
    else if (layout.derived?.lodHidden) lodHidden += 1;
    else empty.push(layout.dimensionId);
    nonFinite += countNonFinite(layout.scenePrimitives) + countNonFinite(layout.primitives) + countNonFinite(layout.labelBounds);
  }
  return { total: batch.layouts.length, drawn, lodHidden, empty, nonFinite };
}

// ---------------------------------------------------------------------------
// 3. 单个对象
// ---------------------------------------------------------------------------

function summarizeIssues(issues) {
  const bySeverity = { info: 0, warning: 0, error: 0 };
  const list = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const severity = String(issue?.severity ?? 'info');
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    list.push({
      severity,
      category: String(issue?.category ?? ''),
      ruleId: String(issue?.rule_id ?? ''),
      message: String(issue?.message ?? '').slice(0, 300),
    });
  }
  return { bySeverity, list };
}

/** 源空间毫米。比这还小的字、弧、整包范围画出来看不见（真实模型里的字高是毫米到分米量级）。 */
const DEGENERATE_MM = 0.01;
const POINT_KEYS = ['start', 'end', 'position', 'center', 'label_anchor'];
const SEGMENT_KEYS = ['extension_lines', 'arrow_lines', 'leg_lines'];

/**
 * 合契约、但一眼看得出画不出东西的退化：字高或弧半径小到看不见、整包的点缩在一处。契约只要求「有限正数」，
 * 这几种它都认——真实库里有字高 1e-13 的标签、所有图元挤在一个点上的支架。只查这几种，不是完整的几何校验。
 */
function findDegenerate(payload) {
  const reasons = [];
  const primitives = Array.isArray(payload?.primitives) ? payload.primitives : [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let located = 0;
  const visit = (point) => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) return false;
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
    return true;
  };
  let tinyText = 0;
  let tinyArc = 0;
  for (const primitive of primitives) {
    if (typeof primitive?.text_height_mm === 'number' && primitive.text_height_mm < DEGENERATE_MM) tinyText += 1;
    if (typeof primitive?.radius === 'number' && primitive.radius < DEGENERATE_MM) tinyArc += 1;
    let hasPoint = false;
    for (const key of POINT_KEYS) hasPoint = visit(primitive?.[key]) || hasPoint;
    for (const key of SEGMENT_KEYS) {
      for (const segment of Array.isArray(primitive?.[key]) ? primitive[key] : []) {
        hasPoint = visit(segment?.from) || hasPoint;
        hasPoint = visit(segment?.to) || hasPoint;
      }
    }
    if (hasPoint) located += 1;
  }
  if (tinyText > 0) reasons.push(`${tinyText} 个图元的字高小于 ${DEGENERATE_MM} mm`);
  if (tinyArc > 0) reasons.push(`${tinyArc} 个弧 / 圈的半径小于 ${DEGENERATE_MM} mm`);
  if (located >= 2 && Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) < DEGENERATE_MM) {
    reasons.push(`${located} 个图元的全部点缩在 ${DEGENERATE_MM} mm 以内`);
  }
  const tinyRows = (Array.isArray(payload?.meta?.isolines) ? payload.meta.isolines : [])
    .filter((isoline) => typeof isoline?.cheight_mm === 'number' && isoline.cheight_mm < DEGENERATE_MM).length;
  if (tinyRows > 0) reasons.push(`直段表里 ${tinyRows} 行的字高小于 ${DEGENERATE_MM} mm`);
  return reasons;
}

/** 重放目录里一个对象的答复文件：`<refno>.json`（refno 写成 `24381_145018`）。 */
const STORED_PAYLOAD_FILE = /^\d+_\d+\.json$/;

let storedIndexCache;
/**
 * `--payload-dir` 下的 index.jsonl（离线端点 `mbd_object_respond` 或本脚本 `--save-payloads` 写的）：
 * 对象 → 那一行（状态码；本脚本写的还带候选信息）。没有这个文件时是 null，目录里的答复都当 200。
 */
function storedIndex() {
  if (storedIndexCache !== undefined) return storedIndexCache;
  let text;
  try {
    text = readFileSync(path.join(payloadDir, 'index.jsonl'), 'utf8');
  } catch {
    storedIndexCache = null;
    return storedIndexCache;
  }
  storedIndexCache = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    storedIndexCache.set(String(row.file ?? `${row.refno}.json`).replace(/\.json$/, ''), row);
  }
  return storedIndexCache;
}

/** 重放时的候选：index.jsonl 里带着候选信息就用上（离线端点写的只有状态码）。 */
function storedCandidate(refno) {
  const row = storedIndex()?.get(refno) ?? {};
  return {
    refno,
    noun: upper(row.noun) || '?',
    name: String(row.name ?? ''),
    site: row.site ?? null,
    zone: row.zone ?? null,
    parentNoun: row.parentNoun ?? null,
  };
}

/** 重放、没给 --refnos：候选就是 index.jsonl 里的对象；没有 index.jsonl 时是目录里的 `<refno>.json`。 */
function storedCandidates() {
  const index = storedIndex();
  const refnos = index
    ? [...index.keys()]
    : readdirSync(payloadDir).filter((name) => STORED_PAYLOAD_FILE.test(name)).map((name) => name.replace(/\.json$/, ''));
  return refnos.map(storedCandidate);
}

/** 重放：从 `--payload-dir` 读这个对象存下来的答复；状态码按 index.jsonl，里面没有这个对象的当 200。 */
function readStoredPayload(refno) {
  const status = Number(storedIndex()?.get(refno)?.status ?? 200);
  if (!Number.isInteger(status) || status <= 0) {
    return { status: 0, text: '', ms: 0, error: `index.jsonl 里这个对象的状态码不可用（${status}）` };
  }
  try {
    return { status, text: readFileSync(path.join(payloadDir, `${refno}.json`), 'utf8'), ms: 0, error: null };
  } catch (error) {
    return { status: 0, text: '', ms: 0, error: `读不到存下来的答复：${error instanceof Error ? error.message : String(error)}` };
  }
}

async function evaluate(frontend, candidate) {
  const url = `${mbdBase}/api/mbd/v2/object/${encodeURIComponent(candidate.refno)}`;
  const got = payloadDir ? readStoredPayload(candidate.refno) : await httpGet(url, timeoutMs);
  const result = {
    ...candidate,
    httpStatus: got.status,
    ms: Math.round(got.ms),
    bytes: Buffer.byteLength(got.text, 'utf8'),
    outcome: 'ok',
    reason: null,
  };
  const fail = (outcome, reason) => {
    result.outcome = outcome;
    result.reason = String(reason ?? '').slice(0, 600);
    return { result, payloadText: got.text };
  };

  if (got.status === 0) return fail('transport_error', got.error);
  if (got.status !== 200) {
    const envelope = safeJson(got.text);
    // 没枚举过模型树（--refnos、重放）时候选不知道自己是什么，错误信封里有就补上
    const detail = envelope.ok ? envelope.value?.detail : null;
    if (result.noun === '?' && detail && typeof detail === 'object') {
      result.noun = upper(detail.noun ?? (detail.branch_refno ? 'BRAN' : '')) || '?';
    }
    const code = envelope.ok ? String(envelope.value?.code ?? '') : '';
    const message = envelope.ok ? String(envelope.value?.message ?? '') : got.text.slice(0, 300);
    result.errorCode = code;
    result.errorMessage = message.slice(0, 600);
    const detailIssues = envelope.ok ? envelope.value?.detail?.issues : null;
    if (Array.isArray(detailIssues)) result.issues = summarizeIssues(detailIssues);
    return fail(code === 'not_annotatable' ? 'not_annotatable' : 'http_error', `${got.status} ${code}: ${message}`);
  }

  const parsedJson = safeJson(got.text);
  if (!parsedJson.ok) return fail('bad_json', parsedJson.error);
  const payload = parsedJson.value;
  result.annotationType = typeof payload?.annotation_type === 'string' ? payload.annotation_type : null;
  result.subject = payload?.subject ?? null;
  result.layoutMode = payload?.meta?.layout_mode ?? null;
  result.coverage = Array.isArray(payload?.meta?.coverage) ? payload.meta.coverage : null;
  result.notes = Array.isArray(payload?.meta?.notes) ? payload.meta.notes.slice(0, 4) : [];
  const kinds = {};
  for (const primitive of Array.isArray(payload?.primitives) ? payload.primitives : []) {
    const kind = String(primitive?.kind ?? '?');
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  result.kinds = kinds;
  result.primitiveCount = Object.values(kinds).reduce((sum, count) => sum + count, 0);
  result.issues = summarizeIssues(payload?.issues);

  // 契约（fail-closed：整包拒绝）
  let parsed;
  try {
    parsed = frontend.parseMbdV2PipeData(payload, { partial: false });
  } catch (error) {
    return fail('contract_threw', error instanceof Error ? error.message : String(error));
  }
  if (!parsed.ok) return fail('contract_rejected', parsed.error);
  result.contractDiagnostics = parsed.diagnostics?.length ?? 0;

  // 映射（有一条映射不出就整包拒绝，ADR 0046）
  let mapped;
  try {
    mapped = frontend.mbdV2ToExternalRecords(parsed.data, {});
  } catch (error) {
    return fail('mapping_threw', error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  result.recordCount = mapped.records.length;
  if (mapped.skipped.length > 0) {
    result.mappingSkipped = mapped.skipped.slice(0, 10);
    return fail('mapping_rejected', `${mapped.skipped.length} 个图元无法映射（首个：${mapped.skipped[0].id} — ${mapped.skipped[0].reason}）`);
  }

  // 登记
  try {
    new frontend.ExternalDimensionRegistry().replaceSource('mbd', mapped.records);
  } catch (error) {
    return fail('commit_failed', error instanceof Error ? error.message : String(error));
  }

  // 内核排版
  if (layoutEnabled && mapped.records.length > 0) {
    try {
      const inputs = mapped.records.map((record) => frontend.normalizeExternalDimension(record));
      const fitted = fitProjector(frontend, inputs);
      if (!fitted) return fail('layout_failed', '整包没有一个有限的坐标点');
      const withLod = layoutPass(frontend, inputs, fitted.projector);
      const noLod = layoutPass(frontend, inputs.map(withoutLod), fitted.projector);
      result.layout = {
        radiusM: Number(fitted.radiusM.toFixed(3)),
        drawn: withLod.drawn,
        lodHidden: withLod.lodHidden,
        drawnNoLod: noLod.drawn,
        emptyNoLod: noLod.empty.length,
        emptyNoLodSample: noLod.empty.slice(0, 6),
        nonFinite: withLod.nonFinite + noLod.nonFinite,
      };
      if (result.layout.nonFinite > 0) return fail('layout_nonfinite', `排版结果里有 ${result.layout.nonFinite} 个非有限数`);
      if (noLod.drawn === 0) return fail('layout_draws_nothing', `${mapped.records.length} 条记录关掉 LOD 也一条都画不出来`);
    } catch (error) {
      return fail('layout_threw', error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }

  // 页面护栏
  if (result.ms > PAGE_FETCH_TIMEOUT_MS) return fail('page_timeout', `取数 ${result.ms} 毫秒，页面只等 ${PAGE_FETCH_TIMEOUT_MS} 毫秒`);
  if (result.bytes > PAGE_RESPONSE_MAX_BYTES) return fail('page_too_large', `负载 ${result.bytes} 字节，页面上限 ${PAGE_RESPONSE_MAX_BYTES}`);

  if (result.primitiveCount === 0) return fail('empty', '200，但一个图元都没有');
  const degenerate = findDegenerate(payload);
  if (degenerate.length > 0) return fail('degenerate', `合契约，但画出来看不见：${degenerate.join('；')}`);
  if (result.issues.bySeverity.error > 0) {
    const first = result.issues.list.find((issue) => issue.severity === 'error');
    return fail('ok_with_error_issues', `${result.issues.bySeverity.error} 条 error 诊断（首条：${first?.ruleId || first?.category} ${first?.message}）`);
  }
  return { result, payloadText: got.text };
}

// ---------------------------------------------------------------------------
// 4. 汇总
// ---------------------------------------------------------------------------

/** 结局在表里的列序与中文名；没列出的排在最后、只写原名。 */
const OUTCOME_LABELS = new Map([
  ['ok', '走通'],
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
]);

/**
 * 同一个归属对象的几个候选结局不同时记哪一个：越靠前越差，没列出的算最差。成对的 STRU 与 REST
 * 答复本来相同，这只是兜底；不一致的在汇总里逐个列出。
 */
const OUTCOME_SEVERITY = [
  'sweep_error', 'transport_error', 'bad_json', 'contract_threw', 'contract_rejected', 'mapping_threw',
  'mapping_rejected', 'commit_failed', 'layout_threw', 'layout_failed', 'layout_nonfinite', 'layout_draws_nothing',
  'http_error', 'page_timeout', 'page_too_large', 'degenerate', 'ok_with_error_issues', 'empty', 'not_annotatable', 'ok',
];
const severityRank = (outcome) => OUTCOME_SEVERITY.indexOf(outcome);

/** 归属对象：答复里的 `subject.refno`；没有数据包（422、取数失败）时就是候选自己。 */
function subjectRefnoOf(result) {
  const refno = result.subject?.refno;
  return typeof refno === 'string' && refno.trim() ? refno.trim().replace('/', '_') : result.refno;
}

const typeOf = (result) => result.annotationType ?? `(${result.noun})`;

/** 类型 × 结局，每个条目算一个。 */
function outcomeTable(entries) {
  const table = new Map();
  for (const { type, outcome } of entries) {
    if (!table.has(type)) table.set(type, new Map());
    const row = table.get(type);
    row.set(outcome, (row.get(outcome) ?? 0) + 1);
  }
  return table;
}

/** 按归属对象去重：每个归属对象一个条目，结局取它的候选里最差的；候选之间结局或类型不一致的另列。 */
function groupBySubject(results) {
  const groups = new Map();
  for (const result of results) {
    const members = groups.get(result.subjectRefno);
    if (members) members.push(result);
    else groups.set(result.subjectRefno, [result]);
  }
  const entries = [];
  const conflicts = [];
  let shared = 0;
  for (const [subject, members] of groups) {
    if (members.length > 1) shared += 1;
    const worst = members.reduce((kept, member) => (severityRank(member.outcome) < severityRank(kept.outcome) ? member : kept));
    if (new Set(members.map((member) => `${typeOf(member)} ${member.outcome}`)).size > 1) {
      conflicts.push({
        subject,
        members: members.map((member) => ({ refno: member.refno, type: typeOf(member), outcome: member.outcome })),
      });
    }
    entries.push({ subject, type: typeOf(worst), outcome: worst.outcome });
  }
  return { entries, shared, conflicts };
}

function outcomeTableLines(table, columns) {
  const lines = [];
  lines.push(`| 类型 | 合计 | ${columns.map((outcome) => (OUTCOME_LABELS.has(outcome) ? `${OUTCOME_LABELS.get(outcome)} ${outcome}` : outcome)).join(' | ')} |`);
  lines.push(`|---|---|${columns.map(() => '---').join('|')}|`);
  const totals = new Map();
  let grand = 0;
  for (const [type, row] of [...table.entries()].sort()) {
    const total = [...row.values()].reduce((sum, count) => sum + count, 0);
    grand += total;
    for (const [outcome, count] of row) totals.set(outcome, (totals.get(outcome) ?? 0) + count);
    lines.push(`| ${type} | ${total} | ${columns.map((outcome) => row.get(outcome) ?? 0).join(' | ')} |`);
  }
  lines.push(`| 合计 | ${grand} | ${columns.map((outcome) => totals.get(outcome) ?? 0).join(' | ')} |`);
  return lines;
}

/**
 * 排版那一步在脚本摆的相机下看到的两种可疑情形：带 LOD 一条都不画的候选、关掉 LOD 仍有记录画不出来的候选。
 * 相机不是页面的相机，这两张清单要到页面上对着看才算数。
 */
function layoutFindings(results) {
  const totals = { objects: 0, records: 0, drawn: 0, lodHidden: 0, drawnNoLod: 0, emptyNoLod: 0, nonFinite: 0 };
  const drawsNothingWithLod = [];
  const emptyNoLod = [];
  for (const result of results) {
    const layout = result.layout;
    if (!layout) continue;
    totals.objects += 1;
    totals.records += result.recordCount ?? 0;
    totals.drawn += layout.drawn;
    totals.lodHidden += layout.lodHidden;
    totals.drawnNoLod += layout.drawnNoLod;
    totals.emptyNoLod += layout.emptyNoLod;
    totals.nonFinite += layout.nonFinite;
    const brief = { refno: result.refno, subject: result.subjectRefno, type: typeOf(result), outcome: result.outcome };
    if (layout.drawn === 0) drawsNothingWithLod.push({ ...brief, records: result.recordCount, lodHidden: layout.lodHidden });
    if (layout.emptyNoLod > 0) emptyNoLod.push({ ...brief, records: layout.emptyNoLod, sample: layout.emptyNoLodSample });
  }
  return { totals, drawsNothingWithLod, emptyNoLod };
}

/** 「候选数（归属对象数）」按类型。 */
function countByType(list) {
  const byType = new Map();
  for (const item of list) {
    const entry = byType.get(item.type) ?? { candidates: 0, subjects: new Set() };
    entry.candidates += 1;
    entry.subjects.add(item.subject);
    byType.set(item.type, entry);
  }
  return [...byType.entries()].sort()
    .map(([type, entry]) => `${type} ${entry.candidates}（归属对象 ${entry.subjects.size}）`)
    .join('、');
}

// ---------------------------------------------------------------------------
// 5. 主流程
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(outDir, { recursive: true });
  const startedAt = Date.now();
  console.log(payloadDir ? `[mbd-sweep] 重放 ${shownPath(payloadDir)}（不连后端）` : `[mbd-sweep] 模型树 ${base}  MBD ${mbdBase}`);
  console.log(`[mbd-sweep] 输出 ${shownPath(outDir)}`);

  let backend;
  if (payloadDir) {
    backend = { replay: shownPath(payloadDir), statuses: storedIndex() ? 'index.jsonl' : '没有 index.jsonl，都当 200' };
    if (includeSites || typeof args['exclude-sites'] === 'string') {
      console.log('[mbd-sweep] 重放不枚举模型树，--include-sites / --exclude-sites 不起作用');
    }
  } else {
    const health = await httpGet(`${mbdBase}/api/v1/health`, 15_000);
    const healthJson = health.status === 200 ? safeJson(health.text) : { ok: false };
    backend = healthJson.ok
      ? { version: healthJson.value.version, started_at: healthJson.value.started_at, project: healthJson.value.project, mdb: healthJson.value.mdb }
      : { error: `health ${health.status || health.error}` };
  }
  console.log(`[mbd-sweep] 后端 ${JSON.stringify(backend)}`);

  let candidates;
  let enumeration = null;
  if (explicitRefnos) {
    candidates = explicitRefnos.map((refno) => (payloadDir
      ? storedCandidate(refno)
      : { refno, noun: '?', name: '', site: null, zone: null, parentNoun: null }));
  } else if (payloadDir) {
    candidates = storedCandidates();
    console.log(`[mbd-sweep] 重放目录里的候选 ${candidates.length} 个`);
  } else {
    const treeStartedAt = Date.now();
    const found = await enumerateCandidates();
    enumeration = {
      sites: found.siteCount,
      skippedSites: found.skippedSites,
      treeRequests: found.treeRequests,
      treeErrors: found.treeErrors.slice(0, 20),
      treeErrorCount: found.treeErrors.length,
      ms: Date.now() - treeStartedAt,
    };
    candidates = found.candidates;
    console.log(
      `[mbd-sweep] 枚举：${found.siteCount} 个 SITE（跳过 ${found.skippedSites.length} 个），`
      + `${found.treeRequests} 次 tree 请求，${enumeration.ms} ms，候选 ${candidates.length} 个，出错 ${found.treeErrors.length} 次`,
    );
  }
  if (nounFilter) candidates = candidates.filter((candidate) => nounFilter.has(candidate.noun));
  const byNoun = new Map();
  for (const candidate of candidates) {
    if (!byNoun.has(candidate.noun)) byNoun.set(candidate.noun, []);
    byNoun.get(candidate.noun).push(candidate);
  }
  const nounCounts = Object.fromEntries([...byNoun.entries()].map(([noun, list]) => [noun, list.length]));
  console.log(`[mbd-sweep] 候选按类型：${JSON.stringify(nounCounts)}`);
  writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify({ backend, enumeration, nounCounts, candidates }, null, 1));
  if (limitPerNoun !== null) {
    candidates = [...byNoun.values()].flatMap((list) => sampleEvenly(list, limitPerNoun));
    console.log(`[mbd-sweep] 每类最多 ${limitPerNoun} 个 → 实扫 ${candidates.length} 个`);
  }
  if (enumerateOnly) return;

  const frontend = await loadFrontend();
  const resultsPath = path.join(outDir, 'results.jsonl');
  writeFileSync(resultsPath, '');
  const savedPayloadDir = path.join(outDir, 'payloads');
  const savedIndexPath = path.join(savedPayloadDir, 'index.jsonl');
  if (savePayloads !== 'none') {
    mkdirSync(savedPayloadDir, { recursive: true });
    writeFileSync(savedIndexPath, '');
  }
  let savedPayloads = 0;
  const results = [];
  let done = 0;
  let lastLogAt = Date.now();
  try {
    await runPool(candidates, concurrency, async (candidate) => {
      let evaluated;
      try {
        evaluated = await evaluate(frontend, candidate);
      } catch (error) {
        evaluated = {
          result: { ...candidate, outcome: 'sweep_error', reason: error instanceof Error ? (error.stack ?? error.message) : String(error) },
          payloadText: '',
        };
      }
      const { result, payloadText } = evaluated;
      result.subjectRefno = subjectRefnoOf(result);
      results.push(result);
      appendFileSync(resultsPath, `${JSON.stringify(result)}\n`);
      // 空包（200、没有图元）的负载没什么可看的，原因都在 issues 里；留着只会把真正要看的失败负载挤出上限
      const keep = savePayloads === 'all'
        || (savePayloads === 'failed'
          && !['ok', 'not_annotatable', 'empty'].includes(result.outcome)
          && savedPayloads < 300);
      if (keep && payloadText && payloadText.length < (savePayloads === 'all' ? 32 : 4) * 1024 * 1024) {
        writeFileSync(path.join(savedPayloadDir, `${result.refno}.json`), payloadText);
        // 重放靠这一行认状态码（422 的错误信封不是数据包）、拿回候选信息
        appendFileSync(savedIndexPath, `${JSON.stringify({
          refno: result.refno,
          file: `${result.refno}.json`,
          status: result.httpStatus,
          bytes: result.bytes,
          ms: result.ms,
          noun: result.noun,
          name: result.name,
          site: result.site,
          zone: result.zone,
          parentNoun: result.parentNoun,
        })}\n`);
        savedPayloads += 1;
      }
      done += 1;
      if (Date.now() - lastLogAt > 10_000) {
        lastLogAt = Date.now();
        console.log(`[mbd-sweep] ${done}/${candidates.length}`);
      }
    });
  } finally {
    await frontend.close();
  }

  // ---- 汇总 ----
  const outcomes = new Map();
  const reasons = new Map();
  const issueGroups = new Map();
  const kindsByType = new Map();
  const timings = [];
  for (const result of results) {
    const type = typeOf(result);
    const subject = result.subjectRefno;
    bump(outcomes, result.outcome, result.refno, subject);
    if (result.outcome !== 'ok') bump(reasons, `${result.outcome} | ${type} | ${normalizeMessage(result.reason)}`, result.refno, subject);
    for (const issue of result.issues?.list ?? []) {
      bump(issueGroups, `${issue.severity} | ${type} | ${issue.category} ${issue.ruleId} | ${normalizeMessage(issue.message)}`, result.refno, subject);
    }
    if (result.kinds) {
      if (!kindsByType.has(type)) kindsByType.set(type, { objects: 0, kinds: {} });
      const entry = kindsByType.get(type);
      entry.objects += 1;
      for (const [kind, count] of Object.entries(result.kinds)) {
        const slot = entry.kinds[kind] ?? (entry.kinds[kind] = { primitives: 0, objects: 0 });
        slot.primitives += count;
        slot.objects += 1;
      }
    }
    if (typeof result.ms === 'number') timings.push(result.ms);
  }
  timings.sort((a, b) => a - b);
  const pct = (p) => (timings.length ? timings[Math.min(timings.length - 1, Math.floor(timings.length * p))] : null);
  const table = outcomeTable(results.map((result) => ({ type: typeOf(result), outcome: result.outcome })));
  const bySubject = groupBySubject(results);
  const subjectTable = outcomeTable(bySubject.entries);
  const subjectOutcomes = new Map();
  for (const entry of bySubject.entries) subjectOutcomes.set(entry.outcome, (subjectOutcomes.get(entry.outcome) ?? 0) + 1);
  const columns = [...OUTCOME_LABELS.keys(), ...[...outcomes.keys()].filter((outcome) => !OUTCOME_LABELS.has(outcome)).sort()]
    .filter((outcome) => outcomes.has(outcome));
  const layout = layoutFindings(results);
  const summary = {
    backend,
    base: payloadDir ? null : base,
    mbdBase: payloadDir ? null : mbdBase,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    enumeration,
    nounCounts,
    swept: results.length,
    subjects: bySubject.entries.length,
    outcomes: Object.fromEntries(sortedEntries(outcomes).map(([key, entry]) => [key, entry.count])),
    byType: Object.fromEntries([...table.entries()].sort().map(([type, row]) => [type, Object.fromEntries(row)])),
    bySubject: {
      subjects: bySubject.entries.length,
      withSeveralCandidates: bySubject.shared,
      outcomes: Object.fromEntries([...subjectOutcomes.entries()].sort((a, b) => b[1] - a[1])),
      byType: Object.fromEntries([...subjectTable.entries()].sort().map(([type, row]) => [type, Object.fromEntries(row)])),
      conflicts: bySubject.conflicts,
    },
    timingMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: timings.at(-1) ?? null },
    layout,
    reasons: sortedEntries(reasons).map(([key, entry]) => ({ key, count: entry.count, subjects: entry.subjects.size, samples: entry.samples })),
    issues: sortedEntries(issueGroups).map(([key, entry]) => ({ key, count: entry.count, subjects: entry.subjects.size, samples: entry.samples })),
    kindsByType: Object.fromEntries(kindsByType),
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));

  const lines = [];
  lines.push(`# MBD 全量联调扫描 ${new Date(startedAt).toISOString()}`, '');
  lines.push(payloadDir
    ? `- 重放：${JSON.stringify(backend)}（没有连后端）`
    : `- 后端：${JSON.stringify(backend)}（模型树 ${base}，MBD ${mbdBase}）`);
  lines.push(`- 扫了 ${results.length} 个候选 = ${bySubject.entries.length} 个归属对象（${bySubject.shared} 个归属对象各有不止一个候选，`
    + `多是 ZONE 直属的 STRU 与配对的 REST；候选之间结局或类型不一致的 ${bySubject.conflicts.length} 个），用时 ${Math.round(summary.elapsedMs / 1000)} 秒`);
  if (!payloadDir) lines.push(`- 取数耗时 p50 / p90 / p99 / 最长 = ${summary.timingMs.p50} / ${summary.timingMs.p90} / ${summary.timingMs.p99} / ${summary.timingMs.max} ms`);
  if (enumeration) lines.push(`- 枚举：${enumeration.sites} 个 SITE，跳过 ${enumeration.skippedSites.length} 个（${enumeration.skippedSites.slice(0, 8).join('、')}${enumeration.skippedSites.length > 8 ? ' …' : ''}），tree 请求 ${enumeration.treeRequests} 次、出错 ${enumeration.treeErrorCount} 次`);
  lines.push('', `## 标注类型 × 结局：按候选（${results.length}）`, '');
  lines.push(...outcomeTableLines(table, columns));
  lines.push('', `## 标注类型 × 结局：按归属对象去重（${bySubject.entries.length}）`, '');
  lines.push(...outcomeTableLines(subjectTable, columns));
  if (bySubject.conflicts.length > 0) {
    lines.push('', '候选之间结局或类型不一致的归属对象（上表记的是最差的那个）：', '');
    for (const conflict of bySubject.conflicts.slice(0, 40)) {
      lines.push(`- ${conflict.subject}：${conflict.members.map((member) => `${member.refno} ${member.type} ${member.outcome}`).join('；')}`);
    }
  }
  const totals = layout.totals;
  lines.push('', '## 排版（脚本摆的相机：整包标注装进一个视口，不是页面上的相机）', '');
  lines.push(`- 排了 ${totals.objects} 个候选、${totals.records} 条记录：带 LOD 画出 ${totals.drawn} 条、LOD 藏掉 ${totals.lodHidden} 条；`
    + `关掉 LOD 画出 ${totals.drawnNoLod} 条、仍画不出来 ${totals.emptyNoLod} 条；非有限数 ${totals.nonFinite} 个`);
  lines.push(`- 带 LOD 一条都不画的候选 ${layout.drawsNothingWithLod.length} 个${layout.drawsNothingWithLod.length > 0 ? `：${countByType(layout.drawsNothingWithLod)}` : ''}`);
  for (const item of layout.drawsNothingWithLod.slice(0, 40)) {
    lines.push(`  - ${item.refno}（${item.type}，${item.outcome}）：${item.records} 条记录，LOD 藏掉 ${item.lodHidden} 条`);
  }
  lines.push(`- 关掉 LOD 仍有记录画不出来的候选 ${layout.emptyNoLod.length} 个${layout.emptyNoLod.length > 0 ? `：${countByType(layout.emptyNoLod)}` : ''}`);
  for (const item of layout.emptyNoLod.slice(0, 40)) {
    lines.push(`  - ${item.refno}（${item.type}，${item.outcome}）：${item.records} 条（例：${(item.sample ?? []).slice(0, 3).join('、')}）`);
  }
  lines.push('', '## 不是 ok 的原因（候选数 × 结局 | 类型 | 原因）', '');
  for (const item of summary.reasons.slice(0, 80)) lines.push(`- ${item.count} × ${item.key}（归属对象 ${item.subjects}；例：${item.samples.join('、')}）`);
  lines.push('', '## 求解器 / 宿主 issues（条数 × 级别 | 类型 | 类别 规则号 | 内容）', '');
  for (const item of summary.issues.slice(0, 80)) lines.push(`- ${item.count} × ${item.key}（归属对象 ${item.subjects}；例：${item.samples.join('、')}）`);
  lines.push('', '## 各类型产出的图元 kind（图元数 / 有它的候选数）', '');
  for (const [type, entry] of Object.entries(summary.kindsByType)) {
    lines.push(`- ${type}（${entry.objects} 个对象）：${Object.entries(entry.kinds).sort().map(([kind, slot]) => `${kind} ${slot.primitives}/${slot.objects}`).join('，')}`);
  }
  writeFileSync(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
  console.log(`\n${lines.join('\n')}`);
}

main().catch((error) => {
  console.error('[mbd-sweep] 失败：', error);
  process.exitCode = 1;
});

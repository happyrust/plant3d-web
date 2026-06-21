import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18083';
const DEFAULT_ROOT_REFNO = '250160_0';
const DEFAULT_OUT = 'tmp/mbd-bran-candidates.json';
const DEFAULT_NODE_TIMEOUT_MS = 5_000;
const DEFAULT_SUBTREE_TIMEOUT_MS = 8_000;
const DEFAULT_DELAY_MS = 120;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_REF_LIMIT = 240;
const DEFAULT_BRAN_LIMIT = 40;
const DEFAULT_SUBTREE_LIMIT = 120;

function readArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    rootRefno: DEFAULT_ROOT_REFNO,
    out: DEFAULT_OUT,
    refs: null,
    visibleFile: null,
    refLimit: DEFAULT_REF_LIMIT,
    branLimit: DEFAULT_BRAN_LIMIT,
    subtreeLimit: DEFAULT_SUBTREE_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    nodeTimeoutMs: DEFAULT_NODE_TIMEOUT_MS,
    subtreeTimeoutMs: DEFAULT_SUBTREE_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? '';
    if (arg === '--base') args.baseUrl = next();
    else if (arg === '--root') args.rootRefno = next();
    else if (arg === '--out') args.out = next();
    else if (arg === '--refs') args.refs = splitRefs(next());
    else if (arg === '--visible-file') args.visibleFile = next();
    else if (arg === '--limit') args.refLimit = Number(next());
    else if (arg === '--bran-limit') args.branLimit = Number(next());
    else if (arg === '--subtree-limit') args.subtreeLimit = Number(next());
    else if (arg === '--concurrency') args.concurrency = Number(next());
    else if (arg === '--delay-ms') args.delayMs = Number(next());
    else if (arg === '--node-timeout-ms') args.nodeTimeoutMs = Number(next());
    else if (arg === '--subtree-timeout-ms') args.subtreeTimeoutMs = Number(next());
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/$/, '');
  args.refLimit = saneInteger(args.refLimit, DEFAULT_REF_LIMIT);
  args.branLimit = saneInteger(args.branLimit, DEFAULT_BRAN_LIMIT);
  args.subtreeLimit = saneInteger(args.subtreeLimit, DEFAULT_SUBTREE_LIMIT);
  args.concurrency = Math.max(1, Math.min(4, saneInteger(args.concurrency, DEFAULT_CONCURRENCY)));
  args.delayMs = Math.max(0, saneInteger(args.delayMs, DEFAULT_DELAY_MS));
  args.nodeTimeoutMs = Math.max(500, saneInteger(args.nodeTimeoutMs, DEFAULT_NODE_TIMEOUT_MS));
  args.subtreeTimeoutMs = Math.max(500, saneInteger(args.subtreeTimeoutMs, DEFAULT_SUBTREE_TIMEOUT_MS));
  return args;
}

function printHelp() {
  console.log(`Usage:
  node e2e/helpers/mbdDiscoverBranCandidates.mjs [options]

Options:
  --base <url>              Backend base URL. Default: ${DEFAULT_BASE_URL}
  --root <refno>            Root for /api/e3d/visible-insts. Default: ${DEFAULT_ROOT_REFNO}
  --visible-file <json>     Optional deploy-validation JSON; extracts 2013286704_* refs from it.
  --refs <a,b,c>            Optional explicit refno list. Skips visible-insts.
  --limit <n>               Max visible refs to classify. Default: ${DEFAULT_REF_LIMIT}
  --bran-limit <n>          Max BRAN nodes to enrich with subtree stats. Default: ${DEFAULT_BRAN_LIMIT}
  --subtree-limit <n>       Max subtree refs per BRAN. Default: ${DEFAULT_SUBTREE_LIMIT}
  --concurrency <n>         Node lookup concurrency, capped at 4. Default: ${DEFAULT_CONCURRENCY}
  --delay-ms <n>            Delay between requests per worker. Default: ${DEFAULT_DELAY_MS}
  --out <file.json>         Output path. Default: ${DEFAULT_OUT}
`);
}

function saneInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function splitRefs(value) {
  return [...new Set(
    String(value ?? '')
      .split(/[,;\s]+/)
      .map(normalizeRef)
      .filter(Boolean),
  )];
}

function normalizeRef(value) {
  return String(value ?? '').trim().replace(/[\\/]/g, '_');
}

function extractRefsFromText(text) {
  return [...new Set([...String(text).matchAll(/\b\d+_\d+\b/g)].map((match) => match[0]))];
}

function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, concurrency, delayMs, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
      await delay(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function loadSeedRefs(args) {
  if (args.refs?.length) return args.refs;

  if (args.visibleFile) {
    const file = path.resolve(args.visibleFile);
    if (!existsSync(file)) throw new Error(`visible file not found: ${file}`);
    return extractRefsFromText(readFileSync(file, 'utf8'));
  }

  const url = `${args.baseUrl}/api/e3d/visible-insts/${encodeURIComponent(args.rootRefno)}`;
  const result = await fetchJson(url, args.subtreeTimeoutMs);
  if (!result.ok || result.body?.success !== true) {
    throw new Error(`visible-insts failed: HTTP ${result.status} ${result.body?.error_message ?? ''}`);
  }
  return (result.body.refnos ?? []).map(normalizeRef).filter(Boolean);
}

function scoreCandidate(candidate) {
  const nouns = candidate.child_nouns ?? {};
  return (
    (nouns.TEE ?? 0) * 22 +
    (nouns.OLET ?? 0) * 18 +
    (nouns.REDU ?? 0) * 16 +
    (nouns.FLANGE ?? 0) * 10 +
    (nouns.FLAN ?? 0) * 10 +
    (nouns.VALV ?? 0) * 10 +
    (nouns.ELBO ?? 0) * 8 +
    (nouns.BEND ?? 0) * 8 +
    (nouns.TUBI ?? 0) * 4 +
    Math.max(0, candidate.subtree_ref_count - 1)
  );
}

function summarizeNouns(nodes) {
  const counts = {};
  for (const node of nodes) {
    const noun = String(node?.noun ?? '').trim().toUpperCase();
    if (!noun) continue;
    counts[noun] = (counts[noun] ?? 0) + 1;
  }
  return counts;
}

async function readNode(args, refno) {
  const url = `${args.baseUrl}/api/e3d/node/${encodeURIComponent(refno)}`;
  try {
    const result = await fetchJson(url, args.nodeTimeoutMs);
    if (!result.ok || result.body?.success !== true || !result.body.node) {
      return {
        refno,
        ok: false,
        error: `HTTP ${result.status} ${result.body?.error_message ?? 'node missing'}`,
      };
    }
    return { refno, ok: true, node: result.body.node };
  } catch (error) {
    return { refno, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function enrichBran(args, bran) {
  const url = `${args.baseUrl}/api/e3d/subtree-refnos/${encodeURIComponent(bran.refno)}?include_self=true&max_depth=2&limit=${args.subtreeLimit}`;
  let subtreeRefs = [];
  let truncated = false;
  let subtreeError = null;
  try {
    const result = await fetchJson(url, args.subtreeTimeoutMs);
    if (result.ok && result.body?.success === true) {
      subtreeRefs = (result.body.refnos ?? []).map(normalizeRef).filter(Boolean);
      truncated = result.body.truncated === true;
    } else {
      subtreeError = `HTTP ${result.status} ${result.body?.error_message ?? 'subtree failed'}`;
    }
  } catch (error) {
    subtreeError = error instanceof Error ? error.message : String(error);
  }

  const childRefs = subtreeRefs
    .filter((refno) => refno !== bran.refno)
    .slice(0, args.subtreeLimit);
  const childReads = await mapLimit(childRefs, args.concurrency, args.delayMs, (refno) =>
    readNode(args, refno),
  );
  const childNodes = childReads
    .filter((item) => item?.ok && item.node)
    .map((item) => item.node);
  const candidate = {
    refno: bran.refno,
    name: bran.node.name ?? null,
    owner: bran.node.owner ?? null,
    child_nouns: summarizeNouns(childNodes),
    subtree_ref_count: subtreeRefs.length,
    subtree_truncated: truncated,
    subtree_error: subtreeError,
  };
  candidate.score = scoreCandidate(candidate);
  return candidate;
}

try {
  const args = readArgs(process.argv.slice(2));
  const seedRefs = (await loadSeedRefs(args)).slice(0, args.refLimit);
  const nodeReads = await mapLimit(seedRefs, args.concurrency, args.delayMs, (refno) =>
    readNode(args, refno),
  );
  const branNodes = nodeReads
    .filter((item) => item?.ok && String(item.node?.noun ?? '').toUpperCase() === 'BRAN')
    .map((item) => ({ refno: item.refno, node: item.node }))
    .slice(0, args.branLimit);
  const candidates = await mapLimit(branNodes, 1, args.delayMs, (bran) => enrichBran(args, bran));
  candidates.sort((a, b) => b.score - a.score || a.refno.localeCompare(b.refno));

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: args.baseUrl,
    root_refno: args.rootRefno,
    seed_ref_count: seedRefs.length,
    bran_count: branNodes.length,
    candidate_count: candidates.length,
    e2e_refnos: candidates.map((item) => item.refno).join(','),
    candidates,
    failures: nodeReads
      .filter((item) => item && !item.ok)
      .slice(0, 50)
      .map((item) => ({ refno: item.refno, error: item.error })),
  };

  const out = path.resolve(args.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    out,
    seed_ref_count: summary.seed_ref_count,
    bran_count: summary.bran_count,
    candidate_count: summary.candidate_count,
    top_refnos: candidates.slice(0, 12).map((item) => item.refno),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

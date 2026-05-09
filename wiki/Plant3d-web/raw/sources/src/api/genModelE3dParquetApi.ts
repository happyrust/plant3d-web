/**
 * genModel E3D API (Parquet + DuckDB-WASM)
 *
 * Full Parquet Mode：在前端直接查询：
 * - output/<project>/scene_tree_parquet/pdms_tree_{dbnum}.parquet
 * - output/<project>/scene_tree_parquet/world_sites.parquet
 * - output/<project>/parquet/manifest_{dbnum}.json（用于 visible-insts 过滤）
 */

import * as duckdb from '@duckdb/duckdb-wasm';

import type {
  AncestorsResponse,
  ChildrenResponse,
  NodeResponse,
  SearchRequest,
  SearchResponse,
  SubtreeRefnosResponse,
  TreeNodeDto,
  VisibleInstsResponse,
} from '@/api/genModelE3dTypes';

import { buildFilesOutputUrl, getOutputProjectFromUrl } from '@/lib/filesOutput';

type DbMetaInfo = {
  db_files?: Record<string, { dbnum?: number }>
  ref0_to_dbnum?: Record<string, number>
  version?: number
}

type InstancesParquetManifest = {
  dbnum: number
  tables: {
    geo_instances: { file: string }
    tubings: { file: string }
  }
}

type WorldInfo = {
  world_refno_str: string
  world_id: bigint
  site_count: number
}

const DEFAULT_PROJECT_KEY = '__default__' as const;

function toAbsoluteUrl(url: string): string {
  // DuckDB-WASM 的 worker 可能运行在 blob: URL 下，若传入相对路径会导致 XHR.open 抛 Invalid URL。
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

async function urlExists(url: string): Promise<boolean> {
  // 资源可能是大文件（parquet），优先 HEAD；若服务不支持 HEAD，则用 bytes=0-0 的 Range GET。
  const abs = toAbsoluteUrl(url);
  try {
    const head = await fetch(abs, { method: 'HEAD' });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 403) return false;
  } catch {
    // ignore and fallback to range get
  }

  try {
    const get = await fetch(abs, { headers: { Range: 'bytes=0-0' } });
    return get.ok;
  } catch {
    return false;
  }
}

// DuckDB 单例（模块内）
let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

async function ensureDuckDB(): Promise<void> {
  if (db && conn) return;
  if (initPromise) return await initPromise;

  initPromise = (async () => {
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);

    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    conn = await db.connect();
  })();

  return await initPromise;
}

async function queryRows(sql: string): Promise<any[]> {
  await ensureDuckDB();
  if (!conn) throw new Error('DuckDB connection unavailable');
  const arrow = await conn.query(sql);
  return arrow.toArray() as any[];
}

function escapeSqlLike(raw: string): string {
  return String(raw || '').replace(/'/g, '\'\'');
}

function normalizeRefnoKey(raw: string): string {
  const s = String(raw || '').trim();
  const match = s.match(/[⟨<]([^⟩>]+)[⟩>]/);
  const core = match?.[1] ?? s;
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function parseRefno(raw: string): { key: string; str: string; ref0: bigint; sesno: bigint; id: bigint } | null {
  const key = normalizeRefnoKey(raw);
  const m = key.match(/^(\d+)_(\d+)$/);
  if (!m) return null;
  const ref0 = BigInt(m[1]!);
  const sesno = BigInt(m[2]!);
  const id = (ref0 << 32n) + (sesno & 0xffff_ffffn);
  return { key: `${m[1]}_${m[2]}`, str: `${m[1]}/${m[2]}`, ref0, sesno, id };
}

function toBigIntMaybe(v: any): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return null;
}

function decodeIdToRefnoStr(id: bigint): string {
  const ref0 = id >> 32n;
  const sesno = id & 0xffff_ffffn;
  return `${ref0.toString()}/${sesno.toString()}`;
}

let dbMetaCache: DbMetaInfo | null = null;
let dbMetaPromise: Promise<DbMetaInfo> | null = null;
let activeProjectKey: string | null = null;

async function ensureDbMeta(): Promise<DbMetaInfo> {
  const projectKey = ensureProjectScopedState();
  if (dbMetaCache) return dbMetaCache;
  if (dbMetaPromise) return await dbMetaPromise;

  dbMetaPromise = (async () => {
    const url = buildFilesOutputUrl('scene_tree/db_meta_info.json');
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`fetch db_meta_info.json failed: HTTP ${resp.status} ${resp.statusText}`);
    }
    const json = (await resp.json()) as DbMetaInfo;
    dbMetaCache = json;
    return json;
  })();

  try {
    return await dbMetaPromise;
  } catch (error) {
    if (activeProjectKey === projectKey) {
      dbMetaCache = null;
      dbMetaPromise = null;
    }
    throw error;
  }
}

function resolveDbnumByRef0(meta: DbMetaInfo, ref0: bigint): number | null {
  const map = meta.ref0_to_dbnum || {};
  const v = (map as any)[ref0.toString()];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function listDbnums(meta: DbMetaInfo): number[] {
  const dbFiles = meta.db_files || {};
  const out: number[] = [];
  for (const k of Object.keys(dbFiles)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

// 文件注册缓存
const registeredFiles = new Map<string, string>(); // localName -> url

async function registerFile(localName: string, url: string): Promise<void> {
  await ensureDuckDB();
  if (!db) throw new Error('DuckDB not initialized');

  const absUrl = toAbsoluteUrl(url);

  const prev = registeredFiles.get(localName);
  if (prev === absUrl) return;

  // 允许同名覆盖（不同 output_project 切换时）
  await db.registerFileURL(localName, absUrl, duckdb.DuckDBDataProtocol.HTTP, false);
  registeredFiles.set(localName, absUrl);
}

const treeLocalNameByDbnum = new Map<number, string>();

async function ensureTreeFile(dbnum: number): Promise<string> {
  ensureProjectScopedState();
  const existing = treeLocalNameByDbnum.get(dbnum);
  if (existing) return existing;

  const localName = `e3d_pdms_tree_${dbnum}.parquet`;
  const url = buildFilesOutputUrl(`scene_tree_parquet/pdms_tree_${dbnum}.parquet`);
  await registerFile(localName, url);
  treeLocalNameByDbnum.set(dbnum, localName);
  return localName;
}

// 并行 HEAD 预检：一次性确定哪些 dbnum 有 parquet tree 文件，避免 DuckDB 逐个超时
let availableTreeDbnumsCache: number[] | null = null;
let availableTreeDbnumsPromise: Promise<number[]> | null = null;

async function getAvailableTreeDbnums(): Promise<number[]> {
  ensureProjectScopedState();
  if (availableTreeDbnumsCache !== null) return availableTreeDbnumsCache;
  if (availableTreeDbnumsPromise) return await availableTreeDbnumsPromise;

  availableTreeDbnumsPromise = (async () => {
    let allDbnums: number[];
    try {
      allDbnums = await ensureWorldDbnums();
    } catch {
      const meta = await ensureDbMeta();
      allDbnums = listDbnums(meta);
    }
    // 并行 HEAD 检测所有 dbnum 的 parquet 文件
    const results = await Promise.allSettled(
      allDbnums.map(async (dbnum) => {
        const url = toAbsoluteUrl(buildFilesOutputUrl(`scene_tree_parquet/pdms_tree_${dbnum}.parquet`));
        const resp = await fetch(url, { method: 'HEAD' });
        if (!resp.ok) throw new Error('404');
        return dbnum;
      })
    );
    const available = results
      .filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled')
      .map((r) => r.value);
    availableTreeDbnumsCache = available;
    return available;
  })().finally(() => {
    availableTreeDbnumsPromise = null;
  });

  return await availableTreeDbnumsPromise;
}

let worldSitesLocalName: string | null = null;
let worldInfoCache: WorldInfo | null = null;

async function ensureWorldSitesFile(): Promise<string> {
  ensureProjectScopedState();
  if (worldSitesLocalName) return worldSitesLocalName;
  const localName = 'e3d_world_sites.parquet';
  const url = buildFilesOutputUrl('scene_tree_parquet/world_sites.parquet');
  await registerFile(localName, url);
  worldSitesLocalName = localName;
  return localName;
}

async function ensureWorldInfo(): Promise<WorldInfo> {
  ensureProjectScopedState();
  if (worldInfoCache) return worldInfoCache;
  const file = await ensureWorldSitesFile();
  const rows = await queryRows(`
    SELECT
      world_refno_str,
      world_id,
      count(*) AS site_count
    FROM parquet_scan('${file}')
    GROUP BY world_refno_str, world_id
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    throw new Error('world_sites.parquet is empty');
  }
  const world_refno_str = String(row.world_refno_str || '');
  const world_id = toBigIntMaybe(row.world_id);
  const site_count = Number(row.site_count ?? 0);
  if (!world_refno_str || world_id === null) {
    throw new Error('invalid world_sites.parquet schema/values');
  }
  worldInfoCache = { world_refno_str, world_id, site_count };
  return worldInfoCache;
}

async function parallelLimit<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const max = Math.max(1, Math.floor(concurrency || 1));
  let i = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

let worldDbnumsCache: number[] | null = null;
let worldDbnumsPromise: Promise<number[]> | null = null;

async function ensureWorldDbnums(): Promise<number[]> {
  ensureProjectScopedState();
  if (worldDbnumsCache) return worldDbnumsCache;
  if (worldDbnumsPromise) return await worldDbnumsPromise;

  worldDbnumsPromise = (async () => {
    const file = await ensureWorldSitesFile();
    const rows = await queryRows(`
      SELECT DISTINCT dbnum
      FROM parquet_scan('${file}')
      WHERE dbnum IS NOT NULL
      ORDER BY dbnum
    `);
    const out = rows
      .map((r) => Number(r.dbnum))
      .filter((n) => Number.isFinite(n) && n > 0);
    worldDbnumsCache = out;
    return out;
  })().finally(() => {
    worldDbnumsPromise = null;
  });

  return await worldDbnumsPromise;
}

let treeDbnumsCache: Set<number> | null = null;
let treeDbnumsPromise: Promise<Set<number>> | null = null;

async function ensureTreeDbnums(): Promise<Set<number>> {
  ensureProjectScopedState();
  if (treeDbnumsCache) return treeDbnumsCache;
  if (treeDbnumsPromise) return await treeDbnumsPromise;

  treeDbnumsPromise = (async () => {
    const dbnums = await ensureWorldDbnums();
    const ok = new Set<number>();
    await parallelLimit(dbnums, 16, async (dbnum) => {
      const treeUrl = buildFilesOutputUrl(`scene_tree_parquet/pdms_tree_${dbnum}.parquet`);
      if (await urlExists(treeUrl)) ok.add(dbnum);
    });
    treeDbnumsCache = ok;
    return ok;
  })().finally(() => {
    treeDbnumsPromise = null;
  });

  return await treeDbnumsPromise;
}

let instancesDbnumsCache: Set<number> | null = null;
let instancesDbnumsPromise: Promise<Set<number>> | null = null;

async function ensureInstancesDbnums(): Promise<Set<number>> {
  ensureProjectScopedState();
  if (instancesDbnumsCache) return instancesDbnumsCache;
  if (instancesDbnumsPromise) return await instancesDbnumsPromise;

  instancesDbnumsPromise = (async () => {
    const dbnums = await ensureWorldDbnums();
    const ok = new Set<number>();
    await parallelLimit(dbnums, 16, async (dbnum) => {
      const instUrl = buildFilesOutputUrl(`instances/instances_${dbnum}.parquet`);
      const geoUrl = buildFilesOutputUrl(`instances/geo_instances_${dbnum}.parquet`);
      const [instOk, geoOk] = await Promise.all([urlExists(instUrl), urlExists(geoUrl)]);
      if (instOk && geoOk) ok.add(dbnum);
    });
    instancesDbnumsCache = ok;
    return ok;
  })().finally(() => {
    instancesDbnumsPromise = null;
  });

  return await instancesDbnumsPromise;
}

let worldSupportedDbnumsCache: Set<number> | null = null;
let worldSupportedDbnumsPromise: Promise<Set<number>> | null = null;

async function ensureWorldSupportedDbnums(): Promise<Set<number>> {
  ensureProjectScopedState();
  if (worldSupportedDbnumsCache) return worldSupportedDbnumsCache;
  if (worldSupportedDbnumsPromise) return await worldSupportedDbnumsPromise;

  worldSupportedDbnumsPromise = (async () => {
    const [trees, insts] = await Promise.all([ensureTreeDbnums(), ensureInstancesDbnums()]);
    const out = new Set<number>();
    for (const n of trees) {
      if (insts.has(n)) out.add(n);
    }
    worldSupportedDbnumsCache = out;
    return out;
  })().finally(() => {
    worldSupportedDbnumsPromise = null;
  });

  return await worldSupportedDbnumsPromise;
}

// parquet（用于 visible-insts 过滤）
const instancesLocalByDbnum = new Map<number, { geo_instances: string; tubings: string | null }>();

function getActiveProjectKey(): string {
  return getOutputProjectFromUrl() ?? DEFAULT_PROJECT_KEY;
}

function resetProjectScopedState(): void {
  dbMetaCache = null;
  dbMetaPromise = null;
  registeredFiles.clear();
  treeLocalNameByDbnum.clear();
  availableTreeDbnumsCache = null;
  availableTreeDbnumsPromise = null;
  worldSitesLocalName = null;
  worldInfoCache = null;
  worldDbnumsCache = null;
  worldDbnumsPromise = null;
  treeDbnumsCache = null;
  treeDbnumsPromise = null;
  instancesDbnumsCache = null;
  instancesDbnumsPromise = null;
  worldSupportedDbnumsCache = null;
  worldSupportedDbnumsPromise = null;
  instancesLocalByDbnum.clear();
}

function ensureProjectScopedState(): string {
  const projectKey = getActiveProjectKey();
  if (activeProjectKey !== projectKey) {
    resetProjectScopedState();
    activeProjectKey = projectKey;
  }
  return projectKey;
}

async function ensureInstancesFiles(dbnum: number): Promise<{ geo_instances: string; tubings: string | null }> {
  ensureProjectScopedState();
  const cached = instancesLocalByDbnum.get(dbnum);
  if (cached) return cached;

  // 优先 manifest_{dbnum}.json（若不存在则回退到约定命名）
  let geoFile = `geo_instances_${dbnum}.parquet`;
  let tubiFile: string | null = `tubings_${dbnum}.parquet`;
  try {
    const manifestUrl = buildFilesOutputUrl(`instances/manifest_${dbnum}.json`);
    const resp = await fetch(manifestUrl);
    if (resp.ok) {
      const manifest = (await resp.json()) as InstancesParquetManifest;
      const mfGeo = manifest?.tables?.geo_instances?.file;
      const mfTubi = manifest?.tables?.tubings?.file;
      if (mfGeo) geoFile = mfGeo;
      if (mfTubi) tubiFile = mfTubi;
    }
  } catch {
    // ignore
  }

  const geoLocal = `e3d_geo_instances_${dbnum}.parquet`;
  const tubiLocal = `e3d_tubings_${dbnum}.parquet`;
  await registerFile(geoLocal, buildFilesOutputUrl(`instances/${geoFile}`));

  let tubiLocalOrNull: string | null = null;
  if (tubiFile) {
    const tubiUrl = buildFilesOutputUrl(`instances/${tubiFile}`);
    if (await urlExists(tubiUrl)) {
      await registerFile(tubiLocal, tubiUrl);
      tubiLocalOrNull = tubiLocal;
    }
  }

  const out = { geo_instances: geoLocal, tubings: tubiLocalOrNull };
  instancesLocalByDbnum.set(dbnum, out);
  return out;
}

function dtoFromRow(row: any): TreeNodeDto {
  return {
    refno: String(row.refno ?? row.refno_str ?? ''),
    name: String(row.name ?? ''),
    noun: String(row.noun ?? ''),
    owner: row.owner !== undefined ? (row.owner === null ? null : String(row.owner)) : row.owner_refno_str ? String(row.owner_refno_str) : null,
    children_count: row.children_count === null || row.children_count === undefined ? null : Number(row.children_count),
  };
}

export async function e3dParquetGetWorldRoot(): Promise<NodeResponse> {
  try {
    const info = await ensureWorldInfo();
    // 如果只导出了部分 dbnum 的 Parquet（常见于调试/增量导出），WORL 的 children_count 以“可用站点数”为准。
    let childrenCount = info.site_count;
    const supported = await ensureWorldSupportedDbnums();
    if (supported.size > 0) {
      const file = await ensureWorldSitesFile();
      const list = Array.from(supported.values());
      const where =
        list.length === 1 ? `dbnum = ${Math.floor(list[0]!)}` : `dbnum IN (${list.map((n) => Math.floor(n)).join(', ')})`;
      const cntRows = await queryRows(`
        SELECT count(*) AS cnt
        FROM parquet_scan('${file}')
        WHERE ${where}
      `);
      const cnt = Number(cntRows?.[0]?.cnt ?? 0);
      if (Number.isFinite(cnt) && cnt >= 0) childrenCount = cnt;
    }
    return {
      success: true,
      node: {
        refno: info.world_refno_str,
        name: '*',
        noun: 'WORL',
        owner: null,
        children_count: childrenCount,
      },
      error_message: null,
    };
  } catch (e) {
    return { success: false, node: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}

export async function e3dParquetGetNode(refno: string): Promise<NodeResponse> {
  try {
    const parsed = parseRefno(refno);
    if (!parsed) return { success: false, node: null, error_message: 'invalid refno' };

    const meta = await ensureDbMeta();
    const dbnum = resolveDbnumByRef0(meta, parsed.ref0);
    if (!dbnum) return { success: false, node: null, error_message: 'resolve_dbnum_for_refno failed' };

    const treeFile = await ensureTreeFile(dbnum);
    const rows = await queryRows(`
      SELECT
        refno_str AS refno,
        name,
        noun,
        owner_refno_str AS owner,
        children_count
      FROM parquet_scan('${treeFile}')
      WHERE id = ${parsed.id.toString()}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return { success: false, node: null, error_message: 'node not found' };
    return { success: true, node: dtoFromRow(row), error_message: null };
  } catch (e) {
    return { success: false, node: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}

export async function e3dParquetGetChildren(refno: string, limit?: number): Promise<ChildrenResponse> {
  const parentKey = normalizeRefnoKey(refno);
  try {
    const world = await ensureWorldInfo();
    const worldKey = normalizeRefnoKey(world.world_refno_str);

    // WORL：children 走 world_sites.parquet
    if (parentKey && parentKey === worldKey) {
      const file = await ensureWorldSitesFile();
      const lim = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : undefined;
      const rows = await queryRows(`
        SELECT
          site_refno_str AS refno,
          site_name AS name,
          site_noun AS noun,
          world_refno_str AS owner,
          children_count,
          dbnum
        FROM parquet_scan('${file}')
        ORDER BY site_refno_str
      `);

      const supported = await ensureWorldSupportedDbnums();
      const filtered = supported.size > 0 ? rows.filter((r) => supported.has(Number(r.dbnum))) : rows;
      const sliced = lim ? filtered.slice(0, lim) : filtered;

      return {
        success: true,
        parent_refno: world.world_refno_str,
        children: sliced.map(dtoFromRow),
        truncated: !!(lim && filtered.length > lim),
        error_message: null,
      };
    }

    const parsed = parseRefno(refno);
    if (!parsed) {
      return { success: false, parent_refno: refno, children: [], truncated: false, error_message: 'invalid refno' };
    }

    const meta = await ensureDbMeta();
    const dbnum = resolveDbnumByRef0(meta, parsed.ref0);
    if (!dbnum) {
      return { success: false, parent_refno: parsed.str, children: [], truncated: false, error_message: 'resolve_dbnum_for_refno failed' };
    }

    const treeFile = await ensureTreeFile(dbnum);
    const lim = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : undefined;

    const rows = await queryRows(`
      SELECT
        refno_str AS refno,
        name,
        noun,
        owner_refno_str AS owner,
        children_count
      FROM parquet_scan('${treeFile}')
      WHERE parent = ${parsed.id.toString()}
      ORDER BY id
      ${lim ? `LIMIT ${lim}` : ''}
    `);

    let truncated = false;
    if (lim) {
      const cntRows = await queryRows(`
        SELECT count(*) AS cnt
        FROM parquet_scan('${treeFile}')
        WHERE parent = ${parsed.id.toString()}
      `);
      const cnt = Number(cntRows?.[0]?.cnt ?? 0);
      truncated = cnt > lim;
    }

    return {
      success: true,
      parent_refno: parsed.str,
      children: rows.map(dtoFromRow),
      truncated,
      error_message: null,
    };
  } catch (e) {
    return {
      success: false,
      parent_refno: parentKey || refno,
      children: [],
      truncated: false,
      error_message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function e3dParquetGetAncestors(refno: string): Promise<AncestorsResponse> {
  try {
    const parsed0 = parseRefno(refno);
    if (!parsed0) return { success: false, refnos: [], error_message: 'invalid refno' };

    const meta = await ensureDbMeta();

    const out: string[] = [];
    const visited = new Set<string>();
    let cur = parsed0;

    for (let step = 0; step < 512; step++) {
      if (visited.has(cur.key)) break;
      visited.add(cur.key);

      const dbnum = resolveDbnumByRef0(meta, cur.ref0);
      if (!dbnum) break;

      const treeFile = await ensureTreeFile(dbnum);
      const rows = await queryRows(`
        SELECT parent
        FROM parquet_scan('${treeFile}')
        WHERE id = ${cur.id.toString()}
        LIMIT 1
      `);
      const parentId = toBigIntMaybe(rows?.[0]?.parent);
      if (parentId === null) break;

      const parentStr = decodeIdToRefnoStr(parentId);
      out.push(parentStr);

      const next = parseRefno(parentStr);
      if (!next) break;
      cur = next;
    }

    return { success: true, refnos: out, error_message: null };
  } catch (e) {
    return { success: false, refnos: [], error_message: e instanceof Error ? e.message : String(e) };
  }
}

async function querySubtreeRefnosSingleDb(
  dbnum: number,
  rootId: bigint,
  params?: { includeSelf?: boolean; maxDepth?: number; limit?: number }
): Promise<{ refnos: string[]; truncated: boolean }> {
  const treeFile = await ensureTreeFile(dbnum);
  const includeSelf = params?.includeSelf !== false;
  const maxDepth = params?.maxDepth === undefined ? 64 : Math.max(0, Math.min(params.maxDepth, 256));
  const limit = params?.limit === undefined ? 50_000 : Math.max(1, Math.min(params.limit, 200_000));

  if (maxDepth <= 0) return { refnos: [], truncated: false };

  const depthWhere = `WHERE s.depth < ${Math.floor(maxDepth)}`;
  const base = includeSelf
    ? `SELECT id, 0 AS depth FROM tree WHERE id = ${rootId.toString()}`
    : `SELECT id, 1 AS depth FROM tree WHERE parent = ${rootId.toString()}`;

  const sql = `
    WITH RECURSIVE tree AS (
      SELECT id, parent, refno_str
      FROM parquet_scan('${treeFile}')
    ),
    subtree(id, depth) AS (
      ${base}
      UNION ALL
      SELECT t.id, s.depth + 1
      FROM tree t
      JOIN subtree s ON t.parent = s.id
      ${depthWhere}
    )
    SELECT t.refno_str AS refno
    FROM tree t
    JOIN subtree s ON t.id = s.id
    ORDER BY s.depth, t.id
    LIMIT ${Math.floor(limit)}
  `;

  const rows = await queryRows(sql);
  const refnos = rows.map((r) => String(r.refno || '')).filter(Boolean);
  const truncated = refnos.length >= limit;
  return { refnos, truncated };
}

function sortUniqueRefnos(refnos: string[], limit?: number): string[] {
  const out = Array.from(new Set(refnos.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

async function queryNodeNounSingleDb(dbnum: number, nodeId: bigint): Promise<string | null> {
  const treeFile = await ensureTreeFile(dbnum);
  const rows = await queryRows(`
    SELECT noun
    FROM parquet_scan('${treeFile}')
    WHERE id = ${nodeId.toString()}
    LIMIT 1
  `);
  const noun = String(rows?.[0]?.noun || '').trim().toUpperCase();
  return noun || null;
}

async function queryChildRefnosSingleDb(
  dbnum: number,
  parentId: bigint,
  params?: { limit?: number }
): Promise<string[]> {
  const treeFile = await ensureTreeFile(dbnum);
  const limit = params?.limit === undefined ? 200_000 : Math.max(1, Math.min(params.limit, 200_000));
  const rows = await queryRows(`
    SELECT refno_str AS refno
    FROM parquet_scan('${treeFile}')
    WHERE parent = ${parentId.toString()}
    ORDER BY id
    LIMIT ${Math.floor(limit)}
  `);
  return rows.map((r) => String(r.refno || '')).filter(Boolean);
}

async function queryDescendantRefnosByNounsSingleDb(
  dbnum: number,
  rootId: bigint,
  nouns: string[],
  params?: { limit?: number }
): Promise<string[]> {
  const treeFile = await ensureTreeFile(dbnum);
  const limit = params?.limit === undefined ? 200_000 : Math.max(1, Math.min(params.limit, 200_000));
  const normalizedNouns = nouns.map((noun) => noun.trim().toUpperCase()).filter(Boolean);
  if (normalizedNouns.length === 0) return [];
  const nounList = normalizedNouns.map((noun) => `'${escapeSqlLike(noun)}'`).join(', ');

  const rows = await queryRows(`
    WITH RECURSIVE tree AS (
      SELECT id, parent, refno_str, noun
      FROM parquet_scan('${treeFile}')
    ),
    subtree(id) AS (
      SELECT id FROM tree WHERE id = ${rootId.toString()}
      UNION ALL
      SELECT t.id
      FROM tree t
      JOIN subtree s ON t.parent = s.id
    )
    SELECT t.refno_str AS refno
    FROM tree t
    JOIN subtree s ON t.id = s.id
    WHERE t.id != ${rootId.toString()} AND upper(t.noun) IN (${nounList})
    ORDER BY t.id
    LIMIT ${Math.floor(limit)}
  `);

  return rows.map((r) => String(r.refno || '')).filter(Boolean);
}

export async function e3dParquetGetSubtreeRefnos(
  refno: string,
  params?: { includeSelf?: boolean; maxDepth?: number; limit?: number }
): Promise<SubtreeRefnosResponse> {
  try {
    const world = await ensureWorldInfo();
    const worldKey = normalizeRefnoKey(world.world_refno_str);
    const key = normalizeRefnoKey(refno);

    const includeSelf = params?.includeSelf !== false;
    const maxDepth = params?.maxDepth === undefined ? 64 : Math.max(0, Math.min(params.maxDepth, 256));
    const limit = params?.limit === undefined ? 50_000 : Math.max(1, Math.min(params.limit, 200_000));

    // WORL：用 world_sites 驱动（并递归每个 SITE）
    if (key && key === worldKey) {
      const file = await ensureWorldSitesFile();
      const siteRows = await queryRows(`
        SELECT site_refno_str AS refno, dbnum
        FROM parquet_scan('${file}')
        ORDER BY site_refno_str
      `);
      const supportedWorld = await ensureWorldSupportedDbnums();
      const supportedTrees = supportedWorld.size > 0 ? supportedWorld : await ensureTreeDbnums();
      const sites = (supportedTrees.size > 0 ? siteRows.filter((r) => supportedTrees.has(Number(r.dbnum))) : siteRows)
        .map((r) => ({ refno: String(r.refno || ''), dbnum: Number(r.dbnum) }))
        .filter((x) => x.refno && Number.isFinite(x.dbnum) && x.dbnum > 0);

      const out: string[] = [];
      const seen = new Set<string>();
      const push = (v: string) => {
        if (!v) return;
        if (seen.has(v)) return;
        seen.add(v);
        out.push(v);
      };

      if (includeSelf) push(world.world_refno_str);
      for (const s of sites) push(s.refno);

      // maxDepth <= 1：只返回 WORL + SITE（不展开）
      if (maxDepth <= 1) {
        const truncated = out.length > limit;
        return {
          success: true,
          refnos: truncated ? out.slice(0, limit) : out,
          truncated,
          error_message: null,
        };
      }

      for (const s of sites) {
        if (out.length >= limit) break;
        const p = parseRefno(s.refno);
        if (!p) continue;
        try {
          const sub = await querySubtreeRefnosSingleDb(s.dbnum, p.id, {
            includeSelf: true,
            maxDepth: maxDepth - 1,
            limit: limit - out.length,
          });
          for (const r of sub.refnos) push(r);
        } catch {
          // 忽略单库失败（可能缺少对应 pdms_tree parquet）
        }
      }

      const truncated = out.length >= limit;
      return { success: true, refnos: out.slice(0, limit), truncated, error_message: null };
    }

    const parsed = parseRefno(refno);
    if (!parsed) return { success: false, refnos: [], truncated: false, error_message: 'invalid refno' };

    const meta = await ensureDbMeta();
    const dbnum = resolveDbnumByRef0(meta, parsed.ref0);
    if (!dbnum) return { success: false, refnos: [], truncated: false, error_message: 'resolve_dbnum_for_refno failed' };

    const { refnos, truncated } = await querySubtreeRefnosSingleDb(dbnum, parsed.id, params);
    return { success: true, refnos, truncated, error_message: null };
  } catch (e) {
    return { success: false, refnos: [], truncated: false, error_message: e instanceof Error ? e.message : String(e) };
  }
}

async function queryVisibleInstRefnosSingleDb(
  dbnum: number,
  rootId: bigint,
  params?: { limit?: number }
): Promise<string[]> {
  const treeFile = await ensureTreeFile(dbnum);
  const instFiles = await ensureInstancesFiles(dbnum);
  const limit = params?.limit === undefined ? 200_000 : Math.max(1, Math.min(params.limit, 200_000));

  const unionTubi = instFiles.tubings
    ? `
      UNION
      SELECT DISTINCT t.tubi_refno_str AS refno_str
      FROM parquet_scan('${instFiles.tubings}') t
      JOIN subtree_refnos sr ON sr.refno_str = t.tubi_refno_str
    `
    : '';

  const sql = `
    WITH RECURSIVE tree AS (
      SELECT id, parent, refno_str
      FROM parquet_scan('${treeFile}')
    ),
    subtree(id) AS (
      SELECT id FROM tree WHERE id = ${rootId.toString()}
      UNION ALL
      SELECT t.id
      FROM tree t
      JOIN subtree s ON t.parent = s.id
    ),
    subtree_refnos AS (
      SELECT t.refno_str AS refno_str
      FROM tree t
      JOIN subtree s ON t.id = s.id
    ),
    visible AS (
      SELECT DISTINCT gi.refno_str AS refno_str
      FROM parquet_scan('${instFiles.geo_instances}') gi
      JOIN subtree_refnos sr ON sr.refno_str = gi.refno_str
      ${unionTubi}
    )
    SELECT refno_str AS refno
    FROM visible
    ORDER BY refno_str
    LIMIT ${Math.floor(limit)}
  `;

  const rows = await queryRows(sql);
  return rows.map((r) => String(r.refno || '')).filter(Boolean);
}

async function queryVisibleLoadScopeRefnosSingleDb(
  dbnum: number,
  rootId: bigint,
  params?: { limit?: number }
): Promise<string[]> {
  const limit = params?.limit === undefined ? 200_000 : Math.max(1, Math.min(params.limit, 200_000));
  const noun = await queryNodeNounSingleDb(dbnum, rootId);

  if (noun === 'BRAN' || noun === 'HANG') {
    return sortUniqueRefnos(await queryChildRefnosSingleDb(dbnum, rootId, { limit }), limit);
  }

  const ordinaryVisible = await queryVisibleInstRefnosSingleDb(dbnum, rootId, { limit });
  const branHangRoots = await queryDescendantRefnosByNounsSingleDb(dbnum, rootId, ['BRAN', 'HANG'], { limit });
  const out = [...ordinaryVisible];

  for (const branHangRoot of branHangRoots) {
    out.push(branHangRoot);
    const parsed = parseRefno(branHangRoot);
    if (!parsed) continue;
    out.push(...await queryChildRefnosSingleDb(dbnum, parsed.id, { limit }));
  }

  return sortUniqueRefnos(out, limit);
}

export async function e3dParquetGetVisibleInsts(refno: string): Promise<VisibleInstsResponse> {
  try {
    const world = await ensureWorldInfo();
    const worldKey = normalizeRefnoKey(world.world_refno_str);
    const key = normalizeRefnoKey(refno);

    const limit = 200_000;

    // WORL：合并所有 SITE 的 visible refnos
    if (key && key === worldKey) {
      const file = await ensureWorldSitesFile();
      const siteRows = await queryRows(`
        SELECT site_refno_str AS refno, dbnum
        FROM parquet_scan('${file}')
        ORDER BY site_refno_str
      `);
      const supported = await ensureWorldSupportedDbnums();
      const sites = (supported.size > 0 ? siteRows.filter((r) => supported.has(Number(r.dbnum))) : siteRows)
        .map((r) => ({ refno: String(r.refno || ''), dbnum: Number(r.dbnum) }))
        .filter((x) => x.refno && Number.isFinite(x.dbnum) && x.dbnum > 0);

      const out: string[] = [];
      const seen = new Set<string>();
      const push = (v: string) => {
        if (!v) return;
        if (seen.has(v)) return;
        seen.add(v);
        out.push(v);
      };

      for (const s of sites) {
        if (out.length >= limit) break;
        const p = parseRefno(s.refno);
        if (!p) continue;
        try {
          const list = await queryVisibleLoadScopeRefnosSingleDb(s.dbnum, p.id, { limit: limit - out.length });
          for (const r of list) push(r);
        } catch {
          // 忽略单库失败（可能缺少 tree/instances parquet）
        }
      }

      return { success: true, refno: world.world_refno_str, refnos: out.slice(0, limit), error_message: null };
    }

    const parsed = parseRefno(refno);
    if (!parsed) return { success: false, refno, refnos: [], error_message: 'invalid refno' };

    const meta = await ensureDbMeta();
    const dbnum = resolveDbnumByRef0(meta, parsed.ref0);
    if (!dbnum) return { success: false, refno: parsed.str, refnos: [], error_message: 'resolve_dbnum_for_refno failed' };

    const list = await queryVisibleLoadScopeRefnosSingleDb(dbnum, parsed.id, { limit });
    return { success: true, refno: parsed.str, refnos: list, error_message: null };
  } catch (e) {
    return { success: false, refno, refnos: [], error_message: e instanceof Error ? e.message : String(e) };
  }
}

export async function e3dParquetSearch(req: SearchRequest): Promise<SearchResponse> {
  try {
    const keyword = String(req?.keyword || '').trim();
    const limit = req?.limit === undefined ? 200 : Math.max(1, Math.min(req.limit, 5000));
    const nouns = Array.isArray(req?.nouns) ? req!.nouns!.map((x) => String(x || '').trim()).filter(Boolean) : [];

    if (!keyword) return { success: true, items: [], error_message: null };

    // 1) refno 直查
    if (/^\d+[_/]\d+$/.test(keyword)) {
      const nodeResp = await e3dParquetGetNode(keyword);
      if (nodeResp.success && nodeResp.node) {
        return { success: true, items: [nodeResp.node], error_message: null };
      }
    }

    // 使用预检缓存：只查询已确认存在 parquet 文件的 dbnum
    const dbnums = await getAvailableTreeDbnums();

    const kw = escapeSqlLike(keyword);
    const nounClause =
      nouns.length > 0
        ? `AND noun IN (${nouns.map((n) => `'${escapeSqlLike(n)}'`).join(', ')})`
        : '';

    const out: TreeNodeDto[] = [];
    for (const dbnum of dbnums) {
      if (out.length >= limit) break;
      try {
        const treeFile = await ensureTreeFile(dbnum);
        const remaining = limit - out.length;

        const rows = await queryRows(`
          SELECT
            refno_str AS refno,
            name,
            noun,
            owner_refno_str AS owner,
            children_count
          FROM parquet_scan('${treeFile}')
          WHERE (
            name ILIKE '%${kw}%'
            OR refno_str LIKE '%${kw}%'
          )
          ${nounClause}
          LIMIT ${Math.floor(remaining)}
        `);
        for (const r of rows) out.push(dtoFromRow(r));
      } catch {
        // 单库查询失败，跳过
      }
    }

    return { success: true, items: out, error_message: null };
  } catch (e) {
    return { success: false, items: [], error_message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 通过 db_meta_info.json 的 ref0_to_dbnum 映射查询 refno 对应的 dbnum
 * @param refno 元件参考号，格式为 "24384_12345" 或 "24384/12345"
 * @returns dbnum 数字，查询失败返回 null
 */
export async function e3dParquetResolveDbnumForRefno(refno: string): Promise<number | null> {
  try {
    const parsed = parseRefno(refno);
    if (!parsed) return null;
    const meta = await ensureDbMeta();
    return resolveDbnumByRef0(meta, parsed.ref0);
  } catch {
    return null;
  }
}

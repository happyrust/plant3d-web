/**
 * Dbno Instances Parquet Loader (new multi-table schema)
 *
 * 目标：
 * - 从 `/files/output/<project>/parquet/manifest_{dbno}.json` 读取表清单
 * - 使用 DuckDB-WASM (HTTP Range) 查询 Parquet
 * - 按 refno 批量查询并返回 `Map<refnoKey, InstanceEntry[]>`，供 DTXLoader 增量加载
 *
 * 注意：
 * - 不替代旧 JSON loader；由 DTXLoader 在 dataSource=auto 时优先尝试本 loader，失败回退 JSON。
 */

import { shallowRef } from 'vue';

import * as duckdb from '@duckdb/duckdb-wasm';
import { Matrix4 } from 'three';

import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { getParquetVersion } from '@/api/genModelRealtimeApi';
import { buildFilesOutputUrl } from '@/lib/filesOutput';

type ParquetManifest = {
  version: number
  format: 'parquet'
  generated_at: string
  dbnum: number
  root_refno?: string | null
  tables: {
    instances: { file: string; rows?: number }
    geo_instances: { file: string; rows?: number }
    tubings: { file: string; rows?: number }
    transforms: { file: string; rows?: number }
    aabb: { file: string; rows?: number }
  }
  mesh_validation?: {
    lod_tag?: string
    report_file?: string
    checked_geo_hashes?: number
    missing_geo_hashes?: number
    missing_owner_refnos?: number
  }
}

type MissingMeshReport = {
  version?: number
  generated_at?: string
  dbnum?: number
  mesh_base_dir?: string
  lod_tag?: string
  checked_geo_hashes?: number
  missing_geo_hashes?: number
  missing_owner_refnos?: number
  missing_geo_hash_list?: {
    geo_hash?: string
    row_count?: number
    owner_refno_count?: number
  }[]
}

export type ParquetMeshValidationInfo = {
  lodTag: string
  reportFile: string | null
  checkedGeoHashes: number
  missingGeoHashes: number
  missingOwnerRefnos: number
  topMissingGeoHashes: { geoHash: string; rowCount: number; ownerRefnoCount: number }[]
  reportGeneratedAt: string | null
}

export type ParquetQueryTiming = {
  phaseMs: {
    duckdbInit: number
    registerDbno: number
    mainSql: number
    mainRows: number
    tubiSql: number
    tubiRows: number
    total: number
  }
  stats: {
    requestedRefnos: number
    chunkCount: number
    mainRows: number
    tubiRows: number
    resultBuckets: number
    resultEntries: number
  }
}

type RegisteredDbno = {
  dbno: number
  baseDirUrl: string
  manifest: ParquetManifest
  // duckdb local filenames (to avoid cross-dbno collision)
  files: {
    instances: string
    geo_instances: string
    tubings: string
    transforms: string
    aabb: string
  }
}

type ParquetManifestWithBaseDir = {
  manifest: ParquetManifest
  // manifest 所在目录：用于拼接 parquet 文件 URL
  baseDir: 'parquet' | 'instances'
}

type ParquetBaseDir = 'parquet' | 'instances'

type ParquetDirectoryHint = {
  manifestBaseDir: ParquetBaseDir | null
  filesBaseDir: ParquetBaseDir | null
}

const DUCKDB_REMOTE_QUERY_KEY = '__duckdb';

class ParquetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParquetNotFoundError';
  }
}

function toAbsoluteUrl(url: string): string {
  // DuckDB-WASM 的 worker 可能运行在 blob: URL 下，若传入相对路径会导致 XHR.open 抛 Invalid URL。
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

export function buildParquetRemoteFileUrl(baseDirUrl: string, remoteFile: string, cacheBustToken: string): string {
  try {
    const base = typeof window === 'undefined'
      ? new URL(toAbsoluteUrl(baseDirUrl), 'http://127.0.0.1')
      : new URL(toAbsoluteUrl(baseDirUrl), window.location.origin);
    const cleanFile = String(remoteFile || '').replace(/^\/+/, '');
    const nextPath = `${base.pathname.replace(/\/+$/, '')}/${cleanFile}`.replace(/\/{2,}/g, '/');
    base.pathname = nextPath;
    const parsed = base;
    parsed.searchParams.set(DUCKDB_REMOTE_QUERY_KEY, cacheBustToken);
    return typeof window === 'undefined'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    const remotePath = `${baseDirUrl}/${remoteFile}`.replace(/\/{2,}/g, '/');
    const remoteUrl = toAbsoluteUrl(remotePath);
    const separator = remoteUrl.includes('?') ? '&' : '?';
    return `${remoteUrl}${separator}${DUCKDB_REMOTE_QUERY_KEY}=${encodeURIComponent(cacheBustToken)}`;
  }
}

function createDuckdbRemoteQueryToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function urlExists(url: string): Promise<boolean> {
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

async function tryFetchManifest(
  dbno: number,
  baseDir: ParquetBaseDir
): Promise<ParquetManifest | null> {
  const url = buildFilesOutputUrl(`${baseDir}/manifest_${dbno}.json`);
  const resp = await fetch(url, { cache: 'no-store' });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`加载 manifest 失败(${baseDir}): HTTP ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as ParquetManifest;
  if (!json || typeof json !== 'object' || !json.tables?.instances?.file) {
    throw new Error(`manifest 结构不符合预期(${baseDir})`);
  }
  return json;
}

function getDefaultParquetFiles(dbno: number): Pick<RegisteredDbno['files'], 'instances' | 'geo_instances' | 'transforms' | 'aabb'> {
  return {
    instances: `instances_${dbno}.parquet`,
    geo_instances: `geo_instances_${dbno}.parquet`,
    transforms: `transforms_${dbno}.parquet`,
    aabb: `aabb_${dbno}.parquet`,
  };
}

async function areRequiredParquetFilesPresent(
  baseDir: ParquetBaseDir,
  files: Pick<RegisteredDbno['files'], 'instances' | 'geo_instances' | 'transforms' | 'aabb'>
): Promise<boolean> {
  const checks = [
    urlExists(buildFilesOutputUrl(`${baseDir}/${files.instances}`)),
    urlExists(buildFilesOutputUrl(`${baseDir}/${files.geo_instances}`)),
    urlExists(buildFilesOutputUrl(`${baseDir}/${files.transforms}`)),
    urlExists(buildFilesOutputUrl(`${baseDir}/${files.aabb}`)),
  ];
  const [instOk, geoOk, transOk, aabbOk] = await Promise.all(checks);
  return instOk && geoOk && transOk && aabbOk;
}

function normalizeBaseDir(value: unknown): ParquetBaseDir | null {
  return value === 'parquet' || value === 'instances' ? value : null;
}

async function getDirectoryHint(dbno: number): Promise<ParquetDirectoryHint | null> {
  try {
    const version = await getParquetVersion(dbno);
    return {
      manifestBaseDir: normalizeBaseDir(version.manifest_base_dir),
      filesBaseDir: normalizeBaseDir(version.files_base_dir),
    };
  } catch {
    return null;
  }
}

// DuckDB 单例（参考 useParquetSqlStore 的实现）
let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// 每个 dbno 的注册缓存
const registeredByDbno = new Map<number, RegisteredDbno>();
const registeringByDbno = new Map<number, Promise<RegisteredDbno>>();
const availableByDbno = new Map<number, boolean>();
const availabilityCheckingByDbno = new Map<number, Promise<boolean>>();
const meshValidationByDbno = new Map<number, Promise<ParquetMeshValidationInfo | null>>();

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

function normalizeRefnoKey(refno: string): string {
  // DTXLoader 使用的 key 约定：'/' -> '_'
  return String(refno || '').trim().replace('/', '_');
}

function sqlQuoteString(s: string): string {
  // DuckDB SQL: 单引号用 '' 转义
  return `'${String(s).replace(/'/g, '\'\'')}'`;
}

function buildInList(values: string[]): string {
  // 使用 LIST 常量 + UNNEST 比较安全，也避免超长 IN (...) 语句
  // e.g. UNNEST(['a','b','c'])
  const inner = values.map(sqlQuoteString).join(', ');
  return `[${inner}]`;
}

function colsMajorToMatrixArray(row: any): number[] | null {
  // transforms.parquet: m00..m33 按列主序存储（后端 DMat4.to_cols_array）
  const keys = [
    'm00','m10','m20','m30',
    'm01','m11','m21','m31',
    'm02','m12','m22','m32',
    'm03','m13','m23','m33',
  ];
  const out: number[] = [];
  for (const k of keys) {
    const v = (row as any)[k];
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

function colsMajorToMatrixArrayWithPrefix(row: any, prefix: string): number[] | null {
  const prefixedRow: Record<string, unknown> = {
    m00: row?.[`${prefix}m00`],
    m10: row?.[`${prefix}m10`],
    m20: row?.[`${prefix}m20`],
    m30: row?.[`${prefix}m30`],
    m01: row?.[`${prefix}m01`],
    m11: row?.[`${prefix}m11`],
    m21: row?.[`${prefix}m21`],
    m31: row?.[`${prefix}m31`],
    m02: row?.[`${prefix}m02`],
    m12: row?.[`${prefix}m12`],
    m22: row?.[`${prefix}m22`],
    m32: row?.[`${prefix}m32`],
    m03: row?.[`${prefix}m03`],
    m13: row?.[`${prefix}m13`],
    m23: row?.[`${prefix}m23`],
    m33: row?.[`${prefix}m33`],
  };
  const hasAnyValue = Object.values(prefixedRow).some((v) => v !== null && v !== undefined);
  if (!hasAnyValue) return null;
  return colsMajorToMatrixArray(prefixedRow);
}

function multiplyWorldAndGeoLocal(worldCols: number[], geoCols: number[] | null): number[] {
  // three.js Matrix4.fromArray 默认按列主序解释（与 glMatrix/OpenGL 一致）
  const mw = new Matrix4().fromArray(worldCols);
  if (!geoCols) return mw.toArray();
  const mg = new Matrix4().fromArray(geoCols);
  // world * geoLocal
  const combined = mw.multiply(mg);
  return combined.toArray();
}

function createParquetQueryTiming(requestedRefnos: number, chunkCount: number): ParquetQueryTiming {
  return {
    phaseMs: {
      duckdbInit: 0,
      registerDbno: 0,
      mainSql: 0,
      mainRows: 0,
      tubiSql: 0,
      tubiRows: 0,
      total: 0,
    },
    stats: {
      requestedRefnos,
      chunkCount,
      mainRows: 0,
      tubiRows: 0,
      resultBuckets: 0,
      resultEntries: 0,
    },
  };
}

async function fetchManifest(dbno: number): Promise<ParquetManifestWithBaseDir> {
  const hint = await getDirectoryHint(dbno);
  if (hint?.manifestBaseDir) {
    const hintedManifest = await tryFetchManifest(dbno, hint.manifestBaseDir);
    if (hintedManifest) {
      return { manifest: hintedManifest, baseDir: hint.manifestBaseDir };
    }
  }

  // 优先新目录 parquet/，兼容旧目录 instances/
  const parquetManifest = await tryFetchManifest(dbno, 'parquet');
  if (parquetManifest) {
    return { manifest: parquetManifest, baseDir: 'parquet' };
  }
  const instancesManifest = await tryFetchManifest(dbno, 'instances');
  if (instancesManifest) {
    return { manifest: instancesManifest, baseDir: 'instances' };
  }

  // 兼容“仅导出 Parquet 文件但未生成 manifest”的场景：按新目录约定命名兜底。
  const fallbackBaseDir = hint?.filesBaseDir ?? 'parquet';
  return {
    baseDir: fallbackBaseDir,
    manifest: {
      version: 1,
      format: 'parquet',
      generated_at: new Date().toISOString(),
      dbnum: dbno,
      root_refno: null,
      tables: {
        instances: { file: `instances_${dbno}.parquet` },
        geo_instances: { file: `geo_instances_${dbno}.parquet` },
        tubings: { file: `tubings_${dbno}.parquet` },
        transforms: { file: `transforms_${dbno}.parquet` },
        aabb: { file: `aabb_${dbno}.parquet` },
      },
    },
  };
}

async function registerDbno(dbno: number, options: { forceRefresh?: boolean } = {}): Promise<RegisteredDbno> {
  const forceRefresh = options.forceRefresh === true;
  const cached = registeredByDbno.get(dbno);
  if (cached && !forceRefresh) return cached;
  const pending = registeringByDbno.get(dbno);
  if (pending) return await pending;

  const task = (async () => {
    await ensureDuckDB();
    if (!db || !conn) throw new Error('DuckDB not ready');

    const { manifest, baseDir } = await fetchManifest(dbno);
    const baseDirUrl = buildFilesOutputUrl(baseDir);

    const files = {
      instances: `p_${dbno}_instances.parquet`,
      geo_instances: `p_${dbno}_geo_instances.parquet`,
      tubings: `p_${dbno}_tubings.parquet`,
      transforms: `p_${dbno}_transforms.parquet`,
      aabb: `p_${dbno}_aabb.parquet`,
    };
    const requestToken = createDuckdbRemoteQueryToken();

    // 注册远程文件（HTTP Range）
    const registerOne = async (localName: string, remoteFile: string) => {
      const remoteUrl = buildParquetRemoteFileUrl(baseDirUrl, remoteFile, requestToken);
      await db!.registerFileURL(localName, remoteUrl, duckdb.DuckDBDataProtocol.HTTP, true);
    };

    await Promise.all([
      registerOne(files.instances, manifest.tables.instances.file),
      registerOne(files.geo_instances, manifest.tables.geo_instances.file),
      registerOne(files.tubings, manifest.tables.tubings.file),
      registerOne(files.transforms, manifest.tables.transforms.file),
      registerOne(files.aabb, manifest.tables.aabb.file),
    ]);

    const reg: RegisteredDbno = { dbno, baseDirUrl, manifest, files };
    registeredByDbno.set(dbno, reg);
    return reg;
  })();

  registeringByDbno.set(dbno, task);
  try {
    return await task;
  } finally {
    registeringByDbno.delete(dbno);
  }
}

export function useDbnoInstancesParquetLoader() {
  const lastError = shallowRef<string | null>(null);
  const lastQueryTiming = shallowRef<ParquetQueryTiming | null>(null);

  async function prewarmDuckDB(): Promise<void> {
    await ensureDuckDB();
  }

  async function prewarmDbno(dbno: number): Promise<void> {
    await registerDbno(dbno);
  }

  async function isParquetAvailable(dbno: number): Promise<boolean> {
    if (availableByDbno.get(dbno) === true) return true;

    const pending = availabilityCheckingByDbno.get(dbno);
    if (pending) return await pending;

    const task = (async () => {
      try {
        const hint = await getDirectoryHint(dbno);
        if (hint?.manifestBaseDir) {
          const hintedManifest = await tryFetchManifest(dbno, hint.manifestBaseDir);
          if (hintedManifest) {
            return await areRequiredParquetFilesPresent(hint.manifestBaseDir, {
              instances: hintedManifest.tables.instances.file,
              geo_instances: hintedManifest.tables.geo_instances.file,
              transforms: hintedManifest.tables.transforms.file,
              aabb: hintedManifest.tables.aabb.file,
            });
          }
        }

        if (hint?.filesBaseDir) {
          return await areRequiredParquetFilesPresent(hint.filesBaseDir, getDefaultParquetFiles(dbno));
        }

        // 1) manifest 驱动（优先 parquet/，兼容 instances/）
        const parquetManifest = await tryFetchManifest(dbno, 'parquet');
        if (parquetManifest) {
          return await areRequiredParquetFilesPresent('parquet', {
            instances: parquetManifest.tables.instances.file,
            geo_instances: parquetManifest.tables.geo_instances.file,
            transforms: parquetManifest.tables.transforms.file,
            aabb: parquetManifest.tables.aabb.file,
          });
        }

        const instancesManifest = await tryFetchManifest(dbno, 'instances');
        if (instancesManifest) {
          return await areRequiredParquetFilesPresent('instances', {
            instances: instancesManifest.tables.instances.file,
            geo_instances: instancesManifest.tables.geo_instances.file,
            transforms: instancesManifest.tables.transforms.file,
            aabb: instancesManifest.tables.aabb.file,
          });
        }

        // 2) 无 manifest：按约定命名兜底探测
        const defaults = getDefaultParquetFiles(dbno);
        const okParquet = await areRequiredParquetFilesPresent('parquet', defaults);
        if (okParquet) return true;
        return await areRequiredParquetFilesPresent('instances', defaults);
      } catch {
        return false;
      }
    })().finally(() => {
      availabilityCheckingByDbno.delete(dbno);
    });

    availabilityCheckingByDbno.set(dbno, task);
    const available = await task;
    if (available) availableByDbno.set(dbno, true);
    return available;
  }

  async function queryInstanceEntriesByRefnos(
    dbno: number,
    refnoKeys: string[],
    options?: { debug?: boolean }
  ): Promise<Map<string, InstanceEntry[]>> {
    lastError.value = null;
    lastQueryTiming.value = null;

    const debug = options?.debug === true;
    const normalized = Array.from(new Set(refnoKeys.map(normalizeRefnoKey))).filter(Boolean);
    if (normalized.length === 0) return new Map();
    const timing = createParquetQueryTiming(normalized.length, Math.ceil(normalized.length / 500));
    const totalStartedAt = Date.now();

    const duckdbInitStartedAt = Date.now();
    await ensureDuckDB();
    timing.phaseMs.duckdbInit = Date.now() - duckdbInitStartedAt;
    if (!conn) throw new Error('DuckDB connection unavailable');

    const registerDbnoStartedAt = Date.now();
    const reg = await registerDbno(dbno, { forceRefresh: true });
    timing.phaseMs.registerDbno = Date.now() - registerDbnoStartedAt;

    // refno 在 parquet 里是 refno_str（与前端 refnoKey 一致：`24381_100818` 这种下划线格式）
    const toRefnoStr = (k: string) => String(k);

    const resultMap = new Map<string, InstanceEntry[]>();

    const CHUNK = 500;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunkKeys = normalized.slice(i, i + CHUNK);
      const chunkRefnoStr = chunkKeys.map(toRefnoStr);
      const listExpr = buildInList(chunkRefnoStr);

      const sql = `
        WITH target(refno_str) AS (
          SELECT UNNEST(${listExpr}) AS refno_str
        )
        SELECT
          i.refno_str,
          i.noun,
          i.owner_refno_str,
          i.owner_noun,
          i.spec_value,
          i.has_neg,
          i.trans_hash,
          i.aabb_hash,
          gi.geo_index,
          gi.geo_hash,
          gi.geo_trans_hash,
          aw.min_x, aw.min_y, aw.min_z, aw.max_x, aw.max_y, aw.max_z,
          tw.m00, tw.m10, tw.m20, tw.m30,
          tw.m01, tw.m11, tw.m21, tw.m31,
          tw.m02, tw.m12, tw.m22, tw.m32,
          tw.m03, tw.m13, tw.m23, tw.m33,
          tg.m00 AS g_m00, tg.m10 AS g_m10, tg.m20 AS g_m20, tg.m30 AS g_m30,
          tg.m01 AS g_m01, tg.m11 AS g_m11, tg.m21 AS g_m21, tg.m31 AS g_m31,
          tg.m02 AS g_m02, tg.m12 AS g_m12, tg.m22 AS g_m22, tg.m32 AS g_m32,
          tg.m03 AS g_m03, tg.m13 AS g_m13, tg.m23 AS g_m23, tg.m33 AS g_m33
        FROM target t
        JOIN parquet_scan('${reg.files.instances}') i ON i.refno_str = t.refno_str
        JOIN parquet_scan('${reg.files.geo_instances}') gi ON gi.refno_str = i.refno_str
        LEFT JOIN parquet_scan('${reg.files.aabb}') aw ON aw.aabb_hash = i.aabb_hash
        LEFT JOIN parquet_scan('${reg.files.transforms}') tw ON tw.trans_hash = i.trans_hash
        LEFT JOIN parquet_scan('${reg.files.transforms}') tg ON tg.trans_hash = gi.geo_trans_hash
        ORDER BY i.refno_str, gi.geo_index
      `;

      const mainSqlStartedAt = Date.now();
      const arrow = await conn.query(sql);
      timing.phaseMs.mainSql += Date.now() - mainSqlStartedAt;

      const mainRowsStartedAt = Date.now();
      const rows = arrow.toArray() as any[];
      timing.stats.mainRows += rows.length;

      for (const row of rows) {
        const refnoStr = String(row.refno_str || '');
        const refnoKey = normalizeRefnoKey(refnoStr);
        if (!refnoKey) continue;

        const worldCols = colsMajorToMatrixArray(row);
        if (!worldCols) continue;

        // geo local matrix（可能为空）
        const geoLocal = (() => {
          const gRow: any = {
            m00: row.g_m00, m10: row.g_m10, m20: row.g_m20, m30: row.g_m30,
            m01: row.g_m01, m11: row.g_m11, m21: row.g_m21, m31: row.g_m31,
            m02: row.g_m02, m12: row.g_m12, m22: row.g_m22, m32: row.g_m32,
            m03: row.g_m03, m13: row.g_m13, m23: row.g_m23, m33: row.g_m33,
          };
          // 如果 tg 没 join 到，字段会是 null
          const anyVal = Object.values(gRow).some((v) => v !== null && v !== undefined);
          if (!anyVal) return null;
          const arr = colsMajorToMatrixArray(gRow);
          return arr;
        })();

        const matrix = multiplyWorldAndGeoLocal(worldCols, geoLocal);

        const aabb =
          row.min_x !== null && row.max_x !== null
            ? { min: [Number(row.min_x), Number(row.min_y), Number(row.min_z)], max: [Number(row.max_x), Number(row.max_y), Number(row.max_z)] }
            : null;

        const noun = String(row.noun ?? '');
        const ownerRefno = row.owner_refno_str ? String(row.owner_refno_str) : null;
        const ownerNoun = String(row.owner_noun ?? '');

        const entry: InstanceEntry = {
          geo_hash: String(row.geo_hash ?? ''),
          matrix,
          geo_index: Number(row.geo_index ?? 0),
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          lod_mask: 1,
          uniforms: {
            refno: refnoStr,
            noun,
            name: '',
            owner_refno: ownerRefno,
            owner_noun: ownerNoun,
            spec_value: Number(row.spec_value ?? 0),
            has_neg: Boolean(row.has_neg),
            trans_hash: row.trans_hash ? String(row.trans_hash) : '',
            aabb_hash: row.aabb_hash ? String(row.aabb_hash) : '',
          },
          refno_transform: worldCols,
          aabb,
        };

        if (!entry.geo_hash) continue;

        const list = resultMap.get(refnoKey) ?? [];
        list.push(entry);
        resultMap.set(refnoKey, list);
      }
      timing.phaseMs.mainRows += Date.now() - mainRowsStartedAt;

      if (debug) {
         
        console.log('[instances-parquet] chunk loaded', { dbno, chunk: [i, i + CHUNK], rows: rows.length });
      }

      const sqlTubi = `
        WITH target(refno_str) AS (
          SELECT UNNEST(${listExpr}) AS refno_str
        ),
        tubi_candidates AS (
          SELECT DISTINCT
            t.refno_str AS bucket_refno_str,
            tb.tubi_refno_str,
            tb.owner_refno_str,
            tb.order,
            tb.geo_hash,
            tb.trans_hash,
            tb.aabb_hash,
            tb.spec_value
          FROM target t
          JOIN parquet_scan('${reg.files.tubings}') tb
            ON tb.tubi_refno_str = t.refno_str
            OR tb.owner_refno_str = t.refno_str
        )
        SELECT
          c.bucket_refno_str AS refno_str,
          c.tubi_refno_str,
          'TUBI' AS noun,
          '' AS name,
          c.owner_refno_str,
          '' AS owner_noun,
          c.spec_value,
          false AS has_neg,
          c.trans_hash,
          c.aabb_hash,
          c.order AS geo_index,
          c.geo_hash,
          '' AS geo_trans_hash,
          aw.min_x, aw.min_y, aw.min_z, aw.max_x, aw.max_y, aw.max_z,
          tw.m00, tw.m10, tw.m20, tw.m30,
          tw.m01, tw.m11, tw.m21, tw.m31,
          tw.m02, tw.m12, tw.m22, tw.m32,
          tw.m03, tw.m13, tw.m23, tw.m33,
          iw.m00 AS iw_m00, iw.m10 AS iw_m10, iw.m20 AS iw_m20, iw.m30 AS iw_m30,
          iw.m01 AS iw_m01, iw.m11 AS iw_m11, iw.m21 AS iw_m21, iw.m31 AS iw_m31,
          iw.m02 AS iw_m02, iw.m12 AS iw_m12, iw.m22 AS iw_m22, iw.m32 AS iw_m32,
          iw.m03 AS iw_m03, iw.m13 AS iw_m13, iw.m23 AS iw_m23, iw.m33 AS iw_m33,
          NULL AS g_m00, NULL AS g_m10, NULL AS g_m20, NULL AS g_m30,
          NULL AS g_m01, NULL AS g_m11, NULL AS g_m21, NULL AS g_m31,
          NULL AS g_m02, NULL AS g_m12, NULL AS g_m22, NULL AS g_m32,
          NULL AS g_m03, NULL AS g_m13, NULL AS g_m23, NULL AS g_m33
        FROM tubi_candidates c
        LEFT JOIN parquet_scan('${reg.files.aabb}') aw ON aw.aabb_hash = c.aabb_hash
        LEFT JOIN parquet_scan('${reg.files.transforms}') tw ON tw.trans_hash = c.trans_hash
        LEFT JOIN parquet_scan('${reg.files.instances}') ti ON ti.refno_str = c.tubi_refno_str
        LEFT JOIN parquet_scan('${reg.files.transforms}') iw ON iw.trans_hash = ti.trans_hash
        ORDER BY c.bucket_refno_str, c.order, c.tubi_refno_str
      `;

      const tubiSqlStartedAt = Date.now();
      const tubiArrow = await conn.query(sqlTubi);
      timing.phaseMs.tubiSql += Date.now() - tubiSqlStartedAt;

      const tubiRowsStartedAt = Date.now();
      const tubiRows = tubiArrow.toArray() as any[];
      timing.stats.tubiRows += tubiRows.length;

      for (const row of tubiRows) {
        const refnoStr = String(row.refno_str || '');
        const refnoKey = normalizeRefnoKey(refnoStr);
        if (!refnoKey) continue;

        // TUBI 的 trans_hash 已是世界空间完整变换矩阵（world_trans_hash），
        // 不需要再乘以 parentWorld
        const tubiTransform = colsMajorToMatrixArray(row);
        if (!tubiTransform) continue;
        const matrix = tubiTransform;

        const aabb =
          row.min_x !== null && row.max_x !== null
            ? { min: [Number(row.min_x), Number(row.min_y), Number(row.min_z)], max: [Number(row.max_x), Number(row.max_y), Number(row.max_z)] }
            : null;

        const noun = String(row.noun ?? 'TUBI');
        const ownerRefno = row.owner_refno_str ? String(row.owner_refno_str) : null;
        const ownerNoun = String(row.owner_noun ?? '');

        const entry: InstanceEntry = {
          geo_hash: String(row.geo_hash ?? ''),
          matrix,
          geo_index: Number(row.geo_index ?? 0),
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          lod_mask: 1,
          uniforms: {
            refno: row.tubi_refno_str ? String(row.tubi_refno_str) : refnoStr,
            noun,
            name: '',
            owner_refno: ownerRefno,
            owner_noun: ownerNoun,
            spec_value: Number(row.spec_value ?? 0),
            has_neg: false,
            trans_hash: row.trans_hash ? String(row.trans_hash) : '',
            aabb_hash: row.aabb_hash ? String(row.aabb_hash) : '',
          },
          refno_transform: tubiTransform,
          aabb,
        };

        if (!entry.geo_hash) continue;

        const list = resultMap.get(refnoKey) ?? [];
        list.push(entry);
        resultMap.set(refnoKey, list);
      }
      timing.phaseMs.tubiRows += Date.now() - tubiRowsStartedAt;

    }

    timing.stats.resultBuckets = resultMap.size;
    timing.stats.resultEntries = Array.from(resultMap.values()).reduce((sum, entries) => sum + entries.length, 0);
    timing.phaseMs.total = Date.now() - totalStartedAt;
    lastQueryTiming.value = timing;
    return resultMap;
  }

  async function queryAllRefnosByDbno(
    dbno: number,
    options?: { limit?: number; debug?: boolean }
  ): Promise<string[]> {
    lastError.value = null;

    const reg = await registerDbno(dbno);
    await ensureDuckDB();
    if (!conn) throw new Error('DuckDB connection unavailable');

    const limit =
      typeof options?.limit === 'number' && Number.isFinite(options.limit)
        ? Math.max(1, Math.floor(options.limit))
        : null;

    const sql = `
      WITH all_refnos AS (
        SELECT refno_str AS refno
        FROM parquet_scan('${reg.files.instances}')
        UNION
        SELECT owner_refno_str AS refno
        FROM parquet_scan('${reg.files.tubings}')
        UNION
        SELECT tubi_refno_str AS refno
        FROM parquet_scan('${reg.files.tubings}')
      )
      SELECT refno
      FROM all_refnos
      WHERE refno IS NOT NULL AND refno <> ''
      ORDER BY refno
      ${limit ? `LIMIT ${limit}` : ''}
    `;

    const arrow = await conn.query(sql);
    const rows = arrow.toArray() as any[];
    const out = Array.from(
      new Set(
        rows
          .map((r) => normalizeRefnoKey(String(r?.refno || '')))
          .filter(Boolean)
      )
    );

    if (options?.debug) {
       
      console.log('[instances-parquet] all refnos loaded', { dbno, count: out.length });
    }

    return out;
  }

  async function queryMeshValidationInfoByDbno(
    dbno: number,
    options?: { topN?: number; forceRefresh?: boolean }
  ): Promise<ParquetMeshValidationInfo | null> {
    const topN =
      typeof options?.topN === 'number' && Number.isFinite(options.topN)
        ? Math.max(1, Math.floor(options.topN))
        : 5;

    if (options?.forceRefresh) {
      meshValidationByDbno.delete(dbno);
    }

    const cached = meshValidationByDbno.get(dbno);
    if (cached) return await cached;

    const task = (async (): Promise<ParquetMeshValidationInfo | null> => {
      let manifest: ParquetManifest;
      let baseDir: ParquetBaseDir;
      try {
        const fetched = await fetchManifest(dbno);
        manifest = fetched.manifest;
        baseDir = fetched.baseDir;
      } catch {
        return null;
      }

      const mv = manifest.mesh_validation;
      if (!mv || typeof mv !== 'object') return null;

      const info: ParquetMeshValidationInfo = {
        lodTag: String(mv.lod_tag || 'L1'),
        reportFile: mv.report_file ? String(mv.report_file) : null,
        checkedGeoHashes: Number(mv.checked_geo_hashes || 0),
        missingGeoHashes: Number(mv.missing_geo_hashes || 0),
        missingOwnerRefnos: Number(mv.missing_owner_refnos || 0),
        topMissingGeoHashes: [],
        reportGeneratedAt: null,
      };

      if (!info.reportFile) return info;

      try {
        const reportUrl = buildFilesOutputUrl(`${baseDir}/${info.reportFile}`);
        // 同 manifest，缺失报告也需要实时读取最新内容。
        const resp = await fetch(reportUrl, { cache: 'no-store' });
        if (!resp.ok) return info;
        const report = (await resp.json()) as MissingMeshReport;
        info.reportGeneratedAt = report.generated_at ? String(report.generated_at) : null;
        const list = Array.isArray(report.missing_geo_hash_list) ? report.missing_geo_hash_list : [];
        info.topMissingGeoHashes = list
          .map((x) => ({
            geoHash: String(x?.geo_hash || ''),
            rowCount: Number(x?.row_count || 0),
            ownerRefnoCount: Number(x?.owner_refno_count || 0),
          }))
          .filter((x) => !!x.geoHash)
          .sort((a, b) => b.rowCount - a.rowCount || a.geoHash.localeCompare(b.geoHash))
          .slice(0, topN);
      } catch {
        // ignore report fetch errors; manifest-level stats are still useful
      }

      return info;
    })();

    meshValidationByDbno.set(dbno, task);
    return await task;
  }

  return {
    lastError,
    lastQueryTiming,
    prewarmDuckDB,
    prewarmDbno,
    isParquetAvailable,
    queryInstanceEntriesByRefnos,
    queryAllRefnosByDbno,
    queryMeshValidationInfoByDbno,
  };
}

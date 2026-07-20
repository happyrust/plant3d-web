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

import {
  AsyncDuckDB,
  ConsoleLogger,
  DuckDBDataProtocol,
  type AsyncDuckDBConnection,
} from '@duckdb/duckdb-wasm';
import { Matrix4, Vector3 } from 'three';

import type { PtsetPoint, PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { MbdDimensionDto } from '@/dimension';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { getParquetVersion } from '@/api/genModelRealtimeApi';
import { buildFilesOutputUrl } from '@/lib/filesOutput';
import { configureLocalDuckDBExtensions, selectLocalDuckDBBundle } from '@/utils/duckdbBundles';

export type ParquetManifest = {
  version: number
  format: 'parquet'
  generated_at: string
  dbnum: number
  root_refno?: string | null
  tables: {
    instances: { file: string; rows?: number }
    ptsets?: { file: string; rows?: number; key?: string[] }
    primitive_keypoints?: { file: string; rows?: number; key?: string[] }
    mbd_dimensions?: { file: string; rows?: number; key?: string[] }
    geo_instances: { file: string; rows?: number }
    tubings: { file: string; rows?: number }
    transforms: { file: string; rows?: number }
    aabb: { file: string; rows?: number }
  }
  ptset_unit?: {
    source?: string
    target?: string
    conversion_factor?: number
    coordinate_space?: string
  }
  primitive_keypoint_unit?: {
    source?: string
    source_unit?: string
    target?: string
    target_unit?: string
    conversion_factor?: number
    coordinate_space?: string
  }
  mbd_dimension_unit?: {
    source?: string
    target?: string
    conversion_factor?: number
    coordinate_space?: string
    source_to_design?: number[]
  }
  mesh_validation?: {
    lod_tag?: string
    report_file?: string
    checked_geo_hashes?: number
    missing_geo_hashes?: number
    missing_owner_refnos?: number
  }
}

type ParquetBucketIndex = {
  version: number
  format: 'parquet-buckets'
  generated_at?: string
  dbnum: number
  buckets: {
    name: string
    role?: string
    noun?: string
    manifest?: string
    prefix?: string
    tables: ParquetManifest['tables']
    rows?: {
      instances?: number
      geo_instances?: number
      tubings?: number
    }
    total_bytes?: number
  }[]
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

export type ParquetPtsetChildSummary = {
  refno: string
  noun: string
  name: string
  success: boolean
  ptCount: number
  errorMessage: string | null
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

export type PrimitiveKeyPointCandidate = {
  id: string
  refno: string
  objectId: string
  geoHash: string
  geoIndex: number
  keypointIndex: number
  kind: string
  source: string
  local: [number, number, number]
  world: [number, number, number]
  hasDir: boolean
  dir: [number, number, number] | null
  circle?: {
    center: [number, number, number]
    rim: [number, number, number]
    normal: [number, number, number]
  }
  arc?: {
    center: [number, number, number]
    rim: [number, number, number]
    normal: [number, number, number]
  }
}

export type MbdDimensionLoadResult = {
  dimensions: MbdDimensionDto[]
  skipped: { id: string; reason: string }[]
}

type RegisteredDbno = {
  dbno: number
  baseDirUrl: string
  manifest: ParquetManifest
  // duckdb local filenames (to avoid cross-dbno collision)
  files: {
    instances: string
    ptsets: string
    primitive_keypoints: string
    mbd_dimensions: string
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
  bucketIndex?: ParquetBucketIndex | null
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

async function registerDuckdbRemoteFile(
  localName: string,
  baseDirUrl: string,
  remoteFile: string,
  requestToken: string,
): Promise<string> {
  if (!db) throw new Error('DuckDB not ready');
  const remoteUrl = buildParquetRemoteFileUrl(baseDirUrl, remoteFile, requestToken);
  try {
    await db.registerFileURL(localName, remoteUrl, DuckDBDataProtocol.HTTP, true);
    return localName;
  } catch (error) {
    if (!isDuckdbFileAlreadyRegisteredError(error)) throw error;

    const retryLocalName = appendDuckdbLocalFileToken(localName, requestToken);
    await db.registerFileURL(retryLocalName, remoteUrl, DuckDBDataProtocol.HTTP, true);
    return retryLocalName;
  }
}

function createDuckdbRemoteQueryToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDuckdbLocalFileToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9_]/g, '_');
}

function appendDuckdbLocalFileToken(localName: string, token: string): string {
  const safeToken = toDuckdbLocalFileToken(token);
  if (localName.endsWith('.parquet')) {
    return `${localName.slice(0, -'.parquet'.length)}_${safeToken}.parquet`;
  }
  return `${localName}_${safeToken}`;
}

function isDuckdbFileAlreadyRegisteredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('File already registered');
}

function buildRegisteredDbnoFiles(
  dbno: number,
  localFileToken?: string,
): RegisteredDbno['files'] {
  const suffix = localFileToken ? `_${localFileToken}` : '';
  return {
    instances: `p_${dbno}_instances${suffix}.parquet`,
    ptsets: `p_${dbno}_ptsets${suffix}.parquet`,
    primitive_keypoints: `p_${dbno}_primitive_keypoints${suffix}.parquet`,
    mbd_dimensions: `p_${dbno}_mbd_dimensions${suffix}.parquet`,
    geo_instances: `p_${dbno}_geo_instances${suffix}.parquet`,
    tubings: `p_${dbno}_tubings${suffix}.parquet`,
    transforms: `p_${dbno}_transforms${suffix}.parquet`,
    aabb: `p_${dbno}_aabb${suffix}.parquet`,
  };
}

function duckdbFileListExpression(files: string[]): string {
  return `[${files.map(sqlQuoteString).join(', ')}]`;
}

function safeBucketFileToken(bucketName: string): string {
  return String(bucketName || 'bucket').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

async function registerBucketTableFiles(
  dbno: number,
  baseDirUrl: string,
  bucketIndex: ParquetBucketIndex,
  table: keyof RegisteredDbno['files'],
  requestToken: string,
): Promise<string> {
  const registered: string[] = [];
  for (const bucket of bucketIndex.buckets) {
    const remoteFile = bucket.tables?.[table]?.file;
    if (!remoteFile) continue;
    const localName = `p_${dbno}_${safeBucketFileToken(bucket.name)}_${table}_${toDuckdbLocalFileToken(requestToken)}.parquet`;
    registered.push(await registerDuckdbRemoteFile(localName, baseDirUrl, remoteFile, requestToken));
  }
  return duckdbFileListExpression(registered);
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

async function tryFetchBucketIndex(
  dbno: number,
  baseDir: ParquetBaseDir
): Promise<ParquetBucketIndex | null> {
  const url = buildFilesOutputUrl(`${baseDir}/manifest_${dbno}_buckets.json`);
  let resp: Response;
  try {
    resp = await fetch(url, { cache: 'no-store' });
  } catch {
    // Bucket manifests are an optional optimization. Older deployments and
    // strict fetch adapters may reject the probe instead of returning 404.
    return null;
  }
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`加载 bucket manifest 失败(${baseDir}): HTTP ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as ParquetBucketIndex;
  if (!json || json.format !== 'parquet-buckets' || !Array.isArray(json.buckets)) {
    throw new Error(`bucket manifest 结构不符合预期(${baseDir})`);
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
let db: AsyncDuckDB | null = null;
let conn: AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// 每个 dbno 的注册缓存
const registeredByDbno = new Map<number, RegisteredDbno>();
const registeringByDbno = new Map<number, Promise<RegisteredDbno>>();
const registeredPtsetsByDbno = new Map<number, string>();
const registeringPtsetsByDbno = new Map<number, Promise<string | null>>();
const registeredPrimitiveKeypointsByDbno = new Map<number, string>();
const registeringPrimitiveKeypointsByDbno = new Map<number, Promise<string | null>>();
const registeredMbdDimensionsByDbno = new Map<number, string>();
const registeringMbdDimensionsByDbno = new Map<number, Promise<string | null>>();
const availableByDbno = new Map<number, boolean>();
const availabilityCheckingByDbno = new Map<number, Promise<boolean>>();
const meshValidationByDbno = new Map<number, Promise<ParquetMeshValidationInfo | null>>();

async function ensureDuckDB(): Promise<void> {
  if (db && conn) return;
  if (initPromise) return await initPromise;

  initPromise = (async () => {
    const bundle = await selectLocalDuckDBBundle();

    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    const logger = new ConsoleLogger();
    db = new AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    conn = await db.connect();
    await configureLocalDuckDBExtensions(conn);
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

function isDuckdbFileListExpression(value: string): boolean {
  return String(value || '').trim().startsWith('[');
}

function parquetScan(value: string): string {
  return isDuckdbFileListExpression(value)
    ? `parquet_scan(${value})`
    : `parquet_scan(${sqlQuoteString(value)})`;
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
    if (v === null || v === undefined) return null;
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

function ptsetUnitInfoFromManifest(manifest: ParquetManifest): NonNullable<PtsetResponse['unit_info']> {
  const unit = manifest.ptset_unit;
  const conversionFactor = Number(unit?.conversion_factor ?? 1);
  return {
    source_unit: String(unit?.source || 'mm'),
    target_unit: String(unit?.target || unit?.source || 'mm'),
    conversion_factor: Number.isFinite(conversionFactor) ? conversionFactor : 1,
  };
}

function primitiveKeypointConversionFactorFromManifest(manifest: ParquetManifest): number | null {
  const unit = manifest.primitive_keypoint_unit;
  if (!unit || typeof unit !== 'object') return null;
  if (String(unit.coordinate_space || '').trim() !== 'geo_local') return null;
  const conversionFactor = Number(unit.conversion_factor);
  return Number.isFinite(conversionFactor) ? conversionFactor : null;
}

type MbdDimensionUnitMetadata = ParquetManifest['mbd_dimension_unit'];

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function mbdPointFromRow(
  row: Record<string, unknown>,
  prefix: string,
  conversionFactor: number,
): [number, number, number] | null {
  const x = finiteNumber(row[`${prefix}_x`]);
  const y = finiteNumber(row[`${prefix}_y`]);
  const z = finiteNumber(row[`${prefix}_z`]);
  return x === null || y === null || z === null
    ? null
    : [x * conversionFactor, y * conversionFactor, z * conversionFactor];
}

function mbdLinesFromJson(
  value: unknown,
  conversionFactor: number,
): MbdDimensionDto['extensionLines'] | null {
  if (value === null || value === undefined || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const lines: {
    from: [number, number, number];
    to: [number, number, number];
  }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const from = Array.isArray(raw.from) ? raw.from : null;
    const to = Array.isArray(raw.to) ? raw.to : null;
    if (!from || !to || from.length !== 3 || to.length !== 3) return null;
    const convertedFrom = from.map(finiteNumber);
    const convertedTo = to.map(finiteNumber);
    if (
      convertedFrom.some(point => point === null)
      || convertedTo.some(point => point === null)
    ) return null;
    lines.push({
      from: convertedFrom.map(point => point! * conversionFactor) as [
        number,
        number,
        number,
      ],
      to: convertedTo.map(point => point! * conversionFactor) as [
        number,
        number,
        number,
      ],
    });
  }
  return lines;
}

function mbdSourceToDesign(
  row: Record<string, unknown>,
  metadata: MbdDimensionUnitMetadata,
): readonly number[] | null {
  const json = row.source_to_design_json;
  if (typeof json === 'string' && json.trim()) {
    try {
      const parsed = JSON.parse(json);
      if (
        Array.isArray(parsed)
        && parsed.length === 16
        && parsed.every(value => finiteNumber(value) !== null)
      ) {
        return parsed.map(value => Number(value));
      }
    } catch {
      return null;
    }
  }
  const rowMatrix = colsMajorToMatrixArray(row);
  if (rowMatrix) return rowMatrix;
  if (
    Array.isArray(metadata?.source_to_design)
    && metadata.source_to_design.length === 16
    && metadata.source_to_design.every(value => Number.isFinite(value))
  ) {
    return [...metadata.source_to_design];
  }
  return metadata?.coordinate_space === 'design' ? IDENTITY_MATRIX : null;
}

export function mapMbdDimensionRows(
  rows: readonly Record<string, unknown>[],
  metadata: MbdDimensionUnitMetadata,
): MbdDimensionLoadResult {
  const dimensions: MbdDimensionDto[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const rawFactor = finiteNumber(metadata?.conversion_factor ?? 1);
  const conversionFactor = rawFactor && rawFactor > 0 ? rawFactor : 1;
  rows.forEach((row, index) => {
    const id = String(row.id ?? `mbd-row-${index}`).trim();
    const dimensionFrom = mbdPointFromRow(
      row,
      'dimension_from',
      conversionFactor,
    );
    const dimensionTo = mbdPointFromRow(
      row,
      'dimension_to',
      conversionFactor,
    );
    const labelAnchor = mbdPointFromRow(row, 'label', conversionFactor);
    const extensionLines = mbdLinesFromJson(
      row.extension_lines_json,
      conversionFactor,
    );
    const arrowLines = mbdLinesFromJson(
      row.arrow_lines_json,
      conversionFactor,
    );
    const sourceToDesign = mbdSourceToDesign(row, metadata);
    if (
      !id
      || !dimensionFrom
      || !dimensionTo
      || !labelAnchor
      || extensionLines === null
      || arrowLines === null
      || !sourceToDesign
    ) {
      skipped.push({
        id: id || `mbd-row-${index}`,
        reason: 'Invalid MBD dimension row geometry or coordinate metadata',
      });
      return;
    }
    dimensions.push({
      id,
      reference: row.reference === true
        || row.reference === 1
        || String(row.reference).toLowerCase() === 'true',
      formattedLabel: String(row.formatted_label ?? row.label ?? id),
      dimensionLine: { from: dimensionFrom, to: dimensionTo },
      extensionLines,
      arrowLines,
      labelAnchor,
      sourceToDesign,
    });
  });
  return { dimensions, skipped };
}

function primitiveCircularGeometryFromRow(
  row: Record<string, unknown>,
  prefix: 'circle' | 'arc',
  conversionFactor: number,
  matrix: Matrix4,
): PrimitiveKeyPointCandidate['circle'] | null {
  const center = mbdPointFromRow(
    row,
    `${prefix}_center`,
    conversionFactor,
  );
  const rim = mbdPointFromRow(row, `${prefix}_rim`, conversionFactor);
  const normal = mbdPointFromRow(row, `${prefix}_normal`, 1);
  if (!center || !rim || !normal) return null;
  const centerWorld = new Vector3(...center).applyMatrix4(matrix);
  const rimWorld = new Vector3(...rim).applyMatrix4(matrix);
  const normalWorld = new Vector3(...normal).transformDirection(matrix);
  if (normalWorld.lengthSq() <= 1e-18) return null;
  return {
    center: [centerWorld.x, centerWorld.y, centerWorld.z],
    rim: [rimWorld.x, rimWorld.y, rimWorld.z],
    normal: [normalWorld.x, normalWorld.y, normalWorld.z],
  };
}

function rowToPtsetPoint(row: any): PtsetPoint {
  const hasDir = Boolean(row.has_dir);
  const hasRefDir = Boolean(row.has_ref_dir);
  return {
    number: Number(row.point_number ?? 0),
    pt: [
      Number(row.pt_x ?? 0),
      Number(row.pt_y ?? 0),
      Number(row.pt_z ?? 0),
    ],
    dir: hasDir
      ? [
        Number(row.dir_x ?? 0),
        Number(row.dir_y ?? 0),
        Number(row.dir_z ?? 0),
      ]
      : null,
    dir_flag: Number(row.dir_flag ?? 1),
    ref_dir: hasRefDir
      ? [
        Number(row.ref_dir_x ?? 0),
        Number(row.ref_dir_y ?? 0),
        Number(row.ref_dir_z ?? 0),
      ]
      : null,
    pbore: Number(row.pbore ?? 0),
    pwidth: Number(row.pwidth ?? 0),
    pheight: Number(row.pheight ?? 0),
    pconnect: String(row.pconnect ?? ''),
  };
}

async function fetchManifest(dbno: number): Promise<ParquetManifestWithBaseDir> {
  const hint = await getDirectoryHint(dbno);
  if (hint?.manifestBaseDir) {
    const hintedBuckets = await tryFetchBucketIndex(dbno, hint.manifestBaseDir);
    if (hintedBuckets?.buckets.length) {
      return {
        manifest: bucketIndexToSyntheticManifest(dbno, hintedBuckets),
        baseDir: hint.manifestBaseDir,
        bucketIndex: hintedBuckets,
      };
    }
    const hintedManifest = await tryFetchManifest(dbno, hint.manifestBaseDir);
    if (hintedManifest) {
      return { manifest: hintedManifest, baseDir: hint.manifestBaseDir };
    }
  }

  // 优先新目录 parquet/，兼容旧目录 instances/
  const parquetBuckets = await tryFetchBucketIndex(dbno, 'parquet');
  if (parquetBuckets?.buckets.length) {
    return {
      manifest: bucketIndexToSyntheticManifest(dbno, parquetBuckets),
      baseDir: 'parquet',
      bucketIndex: parquetBuckets,
    };
  }
  const parquetManifest = await tryFetchManifest(dbno, 'parquet');
  if (parquetManifest) {
    return { manifest: parquetManifest, baseDir: 'parquet' };
  }
  const instancesBuckets = await tryFetchBucketIndex(dbno, 'instances');
  if (instancesBuckets?.buckets.length) {
    return {
      manifest: bucketIndexToSyntheticManifest(dbno, instancesBuckets),
      baseDir: 'instances',
      bucketIndex: instancesBuckets,
    };
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

function bucketIndexToSyntheticManifest(dbno: number, index: ParquetBucketIndex): ParquetManifest {
  const sumRows = (table: keyof ParquetManifest['tables']): number => index.buckets.reduce((sum, bucket) => {
    const rows = bucket.tables?.[table]?.rows;
    return sum + (typeof rows === 'number' && Number.isFinite(rows) ? rows : 0);
  }, 0);

  return {
    version: 1,
    format: 'parquet',
    generated_at: index.generated_at || new Date().toISOString(),
    dbnum: dbno,
    root_refno: null,
    tables: {
      instances: { file: '__bucketed_instances__', rows: sumRows('instances') },
      geo_instances: { file: '__bucketed_geo_instances__', rows: sumRows('geo_instances') },
      tubings: { file: '__bucketed_tubings__', rows: sumRows('tubings') },
      transforms: { file: '__bucketed_transforms__', rows: sumRows('transforms') },
      aabb: { file: '__bucketed_aabb__', rows: sumRows('aabb') },
      ptsets: { file: '__bucketed_ptsets__', rows: sumRows('ptsets'), key: ['cata_hash', 'point_number'] },
      primitive_keypoints: {
        file: '__bucketed_primitive_keypoints__',
        rows: sumRows('primitive_keypoints'),
        key: ['geo_hash', 'keypoint_index'],
      },
      ...(index.buckets.some(bucket => bucket.tables?.mbd_dimensions?.file)
        ? {
          mbd_dimensions: {
            file: '__bucketed_mbd_dimensions__',
            rows: sumRows('mbd_dimensions'),
            key: ['id'],
          },
        }
        : {}),
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

    const { manifest, baseDir, bucketIndex } = await fetchManifest(dbno);
    const baseDirUrl = buildFilesOutputUrl(baseDir);

    const requestToken = createDuckdbRemoteQueryToken();
    const files = buildRegisteredDbnoFiles(
      dbno,
      forceRefresh ? toDuckdbLocalFileToken(requestToken) : undefined,
    );

    const [
      instances,
      geoInstances,
      tubings,
      transforms,
      aabb,
      ptsets,
      primitiveKeypoints,
      mbdDimensions,
    ] = bucketIndex
      ? await Promise.all([
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'instances', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'geo_instances', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'tubings', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'transforms', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'aabb', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'ptsets', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'primitive_keypoints', requestToken),
        registerBucketTableFiles(dbno, baseDirUrl, bucketIndex, 'mbd_dimensions', requestToken),
      ])
      : await Promise.all([
        registerDuckdbRemoteFile(files.instances, baseDirUrl, manifest.tables.instances.file, requestToken),
        registerDuckdbRemoteFile(files.geo_instances, baseDirUrl, manifest.tables.geo_instances.file, requestToken),
        registerDuckdbRemoteFile(files.tubings, baseDirUrl, manifest.tables.tubings.file, requestToken),
        registerDuckdbRemoteFile(files.transforms, baseDirUrl, manifest.tables.transforms.file, requestToken),
        registerDuckdbRemoteFile(files.aabb, baseDirUrl, manifest.tables.aabb.file, requestToken),
        Promise.resolve(files.ptsets),
        Promise.resolve(files.primitive_keypoints),
        Promise.resolve(files.mbd_dimensions),
      ]);

    const reg: RegisteredDbno = {
      dbno,
      baseDirUrl,
      manifest,
      files: {
        instances,
        ptsets,
        primitive_keypoints: primitiveKeypoints,
        mbd_dimensions: mbdDimensions,
        geo_instances: geoInstances,
        tubings,
        transforms,
        aabb,
      },
    };
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

async function ensurePtsetsRegistered(reg: RegisteredDbno, options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const ptsetsTable = reg.manifest.tables.ptsets;
  if (!ptsetsTable?.file) return null;
  if (isDuckdbFileListExpression(reg.files.ptsets)) return reg.files.ptsets;

  if (options.forceRefresh) {
    registeredPtsetsByDbno.delete(reg.dbno);
  }

  const cached = registeredPtsetsByDbno.get(reg.dbno);
  if (cached && !options.forceRefresh) return cached;

  const pending = registeringPtsetsByDbno.get(reg.dbno);
  if (pending && !options.forceRefresh) return await pending;

  const task = (async () => {
    await ensureDuckDB();
    if (!db || !conn) throw new Error('DuckDB not ready');
    const requestToken = createDuckdbRemoteQueryToken();
    const localName = options.forceRefresh
      ? appendDuckdbLocalFileToken(reg.files.ptsets, requestToken)
      : reg.files.ptsets;
    const registered = await registerDuckdbRemoteFile(
      localName,
      reg.baseDirUrl,
      ptsetsTable.file,
      requestToken,
    );
    registeredPtsetsByDbno.set(reg.dbno, registered);
    return registered;
  })();

  registeringPtsetsByDbno.set(reg.dbno, task);
  try {
    return await task;
  } finally {
    registeringPtsetsByDbno.delete(reg.dbno);
  }
}

async function ensurePrimitiveKeypointsRegistered(
  reg: RegisteredDbno,
  options: { forceRefresh?: boolean } = {}
): Promise<string | null> {
  const table = reg.manifest.tables.primitive_keypoints;
  if (!table?.file) return null;
  if (isDuckdbFileListExpression(reg.files.primitive_keypoints)) return reg.files.primitive_keypoints;

  if (options.forceRefresh) {
    registeredPrimitiveKeypointsByDbno.delete(reg.dbno);
  }

  const cached = registeredPrimitiveKeypointsByDbno.get(reg.dbno);
  if (cached && !options.forceRefresh) return cached;

  const pending = registeringPrimitiveKeypointsByDbno.get(reg.dbno);
  if (pending && !options.forceRefresh) return await pending;

  const task = (async () => {
    await ensureDuckDB();
    if (!db || !conn) throw new Error('DuckDB not ready');
    const requestToken = createDuckdbRemoteQueryToken();
    const localName = options.forceRefresh
      ? appendDuckdbLocalFileToken(reg.files.primitive_keypoints, requestToken)
      : reg.files.primitive_keypoints;
    const registered = await registerDuckdbRemoteFile(
      localName,
      reg.baseDirUrl,
      table.file,
      requestToken,
    );
    registeredPrimitiveKeypointsByDbno.set(reg.dbno, registered);
    return registered;
  })();

  registeringPrimitiveKeypointsByDbno.set(reg.dbno, task);
  try {
    return await task;
  } finally {
    registeringPrimitiveKeypointsByDbno.delete(reg.dbno);
  }
}

async function ensureMbdDimensionsRegistered(
  reg: RegisteredDbno,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const table = reg.manifest.tables.mbd_dimensions;
  if (!table?.file) return null;
  if (isDuckdbFileListExpression(reg.files.mbd_dimensions)) {
    return reg.files.mbd_dimensions === '[]' ? null : reg.files.mbd_dimensions;
  }

  if (options.forceRefresh) {
    registeredMbdDimensionsByDbno.delete(reg.dbno);
  }
  const cached = registeredMbdDimensionsByDbno.get(reg.dbno);
  if (cached && !options.forceRefresh) return cached;
  const pending = registeringMbdDimensionsByDbno.get(reg.dbno);
  if (pending && !options.forceRefresh) return await pending;

  const task = (async () => {
    await ensureDuckDB();
    if (!db || !conn) throw new Error('DuckDB not ready');
    const requestToken = createDuckdbRemoteQueryToken();
    const localName = options.forceRefresh
      ? appendDuckdbLocalFileToken(reg.files.mbd_dimensions, requestToken)
      : reg.files.mbd_dimensions;
    const registered = await registerDuckdbRemoteFile(
      localName,
      reg.baseDirUrl,
      table.file,
      requestToken,
    );
    registeredMbdDimensionsByDbno.set(reg.dbno, registered);
    return registered;
  })();
  registeringMbdDimensionsByDbno.set(reg.dbno, task);
  try {
    return await task;
  } finally {
    registeringMbdDimensionsByDbno.delete(reg.dbno);
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
          const hintedBuckets = await tryFetchBucketIndex(dbno, hint.manifestBaseDir);
          if (hintedBuckets?.buckets.length) {
            const checks = hintedBuckets.buckets.map((bucket) => areRequiredParquetFilesPresent(hint.manifestBaseDir!, {
              instances: bucket.tables.instances.file,
              geo_instances: bucket.tables.geo_instances.file,
              transforms: bucket.tables.transforms.file,
              aabb: bucket.tables.aabb.file,
            }));
            return (await Promise.all(checks)).every(Boolean);
          }
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
        const parquetBuckets = await tryFetchBucketIndex(dbno, 'parquet');
        if (parquetBuckets?.buckets.length) {
          const checks = parquetBuckets.buckets.map((bucket) => areRequiredParquetFilesPresent('parquet', {
            instances: bucket.tables.instances.file,
            geo_instances: bucket.tables.geo_instances.file,
            transforms: bucket.tables.transforms.file,
            aabb: bucket.tables.aabb.file,
          }));
          return (await Promise.all(checks)).every(Boolean);
        }
        const parquetManifest = await tryFetchManifest(dbno, 'parquet');
        if (parquetManifest) {
          return await areRequiredParquetFilesPresent('parquet', {
            instances: parquetManifest.tables.instances.file,
            geo_instances: parquetManifest.tables.geo_instances.file,
            transforms: parquetManifest.tables.transforms.file,
            aabb: parquetManifest.tables.aabb.file,
          });
        }

        const instancesBuckets = await tryFetchBucketIndex(dbno, 'instances');
        if (instancesBuckets?.buckets.length) {
          const checks = instancesBuckets.buckets.map((bucket) => areRequiredParquetFilesPresent('instances', {
            instances: bucket.tables.instances.file,
            geo_instances: bucket.tables.geo_instances.file,
            transforms: bucket.tables.transforms.file,
            aabb: bucket.tables.aabb.file,
          }));
          return (await Promise.all(checks)).every(Boolean);
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

  async function isPtsetParquetAvailable(dbno: number): Promise<boolean> {
    try {
      const reg = await registerDbno(dbno);
      const ptsetsFile = await ensurePtsetsRegistered(reg);
      return !!ptsetsFile;
    } catch {
      return false;
    }
  }

  async function queryPtsetByRefnoFromParquet(
    dbno: number,
    refno: string,
    options?: { forceRefresh?: boolean }
  ): Promise<PtsetResponse> {
    const normalizedRefno = normalizeRefnoKey(refno);
    const fail = (
      errorCode: NonNullable<PtsetResponse['error_code']>,
      message: string,
    ): PtsetResponse => ({
      success: false,
      refno: normalizedRefno,
      ptset: [],
      world_transform: null,
      unit_info: null,
      error_code: errorCode,
      error_message: message,
    });

    lastError.value = null;
    if (!normalizedRefno) return fail('PTSET_REFNO_EMPTY', 'refno 为空，无法查询 ptset');

    try {
      const reg = await registerDbno(dbno, { forceRefresh: options?.forceRefresh });
      await ensureDuckDB();
      if (!conn) throw new Error('DuckDB connection unavailable');

      const ptsetsFile = await ensurePtsetsRegistered(reg, { forceRefresh: options?.forceRefresh });
      if (!ptsetsFile) {
        return fail('PTSET_TABLE_MISSING', '当前模型包未包含 ptsets.parquet，ptset 测量不可用');
      }

      const instanceSql = `
        SELECT
          i.refno_str,
          i.cata_hash,
          i.trans_hash,
          tw.m00, tw.m10, tw.m20, tw.m30,
          tw.m01, tw.m11, tw.m21, tw.m31,
          tw.m02, tw.m12, tw.m22, tw.m32,
          tw.m03, tw.m13, tw.m23, tw.m33
        FROM ${parquetScan(reg.files.instances)} i
        LEFT JOIN ${parquetScan(reg.files.transforms)} tw ON tw.trans_hash = i.trans_hash
        WHERE i.refno_str = ${sqlQuoteString(normalizedRefno)}
        LIMIT 1
      `;
      const instanceArrow = await conn.query(instanceSql);
      const instanceRows = instanceArrow.toArray() as any[];
      const instanceRow = instanceRows[0];
      if (!instanceRow) {
        return fail('PTSET_INSTANCE_MISSING', `instances.parquet 中未找到 refno=${normalizedRefno}`);
      }

      const cataHash = String(instanceRow.cata_hash || '').trim();
      if (!cataHash) {
        return fail('PTSET_CATA_HASH_MISSING', `refno=${normalizedRefno} 缺少 cata_hash，无法查询 ptset`);
      }

      const worldTransform = colsMajorToMatrixArray(instanceRow);
      if (!worldTransform) {
        const transHash = String(instanceRow.trans_hash || '').trim();
        return fail(
          'PTSET_TRANSFORM_MISSING',
          `refno=${normalizedRefno} trans_hash=${transHash || '(empty)'} 缺少 transform row，无法转换 ptset`,
        );
      }

      const ptsetSql = `
        SELECT
          point_number,
          pt_x, pt_y, pt_z,
          has_dir, dir_x, dir_y, dir_z, dir_flag,
          has_ref_dir, ref_dir_x, ref_dir_y, ref_dir_z,
          pbore, pwidth, pheight, pconnect
        FROM ${parquetScan(ptsetsFile)}
        WHERE cata_hash = ${sqlQuoteString(cataHash)}
        ORDER BY point_number
      `;
      const ptsetArrow = await conn.query(ptsetSql);
      const rows = ptsetArrow.toArray() as any[];
      if (rows.length === 0) {
        return fail('PTSET_POINTS_MISSING', `cata_hash=${cataHash} 未找到 ptset 点`);
      }

      return {
        success: true,
        refno: normalizedRefno,
        ptset: rows.map(rowToPtsetPoint),
        world_transform: worldTransform,
        unit_info: ptsetUnitInfoFromManifest(reg.manifest),
        error_code: null,
        error_message: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      return fail('PTSET_QUERY_FAILED', `查询 ptsets.parquet 失败: ${message}`);
    }
  }

  async function isPrimitiveKeypointParquetAvailable(dbno: number): Promise<boolean> {
    try {
      const reg = await registerDbno(dbno);
      const file = await ensurePrimitiveKeypointsRegistered(reg);
      if (!file) return false;
      return primitiveKeypointConversionFactorFromManifest(reg.manifest) !== null;
    } catch {
      return false;
    }
  }

  async function queryPrimitiveKeypointsByRefnoFromParquet(
    dbno: number,
    refno: string,
    options?: { forceRefresh?: boolean }
  ): Promise<PrimitiveKeyPointCandidate[]> {
    const normalizedRefno = normalizeRefnoKey(refno);
    lastError.value = null;
    if (!normalizedRefno) return [];

    try {
      const reg = await registerDbno(dbno, { forceRefresh: options?.forceRefresh });
      await ensureDuckDB();
      if (!conn) throw new Error('DuckDB connection unavailable');

      const primitiveFile = await ensurePrimitiveKeypointsRegistered(reg, {
        forceRefresh: options?.forceRefresh,
      });
      if (!primitiveFile) {
        throw new Error('当前模型包未包含 primitive_keypoints.parquet，Primitive Key Point 不可用');
      }

      const conversionFactor = primitiveKeypointConversionFactorFromManifest(reg.manifest);
      if (conversionFactor === null) {
        throw new Error('当前模型包缺少 primitive_keypoint_unit.geo_local 元数据，Primitive Key Point 不可用');
      }

      const sql = `
        WITH target(refno_str) AS (
          SELECT ${sqlQuoteString(normalizedRefno)} AS refno_str
        ),
        instance_geo AS (
          SELECT
            i.refno_str,
            gi.geo_index,
            gi.geo_hash,
            tw.m00, tw.m10, tw.m20, tw.m30,
            tw.m01, tw.m11, tw.m21, tw.m31,
            tw.m02, tw.m12, tw.m22, tw.m32,
            tw.m03, tw.m13, tw.m23, tw.m33,
            tg.m00 AS g_m00, tg.m10 AS g_m10, tg.m20 AS g_m20, tg.m30 AS g_m30,
            tg.m01 AS g_m01, tg.m11 AS g_m11, tg.m21 AS g_m21, tg.m31 AS g_m31,
            tg.m02 AS g_m02, tg.m12 AS g_m12, tg.m22 AS g_m22, tg.m32 AS g_m32,
            tg.m03 AS g_m03, tg.m13 AS g_m13, tg.m23 AS g_m23, tg.m33 AS g_m33
          FROM target t
          JOIN ${parquetScan(reg.files.instances)} i ON i.refno_str = t.refno_str
          JOIN ${parquetScan(reg.files.geo_instances)} gi ON gi.refno_str = i.refno_str
          LEFT JOIN ${parquetScan(reg.files.transforms)} tw ON tw.trans_hash = i.trans_hash
          LEFT JOIN ${parquetScan(reg.files.transforms)} tg ON tg.trans_hash = gi.geo_trans_hash
        ),
        tubi_geo AS (
          SELECT
            t.refno_str,
            tb.order AS geo_index,
            tb.geo_hash,
            tw.m00, tw.m10, tw.m20, tw.m30,
            tw.m01, tw.m11, tw.m21, tw.m31,
            tw.m02, tw.m12, tw.m22, tw.m32,
            tw.m03, tw.m13, tw.m23, tw.m33,
            NULL AS g_m00, NULL AS g_m10, NULL AS g_m20, NULL AS g_m30,
            NULL AS g_m01, NULL AS g_m11, NULL AS g_m21, NULL AS g_m31,
            NULL AS g_m02, NULL AS g_m12, NULL AS g_m22, NULL AS g_m32,
            NULL AS g_m03, NULL AS g_m13, NULL AS g_m23, NULL AS g_m33
          FROM target t
          JOIN ${parquetScan(reg.files.tubings)} tb
            ON tb.tubi_refno_str = t.refno_str
            OR tb.owner_refno_str = t.refno_str
          LEFT JOIN ${parquetScan(reg.files.transforms)} tw ON tw.trans_hash = tb.trans_hash
        ),
        all_geo AS (
          SELECT * FROM instance_geo
          UNION ALL
          SELECT * FROM tubi_geo
        )
        SELECT
          g.refno_str,
          g.geo_index,
          g.geo_hash,
          g.m00, g.m10, g.m20, g.m30,
          g.m01, g.m11, g.m21, g.m31,
          g.m02, g.m12, g.m22, g.m32,
          g.m03, g.m13, g.m23, g.m33,
          g.g_m00, g.g_m10, g.g_m20, g.g_m30,
          g.g_m01, g.g_m11, g.g_m21, g.g_m31,
          g.g_m02, g.g_m12, g.g_m22, g.g_m32,
          g.g_m03, g.g_m13, g.g_m23, g.g_m33,
          pk.*
        FROM all_geo g
        JOIN ${parquetScan(primitiveFile)} pk ON pk.geo_hash = g.geo_hash
        ORDER BY g.refno_str, g.geo_index, pk.keypoint_index
      `;

      const arrow = await conn.query(sql);
      const rows = arrow.toArray() as any[];
      const out: PrimitiveKeyPointCandidate[] = [];
      for (const row of rows) {
        const refnoStr = normalizeRefnoKey(String(row.refno_str || normalizedRefno));
        const geoHash = String(row.geo_hash || '').trim();
        if (!refnoStr || !geoHash) continue;

        const worldCols = colsMajorToMatrixArray(row);
        if (!worldCols) continue;
        const geoLocal = colsMajorToMatrixArrayWithPrefix(row, 'g_');
        const matrix = new Matrix4().fromArray(multiplyWorldAndGeoLocal(worldCols, geoLocal));

        const local: [number, number, number] = [
          Number(row.local_x ?? 0) * conversionFactor,
          Number(row.local_y ?? 0) * conversionFactor,
          Number(row.local_z ?? 0) * conversionFactor,
        ];
        if (local.some((value) => !Number.isFinite(value))) continue;

        const v = new Vector3(local[0], local[1], local[2]).applyMatrix4(matrix);
        const keypointIndex = Number(row.keypoint_index ?? 0);
        const geoIndex = Number(row.geo_index ?? 0);
        const hasDir = Boolean(row.has_dir);
        const rawDirection = hasDir
          ? new Vector3(
            Number(row.dir_x ?? 0),
            Number(row.dir_y ?? 0),
            Number(row.dir_z ?? 0),
          )
          : null;
        const worldDirection = rawDirection
          && Number.isFinite(rawDirection.x)
          && Number.isFinite(rawDirection.y)
          && Number.isFinite(rawDirection.z)
          && rawDirection.lengthSq() > 1e-18
          ? rawDirection.transformDirection(matrix)
          : null;
        const dir: [number, number, number] | null = worldDirection
          ? [worldDirection.x, worldDirection.y, worldDirection.z]
          : null;
        const circle = primitiveCircularGeometryFromRow(
          row,
          'circle',
          conversionFactor,
          matrix,
        );
        const arc = primitiveCircularGeometryFromRow(
          row,
          'arc',
          conversionFactor,
          matrix,
        );

        out.push({
          id: `primitive:${refnoStr}:${geoIndex}:${geoHash}#${keypointIndex}`,
          refno: refnoStr,
          objectId: `o:${refnoStr}:0`,
          geoHash,
          geoIndex,
          keypointIndex,
          kind: String(row.kind || 'key_point'),
          source: String(row.source || 'primitive_keypoints.parquet'),
          local,
          world: [v.x, v.y, v.z],
          hasDir: dir !== null,
          dir,
          ...(circle ? { circle } : {}),
          ...(arc ? { arc } : {}),
        });
      }
      return out;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      throw new Error(`查询 primitive_keypoints.parquet 失败: ${message}`);
    }
  }

  async function isMbdDimensionParquetAvailable(dbno: number): Promise<boolean> {
    try {
      const reg = await registerDbno(dbno);
      return (await ensureMbdDimensionsRegistered(reg)) !== null;
    } catch {
      return false;
    }
  }

  async function queryMbdDimensionsByDbno(
    dbno: number,
    options?: { forceRefresh?: boolean },
  ): Promise<MbdDimensionLoadResult> {
    lastError.value = null;
    try {
      const reg = await registerDbno(dbno, {
        forceRefresh: options?.forceRefresh,
      });
      await ensureDuckDB();
      if (!conn) throw new Error('DuckDB connection unavailable');
      const file = await ensureMbdDimensionsRegistered(reg, {
        forceRefresh: options?.forceRefresh,
      });
      if (!file) return { dimensions: [], skipped: [] };
      const arrow = await conn.query(`
        SELECT *
        FROM ${parquetScan(file)}
        ORDER BY id
      `);
      const rows = arrow.toArray() as Record<string, unknown>[];
      return mapMbdDimensionRows(rows, reg.manifest.mbd_dimension_unit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      throw new Error(`查询 mbd_dimensions.parquet 失败: ${message}`);
    }
  }

  async function queryDirectChildrenPtsetSummary(
    dbno: number,
    ownerRefno: string,
    options?: { forceRefresh?: boolean }
  ): Promise<ParquetPtsetChildSummary[]> {
    const normalizedOwner = normalizeRefnoKey(ownerRefno);
    if (!normalizedOwner) return [];

    lastError.value = null;

    const toSummary = (row: any, ptsetsFile: string | null): ParquetPtsetChildSummary => {
      const refno = normalizeRefnoKey(String(row.refno_str || ''));
      const cataHash = String(row.cata_hash || '').trim();
      const ptCount = Number(row.pt_count ?? 0);
      const errorMessage = !ptsetsFile
        ? '当前模型包未包含 ptsets.parquet，ptset 不可用'
        : !cataHash
          ? `refno=${refno} 缺少 cata_hash，无法查询 ptset`
          : ptCount > 0
            ? null
            : `cata_hash=${cataHash} 未找到 ptset 点`;

      return {
        refno,
        noun: String(row.noun || ''),
        name: String(row.name || ''),
        success: !!ptsetsFile && !!cataHash && ptCount > 0,
        ptCount: !!ptsetsFile && !!cataHash ? ptCount : 0,
        errorMessage,
      };
    };

    try {
      const reg = await registerDbno(dbno, { forceRefresh: options?.forceRefresh });
      await ensureDuckDB();
      if (!conn) throw new Error('DuckDB connection unavailable');

      const ptsetsFile = await ensurePtsetsRegistered(reg, { forceRefresh: options?.forceRefresh });
      const ptCountSelect = ptsetsFile ? 'COALESCE(pc.pt_count, 0) AS pt_count' : '0 AS pt_count';
      const ptCountJoin = ptsetsFile
        ? `
        LEFT JOIN (
          SELECT cata_hash, COUNT(*) AS pt_count
          FROM ${parquetScan(ptsetsFile)}
          WHERE cata_hash IS NOT NULL AND cata_hash <> ''
          GROUP BY cata_hash
        ) pc ON pc.cata_hash = i.cata_hash
        `
        : '';

      const sql = `
        SELECT
          i.refno_str,
          i.noun,
          '' AS name,
          i.cata_hash,
          ${ptCountSelect}
        FROM ${parquetScan(reg.files.instances)} i
        ${ptCountJoin}
        WHERE i.owner_refno_str = ${sqlQuoteString(normalizedOwner)}
        ORDER BY i.refno_str
      `;
      const arrow = await conn.query(sql);
      const rows = arrow.toArray() as any[];
      return rows
        .map((row) => toSummary(row, ptsetsFile))
        .filter((item) => !!item.refno);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      throw new Error(`查询直子元件 ptset 摘要失败: ${message}`);
    }
  }

  async function queryInstanceEntriesByRefnos(
    dbno: number,
    refnoKeys: string[],
    options?: { debug?: boolean; forceRefresh?: boolean; includeOwnedTubings?: boolean }
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
    const reg = await registerDbno(dbno, {
      forceRefresh: options?.forceRefresh !== false,
    });
    timing.phaseMs.registerDbno = Date.now() - registerDbnoStartedAt;

    // refno 在 parquet 里是 refno_str（与前端 refnoKey 一致：`24381_100818` 这种下划线格式）
    const toRefnoStr = (k: string) => String(k);

    const resultMap = new Map<string, InstanceEntry[]>();
    const cataHashSelect = reg.manifest.tables.ptsets?.file ? 'i.cata_hash' : 'NULL AS cata_hash';
    const includeOwnedTubings = options?.includeOwnedTubings !== false;

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
          ${cataHashSelect},
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
        JOIN ${parquetScan(reg.files.instances)} i ON i.refno_str = t.refno_str
        JOIN ${parquetScan(reg.files.geo_instances)} gi ON gi.refno_str = i.refno_str
        LEFT JOIN ${parquetScan(reg.files.aabb)} aw ON aw.aabb_hash = i.aabb_hash
        LEFT JOIN ${parquetScan(reg.files.transforms)} tw ON tw.trans_hash = i.trans_hash
        LEFT JOIN ${parquetScan(reg.files.transforms)} tg ON tg.trans_hash = gi.geo_trans_hash
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
            cata_hash: row.cata_hash ? String(row.cata_hash) : '',
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

      const tubiJoinCondition = includeOwnedTubings
        ? `
            tb.tubi_refno_str = t.refno_str
            OR tb.owner_refno_str = t.refno_str
          `
        : 'tb.tubi_refno_str = t.refno_str';

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
          JOIN ${parquetScan(reg.files.tubings)} tb
            ON ${tubiJoinCondition}
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
        LEFT JOIN ${parquetScan(reg.files.aabb)} aw ON aw.aabb_hash = c.aabb_hash
        LEFT JOIN ${parquetScan(reg.files.transforms)} tw ON tw.trans_hash = c.trans_hash
        LEFT JOIN ${parquetScan(reg.files.instances)} ti ON ti.refno_str = c.tubi_refno_str
        LEFT JOIN ${parquetScan(reg.files.transforms)} iw ON iw.trans_hash = ti.trans_hash
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

    const reg = await registerDbno(dbno, { forceRefresh: true });
    await ensureDuckDB();
    if (!conn) throw new Error('DuckDB connection unavailable');

    const limit =
      typeof options?.limit === 'number' && Number.isFinite(options.limit)
        ? Math.max(1, Math.floor(options.limit))
        : null;

    const sql = `
      WITH all_refnos AS (
        SELECT refno_str AS refno
        FROM ${parquetScan(reg.files.instances)}
        UNION
        SELECT refno_str AS refno
        FROM ${parquetScan(reg.files.geo_instances)}
        UNION
        SELECT tubi_refno_str AS refno
        FROM ${parquetScan(reg.files.tubings)}
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
    isPtsetParquetAvailable,
    isPrimitiveKeypointParquetAvailable,
    isMbdDimensionParquetAvailable,
    queryPtsetByRefnoFromParquet,
    queryPrimitiveKeypointsByRefnoFromParquet,
    queryMbdDimensionsByDbno,
    queryDirectChildrenPtsetSummary,
    queryInstanceEntriesByRefnos,
    queryAllRefnosByDbno,
    queryMeshValidationInfoByDbno,
  };
}

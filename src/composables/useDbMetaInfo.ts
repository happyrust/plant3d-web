import { getGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import { getGenModelV1BaseUrl } from '@/utils/apiBase';

type DbMetaFileEntry = {
  dbnum?: number
  ref0s?: (number | string)[]
}

type DbMetaInfoJson = {
  db_files?: Record<string, DbMetaFileEntry>
}

let ref0ToDbnum: Map<number, number> | null = null;
let loadPromise: Promise<void> | null = null;
let loadedProjectKey: string | null = null;
let stateGeneration = 0;

function getActiveProjectKey(): string {
  // ref0→dbnum 来自 /api/v1/dbnums 的 ref0s（plan 2026-09-06 P3-g），
  // 键带上 base URL：换后端就是另一张表，不能拿别的后端下的映射顶。
  return `gm-v1:${getGenModelV1BaseUrl()}`;
}

/**
 * `/api/v1/dbnums` → 与旧 `db_meta_info.json` 同形的 `{ db_files }`（legacy 退役后只剩这一条来源，形状沿用是为了让
 * `buildRef0Map` 的校验一行不改）。骨架没预热过的形态服务端**整格不写** `ref0s`——那种行跳过，不当「这个库一个 Ref0 都没有」。
 */
export function dbnumsToDbMetaInfoJson(rows: { dbnum: number; ref0s?: number[] }[]): DbMetaInfoJson {
  const dbFiles: Record<string, DbMetaFileEntry> = {};
  for (const row of rows) {
    if (!Array.isArray(row.ref0s) || row.ref0s.length === 0) continue;
    dbFiles[String(row.dbnum)] = { dbnum: row.dbnum, ref0s: [...row.ref0s] };
  }
  return { db_files: dbFiles };
}

function resetDbMetaState(): void {
  stateGeneration += 1;
  ref0ToDbnum = null;
  loadPromise = null;
  loadedProjectKey = null;
}

function assertDbMetaGeneration(generation: number): void {
  if (generation !== stateGeneration) {
    throw new Error('[db_meta] gen-model 服务代次已变化，拒绝使用旧响应');
  }
}

/** gen-model 服务重启/换地址时清掉内存 ref0→dbnum 与在飞加载。 */
export function invalidateGenModelV1DbMetaInfo(): void {
  resetDbMetaState();
}

function ensureStateMatchesActiveProject(projectKey = getActiveProjectKey()): void {
  if (loadedProjectKey && loadedProjectKey !== projectKey) {
    resetDbMetaState();
  }
}

function normalizeRefnoKeyLike(id: string): string {
  // 与模型树保持一致：兼容 record id 包装、= 前缀、/ 与 , 分隔符
  const raw = String(id || '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? raw;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '');
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function parseRef0FromRefno(refno: string): number {
  const normalized = normalizeRefnoKeyLike(refno);
  if (!normalized) throw new Error(`[db_meta] 非法 refno: ${String(refno)}`);
  const head = normalized.split('_')[0] || '';
  const n = Number(head);
  if (!Number.isFinite(n)) {
    throw new Error(`[db_meta] 无法从 refno 提取 ref0: ${normalized}`);
  }
  return n;
}

function buildRef0Map(json: unknown): Map<number, number> {
  const map = new Map<number, number>();
  const anyJson = json as any;

  const dbFiles: Record<string, DbMetaFileEntry> | null =
    anyJson && typeof anyJson === 'object' && anyJson.db_files && typeof anyJson.db_files === 'object'
      ? (anyJson.db_files as Record<string, DbMetaFileEntry>)
      : null;

  if (!dbFiles) {
    throw new Error('[db_meta] db_meta_info 结构不符合预期：缺少 db_files');
  }

  for (const [dbnoKey, entry] of Object.entries(dbFiles)) {
    const dbnum = Number(entry?.dbnum ?? dbnoKey);
    if (!Number.isFinite(dbnum) || dbnum <= 0) {
      throw new Error(`[db_meta] 非法 dbnum: ${String(entry?.dbnum ?? dbnoKey)}`);
    }
    const ref0s = Array.isArray(entry?.ref0s) ? entry!.ref0s! : [];
    for (const r0 of ref0s) {
      const ref0 = Number(r0);
      if (!Number.isFinite(ref0)) {
        throw new Error(`[db_meta] 非法 ref0: ${String(r0)} (dbnum=${dbnum})`);
      }
      const prev = map.get(ref0);
      if (prev != null && prev !== dbnum) {
        throw new Error(`[db_meta] ref0=${ref0} 同时映射到多个 dbnum: ${prev} / ${dbnum}`);
      }
      map.set(ref0, dbnum);
    }
  }

  if (map.size === 0) {
    throw new Error('[db_meta] /api/v1/dbnums 中未发现任何 ref0 映射');
  }

  return map;
}

function applyDbMetaInfoJson(json: unknown): void {
  ref0ToDbnum = buildRef0Map(json);
}

/**
 * 装载 ref0→dbnum 映射：`/api/v1/dbnums` 的 ref0s（服务端骨架解出，D3-A），与徽标三态共用同一次 /dbnums
 * （`useGenModelV1Dbnums`），首屏只打一次。不跨服务代次持久化：同一个 base URL 重启后源文件集合可能已经变化。
 */
export async function ensureDbMetaInfoLoaded(): Promise<void> {
  const projectKey = getActiveProjectKey();
  ensureStateMatchesActiveProject(projectKey);
  if (loadPromise && loadedProjectKey === projectKey) return await loadPromise;
  const generation = stateGeneration;
  loadedProjectKey = projectKey;

  loadPromise = (async () => {
    const dbnums = await getGenModelV1Dbnums({ timeoutMs: 60_000 });
    assertDbMetaGeneration(generation);
    applyDbMetaInfoJson(dbnumsToDbMetaInfoJson(dbnums.dbnums));
  })();

  try {
    return await loadPromise;
  } catch (error) {
    if (loadedProjectKey === projectKey && generation === stateGeneration) {
      resetDbMetaState();
    }
    throw error;
  }
}

export function getDbnumByRefno(refno: string): number {
  ensureStateMatchesActiveProject();
  if (!ref0ToDbnum) {
    throw new Error('[db_meta] 未加载：请先 await ensureDbMetaInfoLoaded()');
  }
  const ref0 = parseRef0FromRefno(refno);
  const dbnum = ref0ToDbnum.get(ref0);
  if (!dbnum) {
    throw new Error(`[db_meta] 未命中 ref0=${ref0}（refno=${normalizeRefnoKeyLike(refno)}）`);
  }
  return dbnum;
}

/**
 * 宽松版：用于“场景状态回放/显隐”等非关键路径。
 * - 未加载 / 未命中：返回 null（不抛错）
 */
export function tryGetDbnumByRefno(refno: string): number | null {
  try {
    ensureStateMatchesActiveProject();
    if (!ref0ToDbnum) return null;
    const ref0 = parseRef0FromRefno(refno);
    const dbnum = ref0ToDbnum.get(ref0);
    return dbnum ?? null;
  } catch {
    return null;
  }
}

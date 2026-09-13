import { getGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import { buildFilesOutputUrl, getOutputProjectFromUrl } from '@/lib/filesOutput';
import { isGenModelV1Source } from '@/model-source/kind';
import { getGenModelV1BaseUrl } from '@/utils/apiBase';
import { parseJsonResponse } from '@/utils/fileValidation';
import { isDevOnlyFallbackEnabled } from '@/utils/runtimeFallback';
import { getJson, setJson } from '@/utils/storage/indexedDbCache';

type DbMetaFileEntry = {
  dbnum?: number
  ref0s?: (number | string)[]
}

type DbMetaInfoJson = {
  db_files?: Record<string, DbMetaFileEntry>
}

const IDB_STORE = 'meta_info' as const;
const IDB_KEY_PREFIX = 'db_meta_info' as const;
const DEFAULT_PROJECT_KEY = '__default__' as const;
// 内置 AMS 1112 ref0 映射只是增量演示的离线兜底，与增量接口的 DB1112 demo 同一开关：
// 仅开发环境可用，生产构建下 db_meta_info.json 拉不到就直接报错，不得伪装成真实数据。
const ALLOW_DEMO_DB_META_FALLBACK = isDevOnlyFallbackEnabled({
  isDev: import.meta.env.DEV,
  configured: import.meta.env.VITE_INCREMENTAL_ALLOW_DEMO_FALLBACK,
});

let ref0ToDbnum: Map<number, number> | null = null;
let loadPromise: Promise<void> | null = null;
let loadedProjectKey: string | null = null;
let stateGeneration = 0;

function getActiveProjectKey(): string {
  // gen-model-v1 源下 ref0→dbnum 来自 /api/v1/dbnums 的 ref0s（plan 2026-09-06 P3-g），
  // 键带上 base URL：换后端就是另一张表，不能拿旧后端项目名下的缓存顶。
  if (isGenModelV1Source()) return `gm-v1:${getGenModelV1BaseUrl()}`;
  return getOutputProjectFromUrl() ?? DEFAULT_PROJECT_KEY;
}

/**
 * `/api/v1/dbnums` → 与 `db_meta_info.json` 同形的 `{ db_files }`，复用同一套校验与 IndexedDB 缓存。
 * 骨架没预热过的形态服务端**整格不写** `ref0s`——那种行跳过，不当「这个库一个 Ref0 都没有」。
 */
export function dbnumsToDbMetaInfoJson(rows: { dbnum: number; ref0s?: number[] }[]): DbMetaInfoJson {
  const dbFiles: Record<string, DbMetaFileEntry> = {};
  for (const row of rows) {
    if (!Array.isArray(row.ref0s) || row.ref0s.length === 0) continue;
    dbFiles[String(row.dbnum)] = { dbnum: row.dbnum, ref0s: [...row.ref0s] };
  }
  return { db_files: dbFiles };
}

function getDbMetaCacheKey(projectKey = getActiveProjectKey()): string {
  return `${IDB_KEY_PREFIX}:${projectKey}`;
}

function getMetaUrl(): string {
  return buildFilesOutputUrl('scene_tree/db_meta_info.json');
}

function buildDemoDbMetaInfo(projectKey: string): DbMetaInfoJson | null {
  const normalized = projectKey.trim().toLowerCase();
  if (normalized !== 'avevamarinesample') return null;
  return {
    db_files: {
      '1112': {
        dbnum: 1112,
        ref0s: [17496],
      },
    },
  };
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

/** gen-model 服务重启/换地址时清掉内存 ref0→dbnum 与在飞加载。IndexedDB 只作预热，随后仍会拉新。 */
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
    throw new Error('[db_meta] db_meta_info.json 结构不符合预期：缺少 db_files');
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
    throw new Error('[db_meta] db_meta_info.json 中未发现任何 ref0 映射');
  }

  return map;
}

function applyDbMetaInfoJson(json: unknown): void {
  ref0ToDbnum = buildRef0Map(json);
}

export async function ensureDbMetaInfoLoaded(): Promise<void> {
  const projectKey = getActiveProjectKey();
  ensureStateMatchesActiveProject(projectKey);
  if (loadPromise && loadedProjectKey === projectKey) return await loadPromise;
  const generation = stateGeneration;

  const metaUrl = getMetaUrl();
  const cacheKey = getDbMetaCacheKey(projectKey);
  const genModelSource = isGenModelV1Source();
  loadedProjectKey = projectKey;

  loadPromise = (async () => {
    // 1) legacy 尝试从 IndexedDB 预热（加速启动）。gen-model 不跨服务代次持久化
    // ref0 映射：同一个 base URL 重启后源文件集合可能已经变化，先读旧 IDB 会制造短暂错路由。
    // IndexedDB 读写失败不得阻断 viewer / 模型树初始化（常见：transaction aborted / 多 tab 锁库）。
    if (!genModelSource) {
      try {
        const cached = await getJson<unknown>(IDB_STORE, cacheKey);
        assertDbMetaGeneration(generation);
        if (cached) {
          try {
            applyDbMetaInfoJson(cached);
          } catch {
            // 缓存损坏：忽略预热，继续强制拉新
          }
        }
      } catch (e) {
        console.warn('[db_meta] IndexedDB 预热失败，继续拉取远端 meta', e);
      }
    }

    // 2) gen-model-v1：`/api/v1/dbnums` 的 ref0s（服务端骨架解出，D3-A），不读旧后端的 db_meta_info.json；
    //    与徽标三态共用同一次 /dbnums（useGenModelV1Dbnums），首屏只打一次
    if (genModelSource) {
      const dbnums = await getGenModelV1Dbnums({ timeoutMs: 60_000 });
      assertDbMetaGeneration(generation);
      const fresh = dbnumsToDbMetaInfoJson(dbnums.dbnums);
      applyDbMetaInfoJson(fresh);
      return;
    }

    // 3) 强制刷新；仅开发环境允许 AMS 1112 增量演示用内置 ref0 映射兜底，生产直接报错。
    const resp = await fetch(metaUrl);
    assertDbMetaGeneration(generation);
    if (!resp.ok) {
      if (ref0ToDbnum && ref0ToDbnum.size > 0) return;
      const demo = ALLOW_DEMO_DB_META_FALLBACK ? buildDemoDbMetaInfo(projectKey) : null;
      if (demo) {
        console.warn(`[db_meta] 加载失败: HTTP ${resp.status} ${resp.statusText} (${metaUrl})，开发环境已改用内置 AMS 1112 演示 ref0 映射`);
        applyDbMetaInfoJson(demo);
        return;
      }
      throw new Error(`[db_meta] 加载失败: HTTP ${resp.status} ${resp.statusText} (${metaUrl})`);
    }
    // 先验证 JSON 再解析：非 JSON / 截断的 meta 会带上位置立即报错，不会带着无效映射继续初始化 viewer。
    const fresh = await parseJsonResponse<unknown>(resp, metaUrl);
    assertDbMetaGeneration(generation);
    applyDbMetaInfoJson(fresh);
    try {
      await setJson(IDB_STORE, cacheKey, fresh);
      assertDbMetaGeneration(generation);
    } catch (e) {
      // 内存映射已就绪；缓存写失败只影响下次启动预热，不应让 viewer 初始化失败。
      console.warn('[db_meta] IndexedDB 写入失败，已使用内存 meta 继续', e);
    }
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

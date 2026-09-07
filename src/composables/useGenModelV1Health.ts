/**
 * gen-model `/api/v1/health` 探针（plan P1-4）。
 *
 * 进程内单例 store：`GET /api/v1/health` → 服务身份（`project / mdb / namespace / version`）、
 * `delivery_unit_types`、`initialization.{data_ready, model_ready, model_phase_open}`、`data_face`。
 * 给树面板顶部的 `GenModelV1HealthBadge` 显示「已连接 gen-model :8022 · AvevaMarineSample · 模型门 开」用，
 * P2 起也给 `genModelV1` 适配器判「服务端就绪了没」。
 *
 * 不在 `legacy` 数据源下自动起——谁挂了徽标谁 `start()`，`legacy` 页面一次请求都不发。
 */
import { computed, reactive, readonly } from 'vue';

import { genModelV1Health, isGenModelV1ApiError, type DbnumRow, type HealthResponse } from '@/api/genModelV1Api';
import { DBNUMS_DEFAULT_MAX_AGE_MS, getGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import { getGenModelV1BaseUrl } from '@/utils/apiBase';

export type GenModelV1HealthStatus = 'idle' | 'loading' | 'ok' | 'error';

/** `/dbnums` 的 `model_verdict` 三态汇总（共识 d-594：`not_judged` 是「没判」，不画成告警）。 */
export type GenModelV1VerdictSummary = {
  inSync: number;
  lagging: number;
  notJudged: number;
  /** 参与统计的库（本 MDB 内、未排除的 DESI） */
  total: number;
  /** `dbnum → verdict` */
  byDbnum: Record<number, string>;
  /** 滞后库的 dbnum（悬停列出来） */
  laggingDbnums: number[];
  lastCheckedAt: number | null;
  error: string | null;
};

export type GenModelV1HealthState = {
  status: GenModelV1HealthStatus;
  baseUrl: string;
  project: string | null;
  mdb: string | null;
  namespace: string | null;
  version: string | null;
  dataFace: string | null;
  deliveryUnitTypes: string[];
  initializationStatus: string | null;
  dataReady: boolean | null;
  modelReady: boolean | null;
  /** `initialization.model_phase_open`：模型门开着才接按需生成 */
  modelPhaseOpen: boolean | null;
  staticAssets: boolean | null;
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  error: string | null;
  raw: HealthResponse | null;
  verdict: GenModelV1VerdictSummary;
};

/** `/health` 便宜（~0.4 s），一分钟一次让「连上 / 断了」及时 */
export const DEFAULT_HEALTH_POLL_INTERVAL_MS = 60_000;
/** `/dbnums` 贵（1.3–30 s），三态五分钟看一次；与 `useGenModelV1Dbnums` 的缓存窗口同一个数 */
export const DEFAULT_VERDICT_POLL_INTERVAL_MS = DBNUMS_DEFAULT_MAX_AGE_MS;

function emptyVerdict(): GenModelV1VerdictSummary {
  return { inSync: 0, lagging: 0, notJudged: 0, total: 0, byDbnum: {}, laggingDbnums: [], lastCheckedAt: null, error: null };
}

/**
 * `/dbnums` 行 → 三态汇总。只数本 MDB 内、未排除的 DESI 行（`not_in_project` / `excluded` 的不是本服务的活）；
 * 一行都不剩时退回全部 DESI 行，免得面板一个数字都说不出。认不出的 verdict 归 `not_judged`。
 */
export function summarizeVerdicts(rows: DbnumRow[], now = Date.now()): GenModelV1VerdictSummary {
  const desi = rows.filter((row) => String(row.db_type ?? '').toUpperCase() === 'DESI');
  const scoped = desi.filter((row) => row.not_in_project !== true && row.excluded !== true);
  const counted = scoped.length > 0 ? scoped : desi;
  const summary = emptyVerdict();
  summary.lastCheckedAt = now;
  for (const row of counted) {
    const verdict = String(row.model_verdict ?? 'not_judged').toLowerCase();
    summary.byDbnum[row.dbnum] = verdict;
    summary.total++;
    if (verdict === 'in_sync') summary.inSync++;
    else if (verdict === 'lagging') {
      summary.lagging++;
      summary.laggingDbnums.push(row.dbnum);
    } else summary.notJudged++;
  }
  return summary;
}

function initialState(): GenModelV1HealthState {
  return {
    status: 'idle',
    baseUrl: '',
    project: null,
    mdb: null,
    namespace: null,
    version: null,
    dataFace: null,
    deliveryUnitTypes: [],
    initializationStatus: null,
    dataReady: null,
    modelReady: null,
    modelPhaseOpen: null,
    staticAssets: null,
    lastCheckedAt: null,
    lastOkAt: null,
    error: null,
    raw: null,
    verdict: emptyVerdict(),
  };
}

const state = reactive<GenModelV1HealthState>(initialState());

let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
let verdictInflight: Promise<void> | null = null;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** 把一份 `/health` 响应写进 state（纯赋值，给 refresh 与测试共用）。 */
export function applyGenModelV1Health(target: GenModelV1HealthState, health: HealthResponse, baseUrl: string, now = Date.now()): void {
  target.status = 'ok';
  target.baseUrl = baseUrl;
  target.project = asString(health.project);
  target.mdb = asString(health.mdb);
  target.namespace = asString(health.namespace);
  target.version = asString(health.version);
  target.dataFace = asString(health.data_face);
  target.deliveryUnitTypes = Array.isArray(health.delivery_unit_types)
    ? health.delivery_unit_types.filter((item): item is string => typeof item === 'string')
    : [];
  target.initializationStatus = asString(health.initialization?.status);
  target.dataReady = asBoolean(health.initialization?.data_ready);
  target.modelReady = asBoolean(health.initialization?.model_ready);
  target.modelPhaseOpen = asBoolean(health.initialization?.model_phase_open);
  target.staticAssets = asBoolean(health.static_assets);
  target.lastCheckedAt = now;
  target.lastOkAt = now;
  target.error = null;
  target.raw = health;
}

/** 探针失败：身份字段保留上一次成功值（面板还能说出「上次连到的是谁」），只翻状态与错误。 */
export function applyGenModelV1HealthError(target: GenModelV1HealthState, error: unknown, baseUrl: string, now = Date.now()): void {
  target.status = 'error';
  target.baseUrl = baseUrl;
  target.lastCheckedAt = now;
  target.error = isGenModelV1ApiError(error)
    ? `${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}

/** 把 base URL 压成徽标上那一小段：`http://localhost:8022` → `:8022`，`/gm` → `/gm`。 */
export function shortGenModelV1Host(baseUrl: string): string {
  if (!baseUrl) return '';
  if (baseUrl.startsWith('/')) return baseUrl;
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' ? '' : parsed.hostname;
    return parsed.port ? `${host}:${parsed.port}` : host || parsed.host;
  } catch {
    return baseUrl;
  }
}

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  const baseUrl = getGenModelV1BaseUrl();
  if (state.status === 'idle') state.status = 'loading';
  inflight = (async () => {
    try {
      const health = await genModelV1Health();
      applyGenModelV1Health(state, health, baseUrl);
    } catch (error) {
      applyGenModelV1HealthError(state, error, baseUrl);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * `/dbnums` 的三态（P5）。它比 `/health` 慢得多（初始化中的实例可能几十秒），所以单独一条线、单独的失败格，
 * 不拖累身份探针；`/health` 没通就不问它。
 *
 * 走 `useGenModelV1Dbnums` 的共享缓存：首屏那一次与 `useDbMetaInfo` 的 ref0→dbnum 合成同一个请求；
 * 定时轮询与人点「重探」才 `force` 重拉。
 */
async function refreshVerdict(options: { force?: boolean } = {}): Promise<void> {
  if (verdictInflight) return verdictInflight;
  if (state.status !== 'ok') return;
  verdictInflight = (async () => {
    try {
      const resp = await getGenModelV1Dbnums({ timeoutMs: 60_000, force: options.force === true });
      state.verdict = summarizeVerdicts(resp.dbnums ?? []);
    } catch (error) {
      state.verdict = {
        ...state.verdict,
        lastCheckedAt: Date.now(),
        error: isGenModelV1ApiError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error),
      };
    } finally {
      verdictInflight = null;
    }
  })();
  return verdictInflight;
}

/** 人点徽标「重探」：身份与三态都强制重拉。 */
async function refreshAll(): Promise<void> {
  await refresh();
  await refreshVerdict({ force: true });
}

/**
 * 起表：`/health` 每 `intervalMs`，`/dbnums` 三态每 `verdictIntervalMs`（用 `/health` 的节拍数出来，一张表）。
 * 首次不 force——与 `useDbMetaInfo` 首屏的 /dbnums 共用同一次请求。
 */
function start(intervalMs = DEFAULT_HEALTH_POLL_INTERVAL_MS, verdictIntervalMs = DEFAULT_VERDICT_POLL_INTERVAL_MS): void {
  if (timer) return;
  void (async () => {
    await refresh();
    await refreshVerdict();
  })();
  let lastVerdictTick = Date.now();
  timer = setInterval(() => {
    void (async () => {
      await refresh();
      const now = Date.now();
      // 三态上次没拿到（/health 当时没通）也补一次，不用等满一个周期
      if (now - lastVerdictTick >= verdictIntervalMs || state.verdict.lastCheckedAt === null) {
        lastVerdictTick = now;
        await refreshVerdict({ force: true });
      }
    })();
  }, intervalMs);
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

const summary = computed(() => {
  const host = shortGenModelV1Host(state.baseUrl || getGenModelV1BaseUrl());
  const who = `gen-model ${host}`.trim();
  switch (state.status) {
    case 'idle':
      return `${who} · 未探测`;
    case 'loading':
      return `${who} · 连接中…`;
    case 'error':
      return `${who} · 连接失败${state.project ? `（上次：${state.project}）` : ''}`;
    case 'ok': {
      const identity = [state.project, state.mdb].filter(Boolean).join(' ');
      const gate = state.modelPhaseOpen === null ? '' : ` · 模型门 ${state.modelPhaseOpen ? '开' : '关'}`;
      const ready = state.modelReady === null ? '' : state.modelReady ? '' : ' · 模型未就绪';
      return `已连接 ${who}${identity ? ` · ${identity}` : ''}${gate}${ready}`;
    }
    default:
      return who;
  }
});

/** 三态那一小段：「库 同步 1 · 滞后 0 · 未判 28」；没数据就空串。`not_judged` 只是陈述，不是告警。 */
export const verdictSummaryText = (verdict: GenModelV1VerdictSummary): string => {
  if (verdict.total === 0) return verdict.error ? '库状态未取到' : '';
  return `库 同步 ${verdict.inSync} · 滞后 ${verdict.lagging} · 未判 ${verdict.notJudged}`;
};

const verdictText = computed(() => verdictSummaryText(state.verdict));

export function useGenModelV1Health() {
  return {
    state: readonly(state),
    summary,
    verdictText,
    refresh: refreshAll,
    refreshVerdict: () => refreshVerdict({ force: true }),
    start,
    stop,
    /** 测试用：回到初始态并停表。 */
    __reset(): void {
      stop();
      inflight = null;
      verdictInflight = null;
      Object.assign(state, initialState());
    },
  };
}

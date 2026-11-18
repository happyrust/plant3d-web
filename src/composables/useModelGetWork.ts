/**
 * 「取最新」（E3D 的 GETWORK）的接线（单例）：把 `modelGetWork` 的引擎接到页面上真实的东西——后台的 `/health` 与
 * `/dbnums`、已加载节点表、取最新自己的登记表、模型树、三维场景、选中与属性、提示。
 *
 * 谁来登记：
 * - 模型树面板挂上时登记树（`registerGetWorkTree`），卸载时撤；
 * - 查看器装好显示流程时登记场景（`registerGetWorkScene`），卸载时撤；
 * - 跟着模型走的东西（属性面板的缓存、MBD 标注、房间树）各自登记一个「取最新之后要做的事」
 *   （`registerGetWorkDerived`）。没登记的派生物取最新不会碰——这一期带不上的见验证记录。
 *
 * 只有状态栏的「取最新」按钮调 `requestGetWork`。这里不引用数据源适配器的大包（用到时动态引入），
 * 免得状态栏把它拖进首屏。
 */
import { reactive, readonly } from 'vue';

import type { DbnumRow } from '@/api/genModelV1Api';
import type { GetWorkWatermark } from '@/composables/modelGetWorkRegistry';
import type { MbdLatestRefreshInput } from '@/composables/useMbdExternalSync';

import {
  createModelGetWork,
  type GetWorkDerived,
  type GetWorkReport,
  type GetWorkRoot,
  type GetWorkScenePort,
  type GetWorkTreePort,
} from '@/composables/modelGetWork';
import {
  advanceGetWorkRoot,
  forgetGetWorkRoot,
  getWorkRegisteredRoots,
  getWorkRegisteredScopes,
  noteGetWorkScopeChecked,
  noteGetWorkSiteKnown,
} from '@/composables/modelGetWorkRegistry';
import { hasActiveModelLoad } from '@/composables/modelLoadSession';
import { fetchNodeModelFacts } from '@/composables/nodeModelFacts';
import { resolveNodeModelStatus, type NodeChangedSession } from '@/composables/nodeModelStatus';
import { isTreeNodeGoneMessage } from '@/composables/pdmsTreeRefresh';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { getGenModelV1Dbnums, peekGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import { ensureGenModelV1Freshness, useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { dismissGenModelV1UpdateNotice } from '@/composables/useGenModelV1UpdateNotice';
import { useLoadedNodeStatus } from '@/composables/useLoadedNodeStatus';
import {
  getGlobalSelectedIsDeleted,
  getGlobalSelectedRefno,
  getGlobalSelectedVersionPin,
  setGlobalSelectedDeletedRefno,
} from '@/composables/useSelectionStore';
import { getGenModelV1ServiceGeneration } from '@/model-source/genModelV1/serviceLifecycle';
import { emitToast } from '@/ribbon/toastBus';
import { toRefnoKey } from '@/utils/refnoKey';

// 查看器登记地址栏直装的根、从地址栏的列表里撤下时撤掉、卸载时清登记表，都从这里拿（它只引这一个模块）
export { forgetGetWorkRoot, noteGetWorkRoot, resetGetWorkRegistry } from '@/composables/modelGetWorkRegistry';

let treePort: GetWorkTreePort | null = null;
let scenePort: GetWorkScenePort | null = null;
const derivedHandlers = new Map<string, GetWorkDerived>();

/** 模型树登记自己；回的函数在面板卸载时调。后登记的顶掉先登记的（同时只有一棵 PDMS 树）。 */
export function registerGetWorkTree(port: GetWorkTreePort): () => void {
  treePort = port;
  return () => {
    if (treePort === port) treePort = null;
  };
}

/** 查看器登记三维场景；回的函数在查看器卸载时调。 */
export function registerGetWorkScene(port: GetWorkScenePort): () => void {
  scenePort = port;
  return () => {
    if (scenePort === port) scenePort = null;
  };
}

/** 派生物登记「取最新之后要做的事」；同名的后登记顶掉先登记的。回的函数用来撤。 */
export function registerGetWorkDerived(handler: GetWorkDerived): () => void {
  derivedHandlers.set(handler.name, handler);
  return () => {
    if (derivedHandlers.get(handler.name) === handler) derivedHandlers.delete(handler.name);
  };
}

function sesnoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 记下此刻各库的水位（读 `/dbnums` 共享缓存里现成的，不发请求）。地址栏直装在**开始取数之前**调一次，
 * 装完按库取用——取早不取晚：装的过程中后端正好跑完一个批次时，宁可下次取最新多核对一次，不能漏掉。
 */
export function captureGetWorkWatermarks(): (dbnum: number) => GetWorkWatermark {
  const marks = new Map<number, GetWorkWatermark>();
  for (const row of peekGenModelV1Dbnums()?.response.dbnums ?? []) {
    if (typeof row.dbnum !== 'number') continue;
    marks.set(row.dbnum, { modelSesno: sesnoOf(row.model_sesno), fileLatestSesno: sesnoOf(row.file_latest_sesno) });
  }
  return (dbnum) => marks.get(dbnum) ?? { modelSesno: null, fileLatestSesno: null };
}

/**
 * 「取最新」跑完模型重载进入派生物阶段时，把刚刚强制重拉过的 `/dbnums` 各库水位整理给 MBD 增量同步（#142）：
 * - `fileLatestSessionsByDbnum` 供 `useMbdExternalSync` 比对各已装标注包的 `sourceVersion` 是否落后（没变的库不重取）；
 * - `modelSessionsByDbnum` 供尺寸面板核对标注会话与模型所在会话是否一致（如更新范围外的库）。
 */
export function readGetWorkMbdRefresh(): MbdLatestRefreshInput {
  const rows = peekGenModelV1Dbnums()?.response.dbnums;
  if (!rows || rows.length === 0) return {};
  const fileLatestSessionsByDbnum: Record<number, number> = {};
  const modelSessionsByDbnum: Record<number, number> = {};
  let hasFileLatest = false;
  let hasModelSesno = false;
  for (const row of rows) {
    if (typeof row.dbnum !== 'number') continue;
    const fileSesno = sesnoOf(row.file_latest_sesno);
    if (fileSesno !== null) {
      fileLatestSessionsByDbnum[row.dbnum] = fileSesno;
      hasFileLatest = true;
    }
    const modelSesno = sesnoOf(row.model_sesno);
    if (modelSesno !== null) {
      modelSessionsByDbnum[row.dbnum] = modelSesno;
      hasModelSesno = true;
    }
  }
  return {
    ...(hasFileLatest ? { fileLatestSessionsByDbnum } : {}),
    ...(hasModelSesno ? { modelSessionsByDbnum } : {}),
  };
}

type GetWorkState = {
  /** 有一轮在跑 */
  running: boolean;
  /** 这一轮完了还要再跑一轮（运行中又点了） */
  queued: boolean;
  /** 这一轮正在做什么 */
  progress: string;
  /** 上一轮的回执 */
  last: GetWorkReport | null;
};

const state = reactive<GetWorkState>({ running: false, queued: false, progress: '', last: null });

function currentRoots(): GetWorkRoot[] {
  const out = new Map<string, GetWorkRoot>();
  for (const entry of useLoadedNodeStatus().entries()) {
    // 只是点过、没有模型可显示的不算装着的
    if (!entry.loaded) continue;
    out.set(entry.refno, {
      refno: entry.refno,
      dbnum: entry.dbnum,
      loadedModelSesno: entry.loadedModelSesno,
      loadedFileLatestSesno: entry.loadedFileLatestSesno,
      staleReason: entry.staleReason,
      source: 'table',
      // 装上之后头一次问到的后端那一版（表里记下了才带）：引擎拿它核对屏幕上装的是不是后端现在的那一版
      ...(entry.loadedGenerated !== undefined ? { loadedGenerated: entry.loadedGenerated } : {}),
    });
  }
  for (const entry of getWorkRegisteredRoots()) {
    // 同一个节点两张表都有：以已加载节点表为准（它记的是最近一次经显示流程装的）
    if (out.has(entry.refno)) continue;
    out.set(entry.refno, {
      refno: entry.refno,
      dbnum: entry.dbnum,
      loadedModelSesno: entry.loadedModelSesno,
      loadedFileLatestSesno: entry.loadedFileLatestSesno,
      staleReason: null,
      source: 'registry',
    });
  }
  return [...out.values()];
}

/**
 * 页面上装着节点的那些库：已加载节点表里装着的节点、取最新登记的直装根、整库显示过的库。
 *
 * 状态栏「数据已更新」的提示拿它判断一个数据批次和本页有没有关系（查看器把它接进提示的场景探针）：这些库里任何一个
 * 有变化的批次落地都要提示——只有手动的「取最新」，人是靠那条提示知道该去点的。只是点过、没有模型可显示的节点不算。
 */
export function loadedModelDbnums(): number[] {
  const out = new Set<number>();
  for (const root of currentRoots()) out.add(root.dbnum);
  for (const scope of getWorkRegisteredScopes()) out.add(scope.dbnum);
  return [...out];
}

/** 当前选中的构件（`a_b`）：没有、不是 PDMS 的 refno、或钉在某个历史版本上的（版本对比里选的）都回 `null` */
function selectedRefnoKey(): string | null {
  if (getGlobalSelectedVersionPin()) return null;
  const key = toRefnoKey(getGlobalSelectedRefno());
  return /^\d+_\d+$/.test(key) ? key : null;
}

/**
 * 「本页装的那一版之后，谁改到了这个节点」——取最新**不去问节点版本表**（`node/versions`），一律按改到了算：
 * 回一条记在库现在的模型水位上的会话。`resolveNodeModelStatus` 只认落在「本页装的那一版之后、库的模型水位之内」的
 * 会话，所以库里的模型比本页装的新时这个节点判成「有更新可重载」、直接重载；库的模型水位没动（只有库文件前进了、
 * 后台没跟上）时这条会话不在那个范围里，等于没有可换的新版。
 *
 * 为什么不问：那条查询每来一个新会话都要把整条会话链现算一遍，不同节点之间不共用。2026-11-12 真实回放实测
 * （1663 个会话的库）一次 17–28 秒，几个节点一起问会超过 120 秒的请求上限——结果是「新旧判不了、屏幕上的没有动」，
 * 树换了、新增的构件却没装进来。重载只是重新查记录、和场景做差（同一个节点几十毫秒），记录才是准的。
 * 代价：这个库在册的节点，在库的模型水位每动一次之后各重载一次（哪怕这次改动没碰到它）。
 *
 * 库状态里没有这个库的那一行（没取到）而后端答得出节点的状态时，记在起点的下一个会话上：照样算有更新。
 */
function assumeChangedSince(sinceSesno: number, row: DbnumRow | null): NodeChangedSession[] {
  return [{ sesno: sesnoOf(row?.model_sesno) ?? sinceSesno + 1, time: null, unitsChanged: 0 }];
}

/** 数据源适配器的大包：用到时才引入，引入一次（状态栏不把它拖进首屏） */
let modelSourceModule: Promise<typeof import('@/model-source')> | null = null;

function loadModelSource(): Promise<typeof import('@/model-source')> {
  modelSourceModule ??= import('@/model-source');
  return modelSourceModule;
}

const engine = createModelGetWork({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  loadBusy: () => hasActiveModelLoad(),
  probeService: async () => ({ generation: (await ensureGenModelV1Freshness({ force: true })).generation }),
  // 此刻（页面刚打开、还没装任何模型）的服务代次：头一次点取最新就比得出「这期间后端重启过没有」
  initialGeneration: getGenModelV1ServiceGeneration(),
  fetchDbnumRows: async () => {
    const response = await getGenModelV1Dbnums({ timeoutMs: 60_000, force: true });
    const rows = new Map<number, DbnumRow>();
    for (const row of response.dbnums ?? []) {
      if (typeof row.dbnum === 'number') rows.set(row.dbnum, row);
    }
    // 库状态圆点、已加载节点表读的是健康探针里那一份：让它也换成新的（不等它）
    void useGenModelV1Health().refreshVerdict();
    return rows;
  },
  tree: () => treePort,
  scene: () => scenePort,
  roots: currentRoots,
  dbnumScopes: () => getWorkRegisteredScopes(),
  listSites: async (dbnum) => {
    const [{ getModelSource }, { listSitesOfDbnum }] = await Promise.all([
      loadModelSource(),
      import('@/model-source/genModelV1/collectDbnum'),
    ]);
    const tree = getModelSource().tree;
    // 根名单有短缓存：先清掉，查到的才是此刻的
    tree.invalidate?.();
    return listSitesOfDbnum(tree, dbnum);
  },
  nodeStatus: async (root, row) => {
    let gone = false;
    const status = await resolveNodeModelStatus({
      dbnum: root.dbnum,
      refno: root.refno,
      row,
      loadedModelSesno: root.loadedModelSesno,
      fetchFacts: async (query) => {
        try {
          return await fetchNodeModelFacts(query);
        } catch (error) {
          // 后端明说库文件最新会话上没有这个节点：记下来（`resolveNodeModelStatus` 只会把它折成「判不了」）
          if ((error as { code?: unknown } | null)?.code === 'REFNO_NOT_FOUND') gone = true;
          throw error;
        }
      },
      listChangedSessions: async ({ sinceSesno }) => assumeChangedSince(sinceSesno, row),
    });
    return { status, gone };
  },
  advanceRoot: advanceGetWorkRoot,
  forgetRoot: forgetGetWorkRoot,
  noteSiteKnown: noteGetWorkSiteKnown,
  noteScopeChecked: noteGetWorkScopeChecked,
  selection: {
    current: selectedRefnoKey,
    isDeleted: () => getGlobalSelectedIsDeleted(),
    markDeleted: (refno) => {
      // 按原样的那个值登记（不换写法）：选中的 refno 不变，模型树不会为它再去定位一次
      const raw = getGlobalSelectedRefno();
      if (raw && toRefnoKey(raw) === refno) setGlobalSelectedDeletedRefno(raw);
    },
  },
  probeNodeGone: async (refno) => {
    const { getModelSource } = await loadModelSource();
    const resp = await getModelSource().tree.ancestors(refno);
    if (resp.success) return false;
    return isTreeNodeGoneMessage(resp.error_message) ? true : null;
  },
  derived: () => [...derivedHandlers.values()],
  onProgress: (text) => {
    state.progress = text;
  },
});

let callers = 0;
let announced: GetWorkReport | null = null;

/** 一轮做完：给人一句交代（每轮只说一次，哪怕有几个人在等它）。 */
function announce(report: GetWorkReport): void {
  if (announced === report) return;
  announced = report;
  state.last = report;
  emitToast({ message: report.summary, level: report.level });
  const consoleStore = useConsoleStore();
  consoleStore.addLog(report.level === 'error' ? 'error' : report.level === 'warning' ? 'warning' : 'info', `[取最新] ${report.summary}`);
  for (const line of report.detail) consoleStore.addLog('info', `[取最新] ${line}`);
  // 状态栏那条「数据已更新 → 重载」说的就是这次换掉的东西：做成了就收起（有没换成的留着它）
  if (report.ok && report.models.failed.length === 0) dismissGenModelV1UpdateNotice();
}

/**
 * 取最新。运行中再叫会排成下一轮（不并发）。从不抛错：没做成也回一份回执（`ok: false`）。
 */
export async function requestGetWork(): Promise<GetWorkReport> {
  callers += 1;
  state.running = true;
  state.queued = callers > 1;
  try {
    const report = await engine.getLatest();
    announce(report);
    return report;
  } finally {
    callers -= 1;
    state.running = callers > 0;
    state.queued = callers > 1;
  }
}

export function useModelGetWork() {
  return {
    state: readonly(state),
    getLatest: requestGetWork,
  };
}

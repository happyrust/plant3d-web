/**
 * 「取最新」（E3D 的 GETWORK）的协调：人点一下，把这个页面同步到**后台现在已有的状态**——模型树刷新到位、
 * 已装的三维模型换成后台现在的那一版、跟着模型走的东西不留旧状态，最后给一句交代。
 *
 * 这一期（2026-11-12 用户定：做法 A，只有手动按钮）的边界：
 * - 只读：不调用 `update/execute`、节点更新、生成这类让后端开工的接口。后台的模型没跟上库文件的库、落后的节点不动，
 *   在交代里点明（行上的「更新」「生成」照旧可用）；
 * - 只有按钮会叫它。引擎写成「谁都可以叫它对一次账」，推送、轮询、标签页回前台这些自动触发这一期都不接。
 *
 * 一轮的顺序（固定）：等正在进行的装载 / 生成结束 → 核对后台（`/health` 认重启、`/dbnums` 取各库的三枚水位）→
 * 后端更新范围内还没做完的库有上限地等 → 刷新模型树 → 重载模型 → 派生物 → 一句交代。
 * 两轮不并发：运行中再点，合并成「这一轮完了再跑一轮」。
 *
 * 刷新范围按库发现、按节点动手：模型这一半只核对「所在库的模型水位或库文件最新会话和装的时候不一样」的节点，问后端它的节点模型状态
 * 之后才决定换不换；别的库的节点不碰。接线那一层（`useModelGetWork`）在新后端声明支持 `node/versions` 尾段快算（#325）与
 * 祖先位姿传播（#323）时，会按 `since_sesno` 查尾段版本表，零几何影响的未改节点不再陪着重载；旧后端或查表失败时保守回退到重载。
 * 树那一半把取过子节点的层都重取一遍（请求小，见 `pdmsTreeRefresh`）。
 *
 * 例外（2026-11-17）：不在后端更新范围里、库一级的模型又落后于库文件的库。后台不会去追它，新旧只能按页面上装着的
 * 节点说——节点装上的时候就可能已经落后，做过节点一级更新的又已经是最新。所以这种库里在册的节点哪怕库的水位和装的
 * 时候一样也核对（核对到是最新、屏幕上装的又确实是那一版之后，库没再变就不再问），交代按节点说（见 `describeOutOfScopeLibrary`）。
 * 这只改问不问和怎么说，不改换不换：换不换仍由 `decideRootAction` 定。
 *
 * 这个文件不引用 Vue、不引用数据源：要用的东西都从 `GetWorkPorts` 进来，接线在 `useModelGetWork`。
 */
import type { DbnumRow } from '@/api/genModelV1Api';
import type { NodeModelStatus } from '@/composables/nodeModelStatus';
import type { TreeRefreshReport } from '@/composables/pdmsTreeRefresh';

import { judgeDbnumFreshness } from '@/composables/dbnumFreshness';
import { nodeModelStatusAction } from '@/composables/nodeModelStatus';

/** 等正在进行的装载 / 生成：多久看一次、最多等多久（等不到这一轮不做，照实说） */
export const GETWORK_LOAD_WAIT_POLL_MS = 500;
export const GETWORK_LOAD_WAIT_MAX_MS = 10 * 60_000;
/** 等后台把后端更新范围内的库更新完：多久看一次 `/dbnums`、最多等多久（等不到就换能换的并说明） */
export const GETWORK_BACKEND_WAIT_POLL_MS = 3_000;
export const GETWORK_BACKEND_WAIT_MAX_MS = 45_000;
/** 同时在问节点模型状态的节点数 */
export const GETWORK_STATUS_CONCURRENCY = 3;

/** 后端的一版节点模型：已生成的那部分对应到哪些会话、当时有几个生成单元落后（后端没给为 `null`） */
export type GetWorkLoadedGeneration = { sesnoMin: number; sesnoMax: number; laggingUnits: number | null };

/** 页面上装着的一个节点（「本页装的是哪一版」） */
export type GetWorkRoot = {
  /** `a_b` */
  refno: string;
  dbnum: number;
  /** 装的时候这个库的模型水位 / 库文件最新会话；当时没读到为 `null` */
  loadedModelSesno: number | null;
  loadedFileLatestSesno: number | null;
  /** 已加载节点表记的「本页装的不是后端现在的那一版」；没有为 `null` */
  staleReason: string | null;
  /** `table` = 已加载节点表里的；`registry` = 整库显示 / 地址栏直装登记的 */
  source: 'table' | 'registry';
  /**
   * 曾经装进场景、因上次「取最新」/重载名下查空（`empty`）被撤下几何，但节点仍在库里、用户未主动关闭眼睛：
   * 继续留在追踪范围里；几何恢复后重载装回场景，仍为空时不再重复撤下。
   */
  withdrawnEmpty?: boolean;
  /** 已加载节点表已明确要求重载（例如任务批次点名或之前落后的改动已生成） */
  reloadHint?: boolean;
  /**
   * 装上之后头一次问到的后端那一版模型（已加载节点表记的）。`null` = 当时后端说不出；不给 = 没记下
   * （登记表里的节点、状态还没问回来、旧后端）。后端按需生成的模型不动库的水位，屏幕上的是不是它现在的那一版
   * 只能拿这个比（见 `screenHoldsBackendModel`）。
   */
  loadedGenerated?: GetWorkLoadedGeneration | null;
};

/** 整库显示过的库：取最新时看它有没有新出现的顶层 SITE */
export type GetWorkDbnumScope = {
  dbnum: number;
  /** 已经在管的顶层 SITE（装进来的、或上次没收齐不归取最新管的） */
  knownSites: ReadonlySet<string>;
  /** 要不要找新出现的 SITE（按预算只显示了一部分的库不找：那些没轮到的 SITE 不是「新增的」） */
  discover: boolean;
  /** 上一次找新 SITE 时库文件的最新会话；没找过为 `null` */
  checkedFileLatestSesno: number | null;
};

export type GetWorkTreePort = {
  /** 树上取过子节点的那些节点属于哪些库（「这个页面在树上碰过的库」） */
  touchedDbnums(): number[];
  refresh(): Promise<TreeRefreshReport>;
  /** 节点在树上的名字；树上没有回 `null` */
  nameOf(refno: string): string | null;
};

/**
 * 场景这一侧。后三个都带着节点所在的库号（登记时就知道）：整库显示的页面里 refno → 库号的映射可能还没装
 * （那条路的库号是地址栏给的），不能靠现查。
 */
export type GetWorkScenePort = {
  /** 重载（不生成）。`true` = 换上了，或查空并确认之后撤下了；`false` = 没做成，场景保持原样 */
  reload(refno: string): Promise<boolean>;
  /** 把库里已经没有的节点从场景撤下；回撤下的构件数 */
  withdraw(refno: string, dbnum: number): number;
  /** 这个节点现在装着哪些构件；不知道回 `null` */
  loadedRefnos(refno: string, dbnum: number): string[] | null;
  /** 这个节点（或它名下的构件）还在不在场景里：别处已经撤掉的不该被取最新装回来 */
  rootInScene(refno: string, dbnum: number): boolean;
};

export type GetWorkDerivedContext = {
  /** 这一轮树或模型有变化，或碰过的库的水位比上一轮动了 */
  changed: boolean;
  treeChanged: boolean;
  modelsChanged: boolean;
};

/** 跟着模型走的东西（属性面板、MBD 标注、房间树、校审批注绑定、测量与净距……）：各自登记一个「取最新之后要做的事」 */
export type GetWorkDerived = {
  name: string;
  /** 模型重载与撤下开始前拍快照（可选）：供派生物对比本轮撤下或发生几何/变换变化的已装构件 */
  beforeModels?: () => void | Promise<void>;
  run(context: GetWorkDerivedContext): void | Promise<void>;
};

export type GetWorkNodeStatus = {
  status: NodeModelStatus;
  /** 后端明说库文件最新会话上没有这个节点（`REFNO_NOT_FOUND`） */
  gone: boolean;
};

export type GetWorkPorts = {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** 有装载 / 生成在跑 */
  loadBusy(): boolean;
  /** 强制探一次 `/health`，回服务代次（页面打开以来每看到后端换一次加一）；连不上就抛 */
  probeService(): Promise<{ generation: number }>;
  /**
   * 页面打开时的服务代次（`probeService` 回的那个数的起点）。给了，头一轮取最新就认得出「本页打开之后后端重启过」；
   * 不给，头一轮没有可比的，要到第二轮才认得出（2026-11-12 在真实后端上撞到：装了按需生成的节点 → 后端重启 →
   * 头一次点取最新，说的是「已是最新」，而后端此刻已经没有那个节点的模型了）。
   */
  initialGeneration?: number;
  /** 强制重拉 `/dbnums`：库号 → 行；取不到就抛 */
  fetchDbnumRows(): Promise<Map<number, DbnumRow>>;
  /** 模型树；面板没开为 `null` */
  tree(): GetWorkTreePort | null;
  /** 三维场景；查看器没挂为 `null` */
  scene(): GetWorkScenePort | null;
  roots(): GetWorkRoot[];
  dbnumScopes(): GetWorkDbnumScope[];
  /** 一个库在树根下的顶层 SITE */
  listSites(dbnum: number): Promise<{ refno: string; name: string }[]>;
  nodeStatus(root: GetWorkRoot, row: DbnumRow | null): Promise<GetWorkNodeStatus>;
  /** 登记表里的节点核对过、不用动：把它记的水位推进到现在（下一轮不再为它发请求） */
  advanceRoot(refno: string, at: { modelSesno: number | null; fileLatestSesno: number | null }): void;
  /** 登记表里的节点不再归登记表管（撤下了，或重载之后由已加载节点表接管） */
  forgetRoot(refno: string): void;
  /** 整库显示的库：这个 SITE 从此算已经在管的 */
  noteSiteKnown(dbnum: number, site: string): void;
  /** 整库显示的库：找过一次新 SITE 了，记下当时库文件的最新会话 */
  noteScopeChecked(dbnum: number, fileLatestSesno: number | null): void;
  selection: {
    /** 当前选中的构件（`a_b`）；没有为 `null` */
    current(): string | null;
    /** 已经登记成「已删除」了 */
    isDeleted(): boolean;
    markDeleted(refno: string): void;
  };
  /** 一个节点库里还有没有：`true` 没有了、`false` 还在、`null` 没问到 */
  probeNodeGone(refno: string): Promise<boolean | null>;
  derived(): GetWorkDerived[];
  onProgress(text: string): void;
};

export type GetWorkLibraryNote = {
  dbnum: number;
  kind: 'out_of_scope' | 'backend_behind' | 'updating' | 'blocked' | 'unknown';
  text: string;
};

export type GetWorkModelsReport = {
  /** 在册的节点数（已加载节点表 + 登记表） */
  rootsTotal: number;
  /** 这一轮向后端核对了的节点数 */
  checked: number;
  /** 重载了的：换上 / 撤下各多少个构件 */
  reloaded: { refno: string; added: number; removed: number; total: number }[];
  /** 新装进来的（整库显示里新出现的顶层 SITE） */
  loadedNew: { refno: string; name: string; total: number }[];
  /** 整个从场景撤下的节点：`deleted` 库里没有它了；`empty` 它还在、名下已没有几何 */
  withdrawn: { refno: string; refnos: number; why: 'deleted' | 'empty' }[];
  /** 没动、要说明的（节点落后 / 后端没有它的模型 / 库在更新 / 判不了） */
  kept: { refno: string; reason: string }[];
  failed: { refno: string; reason: string }[];
  /**
   * 这一轮场景里一共多了 / 少了多少个构件（不重复计：一个节点既单独装过、又在装过的祖先名下时，
   * 它的构件在两处的回执里都会出现，这里只算一次）
   */
  componentsAdded: number;
  componentsRemoved: number;
};

export type GetWorkReport = {
  startedAt: number;
  finishedAt: number;
  /** `false` = 这一轮没做成（后台连不上、装载一直没结束……），页面没动 */
  ok: boolean;
  error: string | null;
  /** 上一轮以来后端重启过 */
  backendRestarted: boolean;
  /** 模型树这一半的回执；面板没开为 `null` */
  tree: TreeRefreshReport | null;
  treeError: string | null;
  models: GetWorkModelsReport;
  /** 没能跟到最新的库 */
  libraries: GetWorkLibraryNote[];
  /**
   * 不算没跟上、只在细节里交代的库一级事实：不在后端更新范围里的库，库一级的模型落后于库文件，
   * 但页面上装着的节点都核对过是最新（比如都做过节点一级的更新）
   */
  libraryFacts: string[];
  /** 等后台的那一段：等了哪些库、多久、哪些没等到 */
  waited: { dbnums: number[]; ms: number; timedOut: number[] } | null;
  /** 选中的构件这一轮发现已被删除 */
  selectionDeleted: string | null;
  derived: { name: string; ok: boolean }[];
  level: 'success' | 'info' | 'warning' | 'error';
  /** 给人的那一句 */
  summary: string;
  /** 逐条细节（悬停 / 控制台） */
  detail: string[];
};

function sesnoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** 这个库后台是不是还在往最新追（后端更新范围内才会自己追上：值得等一等） */
export function libraryWaitsForBackend(row: DbnumRow | null | undefined): boolean {
  if (!row) return false;
  const kind = judgeDbnumFreshness(row).kind;
  // `excluded`（不在后端更新范围 / 不在本项目）的库后台不会去追，等也白等
  return kind === 'updating' || kind === 'file_ahead' || kind === 'model_behind';
}

/** 一个碰过的库有没有「没跟到最新」要交代的；没有回 `null`。 */
export function describeLibraryGap(dbnum: number, row: DbnumRow | null | undefined): GetWorkLibraryNote | null {
  if (!row) return { dbnum, kind: 'unknown', text: `库 ${dbnum} 的状态没取到，新旧不知道` };
  const freshness = judgeDbnumFreshness(row);
  const { fileLatest, applied, model } = freshness;
  switch (freshness.kind) {
    case 'excluded':
      // 没初始化的库模型按需生成、没有库一级的模型水位：落不落后是节点一级的事，在节点那里说
      if (!freshness.initialized || fileLatest === null || model === null || fileLatest <= model) return null;
      return {
        dbnum,
        kind: 'out_of_scope',
        text: `库 ${dbnum} 不在后端更新范围里：模型停在会话 ${model}，库文件已到 ${fileLatest}（树已是最新，模型不会自动跟上）`,
      };
    case 'updating':
      return { dbnum, kind: 'updating', text: `库 ${dbnum} 后台还在更新（模型在会话 ${model ?? '—'}，库文件已到 ${fileLatest ?? '—'}）` };
    case 'file_ahead':
      return { dbnum, kind: 'backend_behind', text: `库 ${dbnum} 后台还没跟上：数据入库到会话 ${applied ?? '—'}，库文件已到 ${fileLatest ?? '—'}` };
    case 'model_behind':
      return { dbnum, kind: 'backend_behind', text: `库 ${dbnum} 后台的模型还没跟上：模型在会话 ${model ?? '—'}，数据已到 ${applied ?? '—'}` };
    case 'blocked':
      return { dbnum, kind: 'blocked', text: `库 ${dbnum} 被后台阻断，不会更新（模型在会话 ${model ?? '—'}，库文件已到 ${fileLatest ?? '—'}）` };
    case 'unknown':
      return { dbnum, kind: 'unknown', text: `库 ${dbnum} 的三枚水位（库文件最新会话、数据入库到的会话、模型生成所按的会话）对不上，新旧判不了` };
    default:
      return null;
  }
}

/**
 * 不在后端更新范围里、库一级的模型落后于库文件的库，页面上装着的节点这一轮核对下来各是什么样（给库一级那句话用）。
 */
export type GetWorkLibraryNodes = {
  /** 这个库在页面上装着的节点数（这一轮撤下的不算） */
  total: number;
  /** 后端的节点模型状态接口说是最新、屏幕上的也是那一版的 */
  latest: number;
  /** 落后的（要点行上的「更新」） */
  lagging: number;
};

/**
 * 不在后端更新范围里、库一级的模型落后于库文件的库（`describeLibraryGap` 的 `out_of_scope`），按页面上装着的节点
 * 怎么交代（纯函数）：
 * - 有节点落后：仍算没跟到最新，点明几个落后、去点行上的「更新」（节点一级的更新）；
 * - 装着的都核对过是最新（比如都做过节点一级的更新）：不算没跟上，只留一句事实放在细节里；
 * - 其余（这个库在页面上没装节点、查看器没挂、有节点说不出新旧）：照库一级的原话。
 */
export function describeOutOfScopeLibrary(
  note: GetWorkLibraryNote,
  row: DbnumRow | null | undefined,
  nodes: GetWorkLibraryNodes | null | undefined,
): { note: GetWorkLibraryNote | null; fact: string | null } {
  if (!nodes || nodes.total <= 0) return { note, fact: null };
  if (nodes.lagging > 0) {
    const who = nodes.lagging < nodes.total
      ? `页面上装着的 ${nodes.total} 个节点里有 ${nodes.lagging} 个落后`
      : nodes.total === 1 ? '页面上装着的 1 个节点落后' : `页面上装着的 ${nodes.total} 个节点都落后`;
    return { note: { ...note, text: `${note.text}；${who}，点行上的「更新」可让后端追上` }, fact: null };
  }
  if (nodes.latest < nodes.total) return { note, fact: null };
  const freshness = row ? judgeDbnumFreshness(row) : null;
  const all = nodes.total === 1 ? '页面上装着的 1 个节点已是最新' : `页面上装着的 ${nodes.total} 个节点都已是最新`;
  return {
    note: null,
    fact: `库 ${note.dbnum} 不在后端更新范围里（库一级的模型停在会话 ${freshness?.model ?? '—'}，库文件已到 ${freshness?.fileLatest ?? '—'}）；${all}`,
  };
}

/**
 * 这个节点这一轮要不要向后端核对（「按库发现」）：所在库的模型水位和库文件最新会话都和装的时候一样就不问。
 * `restarted`：上一轮以来后端重启过——库里没有成套模型的（模型按需生成、只在后端内存里）要问，重启后那些模型没了。
 */
export function rootNeedsCheck(root: GetWorkRoot, row: DbnumRow | null | undefined, restarted: boolean): boolean {
  if (root.staleReason) return true;
  if (!row) return true;
  if (root.loadedModelSesno === null && root.loadedFileLatestSesno === null) return true;
  if (sesnoOf(row.model_sesno) !== root.loadedModelSesno) return true;
  if (sesnoOf(row.file_latest_sesno) !== root.loadedFileLatestSesno) return true;
  if (restarted && !(row.initialized === true && (sesnoOf(row.model_sesno) ?? 0) > 0)) return true;
  return false;
}

export type GetWorkRootAction =
  | { kind: 'withdraw' }
  | { kind: 'reload'; note: string | null }
  | { kind: 'keep'; reason: string }
  | { kind: 'none' };

/**
 * 屏幕上装的是不是后端现在的这一版（纯函数）。只用来定「不在后端更新范围的库里，装着的节点都已是最新」这句话敢不敢说，
 * 不改变换不换：靠库的水位担保的那一版，库的水位没动它就没动；后端按需生成的那部分不动库的水位——要装上之后头一次
 * 问到的那一版和现在的一样才算（做过节点一级更新的节点重新登记过，记的就是更新之后那一版）。说不准的一律不算：
 * 比如装上之后别的页面让后端重新生成过它，后端说「最新」，屏幕上却还是原来那一版。
 */
export function screenHoldsBackendModel(root: GetWorkRoot, status: NodeModelStatus): boolean {
  if (status.source !== 'model-status') return false;
  const generated = status.generated;
  if (!generated) return false;
  if (generated.basis === 'library_watermark') return true;
  const loaded = root.loadedGenerated;
  if (!loaded) return false;
  if (generated.sesnoMin !== loaded.sesnoMin || generated.sesnoMax !== loaded.sesnoMax) return false;
  // 对应的会话没变、落后的单元却比装上时少了：少掉的那些是装上之后重新生成的
  if (loaded.laggingUnits === null) return true;
  const lagging = status.units?.lagging ?? null;
  return lagging !== null && lagging >= loaded.laggingUnits;
}

/** 后端按需生成的模型比本页装的新（别的页面 / 别人让它在更新的会话上重新生成过） */
function ownGenerationNewer(root: GetWorkRoot, status: NodeModelStatus): boolean {
  const generated = status.generated;
  if (!generated || generated.basis === 'library_watermark') return false;
  return root.loadedFileLatestSesno !== null && generated.sesnoMax > root.loadedFileLatestSesno;
}

/**
 * 一个节点这一轮怎么办（纯函数）。原则：后端现在有它的模型、而且和本页装的不一样 → 重载；库里没有它了 → 撤下；
 * 后端没有它的（完整）模型、库在更新、判不了 → 屏幕上的不动，照实说（**后端没有模型不等于它被删了**）。
 */
export function decideRootAction(
  root: GetWorkRoot,
  answer: GetWorkNodeStatus,
  options: { restarted: boolean },
): GetWorkRootAction {
  if (answer.gone) return { kind: 'withdraw' };
  const status = answer.status;
  const watermarkUnknown = root.loadedModelSesno === null && root.loadedFileLatestSesno === null;
  // 库模型水位回退（例如重建 / 回滚），或靠库水位担保但装入时没记到有效模型水位基线：保守重载，绝不漏更新
  const modelRolledBack = root.loadedModelSesno !== null
    && status.modelSesno !== null
    && status.modelSesno < root.loadedModelSesno;
  const modelBaselineMissing = status.modelSesno !== null
    && status.modelSesno > 0
    && status.generated?.basis !== 'own_generation'
    && (root.loadedModelSesno === null || root.loadedModelSesno <= 0);
  const mustReload = Boolean(
    root.withdrawnEmpty
    || root.staleReason
    || root.reloadHint
    || ownGenerationNewer(root, status)
    || watermarkUnknown
    || modelRolledBack
    || modelBaselineMissing,
  );
  switch (status.verdict) {
    case 'reloadable':
      return { kind: 'reload', note: null };
    case 'latest':
      // 本页装的是哪一版没记下来、水位回退、或上次查空撤下后现在后端又有模型了：换一次最稳（重载不生成，只是按后端现在的记录整套替换）
      if (mustReload) return { kind: 'reload', note: null };
      return { kind: 'none' };
    case 'lagging': {
      const behind = '这个节点落后（模型生成之后又有会话改到了它）：这次换上的是后台现有的那一版；行上的「更新」可让后端追上';
      if (status.reloadableSessions.length > 0 || mustReload) {
        return { kind: 'reload', note: behind };
      }
      return { kind: 'keep', reason: '这个节点落后（模型生成之后又有会话改到了它），屏幕上的没有可换的新版；行上的「更新」可让后端追上' };
    }
    case 'empty':
      // 上次查空已经撤下过、现在依然没有生成单元：不再重复撤下
      if (root.withdrawnEmpty) return { kind: 'none' };
      // 这个节点下已经没有生成单元（成员删光了）：重载会查空，确认之后把它名下的旧构件撤下
      return { kind: 'reload', note: null };
    case 'updating':
      return { kind: 'keep', reason: '所在的库后台正在更新，屏幕上的没有动；稍后再点「取最新」' };
    case 'partial':
    case 'not_generated': {
      const what = status.verdict === 'partial' ? '只有一部分' : '没有';
      const why = options.restarted ? '后端重启过，' : '';
      // 让人去点的按钮跟着行上真给的那一颗走（同一个判定 `nodeModelStatusAction`）：库在后端更新范围里、库文件比模型水位新时，
      // 缺的单元靠库一级的更新补，行上给的是「更新」而不是「生成」；没有要生成的单元时行上没有按钮，就不提
      const rowAction = nodeModelStatusAction(status);
      const remedy = rowAction === 'update'
        ? '；行上的「更新」可让后端把这个库更新到最新'
        : rowAction === 'generate' ? '；行上的「生成」可重新生成' : '';
      return {
        kind: 'keep',
        reason: `${why}后端现在${what}这个节点的模型，屏幕上的保持原样（不当成已删除）${remedy}`,
      };
    }
    case 'untracked':
      return { kind: 'keep', reason: '所在的库未初始化、后端没有节点模型状态接口，新旧判不了，屏幕上的没有动' };
    default:
      return { kind: 'keep', reason: `新旧判不了（${status.reason || '后端没有答复'}），屏幕上的没有动` };
  }
}

/** 整库显示里新出现的顶层 SITE 要不要装：后端有它的模型才装（没有模型的装了只会得到一句「没有几何」） */
export function newSiteHasModel(status: NodeModelStatus): boolean {
  if (status.verdict === 'latest' || status.verdict === 'lagging' || status.verdict === 'reloadable') return true;
  return status.verdict === 'partial' && (status.units?.generated ?? 0) > 0;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

function emptyModels(): GetWorkModelsReport {
  return { rootsTotal: 0, checked: 0, reloaded: [], loadedNew: [], withdrawn: [], kept: [], failed: [], componentsAdded: 0, componentsRemoved: 0 };
}

function emptyReport(startedAt: number): GetWorkReport {
  return {
    startedAt,
    finishedAt: startedAt,
    ok: true,
    error: null,
    backendRestarted: false,
    tree: null,
    treeError: null,
    models: emptyModels(),
    libraries: [],
    libraryFacts: [],
    waited: null,
    selectionDeleted: null,
    derived: [],
    level: 'info',
    summary: '',
    detail: [],
  };
}

const NAMED = 3;

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, NAMED).join('、');
  return names.length > NAMED ? `${shown} 等 ${names.length} 个` : shown;
}

/**
 * 回执 → 给人的那一句和逐条细节（纯函数）。`label` 把 refno 换成树上的名字（没有就用 refno）。
 */
export function summarizeGetWork(report: GetWorkReport, label: (refno: string) => string = (refno) => refno): Pick<GetWorkReport, 'summary' | 'detail' | 'level'> {
  if (!report.ok) {
    return { summary: `取最新没有完成：${report.error ?? '原因不明'}`, detail: [], level: 'error' };
  }
  const parts: string[] = [];
  const detail: string[] = [];
  let caveats = 0;

  const tree = report.tree;
  if (tree) {
    const deleted = tree.removed.filter((item) => item.fate === 'deleted').length;
    const relocated = tree.removed.filter((item) => item.fate === 'relocated').length;
    const vanished = tree.removed.length - deleted - relocated;
    const bits = [
      tree.added.length > 0 ? `新增 ${tree.added.length}` : '',
      deleted > 0 ? `删除 ${deleted}` : '',
      tree.renamed.length > 0 ? `改名 ${tree.renamed.length}` : '',
      tree.moved.length + relocated > 0 ? `挪位置 ${tree.moved.length + relocated}` : '',
      vanished > 0 ? `从树上消失 ${vanished}（没问到是删了还是挪了）` : '',
    ].filter(Boolean);
    if (bits.length > 0) parts.push(`模型树${bits.join('、')}`);
    if (tree.added.length > 0) detail.push(`树上新增：${nameList(tree.added.map((item) => item.name || item.id))}`);
    if (deleted > 0) detail.push(`树上删除：${nameList(tree.removed.filter((item) => item.fate === 'deleted').map((item) => item.name || item.id))}`);
    if (tree.renamed.length > 0) detail.push(`树上改名：${nameList(tree.renamed.map((item) => `${item.previousName} → ${item.name}`))}`);
    if (tree.moved.length > 0) detail.push(`树上挪位置：${nameList(tree.moved.map((item) => item.name || item.id))}`);
    if (relocated > 0) {
      detail.push(`挪到了树上还没展开的位置：${nameList(tree.removed.filter((item) => item.fate === 'relocated').map((item) => item.name || item.id))}`);
    }
    if (tree.layersFailed.length > 0) {
      caveats += 1;
      parts.push(`有 ${tree.layersFailed.length} 层没取到（保持原样）`);
      detail.push(`没取到的层：${nameList(tree.layersFailed.map((item) => `${item.name}（${item.error}）`))}`);
    }
  } else if (report.treeError) {
    caveats += 1;
    parts.push('模型树没刷新成');
    detail.push(`模型树刷新失败：${report.treeError}`);
  }

  const models = report.models;
  const swappedIn = models.componentsAdded;
  const swappedOut = models.componentsRemoved;
  // 撤下分两种说：库里已经没有它的，和它还在库里、只是名下没有几何了的（比如唯一的构件挪到了别的设备下）
  const withdrawnDeleted = models.withdrawn.filter((item) => item.why === 'deleted').length;
  const withdrawnEmpty = models.withdrawn.length - withdrawnDeleted;
  const modelBits = [
    models.reloaded.length > 0 ? `重载 ${models.reloaded.length} 个节点` : '',
    models.loadedNew.length > 0 ? `新装入 ${models.loadedNew.length} 个 SITE` : '',
    withdrawnDeleted > 0 ? `撤下 ${withdrawnDeleted} 个已不存在的节点` : '',
    withdrawnEmpty > 0 ? `撤下 ${withdrawnEmpty} 个名下已没有几何的节点` : '',
  ].filter(Boolean);
  if (modelBits.length > 0) {
    const counts = [swappedIn > 0 ? `新增 ${swappedIn} 个构件` : '', swappedOut > 0 ? `撤下 ${swappedOut} 个构件` : ''].filter(Boolean).join('、');
    parts.push(`模型${modelBits.join('、')}${counts ? `（${counts}）` : ''}`);
  }
  for (const item of models.reloaded) {
    detail.push(`重载 ${label(item.refno)}：现有 ${item.total} 个构件${item.added > 0 ? `，新增 ${item.added}` : ''}${item.removed > 0 ? `，撤下 ${item.removed}` : ''}`);
  }
  for (const item of models.loadedNew) detail.push(`新装入 ${item.name || label(item.refno)}：${item.total} 个构件`);
  for (const item of models.withdrawn) {
    detail.push(`撤下 ${label(item.refno)}（${item.why === 'deleted' ? '库里已经没有它' : '它名下已没有几何'}）：${item.refnos} 个构件`);
  }
  if (models.kept.length > 0) {
    caveats += 1;
    parts.push(`${models.kept.length} 个节点的模型没有动`);
    for (const item of models.kept) detail.push(`${label(item.refno)}：${item.reason}`);
  }
  if (models.failed.length > 0) {
    caveats += 1;
    parts.push(`${models.failed.length} 个节点重载没成`);
    for (const item of models.failed) detail.push(`${label(item.refno)}：${item.reason}`);
  }

  if (report.selectionDeleted) {
    parts.push('选中的构件已被删除');
    detail.push(`选中的 ${label(report.selectionDeleted)} 在库里已经没有了`);
  }
  if (report.backendRestarted) detail.push('这次取最新之前后端重启过');
  if (report.waited) {
    detail.push(`等后台更新库 ${report.waited.dbnums.join('、')} 用了 ${Math.round(report.waited.ms / 1000)} 秒${report.waited.timedOut.length > 0 ? `，库 ${report.waited.timedOut.join('、')} 没等到` : ''}`);
  }
  const failedDerived = report.derived.filter((item) => !item.ok);
  if (failedDerived.length > 0) {
    caveats += 1;
    detail.push(`没刷新成：${failedDerived.map((item) => item.name).join('、')}`);
  }

  const changed = parts.length > 0;
  const checked = [
    tree ? `${tree.layersRequested} 层树` : '',
    models.rootsTotal > 0 ? `${models.rootsTotal} 个已装的节点` : '',
  ].filter(Boolean).join('、');
  let summary = changed
    ? `已取最新：${parts.join('；')}。`
    : `已是最新：模型树和已装的模型都没有变化${checked ? `（核对了 ${checked}）` : ''}。`;
  if (report.libraries.length > 0) {
    // 不在后端更新范围里的库是长期如此的事实：照实说，但不为它把这一句标成警告
    if (report.libraries.some((item) => item.kind !== 'out_of_scope')) caveats += 1;
    summary += `没跟到最新：${report.libraries.map((item) => item.text).join('；')}。`;
    for (const item of report.libraries) detail.push(item.text);
  }
  // 不算没跟上的库一级事实：不进那一句，只留在细节里
  for (const text of report.libraryFacts) detail.push(text);
  const acted = (tree?.changed ?? false) || models.reloaded.length + models.loadedNew.length + models.withdrawn.length > 0 || !!report.selectionDeleted;
  return { summary, detail, level: caveats > 0 ? 'warning' : acted ? 'success' : 'info' };
}

export type ModelGetWork = {
  /** 对一次账。运行中再叫：合并成「这一轮完了再跑一轮」，拿到的是那一轮的回执。从不抛错。 */
  getLatest(): Promise<GetWorkReport>;
  isRunning(): boolean;
};

export function createModelGetWork(ports: GetWorkPorts): ModelGetWork {
  let current: Promise<GetWorkReport> | null = null;
  let followUp: Promise<GetWorkReport> | null = null;
  /** 上一轮看到的服务代次（头一轮之前是页面打开时的那个，没给就是不知道）：变了就是后端重启过 */
  let lastGeneration: number | null = ports.initialGeneration ?? null;
  /** 上一轮结束时碰过的库的水位：这一轮比它动了，派生物（房间树）才值得刷新 */
  let lastWatermarks = new Map<number, string>();
  /**
   * 已加载节点表里的节点上一次核对「不用动」时的水位（库的 + 它装时的）：库没再变就不再为它发请求。
   * 那张表不归取最新改，记在这里；登记表里的节点靠推进它自己记的水位做到同一件事（这里也按推进之后的水位记一笔）。
   * `confirmedLatest`：那一次是后端的节点模型状态接口明说「最新」、屏幕上装的又核对得出就是那一版——不在后端更新范围里的库靠它判断「装着的节点都已是最新」
   * （过渡办法不问节点版本表，它说的「最新」不作数）。
   */
  const settledAt = new Map<string, { key: string; confirmedLatest: boolean }>();
  const settleKey = (row: DbnumRow, loadedModelSesno: number | null, loadedFileLatestSesno: number | null): string => (
    `${row.model_sesno ?? ''}:${row.file_latest_sesno ?? ''}|${loadedModelSesno ?? ''}:${loadedFileLatestSesno ?? ''}`
  );

  /** 等装载 / 生成结束；等不到回 `false` */
  async function waitLoadIdle(): Promise<boolean> {
    if (!ports.loadBusy()) return true;
    ports.onProgress('等正在进行的装载结束…');
    const startedAt = ports.now();
    while (ports.loadBusy()) {
      if (ports.now() - startedAt >= GETWORK_LOAD_WAIT_MAX_MS) return false;
      await ports.sleep(GETWORK_LOAD_WAIT_POLL_MS);
    }
    return true;
  }

  async function refreshModels(
    report: GetWorkReport,
    scene: GetWorkScenePort,
    rows: Map<number, DbnumRow>,
  ): Promise<Map<number, GetWorkLibraryNodes>> {
    const models = report.models;
    const restarted = report.backendRestarted;
    const allRoots = ports.roots();
    // 登记表里的节点别处已经撤掉了（换了地址栏的列表、清了场景）：不归取最新管了，更不能把它装回来
    const roots: GetWorkRoot[] = [];
    for (const root of allRoots) {
      if (root.source === 'registry' && !scene.rootInScene(root.refno, root.dbnum)) ports.forgetRoot(root.refno);
      else roots.push(root);
    }
    models.rootsTotal = roots.length;

    // 不在后端更新范围里、库一级的模型落后于库文件的库：后台不会去追它，新旧按页面上装着的节点说。
    // 节点装上的时候就可能已经落后，所以这种库的节点哪怕库的水位和装的时候一样也核对
    const gapLibraries = new Map<number, boolean>();
    const inGapLibrary = (dbnum: number): boolean => {
      let gap = gapLibraries.get(dbnum);
      if (gap === undefined) {
        gap = describeLibraryGap(dbnum, rows.get(dbnum))?.kind === 'out_of_scope';
        gapLibraries.set(dbnum, gap);
      }
      return gap;
    };
    type Standing = 'latest' | 'lagging' | 'unsure';
    /** 这种库里页面上装着的节点这一轮各是什么样（这一轮撤下的不在里面） */
    const standing = new Map<string, { dbnum: number; state: Standing }>();
    for (const root of roots) {
      if (!root.withdrawnEmpty && inGapLibrary(root.dbnum)) standing.set(root.refno, { dbnum: root.dbnum, state: 'unsure' });
    }
    const stand = (root: { refno: string; dbnum: number }, state: Standing): void => {
      if (inGapLibrary(root.dbnum)) standing.set(root.refno, { dbnum: root.dbnum, state });
    };
    /**
     * 这个节点这一轮算什么。`onScreen`：屏幕上装的就是后端现在的那一版（这一轮刚换上的，或 `screenHoldsBackendModel` 核对出来的）。
     * 那样、后端的节点模型状态接口又明说最新，才算最新
     */
    const standingOf = (status: NodeModelStatus, onScreen: boolean): Standing => {
      if (status.verdict === 'lagging') return 'lagging';
      return onScreen && status.source === 'model-status' && (status.verdict === 'latest' || status.verdict === 'reloadable') ? 'latest' : 'unsure';
    };

    const candidates = roots.filter((root) => {
      const row = rows.get(root.dbnum);
      const gap = inGapLibrary(root.dbnum);
      if (!gap && !rootNeedsCheck(root, row, restarted)) return false;
      // 上一轮核对过、不用动，库也没再变：不再问（后端重启过、或它带着过期标记时照问）
      const settled = settledAt.get(root.refno);
      if (row && !restarted && !root.staleReason && settled?.key === settleKey(row, root.loadedModelSesno, root.loadedFileLatestSesno)) {
        // 后台不会去追的库里，上一轮没敢说它最新的（装上时那一版还没记下、状态是过渡办法给的）照问：有把握了才改口
        if (gap && !settled.confirmedLatest) return true;
        if (gap) stand(root, 'latest');
        return false;
      }
      return true;
    });
    models.checked = candidates.length;
    if (candidates.length > 0) ports.onProgress(`核对 ${candidates.length} 个已装的节点…`);
    const answers = await mapLimit(candidates, GETWORK_STATUS_CONCURRENCY, (root) => ports.nodeStatus(root, rows.get(root.dbnum) ?? null));

    // 场景里多了 / 少了哪些构件（按构件记，不重复计）；说不出是哪些构件的（节点装了什么没记下）只记个数
    const addedAll = new Set<string>();
    const removedAll = new Set<string>();
    let removedUnnamed = 0;
    /**
     * 这一轮动过场景的节点，按处理的先后：它这一步从场景拿掉了哪些构件、做完之后它名下是哪些构件（撤下的为 `null`）。
     * 场景里的对象是按构件共用的，不是按节点各有一份——后处理的节点拿掉的构件，可能正是先处理的节点刚装上的。
     */
    const steps: { root: GetWorkRoot; removed: ReadonlySet<string>; after: Set<string> | null; reloadedIndex: number | null }[] = [];
    const settleCounts = () => {
      // 一个构件被某个节点拿掉、却还在另一个节点名下（挪了位置）：它还在场景里，不算少了
      const present = new Set<string>();
      for (const step of steps) for (const refno of step.after ?? []) present.add(refno);
      models.componentsAdded = [...addedAll].filter((refno) => !removedAll.has(refno)).length;
      models.componentsRemoved = [...removedAll].filter((refno) => !addedAll.has(refno) && !present.has(refno)).length + removedUnnamed;
    };

    const reloadOne = async (refno: string, dbnum: number): Promise<{ ok: boolean; before: Set<string>; after: string[] | null }> => {
      const before = new Set(scene.loadedRefnos(refno, dbnum) ?? []);
      const ok = await scene.reload(refno);
      return { ok, before, after: scene.loadedRefnos(refno, dbnum) };
    };

    let acted = 0;
    const toAct = candidates.filter((root, index) => {
      const kind = decideRootAction(root, answers[index]!, { restarted }).kind;
      return kind === 'reload' || kind === 'withdraw';
    }).length;
    for (let index = 0; index < candidates.length; index++) {
      const root = candidates[index]!;
      const row = rows.get(root.dbnum) ?? null;
      const action = decideRootAction(root, answers[index]!, { restarted });
      const status = answers[index]!.status;
      if (action.kind === 'none') {
        // 核对过、不用动：下一轮库没再变就不问它了——登记表里的把水位推进到现在，已加载节点表里的记在这边
        const state = standingOf(status, screenHoldsBackendModel(root, status));
        if (root.withdrawnEmpty && status.verdict === 'empty') standing.delete(root.refno);
        else stand(root, state);
        if (root.source === 'registry' && row) {
          const at = { modelSesno: sesnoOf(row.model_sesno), fileLatestSesno: sesnoOf(row.file_latest_sesno) };
          ports.advanceRoot(root.refno, at);
          // 后台不会去追的库不看水位、每轮都问：登记表里的也在这边记一笔（按推进之后的水位），库没再变就不再问
          if (inGapLibrary(root.dbnum)) {
            settledAt.set(root.refno, { key: settleKey(row, at.modelSesno, at.fileLatestSesno), confirmedLatest: state === 'latest' });
          }
        } else if (row) {
          settledAt.set(root.refno, { key: settleKey(row, root.loadedModelSesno, root.loadedFileLatestSesno), confirmedLatest: state === 'latest' });
        }
        continue;
      }
      settledAt.delete(root.refno);
      if (action.kind === 'keep') {
        models.kept.push({ refno: root.refno, reason: action.reason });
        stand(root, standingOf(status, false));
        continue;
      }
      // 要动场景了：这期间有人点了眼睛在装别的，先等它完
      if (!(await waitLoadIdle())) {
        models.failed.push({ refno: root.refno, reason: '有别的装载一直没结束，这个节点这次没换' });
        continue;
      }
      acted += 1;
      if (action.kind === 'withdraw') {
        ports.onProgress(`撤下已删除的节点 ${acted}/${toAct}…`);
        const members = scene.loadedRefnos(root.refno, root.dbnum) ?? [];
        const refnos = scene.withdraw(root.refno, root.dbnum);
        if (members.length > 0) for (const member of members) removedAll.add(member);
        else removedUnnamed += refnos;
        steps.push({ root, removed: new Set(members), after: null, reloadedIndex: null });
        ports.forgetRoot(root.refno);
        models.withdrawn.push({ refno: root.refno, refnos, why: 'deleted' });
        standing.delete(root.refno);
        continue;
      }
      ports.onProgress(`重载模型 ${acted}/${toAct}…`);
      let outcome: Awaited<ReturnType<typeof reloadOne>>;
      try {
        outcome = await reloadOne(root.refno, root.dbnum);
      } catch (error) {
        models.failed.push({ refno: root.refno, reason: `重载出错：${errorText(error)}` });
        continue;
      }
      if (!outcome.ok) {
        models.failed.push({ refno: root.refno, reason: '重载没有完成，场景保持原样（记录没查通，或后端现在没有它的模型）' });
        continue;
      }
      // 重载做成了：登记表里的从此由已加载节点表接管（显示流程重新登记了它）
      if (root.source === 'registry') ports.forgetRoot(root.refno);
      const after = outcome.after;
      if (!after || after.length === 0) {
        for (const refno of outcome.before) removedAll.add(refno);
        steps.push({ root, removed: outcome.before, after: null, reloadedIndex: null });
        if (!root.withdrawnEmpty || outcome.before.size > 0) {
          models.withdrawn.push({ refno: root.refno, refnos: outcome.before.size, why: 'empty' });
        }
        standing.delete(root.refno);
        continue;
      }
      const afterSet = new Set(after);
      const added = after.filter((refno) => !outcome.before.has(refno));
      const removed = [...outcome.before].filter((refno) => !afterSet.has(refno));
      for (const refno of added) addedAll.add(refno);
      for (const refno of removed) removedAll.add(refno);
      steps.push({ root, removed: new Set(removed), after: afterSet, reloadedIndex: models.reloaded.length });
      models.reloaded.push({ refno: root.refno, added: added.length, removed: removed.length, total: after.length });
      if (action.note) models.kept.push({ refno: root.refno, reason: action.note });
      stand(root, standingOf(status, true));
    }

    // 构件在两个在册节点之间挪了位置（或嵌套的两个节点里，它只是挪出了里面那个）：先重载的节点把它装上了，后处理的
    // 节点按「我名下已经没有它」又把它从场景拿掉。名下的构件被后来者拿掉了的节点，补重载一次把它装回来。
    const repairs = steps.filter((step, index) => {
      const mine = step.after;
      if (!mine) return false;
      return steps.slice(index + 1).some((later) => [...later.removed].some((refno) => mine.has(refno)));
    });
    for (let index = 0; index < repairs.length; index++) {
      const { root, reloadedIndex } = repairs[index]!;
      if (!(await waitLoadIdle())) {
        models.failed.push({ refno: root.refno, reason: '有别的装载一直没结束，它名下被别的节点撤掉的构件这次没补装' });
        continue;
      }
      ports.onProgress(`补装挪了位置的构件 ${index + 1}/${repairs.length}…`);
      let ok = false;
      try {
        ok = await scene.reload(root.refno);
      } catch (error) {
        models.failed.push({ refno: root.refno, reason: `补装出错：${errorText(error)}` });
        continue;
      }
      if (!ok) {
        models.failed.push({ refno: root.refno, reason: '它名下有构件被别的节点的重载撤掉了，补装没有完成' });
        continue;
      }
      const entry = reloadedIndex !== null ? models.reloaded[reloadedIndex] : undefined;
      const now = scene.loadedRefnos(root.refno, root.dbnum);
      if (entry && now) entry.total = now.length;
    }

    // 整库显示过的库：新出现的顶层 SITE 装进来
    for (const scope of ports.dbnumScopes()) {
      if (!scope.discover) continue;
      const row = rows.get(scope.dbnum) ?? null;
      const fileLatest = sesnoOf(row?.file_latest_sesno);
      // 库文件没有新会话：不会有新的 SITE（找过一次之后才敢跳过）
      if (scope.checkedFileLatestSesno !== null && fileLatest === scope.checkedFileLatestSesno) continue;
      let sites: { refno: string; name: string }[];
      try {
        sites = await ports.listSites(scope.dbnum);
      } catch (error) {
        models.failed.push({ refno: `dbnum ${scope.dbnum}`, reason: `没查到这个库的 SITE 名单：${errorText(error)}` });
        continue;
      }
      let allSettled = true;
      for (const site of sites) {
        if (scope.knownSites.has(site.refno)) continue;
        const probe: GetWorkRoot = {
          refno: site.refno, dbnum: scope.dbnum, loadedModelSesno: null, loadedFileLatestSesno: null, staleReason: null, source: 'registry',
        };
        const answer = await ports.nodeStatus(probe, row);
        if (answer.gone) continue;
        // 名下没有生成单元的 SITE：没有可装的。不记成已在管——以后它有了东西还要再看
        if (answer.status.verdict === 'empty') continue;
        if (!newSiteHasModel(answer.status)) {
          allSettled = false;
          models.kept.push({ refno: site.refno, reason: `新出现的 SITE ${site.name}：后端还没有它的模型，没有装入；稍后再点「取最新」` });
          continue;
        }
        if (!(await waitLoadIdle())) {
          allSettled = false;
          models.failed.push({ refno: site.refno, reason: '有别的装载一直没结束，新出现的 SITE 这次没装' });
          continue;
        }
        ports.onProgress(`装入新出现的 SITE ${site.name}…`);
        let outcome: Awaited<ReturnType<typeof reloadOne>>;
        try {
          outcome = await reloadOne(site.refno, scope.dbnum);
        } catch (error) {
          allSettled = false;
          models.failed.push({ refno: site.refno, reason: `装入出错：${errorText(error)}` });
          continue;
        }
        if (!outcome.ok) {
          allSettled = false;
          models.failed.push({ refno: site.refno, reason: `新出现的 SITE ${site.name} 没装成` });
          continue;
        }
        ports.noteSiteKnown(scope.dbnum, site.refno);
        if (outcome.after && outcome.after.length > 0) {
          for (const refno of outcome.after) addedAll.add(refno);
          models.loadedNew.push({ refno: site.refno, name: site.name, total: outcome.after.length });
          stand({ refno: site.refno, dbnum: scope.dbnum }, standingOf(answer.status, true));
        }
      }
      // 都处理完了才记「找过了」；有没装成的，下一轮（哪怕库文件没再变）还要再找
      if (allSettled) ports.noteScopeChecked(scope.dbnum, fileLatest);
    }
    settleCounts();

    // 后台不会去追的库：页面上装着的节点有几个、几个核对过是最新、几个落后（给库一级那句话用）
    const notSwapped = new Set(models.failed.map((item) => item.refno));
    const libraryNodes = new Map<number, GetWorkLibraryNodes>();
    for (const [refno, { dbnum, state }] of standing) {
      const nodes = libraryNodes.get(dbnum) ?? { total: 0, latest: 0, lagging: 0 };
      nodes.total += 1;
      // 没换成、没补装成的：屏幕上的不是后端现有的那一版，不算最新
      if (state === 'latest' && !notSwapped.has(refno)) nodes.latest += 1;
      else if (state === 'lagging') nodes.lagging += 1;
      libraryNodes.set(dbnum, nodes);
    }
    return libraryNodes;
  }

  async function runRound(): Promise<GetWorkReport> {
    const report = emptyReport(ports.now());
    const fail = (error: string): GetWorkReport => {
      report.ok = false;
      report.error = error;
      return finish();
    };
    const finish = (): GetWorkReport => {
      report.finishedAt = ports.now();
      const tree = ports.tree();
      // 这一轮从树上消失的节点树上已经查不到名字了：用回执里记下的
      const goneNames = new Map((report.tree?.removed ?? []).map((item) => [item.id, item.name]));
      Object.assign(report, summarizeGetWork(report, (refno) => {
        const name = tree?.nameOf(refno) ?? goneNames.get(refno);
        return name ? `${name}（${refno}）` : refno;
      }));
      ports.onProgress('');
      return report;
    };

    try {
      // ① 正在装载或生成：不打断，等它完了再对账
      if (!(await waitLoadIdle())) return fail('有装载 / 生成一直没结束，这次没有取最新；等它结束再点');

      // ② 后台现在是什么状态
      ports.onProgress('核对后台状态…');
      let generation: number;
      try {
        generation = (await ports.probeService()).generation;
      } catch (error) {
        return fail(`后台连不上（${errorText(error)}），页面没有动`);
      }
      report.backendRestarted = lastGeneration !== null && generation !== lastGeneration;
      let rows: Map<number, DbnumRow>;
      try {
        rows = await ports.fetchDbnumRows();
      } catch (error) {
        return fail(`库状态没取到（${errorText(error)}），页面没有动`);
      }

      // ③ 这个页面碰过的库：树上展开过的、装过模型的
      const tree = ports.tree();
      const scene = ports.scene();
      const touched = new Set<number>();
      for (const dbnum of tree?.touchedDbnums() ?? []) touched.add(dbnum);
      for (const root of ports.roots()) touched.add(root.dbnum);
      for (const scope of ports.dbnumScopes()) touched.add(scope.dbnum);

      // ④ 后端更新范围内的库后台还在追：有上限地等它做完，再一起换
      const pendingOf = (current: Map<number, DbnumRow>): number[] => (
        [...touched].filter((dbnum) => libraryWaitsForBackend(current.get(dbnum))).sort((a, b) => a - b)
      );
      let pending = pendingOf(rows);
      if (pending.length > 0) {
        const waiting = [...pending];
        const waitStartedAt = ports.now();
        while (pending.length > 0 && ports.now() - waitStartedAt < GETWORK_BACKEND_WAIT_MAX_MS) {
          const seconds = Math.round((ports.now() - waitStartedAt) / 1000);
          ports.onProgress(`等后台把库 ${pending.join('、')} 更新完…（已等 ${seconds} 秒，最多 ${GETWORK_BACKEND_WAIT_MAX_MS / 1000} 秒）`);
          await ports.sleep(GETWORK_BACKEND_WAIT_POLL_MS);
          try {
            rows = await ports.fetchDbnumRows();
          } catch {
            // 这一拍没取到：接着等，用上一拍的
          }
          pending = pendingOf(rows);
        }
        report.waited = { dbnums: waiting, ms: ports.now() - waitStartedAt, timedOut: pending };
      }

      // ⑤ 先刷新树
      if (tree) {
        ports.onProgress('刷新模型树…');
        try {
          report.tree = await tree.refresh();
        } catch (error) {
          report.treeError = errorText(error);
        }
      }

      // ⑥ 再重载模型（先通知需要对比前后场景状态的派生物拍下快照）
      const derivedList = ports.derived();
      for (const handler of derivedList) {
        try {
          await handler.beforeModels?.();
        } catch {
          // 拍快照失败不阻断模型重载
        }
      }
      let libraryNodes = new Map<number, GetWorkLibraryNodes>();
      if (scene) libraryNodes = await refreshModels(report, scene, rows);
      else report.models.rootsTotal = ports.roots().length;

      // ⑦ 跟着模型走的东西
      const models = report.models;
      const modelsChanged = models.reloaded.length + models.loadedNew.length + models.withdrawn.length > 0;
      const treeChanged = report.tree?.changed === true;
      const watermarks = new Map<number, string>();
      for (const dbnum of touched) {
        const row = rows.get(dbnum);
        watermarks.set(dbnum, `${row?.model_sesno ?? ''}:${row?.file_latest_sesno ?? ''}`);
      }
      const librariesMoved = [...watermarks].some(([dbnum, key]) => lastWatermarks.has(dbnum) && lastWatermarks.get(dbnum) !== key);
      lastWatermarks = watermarks;
      lastGeneration = generation;

      const selected = ports.selection.current();
      if (selected && !ports.selection.isDeleted()) {
        let gone: boolean | null = null;
        const top = report.tree?.removedUnder[selected];
        if (top) {
          const fate = report.tree?.removed.find((item) => item.id === top)?.fate;
          gone = fate === 'deleted' ? true : fate === 'relocated' ? false : null;
        }
        if (gone === null && models.withdrawn.some((item) => item.refno === selected && item.why === 'deleted')) gone = true;
        if (gone === null) {
          try {
            gone = await ports.probeNodeGone(selected);
          } catch {
            gone = null;
          }
        }
        if (gone === true) {
          ports.selection.markDeleted(selected);
          report.selectionDeleted = selected;
        }
      }

      const context: GetWorkDerivedContext = {
        changed: treeChanged || modelsChanged || librariesMoved,
        treeChanged,
        modelsChanged,
      };
      for (const handler of derivedList) {
        try {
          await handler.run(context);
          report.derived.push({ name: handler.name, ok: true });
        } catch {
          report.derived.push({ name: handler.name, ok: false });
        }
      }

      // ⑧ 哪些库没能跟到最新
      for (const dbnum of [...touched].sort((a, b) => a - b)) {
        const note = describeLibraryGap(dbnum, rows.get(dbnum));
        if (!note) continue;
        if (note.kind === 'out_of_scope') {
          // 后台不会去追它：落没落后按页面上装着的节点说
          const said = describeOutOfScopeLibrary(note, rows.get(dbnum), libraryNodes.get(dbnum));
          if (said.note) report.libraries.push(said.note);
          if (said.fact) report.libraryFacts.push(said.fact);
          continue;
        }
        const timedOut = report.waited?.timedOut.includes(dbnum) === true;
        report.libraries.push(timedOut ? { ...note, text: `${note.text}，等了 ${Math.round((report.waited?.ms ?? 0) / 1000)} 秒还没做完，这次先换了能换的` } : note);
      }
      return finish();
    } catch (error) {
      return fail(`取最新出错：${errorText(error)}`);
    }
  }

  function getLatest(): Promise<GetWorkReport> {
    if (!current) {
      const round = runRound().finally(() => {
        if (current === round) current = null;
      });
      current = round;
      return round;
    }
    // 两轮不并发：运行中再点，等这一轮完了再跑一轮；期间点多少下都合并成那一轮
    if (!followUp) {
      const next: Promise<GetWorkReport> = current.then(() => {
        if (followUp === next) followUp = null;
        return getLatest();
      });
      followUp = next;
    }
    return followUp;
  }

  return { getLatest, isRunning: () => current !== null };
}

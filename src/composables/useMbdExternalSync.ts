import type {
  MbdDiagnosticsSourceSnapshot,
  MbdDiagnosticsStore,
} from './useMbdDiagnosticsStore';
import type {
  DimensionSystem,
  ExternalDimensionRecord,
  MbdV2Issue,
  MbdV2ParseResult,
  MbdV2PipeData,
} from '@/dimension';
import type { ToastPayload } from '@/ribbon/toastBus';

import { mbdV2ToExternalRecords } from '@/dimension';
import { parseMbdRefnos } from '@/utils/mbdRefnoParam';

export type MbdExternalSyncTarget = Pick<
  DimensionSystem,
  'replaceExternalSource'
>;

export type MbdExternalSyncDeps = Readonly<{
  /** 实时通道：按 refno 拉取契约数据（HTTP 层错误以 ok:false 或 reject 表达）。 */
  /**
   * 按 refno 拉取契约数据。`partial` 会传到契约解析层：只放宽「不认识的图元 kind」
   * 一件事（其余非法一律整包失败），由 `?mbd_partial=1` 驱动。名字沿用管道时代：
   * ViewerPanel 注入的是按对象取数的 `fetchMbdV2ObjectData`（#103 M7），任意可标注对象都走它。
   */
  fetchPipeData(
    refno: string,
    options?: Readonly<{ partial?: boolean; signal?: AbortSignal }>,
  ): Promise<MbdV2ParseResult>;
  /**
   * 可选的批量对象取数通道（`POST /api/mbd/v2/objects`，不支持时自动回退逐包 `GET`）。
   * 未注入（如旧单测替身）时，同步层自动走 `fetchPipeData` 并发池。
   */
  fetchObjectsData?(
    refnos: readonly string[],
    options?: Readonly<{ partial?: boolean; signal?: AbortSignal }>,
  ): Promise<Readonly<{ results: readonly MbdV2ParseResult[]; fallbackNote?: string }>>;
  diagnostics: MbdDiagnosticsStore;
  /** 通常为 () => window.location.search。 */
  getSearch(): string;
  emitToast(payload: ToastPayload): void;
}>;

export type MbdLatestRefreshInput = Readonly<{
  /** 本轮「取最新」受影响的对象 refno（`a_b` 或 `a/b` 均自动归一）。 */
  affectedRefnos?: ReadonlySet<string> | readonly string[];
  /** 本轮「取最新」发生变动的数据库号集合。 */
  affectedDbnums?: ReadonlySet<number> | readonly number[];
  /** 当前后台各库文件的最新会话号（`dbnum -> file_latest_sesno`），用于首轮即识别标注所读库是否前进。 */
  fileLatestSessionsByDbnum?: ReadonlyMap<number, number> | Readonly<Record<number, number>>;
  /** 当前三维模型各库所在的模型会话号（`dbnum -> modelSesno`），供面板对比标注会话与模型会话。 */
  modelSessionsByDbnum?: ReadonlyMap<number, number> | Readonly<Record<number, number>>;
}>;

export type MbdExternalSyncOptions = Readonly<{
  /** 宿主级过期判定（例如尺寸系统已被替换或组件已卸载）。 */
  isCancelled?: () => boolean;
  /** 「取最新」增量刷新上下文（#142）；常规地址栏同步时省略。 */
  latestRefresh?: MbdLatestRefreshInput;
}>;

export type MbdExternalSync = Readonly<{
  /**
   * 按 URL 参数把 MBD 图元同步进目标系统：`mbd_refno` → 实时 API；
   * 无 `mbd_refno` → 清空来源（离线 parquet 通道已随 legacy 数据源退役）。
   *
   * 多 BRAN（2026-11-02）：`mbd_refno=A,B` 逐包取数（并发上限
   * {@link MBD_FETCH_CONCURRENCY}，后端没有批量接口），所有成功包的记录合并后
   * 一次性 `replaceExternalSource`——它是整槽覆盖，逐包提交会互相顶掉。
   * 某一包取数或映射失败只剔除那一包（逐包拒绝），其余包照常显示、失败原因进
   * 逐源诊断；每个失败 refno 的同一句原因只弹一次错误提示，成功后复位。
   */
  sync(
    target: MbdExternalSyncTarget,
    options?: MbdExternalSyncOptions,
  ): Promise<void>;
  /** 使所有在途 sync 的结果失效（组件卸载时调用）。 */
  invalidate(): void;
}>;

/**
 * 多 BRAN 同屏取数的并发上限：后端没有批量接口只能逐包拉，全串行会让
 * `mbd_refno=A,B,C,…` 的首屏等所有包依次回来；4 是「不淹掉连接、也不让用户
 * 干等」的折中。导出常量便于测试断言上限生效。
 */
export const MBD_FETCH_CONCURRENCY = 4;

/**
 * 一次打开大量对象的标注时，首屏缺省先装前 32 个对象，其余按需加载（#136）。
 * 按对象个数算（不分 BRAN / 设备 / 支架 / 楼板 / 墙板），地址参数 `?mbd_limit=<正整数|all>` 可覆盖。
 */
export const MBD_INITIAL_OBJECT_LIMIT = 32;
/** 兼容管道时代的旧常量名别名。 */
export const MBD_INITIAL_BRAN_LIMIT = MBD_INITIAL_OBJECT_LIMIT;

export function parseMbdObjectLimit(raw: string | null): number {
  const value = raw?.trim().toLowerCase();
  if (value === 'all') return Number.POSITIVE_INFINITY;
  const parsed = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MBD_INITIAL_OBJECT_LIMIT;
}

/**
 * 包级原子拒绝（ADR 0046，2026-11-02 改为逐包生效）：单包内映射未全量成功时
 * 该包不提交任何部分记录。错误对象携带该包的诊断明细，在包级 catch 里转成
 * 这一包的逐源诊断——不再抛到 sync 顶层掀翻其它包。
 */
class MbdAtomicRejectionError extends Error {
  constructor(
    message: string,
    readonly issues: readonly MbdV2Issue[],
    readonly skipped: readonly Readonly<{ id: string; reason: string }>[],
  ) {
    super(message);
    this.name = 'MbdAtomicRejectionError';
  }
}

/**
 * 单包取数 + 映射的结果：诊断字段与 {@link MbdDiagnosticsSourceSnapshot}
 * 同形（`refno` 起逐源归因），外加本包要提交的记录。`loadError` 非空即
 * 该包失败，其 `records` 恒为空。
 */
type MbdSourceLoadOutcome = MbdDiagnosticsSourceSnapshot & Readonly<{
  records: readonly ExternalDimensionRecord[];
  /**
   * 规范化后的归属对象键（`subject.refno ?? branch_refno ?? refno`），用于多输入子构件去重。
   */
  subjectKey?: string;
  /**
   * 空包：取数、契约、映射都过了，负载里一个图元都没有（真实库里 7059 个归属对象有 261 个）。
   * 按负载判，不按提交的记录数——`mbd_kinds` 把记录滤光不算空包。这里必给；随逐包快照写进诊断（票 134）。
   */
  empty: boolean;
}>;

/**
 * 调试过滤 `?mbd_kinds=linear_dim[,slope_mark,…]`：只把这些 kind 的图元送进画家
 * （例如只看长度尺寸）。缺省 / 空值 = 不过滤。它作用在契约校验与原子拒绝之后，
 * 所以既不掩盖负载问题，也不改变求解器输出本身；过滤事实写进诊断 notes。
 * 已配对进标签记录的 `leader_line`（见 mapper `pairLeaders`）随 `label` 一起过滤；
 * `leader_line` 单独勾选只剩没有标签可配的引线。
 */
function parseMbdKindFilter(raw: string | null): ReadonlySet<string> | null {
  const kinds = (raw ?? '')
    .split(',')
    .map(kind => kind.trim().toLowerCase())
    .filter(kind => kind.length > 0);
  return kinds.length > 0 ? new Set(kinds) : null;
}

/**
 * 调试开关 `?mbd_lod=0`：关掉分级显示（S3）。mapper 给 `linear_dim` 打的 `lod` 提示在这里
 * 被剥掉，内核就对每条尺寸照常出图；缺省 / 其它值 = 保留提示。
 */
function isMbdLodDisabled(raw: string | null): boolean {
  return raw?.trim() === '0';
}

function withoutLod(record: ExternalDimensionRecord): ExternalDimensionRecord {
  const layout = record.layout;
  // `lod` only exists on explicit layouts, so the `in` check narrows the union.
  if (!('lod' in layout)) return record;
  const { lod: _lod, ...rest } = layout;
  return { ...record, layout: rest };
}

/**
 * 调试开关 `?mbd_3d=0`：关掉三维标注呈现（长度尺寸：尺寸线沿 dim_dir 外移、数字在线上方、
 * 实心箭头；标签：卡片 / 方框 / 药丸式 billboard 带引线；2026-09-12 参考图风格）。mapper 打的
 * `dimension3d`、`tag` 与 `label3d`（带文字平面的角度字在三维里仍沿弧写，CT-15）在这里被剥掉，
 * 内核回到求解器原位几何的平面呈现；缺省 / 其它值 = 保留。
 */
function isMbd3dDisabled(raw: string | null): boolean {
  return raw?.trim() === '0';
}

/**
 * 调试开关 `?mbd_label=above`（W5-4 / Q6）：长度尺寸的数字浮到尺寸线上方、线不切段
 * （ISO 读法）。缺省 / 其它值 = `interrupted`（工程惯例：文字压线、线在标签处断开）。
 *
 * **默认必须是 interrupted**：`above` 要的行距 ≥ 2.96 字高，而求解器的行距是
 * `1.2 · cheight`，堆叠尺寸组会互相侵入（见计划 §11.2）。它是 A/B 与后续排布
 * 改造的试验开关。
 */
function parseLabelPresentation(raw: string | null): 'interrupted' | 'above' {
  return raw?.trim().toLowerCase() === 'above' ? 'above' : 'interrupted';
}

/**
 * 调试开关 `?mbd_partial=1`：允许部分显示。缺省（关）维持 ADR 0046 的逐包原子
 * 拒绝——一包里有一个图元映射不过，那一包就不提交（2026-11-02 起不再掀翻
 * 其它包）；打开后跳过的那几条只进诊断，其余照常渲染，面板常驻「N 条被跳过」
 * 的横幅（`DimensionPanelDock`），避免使用者误以为图是完整的。
 */
function isMbdPartialEnabled(raw: string | null): boolean {
  return raw?.trim() === '1';
}

function withoutPresentation3d(record: ExternalDimensionRecord): ExternalDimensionRecord {
  const layout = record.layout;
  // Only explicit layouts carry the presentation hints.
  if (!('lines' in layout)) return record;
  const has3dDeclutter = layout.declutter?.movable !== undefined
    || layout.declutter?.parentId !== undefined;
  if (
    layout.dimension3d === undefined
    && layout.tag === undefined
    && layout.label3d === undefined
    && !has3dDeclutter
  ) {
    return record;
  }
  const { dimension3d: _dimension3d, tag: _tag, label3d: _label3d, declutter, ...rest } = layout;
  const flatDeclutter = declutter && declutter.parentId === undefined
    ? {
      rank: declutter.rank,
      ...(declutter.group !== undefined ? { group: declutter.group } : {}),
    }
    : undefined;
  return {
    ...record,
    layout: {
      ...rest,
      ...(flatDeclutter !== undefined ? { declutter: flatDeclutter } : {}),
    },
  };
}

/**
 * 已退役的调试参数 `?mbd_polar=1`：管道极坐标摆位已全部收敛到求解器（plant-mbd ADR-0016），
 * 前端不再二次放置；此处只保留参数识别以便在诊断 notes 里提示退役事实。
 */
function isMbdPolarEnabled(raw: string | null): boolean {
  return raw?.trim() === '1';
}

/**
 * 多对象同屏时，跨记录的去重分组键（`declutter.group` / `declutter.parentId`）也要加前缀，
 * 避免不同对象里同号组名互相碰撞。
 */
function qualifyGroups(
  layout: ExternalDimensionRecord['layout'],
  qualify: (key: string) => string,
): ExternalDimensionRecord['layout'] {
  if (!('lines' in layout)) return layout;
  return {
    ...layout,
    ...(layout.declutter !== undefined
      && (layout.declutter.group !== undefined || layout.declutter.parentId !== undefined)
      ? {
        declutter: {
          ...layout.declutter,
          ...(layout.declutter.group !== undefined ? { group: qualify(layout.declutter.group) } : {}),
          ...(layout.declutter.parentId !== undefined ? { parentId: qualify(layout.declutter.parentId) } : {}),
        },
      }
      : {}),
  };
}

/**
 * MBD 外部图元双通道同步（从 ViewerPanel 抽出以获得可测缝）：
 * 通道选择、竞态守卫、诊断写入、error toast 集中在此。
 */
export function createMbdExternalSync(
  deps: MbdExternalSyncDeps,
): MbdExternalSync {
  let syncVersion = 0;
  let activeAbortController: AbortController | null = null;

  const isAbortError = (error: unknown): boolean =>
    error instanceof Error && error.name === 'AbortError';
  /**
   * 失败提示按 refno 去重：同一 refno 的同一句原因只弹一次。取数失败往往是持续性
   * 的（后端 422 / 网关 502），每次 popstate 都弹会在用户眼前刷屏；换源或
   * 成功一次之后复位，下一次真失败仍要看得见。多 BRAN 时按 refno 各记各的，
   * 否则不同包轮流顶掉单条记忆，要么漏报要么重复刷屏。
   */
  const failureToasts = new Map<string, string>();

  const containsRefnoToken = (text: string, target: string): boolean => {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9_/])${escaped}(?:$|[^A-Za-z0-9_/])`).test(text);
  };

  const toastFailure = (refno: string, message: string): void => {
    if (failureToasts.get(refno) === message) {
      return;
    }
    failureToasts.set(refno, message);
    const slashRefno = refno.replace(/_/g, '/');
    const hasRefno = !refno
      || containsRefnoToken(message, refno)
      || (slashRefno !== refno && containsRefnoToken(message, slashRefno));
    const body = hasRefno ? message : `${refno} — ${message}`;
    deps.emitToast({ message: `MBD 标注装载失败：${body}`, level: 'error' });
  };
  /** 上一次弹过的空包提示；同一句不重复弹，空包消失后复位。 */
  let lastEmptyToast: string | null = null;
  /** 已成功装载的对象快照缓存，供「取最新」按受影响对象增量重取与识别已删除对象（#142）。 */
  const cachedOutcomes = new Map<string, Readonly<{
    optionsSignature: string;
    outcome: MbdSourceLoadOutcome;
  }>>();

  const normalizeRefnoToken = (raw: string): string =>
    raw.trim().replace(/^=+/, '').replace(/\//g, '_');

  const toNormalizedRefnoSet = (
    input: ReadonlySet<string> | readonly string[] | undefined,
  ): ReadonlySet<string> | null => {
    if (!input) return null;
    const out = new Set<string>();
    for (const item of input) {
      const norm = normalizeRefnoToken(item);
      if (norm) out.add(norm);
    }
    return out;
  };

  const toDbnumSet = (
    input: ReadonlySet<number> | readonly number[] | undefined,
  ): ReadonlySet<number> | null => {
    if (!input) return null;
    const out = new Set<number>();
    for (const item of input) {
      if (Number.isFinite(item)) out.add(item);
    }
    return out;
  };

  const normalizeModelSessions = (
    input: ReadonlyMap<number, number> | Readonly<Record<number, number>> | undefined,
  ): Readonly<Record<number, number>> | undefined => {
    if (!input) return undefined;
    const out: Record<number, number> = {};
    if (input instanceof Map) {
      for (const [k, v] of input.entries()) {
        if (Number.isFinite(k) && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    for (const [k, v] of Object.entries(input as Record<string, number>)) {
      const dbnum = Number(k);
      if (Number.isFinite(dbnum) && Number.isFinite(v)) out[dbnum] = v;
    }
    return out;
  };

  const isSourceAffectedByRefresh = (
    refno: string,
    cached: MbdSourceLoadOutcome,
    affectedRefnos: ReadonlySet<string> | null,
    affectedDbnums: ReadonlySet<number> | null,
    fileLatestSessions: Readonly<Record<number, number>> | undefined,
  ): boolean => {
    // 筛选条件都没指定时（例如后端重启兜底）：全部重取。
    if (affectedRefnos === null && affectedDbnums === null && fileLatestSessions === undefined) {
      return true;
    }
    if (affectedRefnos?.has(refno)) return true;
    const subjectRefno = cached.subject?.refno ? normalizeRefnoToken(cached.subject.refno) : null;
    if (subjectRefno && affectedRefnos?.has(subjectRefno)) return true;
    const sv = cached.sourceVersion;
    if (affectedDbnums && sv) {
      if (affectedDbnums.has(sv.dbnum)) return true;
      if (sv.databases.some(db => affectedDbnums.has(db.dbnum))) return true;
    }
    if (fileLatestSessions) {
      // 老标注包没声明 sourceVersion 时保守重取，否则比对主库及读取过的目录/关联库会话是否变化
      if (!sv) return true;
      const rootLatest = fileLatestSessions[sv.dbnum];
      if (rootLatest !== undefined && rootLatest !== sv.sesno) return true;
      if (sv.databases.some(db => {
        const latest = fileLatestSessions[db.dbnum];
        return latest !== undefined && latest !== db.sesno;
      })) {
        return true;
      }
    }
    return false;
  };

  const isNotFoundParseFailure = (
    parsed: Extract<MbdV2ParseResult, { ok: false }>,
  ): boolean =>
    parsed.notFound === true
    || /在所钉会话里不存在|库里没有|不存在该对象|对象已删除/.test(parsed.error);

  return {
    async sync(target, options = {}) {
      const version = ++syncVersion;
      activeAbortController?.abort();
      const abortController = new AbortController();
      activeAbortController = abortController;
      const cancelled = (): boolean =>
        version !== syncVersion
        || abortController.signal.aborted
        || (options.isCancelled?.() ?? false);

      const search = deps.getSearch();
      const params = new URLSearchParams(search);
      const requestedRefnos = parseMbdRefnos(search);

      if (requestedRefnos.length === 0) {
        if (cancelled()) return;
        target.replaceExternalSource('mbd', []);
        deps.diagnostics.clear();
        failureToasts.clear();
        cachedOutcomes.clear();
        lastEmptyToast = null;
        return;
      }
      const activeSet = new Set(requestedRefnos);
      for (const key of cachedOutcomes.keys()) {
        if (!activeSet.has(key)) cachedOutcomes.delete(key);
      }

      const objectLimit = parseMbdObjectLimit(params.get('mbd_limit'));
      const refnos = Number.isFinite(objectLimit)
        ? requestedRefnos.slice(0, objectLimit)
        : requestedRefnos;
      const deferredRefnos = Number.isFinite(objectLimit)
        ? requestedRefnos.slice(objectLimit)
        : [];

      const channel = 'api' as const;
      const partialEnabled = isMbdPartialEnabled(params.get('mbd_partial'));
      const labelPresentation = parseLabelPresentation(params.get('mbd_label'));
      const kindFilter = parseMbdKindFilter(params.get('mbd_kinds'));
      const lodDisabled = isMbdLodDisabled(params.get('mbd_lod'));
      const presentation3dDisabled = isMbd3dDisabled(params.get('mbd_3d'));
      const polarEnabled = isMbdPolarEnabled(params.get('mbd_polar'));
      /**
       * 多对象同屏时给记录 id 加 `subjectKey:` 前缀：各包的图元 id 编号空间各自
       * 独立（两个对象都能叫 dim-1），`replaceSource` 又是整槽校验、遇重复
       * id 直接抛——不加前缀合并必然失败。
       * 注意按请求列表总长度 `requestedRefnos.length > 1` 判定（#136）：即使 `?mbd_limit=1`
       * 首屏只装第 1 个对象，只要请求列表不止 1 个对象就统一加前缀，确保点「再加载 / 全部加载」
       * 前后已有记录的 `id` 不变。单对象保持裸 id，与旧行为一致。
       */
      const multiRefnos = requestedRefnos.length > 1;
      const optionsSignature = [
        partialEnabled ? '1' : '0',
        labelPresentation,
        kindFilter ? [...kindFilter].sort().join(',') : '',
        lodDisabled ? '0' : '1',
        presentation3dDisabled ? '0' : '1',
        polarEnabled ? '1' : '0',
        multiRefnos ? 'm' : 's',
      ].join('|');
      const latestRefresh = options.latestRefresh;
      const affectedRefnoSet = toNormalizedRefnoSet(latestRefresh?.affectedRefnos);
      const affectedDbnumSet = toDbnumSet(latestRefresh?.affectedDbnums);
      const fileLatestSessionsByDbnum = normalizeModelSessions(latestRefresh?.fileLatestSessionsByDbnum);
      const modelSessionsByDbnum = normalizeModelSessions(latestRefresh?.modelSessionsByDbnum);

      const processParsedOutcome = (
        refno: string,
        parsed: MbdV2ParseResult,
        previousCached: Readonly<{ optionsSignature: string; outcome: MbdSourceLoadOutcome }> | undefined,
      ): MbdSourceLoadOutcome => {
        try {
          if (!parsed.ok) {
            if (
              latestRefresh !== undefined
              && previousCached !== undefined
              && isNotFoundParseFailure(parsed)
            ) {
              cachedOutcomes.delete(refno);
              failureToasts.delete(refno);
              return {
                refno,
                records: [],
                empty: false,
                deleted: true,
                issues: [],
                skipped: [],
                layoutMode: null,
                notes: ['对象已删除：最新会话中已不存在该对象，标注已撤下'],
                sourceVersion: null,
                isolines: [],
                loadError: null,
              };
            }
            throw new MbdAtomicRejectionError(parsed.error, parsed.issues ?? [], []);
          }
          const payload: MbdV2PipeData = parsed.data;
          const channelSkipped = parsed.diagnostics;
          const mapped = mbdV2ToExternalRecords(
            payload,
            labelPresentation === 'above' ? { labelPresentation } : {},
          );
          const skipped = [...channelSkipped, ...mapped.skipped];
          const mappedSkipped = mapped.skipped;
          if (mappedSkipped.length > 0 && !partialEnabled) {
            throw new MbdAtomicRejectionError(
              `对象 ${refno} 整包拒绝：${mappedSkipped.length} 个图元无法映射`
                + `（首个：${mappedSkipped[0]!.id} — ${mappedSkipped[0]!.reason}）`,
              payload.issues,
              skipped,
            );
          }
          const kindById = new Map<string, string>(
            payload.primitives.map(primitive => [primitive.id, primitive.kind]),
          );
          const filtered = kindFilter
            ? mapped.records.filter(record => kindFilter.has(kindById.get(record.id) ?? ''))
            : mapped.records;
          const withLod = lodDisabled ? filtered.map(withoutLod) : filtered;
          const stripped = presentation3dDisabled ? withLod.map(withoutPresentation3d) : withLod;
          // 只有通用端点明确声明了 `payload.subject.refno` 时才按归属对象跨输入去重；
          // 未声明 `subject` 的老管道包 / 合成夹具按输入 `refno` 各自隔离，避免被占位 `branch_refno` 误并。
          const declaredSubjectKey = payload.subject?.refno
            ? normalizeRefnoToken(payload.subject.refno)
            : '';
          const qualifyPrefix = declaredSubjectKey || refno;
          const qualify = (id: string): string =>
            id.startsWith(`${qualifyPrefix}:`) ? id : `${qualifyPrefix}:${id}`;
          const records = multiRefnos
            ? stripped.map(record => ({
              ...record,
              id: qualify(record.id),
              sourceLabel: `MBD: ${qualify(record.id)}`,
              ...(record.chainId !== undefined ? { chainId: qualify(record.chainId) } : {}),
              layout: qualifyGroups({ ...record.layout, id: qualify(record.id) }, qualify),
            }))
            : stripped;
          const empty = payload.primitives.length === 0;
          const okOutcome: MbdSourceLoadOutcome = {
            refno,
            ...(declaredSubjectKey ? { subjectKey: declaredSubjectKey } : {}),
            records,
            empty,
            issues: payload.issues,
            skipped,
            layoutMode: payload.meta.layout_mode ?? null,
            sourceVersion: payload.meta.source_version ?? null,
            isolines: payload.meta.isolines ?? [],
            coverage: payload.meta.coverage ?? null,
            annotationType: payload.annotation_type ?? null,
            subject: payload.subject ?? null,
            loadError: null,
            notes: [
              ...payload.meta.notes,
              ...(empty
                ? [
                  '本对象没有可显示的标注：后端返回 0 个图元'
                    + (payload.issues.length > 0 ? '，原因见上面的诊断' : '，也没有给出原因'),
                ]
                : []),
              ...(kindFilter
                ? [
                  `mbd_kinds=${[...kindFilter].join(',')}：调试过滤，仅显示 `
                    + `${stripped.length}/${mapped.records.length} 个图元`,
                ]
                : []),
              ...(lodDisabled ? ['mbd_lod=0：已关闭分级显示（LOD），每条尺寸照常出图'] : []),
              ...(presentation3dDisabled
                ? ['mbd_3d=0：已关闭三维标注呈现，长度尺寸按求解器原位几何平面出图，标签按原位文字出图']
                : []),
              ...(polarEnabled
                ? ['mbd_polar=1 已退役：管道极坐标摆位由求解器完成，前端不再二次放置']
                : []),
              ...(labelPresentation === 'above'
                ? ['mbd_label=above：长度尺寸的数字浮在线上方、尺寸线不切段（ISO 读法，试验开关）']
                : []),
              ...(mappedSkipped.length > 0
                ? [
                  `mbd_partial=1：允许部分显示，已跳过 ${mappedSkipped.length} 个图元`
                    + `（首个：${mappedSkipped[0]!.id} — ${mappedSkipped[0]!.reason}）`,
                ]
                : []),
              ...(channelSkipped.length > 0
                ? [
                  `契约层跳过 ${channelSkipped.length} 个图元`
                    + `（首个：${channelSkipped[0]!.id} — ${channelSkipped[0]!.reason}）`,
                ]
                : []),
            ],
          };
          cachedOutcomes.set(refno, { optionsSignature, outcome: okOutcome });
          return okOutcome;
        } catch (error) {
          cachedOutcomes.delete(refno);
          const rejection = error instanceof MbdAtomicRejectionError ? error : null;
          return {
            refno,
            records: [],
            empty: false,
            issues: rejection?.issues ?? [],
            skipped: rejection?.skipped ?? [],
            layoutMode: null,
            notes: [],
            sourceVersion: null,
            isolines: [],
            loadError: error instanceof Error ? error.message : String(error),
          };
        }
      };

      const errorToOutcome = (refno: string, error: unknown): MbdSourceLoadOutcome => {
        cachedOutcomes.delete(refno);
        const rejection = error instanceof MbdAtomicRejectionError ? error : null;
        return {
          refno,
          records: [],
          empty: false,
          issues: rejection?.issues ?? [],
          skipped: rejection?.skipped ?? [],
          layoutMode: null,
          notes: [],
          sourceVersion: null,
          isolines: [],
          loadError: error instanceof Error ? error.message : String(error),
        };
      };

      const outcomes: (MbdSourceLoadOutcome | null)[] = Array.from(
        { length: refnos.length },
        () => null,
      );
      const toFetch: { index: number; refno: string }[] = [];
      for (let i = 0; i < refnos.length; i += 1) {
        const refno = refnos[i]!;
        const previousCached = cachedOutcomes.get(refno);
        if (
          latestRefresh !== undefined
          && previousCached !== undefined
          && previousCached.optionsSignature === optionsSignature
          && !isSourceAffectedByRefresh(
            refno,
            previousCached.outcome,
            affectedRefnoSet,
            affectedDbnumSet,
            fileLatestSessionsByDbnum,
          )
        ) {
          outcomes[i] = previousCached.outcome;
        } else {
          toFetch.push({ index: i, refno });
        }
      }

      let batchFallbackNote: string | undefined;
      if (toFetch.length >= 2 && deps.fetchObjectsData) {
        try {
          const batch = await deps.fetchObjectsData(
            toFetch.map(item => item.refno),
            { partial: partialEnabled, signal: abortController.signal },
          );
          if (cancelled()) return;
          batchFallbackNote = batch.fallbackNote;
          for (let i = 0; i < toFetch.length; i += 1) {
            const { index, refno } = toFetch[i]!;
            const parsed = batch.results[i] ?? { ok: false as const, error: '批量响应缺少对应条目' };
            outcomes[index] = processParsedOutcome(refno, parsed, cachedOutcomes.get(refno));
          }
        } catch (error) {
          if (cancelled() || isAbortError(error)) return;
          for (const { index, refno } of toFetch) {
            outcomes[index] = errorToOutcome(refno, error);
          }
        }
      } else if (toFetch.length > 0) {
        let nextCursor = 0;
        const workers = Array.from(
          { length: Math.min(MBD_FETCH_CONCURRENCY, toFetch.length) },
          async () => {
            while (nextCursor < toFetch.length) {
              if (cancelled()) return;
              const cursor = nextCursor;
              nextCursor += 1;
              const { index, refno } = toFetch[cursor]!;
              try {
                const parsed = await deps.fetchPipeData(refno, {
                  partial: partialEnabled,
                  signal: abortController.signal,
                });
                if (cancelled()) return;
                outcomes[index] = processParsedOutcome(refno, parsed, cachedOutcomes.get(refno));
              } catch (error) {
                if (cancelled() || isAbortError(error)) return;
                outcomes[index] = errorToOutcome(refno, error);
              }
            }
          },
        );
        await Promise.all(workers);
      }

      // 中途被顶替 / 宿主作废 / 任一包因取消而中途收手：整体放弃，不提交半批。
      if (cancelled() || outcomes.includes(null)) return;

      // 归属对象去重：多个子构件（例如同一台设备下的多个 NOZZ，或同一支架下的多根 SCTN）
      // 解析到同一个 `subjectKey` 时，只保留首次出现的记录，后续包归并说明而不重复提交图元。
      const seenSubjects = new Set<string>();
      const results: MbdSourceLoadOutcome[] = (outcomes as readonly MbdSourceLoadOutcome[]).map(
        (result) => {
          if (result.loadError !== null || result.deleted === true) return result;
          const subjectKey = result.subjectKey;
          if (!subjectKey) return result;
          if (seenSubjects.has(subjectKey)) {
            return {
              ...result,
              records: [],
              empty: false,
              deduplicatedInto: subjectKey,
              notes: [
                ...result.notes,
                `已归并至归属对象 ${subjectKey}，不重复绘制图元`,
              ],
            };
          }
          seenSubjects.add(subjectKey);
          return result;
        },
      );

      const allRecords = results.flatMap(result => result.records);
      const sources: MbdDiagnosticsSourceSnapshot[] = results.map(
        ({ records: _records, subjectKey: _subjectKey, ...source }) => source,
      );
      const failed = sources.filter(source => source.loadError !== null);

      // 合并所有成功包的记录，一次性整槽提交。合并级失败（理论上只剩跨包
      // 重复 id 之外的情形）兜底成整槽清空 + 失败进诊断，不抛给调用方。
      let commitError: string | null = null;
      try {
        target.replaceExternalSource('mbd', allRecords);
      } catch (error) {
        commitError = error instanceof Error ? error.message : String(error);
        target.replaceExternalSource('mbd', []);
      }

      // 聚合写诊断：顶层字段保留给现有面板读取点（`DimensionPanelDock` 不改
      // 也能工作），逐源明细进 `sources`。
      const summarizeFailures = (): string | null => {
        if (failed.length === 0) return null;
        if (refnos.length === 1 && !multiRefnos) return failed[0]!.loadError;
        const details = failed
          .map(source => `${source.refno} — ${source.loadError}`)
          .join('；');
        return `${failed.length}/${refnos.length} 个包装载失败：${details}`;
      };
      const loadError = commitError ?? summarizeFailures();
      const sourceNotes = sources.flatMap(
        source => source.notes.map(note => (multiRefnos ? `${source.refno}：${note}` : note)),
      );
      deps.diagnostics.set({
        channel,
        sourceId: refnos.join(','),
        sources,
        deferredRefnos,
        issues: sources.flatMap(source => source.issues),
        skipped: sources.flatMap(source => source.skipped),
        layoutMode: sources.find(source => source.layoutMode !== null)?.layoutMode ?? null,
        notes: batchFallbackNote ? [...sourceNotes, batchFallbackNote] : sourceNotes,
        sourceVersion: sources.find(source => source.sourceVersion !== null)?.sourceVersion ?? null,
        isolines: sources.flatMap(source => source.isolines),
        ...(modelSessionsByDbnum !== undefined ? { modelSessionsByDbnum } : {}),
        ...(loadError !== null ? { loadError } : {}),
      });

      for (const source of sources) {
        if (source.loadError !== null) toastFailure(source.refno, source.loadError);
        else failureToasts.delete(source.refno);
      }
      if (commitError !== null) {
        toastFailure(refnos.join(','), commitError);
      }
      for (const source of failed) {
        console.warn('[dimension-v2] MBD annotations unavailable', source.refno, source.loadError);
      }
      if (commitError !== null) {
        console.warn('[dimension-v2] MBD annotations unavailable', commitError);
      }

      const emptySources = results.filter(result => result.empty && !result.deduplicatedInto);
      const describeEmpty = (): string | null => {
        if (emptySources.length === 0) return null;
        if (emptySources.length === 1) {
          const [only] = emptySources;
          return `MBD 标注：${only!.refno} 没有可显示的标注（后端返回 0 个图元），`
            + (only!.issues.length > 0 ? '原因见尺寸面板' : '后端没有给出原因');
        }
        const listed = emptySources.slice(0, 3).map(source => source.refno).join('、');
        return `MBD 标注：${emptySources.length} 个对象没有可显示的标注（${listed}`
          + `${emptySources.length > 3 ? ' 等' : ''}），详见尺寸面板`;
      };
      const emptyToast = describeEmpty();
      if (emptyToast !== null && emptyToast !== lastEmptyToast) {
        deps.emitToast({ message: emptyToast, level: 'warning' });
      }
      lastEmptyToast = emptyToast;

      const errorCount = sources
        .filter(source => source.loadError === null)
        .flatMap(source => source.issues)
        .filter(issue => issue.severity === 'error')
        .length;
      if (errorCount > 0) {
        deps.emitToast({
          message: `MBD 标注存在 ${errorCount} 条 error 诊断，详见尺寸面板`,
          level: 'error',
        });
      }
    },
    invalidate() {
      syncVersion += 1;
      activeAbortController?.abort();
      activeAbortController = null;
    },
  };
}

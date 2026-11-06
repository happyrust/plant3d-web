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
   * 一件事（其余非法一律整包失败），由 `?mbd_partial=1` 驱动。
   */
  fetchPipeData(
    refno: string,
    options?: Readonly<{ partial?: boolean }>,
  ): Promise<MbdV2ParseResult>;
  diagnostics: MbdDiagnosticsStore;
  /** 通常为 () => window.location.search。 */
  getSearch(): string;
  emitToast(payload: ToastPayload): void;
}>;

export type MbdExternalSyncOptions = Readonly<{
  /** 宿主级过期判定（例如尺寸系统已被替换或组件已卸载）。 */
  isCancelled?: () => boolean;
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
 * `dimension3d` 与 `tag` 在这里被剥掉，内核回到求解器原位几何的平面呈现；缺省 / 其它值 = 保留。
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
  if (layout.dimension3d === undefined && layout.tag === undefined) return record;
  const { dimension3d: _dimension3d, tag: _tag, ...rest } = layout;
  return { ...record, layout: rest };
}

/**
 * 调试开关 `?mbd_polar=1`（T3.6a）：接入极坐标放置层——标签锚点改由
 * `polarPlace` + 屏幕净空校验挑选，而不是求解器原位 `label_anchor`。
 * **默认关闭**：mapper 给带同直段 `linear_dim` + 外径的 `label` 打的
 * `polar` 字段、以及给同 isoline 的 `linear_dim` 打的 `polarObstacle`
 * 字段（T3.6b），在这里一并被剥掉，内核回到原位呈现；缺省 / 其它值 = 剥掉。
 *
 * **只在 `mbd_3d=0` 下生效**：三维呈现里标签是 billboard 卡片，卡片有自己的
 * 避让轮；极坐标的屏幕校验看不到长度数值的文字框，接进来只会把卡片换成压在
 * 数值上的平面文字（真实 BRAN 远景重叠 2 → 39 对）。平面呈现里标签本来就是
 * 原位文字，全部候选被否决时退回原位，与不开时逐字段相同，不丢任何东西。
 */
function isMbdPolarEnabled(raw: string | null): boolean {
  return raw?.trim() === '1';
}

function withoutPolar(record: ExternalDimensionRecord): ExternalDimensionRecord {
  const layout = record.layout;
  // Only explicit layouts carry the polar opt-in.
  if (!('lines' in layout)) return record;
  if (layout.polar === undefined && layout.polarObstacle === undefined) return record;
  const { polar: _polar, polarObstacle: _polarObstacle, ...rest } = layout;
  return { ...record, layout: rest };
}

/**
 * MBD 外部图元双通道同步（从 ViewerPanel 抽出以获得可测缝）：
 * 通道选择、竞态守卫、诊断写入、error toast 集中在此。
 */
export function createMbdExternalSync(
  deps: MbdExternalSyncDeps,
): MbdExternalSync {
  let syncVersion = 0;
  /**
   * 失败提示按 refno 去重：同一 refno 的同一句原因只弹一次。取数失败往往是持续性
   * 的（后端 422 / 网关 502），每次 popstate 都弹会在用户眼前刷屏；换源或
   * 成功一次之后复位，下一次真失败仍要看得见。多 BRAN 时按 refno 各记各的，
   * 否则不同包轮流顶掉单条记忆，要么漏报要么重复刷屏。
   */
  const failureToasts = new Map<string, string>();

  const toastFailure = (refno: string, message: string): void => {
    if (failureToasts.get(refno) === message) {
      return;
    }
    failureToasts.set(refno, message);
    deps.emitToast({ message: `MBD 标注装载失败：${message}`, level: 'error' });
  };

  return {
    async sync(target, options = {}) {
      const version = ++syncVersion;
      const cancelled = (): boolean =>
        version !== syncVersion || (options.isCancelled?.() ?? false);

      const search = deps.getSearch();
      const params = new URLSearchParams(search);
      const refnos = parseMbdRefnos(search);

      if (refnos.length === 0) {
        if (cancelled()) return;
        target.replaceExternalSource('mbd', []);
        deps.diagnostics.clear();
        failureToasts.clear();
        return;
      }

      const channel = 'api' as const;
      const partialEnabled = isMbdPartialEnabled(params.get('mbd_partial'));
      const labelPresentation = parseLabelPresentation(params.get('mbd_label'));
      const kindFilter = parseMbdKindFilter(params.get('mbd_kinds'));
      const lodDisabled = isMbdLodDisabled(params.get('mbd_lod'));
      const presentation3dDisabled = isMbd3dDisabled(params.get('mbd_3d'));
      const polarEnabled = isMbdPolarEnabled(params.get('mbd_polar'));
      const polarApplied = polarEnabled && presentation3dDisabled;
      /**
       * 多 BRAN 同屏时给记录 id 加 `refno:` 前缀：各包的图元 id 编号空间各自
       * 独立（两个 BRAN 都能叫 dim-1），`replaceSource` 又是整槽校验、遇重复
       * id 直接抛——不加前缀合并必然失败。单包保持裸 id，与旧行为一致。
       */
      const multiRefnos = refnos.length > 1;

      const loadSource = async (refno: string): Promise<MbdSourceLoadOutcome | null> => {
        try {
          const parsed = await deps.fetchPipeData(refno, { partial: partialEnabled });
          // 在途 sync 被新 sync 顶替或宿主作废：立刻收手，不白费映射，外层也会整体放弃。
          if (cancelled()) return null;
          if (!parsed.ok) throw new Error(parsed.error);
          const payload: MbdV2PipeData = parsed.data;
          const channelSkipped = parsed.diagnostics;
          const mapped = mbdV2ToExternalRecords(
            payload,
            labelPresentation === 'above' ? { labelPresentation } : {},
          );
          const skipped = [...channelSkipped, ...mapped.skipped];
          // ADR 0046：先校验、后提交。原子拒绝只针对**映射失败**（契约认可、
          // 但映射不出来 —— 这是代码缺陷，半对的数据不可信），且现在按包生效
          // （2026-11-02 多 BRAN）：只剔除这一包，不掀翻其它包。
          //
          // 契约层的逐条诊断（`channelSkipped`，A3 起是「还不认识的图元 kind」）不再
          // 触发整包拒绝：那是后端向前演进的信息，不是本地能判对错的错。它们照旧
          // 进 diagnostics.skipped（面板可见、常驻提示），其余图元照常提交。
          const mappedSkipped = mapped.skipped;
          if (mappedSkipped.length > 0 && !partialEnabled) {
            throw new MbdAtomicRejectionError(
              `MBD 负载整包拒绝：${mappedSkipped.length} 个图元无法映射`
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
          const withPresentation3d = presentation3dDisabled ? withLod.map(withoutPresentation3d) : withLod;
          const stripped = polarApplied ? withPresentation3d : withPresentation3d.map(withoutPolar);
          // 真实后端的图元 id 已经带 refno 前缀（`24381_145018:isoline:0:...`），
          // 跨 BRAN 天然不冲突；只有那些不带前缀的 id 才需要补，否则会得到
          // `24381_145018:24381_145018:isoline:...` 这种重复噪声。
          const qualify = (id: string): string =>
            id.startsWith(`${refno}:`) ? id : `${refno}:${id}`;
          const records = multiRefnos
            ? stripped.map(record => ({
              ...record,
              id: qualify(record.id),
              sourceLabel: `MBD: ${qualify(record.id)}`,
              layout: { ...record.layout, id: qualify(record.id) },
            }))
            : stripped;
          return {
            refno,
            records,
            issues: payload.issues,
            skipped,
            layoutMode: payload.meta.layout_mode ?? null,
            sourceVersion: payload.meta.source_version ?? null,
            isolines: payload.meta.isolines ?? [],
            loadError: null,
            notes: [
              ...payload.meta.notes,
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
              ...(polarApplied
                ? ['mbd_polar=1：已接入极坐标放置层，标签锚点改由屏幕净空校验挑选（试验开关，仅平面呈现）']
                : []),
              ...(polarEnabled && !polarApplied
                ? ['mbd_polar=1：三维呈现下不生效，标签保留卡片；需同时加 mbd_3d=0 才走极坐标放置']
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
        } catch (error) {
          // 逐包拒绝的出口：取数失败、契约错误、映射未全量成功都转成这一包的
          // loadError——只有它不提交，其余包照常。
          const rejection = error instanceof MbdAtomicRejectionError ? error : null;
          return {
            refno,
            records: [],
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

      // 后端没有批量接口：固定大小的 worker 池逐包拉取，结果按 `mbd_refno`
      // 顺序落位（与并发完成的先后无关）。
      const outcomes: (MbdSourceLoadOutcome | null)[] = Array.from(
        { length: refnos.length },
        () => null,
      );
      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(MBD_FETCH_CONCURRENCY, refnos.length) },
        async () => {
          while (nextIndex < refnos.length) {
            const index = nextIndex;
            nextIndex += 1;
            outcomes[index] = await loadSource(refnos[index]!);
          }
        },
      );
      await Promise.all(workers);
      // 中途被顶替 / 宿主作废 / 任一包因取消而中途收手：整体放弃，不提交半批。
      if (cancelled() || outcomes.includes(null)) return;
      const results = outcomes as readonly MbdSourceLoadOutcome[];

      const allRecords = results.flatMap(result => result.records);
      const sources: MbdDiagnosticsSourceSnapshot[] = results.map(
        ({ records: _records, ...source }) => source,
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
        // 单源时原样用那句错误，与多源改造前的文案一致。
        if (refnos.length === 1) return failed[0]!.loadError;
        const details = failed
          .map(source => `${source.refno} — ${source.loadError}`)
          .join('；');
        return `${failed.length}/${refnos.length} 个包装载失败：${details}`;
      };
      const loadError = commitError ?? summarizeFailures();
      deps.diagnostics.set({
        channel,
        sourceId: refnos.join(','),
        sources,
        issues: sources.flatMap(source => source.issues),
        skipped: sources.flatMap(source => source.skipped),
        layoutMode: sources.find(source => source.layoutMode !== null)?.layoutMode ?? null,
        // 各包按自己的视角生成提示、再拼接；多源时补 refno 前缀归因，否则
        // 几条来源不同的「调试过滤」拼在一起分不清是谁的。
        notes: sources.flatMap(
          source => source.notes.map(note => (multiRefnos ? `${source.refno}：${note}` : note)),
        ),
        sourceVersion: sources.find(source => source.sourceVersion !== null)?.sourceVersion ?? null,
        isolines: sources.flatMap(source => source.isolines),
        ...(loadError !== null ? { loadError } : {}),
      });

      // 视口空白 + 无提示 = 现场分不清「本分支没有标注」与「取数失败」，所以失败
      // 必须有一次可见提示（诊断面板默认收起，光写诊断等于没提示）。按 refno
      // 分别去重；成功的包复位自己的记忆，下一次真失败仍要看得见。
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
    },
  };
}

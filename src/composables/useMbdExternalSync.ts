import type { MbdDiagnosticsStore } from './useMbdDiagnosticsStore';
import type {
  DimensionSystem,
  ExternalDimensionRecord,
  MbdV2Issue,
  MbdV2ParseResult,
  MbdV2PipeData,
} from '@/dimension';
import type { ToastPayload } from '@/ribbon/toastBus';

import { mbdV2ToExternalRecords } from '@/dimension';

export type MbdExternalSyncTarget = Pick<
  DimensionSystem,
  'replaceExternalSource'
>;

export type MbdExternalSyncDeps = Readonly<{
  /** 实时通道：按 refno 拉取契约数据（HTTP 层错误以 ok:false 或 reject 表达）。 */
  fetchPipeData(refno: string): Promise<MbdV2ParseResult>;
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
   * 通道失败时清空来源、把失败原因写入诊断并弹一次错误提示
   * （同一 refno 的同一句原因只弹一次，成功后复位；不静默清空诊断）。
   */
  sync(
    target: MbdExternalSyncTarget,
    options?: MbdExternalSyncOptions,
  ): Promise<void>;
  /** 使所有在途 sync 的结果失效（组件卸载时调用）。 */
  invalidate(): void;
}>;

/**
 * 原子拒绝（ADR 0046）：负载校验或映射未全量成功时携带诊断明细进入统一
 * 失败分支，不提交任何部分记录。
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
 * 调试开关 `?mbd_partial=1`：允许部分显示。缺省（关）维持 ADR 0046 的原子拒绝——
 * 只要有一个图元映射不过就整包不提交；打开后跳过的那几条只进诊断，其余照常渲染，
 * 面板常驻「N 条被跳过」的横幅（`DimensionPanelDock`），避免使用者误以为图是完整的。
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
 * MBD 外部图元双通道同步（从 ViewerPanel 抽出以获得可测缝）：
 * 通道选择、竞态守卫、诊断写入、error toast 集中在此。
 */
export function createMbdExternalSync(
  deps: MbdExternalSyncDeps,
): MbdExternalSync {
  let syncVersion = 0;
  /**
   * 失败提示去重：同一 refno 的同一句原因只弹一次。取数失败往往是持续性
   * 的（后端 422 / 网关 502），每次 popstate 都弹会在用户眼前刷屏；换源或
   * 成功一次之后复位，下一次真失败仍要看得见。
   */
  let lastFailureToast: Readonly<{ refno: string; message: string }> | null = null;

  const toastFailure = (refno: string, message: string): void => {
    if (lastFailureToast?.refno === refno && lastFailureToast.message === message) {
      return;
    }
    lastFailureToast = { refno, message };
    deps.emitToast({ message: `MBD 标注装载失败：${message}`, level: 'error' });
  };

  return {
    async sync(target, options = {}) {
      const version = ++syncVersion;
      const cancelled = (): boolean =>
        version !== syncVersion || (options.isCancelled?.() ?? false);

      const params = new URLSearchParams(deps.getSearch());
      const mbdRefno = params.get('mbd_refno')?.trim() || '';

      if (!mbdRefno) {
        if (cancelled()) return;
        target.replaceExternalSource('mbd', []);
        deps.diagnostics.clear();
        lastFailureToast = null;
        return;
      }

      const channel = 'api' as const;
      const sourceId = mbdRefno;
      try {
        const parsed = await deps.fetchPipeData(mbdRefno);
        if (!parsed.ok) throw new Error(parsed.error);
        const payload: MbdV2PipeData = parsed.data;
        const channelSkipped = parsed.diagnostics;
        const mapped = mbdV2ToExternalRecords(payload);
        const skipped = [...channelSkipped, ...mapped.skipped];
        // ADR 0046：先校验、后原子替换。实时 API 负载的任何跳过——契约校验阶段的
        // 逐条诊断（channelSkipped）与映射失败（mapped.skipped）——都整包拒绝，
        // 不部分提交。
        const partialEnabled = isMbdPartialEnabled(params.get('mbd_partial'));
        if (skipped.length > 0 && !partialEnabled) {
          throw new MbdAtomicRejectionError(
            `MBD 负载整包拒绝：${skipped.length} 个图元无法映射`
              + `（首个：${skipped[0]!.id} — ${skipped[0]!.reason}）`,
            payload.issues,
            skipped,
          );
        }
        if (cancelled()) return;
        const kindFilter = parseMbdKindFilter(params.get('mbd_kinds'));
        const kindById = new Map<string, string>(
          payload.primitives.map(primitive => [primitive.id, primitive.kind]),
        );
        const lodDisabled = isMbdLodDisabled(params.get('mbd_lod'));
        const presentation3dDisabled = isMbd3dDisabled(params.get('mbd_3d'));
        const filtered = kindFilter
          ? mapped.records.filter(record => kindFilter.has(kindById.get(record.id) ?? ''))
          : mapped.records;
        const withLod = lodDisabled ? filtered.map(withoutLod) : filtered;
        const records = presentation3dDisabled ? withLod.map(withoutPresentation3d) : withLod;
        target.replaceExternalSource('mbd', records);
        lastFailureToast = null;
        deps.diagnostics.set({
          channel,
          sourceId,
          issues: payload.issues,
          skipped,
          layoutMode: payload.meta.layout_mode ?? null,
          notes: [
            ...payload.meta.notes,
            ...(kindFilter
              ? [
                `mbd_kinds=${[...kindFilter].join(',')}：调试过滤，仅显示 `
                  + `${records.length}/${mapped.records.length} 个图元`,
              ]
              : []),
            ...(lodDisabled ? ['mbd_lod=0：已关闭分级显示（LOD），每条尺寸照常出图'] : []),
            ...(presentation3dDisabled
              ? ['mbd_3d=0：已关闭三维标注呈现，长度尺寸按求解器原位几何平面出图，标签按原位文字出图']
              : []),
            ...(skipped.length > 0
              ? [
                `mbd_partial=1：允许部分显示，已跳过 ${skipped.length} 个图元`
                  + `（首个：${skipped[0]!.id} — ${skipped[0]!.reason}）`,
              ]
              : []),
          ],
        });
        const errorCount = payload.issues.filter(
          issue => issue.severity === 'error',
        ).length;
        if (errorCount > 0) {
          deps.emitToast({
            message: `MBD 标注存在 ${errorCount} 条 error 诊断，详见尺寸面板`,
            level: 'error',
          });
        }
      } catch (error) {
        if (cancelled()) return;
        target.replaceExternalSource('mbd', []);
        const rejection = error instanceof MbdAtomicRejectionError ? error : null;
        deps.diagnostics.set({
          channel,
          sourceId,
          issues: rejection?.issues ?? [],
          skipped: rejection?.skipped ?? [],
          loadError: error instanceof Error ? error.message : String(error),
        });
        // 视口空白 + 无提示 = 现场分不清「本分支没有标注」与「取数失败」，所以失败
        // 必须有一次可见提示（诊断面板默认收起，光写诊断等于没提示）。
        toastFailure(sourceId, error instanceof Error ? error.message : String(error));
        console.warn('[dimension-v2] MBD annotations unavailable', error);
      }
    },
    invalidate() {
      syncVersion += 1;
    },
  };
}

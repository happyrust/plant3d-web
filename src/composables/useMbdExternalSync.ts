import type { MbdDiagnosticsStore } from './useMbdDiagnosticsStore';
import type {
  DimensionSystem,
  MbdDimensionDto,
  MbdV2Issue,
  MbdV2ParseResult,
  MbdV2PipeData,
} from '@/dimension';
import type { ToastPayload } from '@/ribbon/toastBus';

import { mbdDtosToV2PipeData, mbdV2ToExternalRecords } from '@/dimension';

export type MbdExternalSyncTarget = Pick<
  DimensionSystem,
  'replaceExternalSource'
>;

export type MbdExternalSyncDeps = Readonly<{
  /** 实时通道：按 refno 拉取契约数据（HTTP 层错误以 ok:false 或 reject 表达）。 */
  fetchPipeData(refno: string): Promise<MbdV2ParseResult>;
  /** 离线通道：按 dbno 读取 parquet 尺寸 DTO。 */
  queryParquetDimensions(
    dbno: number,
    options: Readonly<{ forceRefresh?: boolean }>,
  ): Promise<Readonly<{
    dimensions: readonly MbdDimensionDto[];
    skipped: readonly Readonly<{ id: string; reason: string }>[];
  }>>;
  diagnostics: MbdDiagnosticsStore;
  /** 通常为 () => window.location.search。 */
  getSearch(): string;
  emitToast(payload: ToastPayload): void;
}>;

export type MbdExternalSyncOptions = Readonly<{
  forceRefresh?: boolean;
  /** 宿主级过期判定（例如尺寸系统已被替换或组件已卸载）。 */
  isCancelled?: () => boolean;
}>;

export type MbdExternalSync = Readonly<{
  /**
   * 按 URL 参数选择通道并把 MBD 图元同步进目标系统：
   * `mbd_refno` → 实时 API；否则 `show_dbnum` → parquet；两者皆无 → 清空来源。
   * 通道失败时清空来源并把失败原因写入诊断（不静默清空诊断）。
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
 * MBD 外部图元双通道同步（从 ViewerPanel 抽出以获得可测缝）：
 * 通道选择、竞态守卫、诊断写入、error toast 集中在此。
 */
export function createMbdExternalSync(
  deps: MbdExternalSyncDeps,
): MbdExternalSync {
  let syncVersion = 0;

  return {
    async sync(target, options = {}) {
      const version = ++syncVersion;
      const cancelled = (): boolean =>
        version !== syncVersion || (options.isCancelled?.() ?? false);

      const params = new URLSearchParams(deps.getSearch());
      const mbdRefno = params.get('mbd_refno')?.trim() || '';
      const rawDbno = params.get('show_dbnum');
      const parsedDbno = rawDbno === null ? Number.NaN : Number(rawDbno);
      const hasParquetChannel =
        Number.isSafeInteger(parsedDbno) && parsedDbno >= 0;

      if (!mbdRefno && !hasParquetChannel) {
        if (cancelled()) return;
        target.replaceExternalSource('mbd', []);
        deps.diagnostics.clear();
        return;
      }

      const channel = mbdRefno ? ('api' as const) : ('parquet' as const);
      const sourceId = mbdRefno || String(parsedDbno);
      try {
        let payload: MbdV2PipeData;
        let channelSkipped: readonly Readonly<{ id: string; reason: string }>[];
        if (mbdRefno) {
          const parsed = await deps.fetchPipeData(mbdRefno);
          if (!parsed.ok) throw new Error(parsed.error);
          payload = parsed.data;
          channelSkipped = parsed.diagnostics;
        } else {
          const loaded = await deps.queryParquetDimensions(parsedDbno, {
            forceRefresh: options.forceRefresh,
          });
          const converted = mbdDtosToV2PipeData(loaded.dimensions, {
            inputRefno: `dbno:${parsedDbno}`,
          });
          payload = converted.data;
          channelSkipped = [...loaded.skipped, ...converted.skipped];
        }
        const mapped = mbdV2ToExternalRecords(payload);
        const skipped = [...channelSkipped, ...mapped.skipped];
        // ADR 0046：先校验、后原子替换。parquet 装载/契约化阶段的逐行跳过
        // （channelSkipped）保留为通道容忍；实时 API 负载的任何跳过、以及两个
        // 通道进入适配层后的映射失败（mapped.skipped）都整包拒绝，不部分提交。
        const atomicSkipped = channel === 'api' ? skipped : mapped.skipped;
        if (atomicSkipped.length > 0) {
          throw new MbdAtomicRejectionError(
            `MBD 负载整包拒绝：${atomicSkipped.length} 个图元无法映射`
              + `（首个：${atomicSkipped[0]!.id} — ${atomicSkipped[0]!.reason}）`,
            payload.issues,
            skipped,
          );
        }
        if (cancelled()) return;
        target.replaceExternalSource('mbd', mapped.records);
        deps.diagnostics.set({
          channel,
          sourceId,
          issues: payload.issues,
          skipped,
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
        if (skipped.length > 0) {
          console.warn('[dimension-v2] skipped MBD primitives', skipped);
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
        console.warn('[dimension-v2] MBD annotations unavailable', error);
      }
    },
    invalidate() {
      syncVersion += 1;
    },
  };
}

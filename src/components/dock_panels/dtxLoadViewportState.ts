/**
 * DTX 场景装载后的视口状态：全局归一化变换（mm→m + recenter）与首次加载自动对焦（auto-fit）。
 *
 * 从 `ViewerPanel.vue` 拆出的纯状态逻辑，便于单测直接覆盖多库同屏 + `flyTo: false` 重载路径（#324）：
 * - 全局矩阵作用于整张共享 `DTXLayer`（所有库共用同一工程坐标系），按 `(scale, recenter)` 生效一次即可，
 *   切到第二个库或重载非最后装的库时不重算，避免把已装模型的坐标原点和镜头参考系挪走；
 * - 自动对焦按 `(dbno, scale, recenter)` 用集合记账：已对焦过的库再次重载/切回不会被误判成首次加载；
 *   且调用方显式传 `autoFit: false`（如 `flyTo: false` 的「取最新」重载）或本次没有新装构件（撤下/驱逐）
 *   时一律不触发自动对焦。
 */

export type DtxAfterInstancesLoadedOptions = {
  /** 是否允许本次装载触发首次加载自动对焦；缺省 `true`。`flyTo: false`（如「取最新」重载）时传 `false`。 */
  autoFit?: boolean;
};

export type DtxScaleTransformConfig = {
  scale: number;
  recenter: boolean;
  autoFitOnLoad: boolean;
};

export function createDtxLoadViewportState() {
  let globalTransformKey: string | null = null;
  const autoFitAppliedKeys = new Set<string>();

  const transformKeyOf = (config: Pick<DtxScaleTransformConfig, 'scale' | 'recenter'>): string => (
    `${config.scale}:${config.recenter ? 1 : 0}`
  );
  const autoFitKeyOf = (dbno: number, config: Pick<DtxScaleTransformConfig, 'scale' | 'recenter'>): string => (
    `${dbno}:${config.scale}:${config.recenter ? 1 : 0}`
  );

  return {
    shouldApplyGlobalTransform(config: Pick<DtxScaleTransformConfig, 'scale' | 'recenter'>): boolean {
      if (!Number.isFinite(config.scale) || config.scale <= 0) return false;
      return globalTransformKey !== transformKeyOf(config);
    },
    markGlobalTransformApplied(config: Pick<DtxScaleTransformConfig, 'scale' | 'recenter'>): void {
      globalTransformKey = transformKeyOf(config);
    },
    shouldAutoFit(
      dbno: number,
      config: DtxScaleTransformConfig,
      options?: { autoFit?: boolean; loadedCount?: number },
    ): boolean {
      if (!config.autoFitOnLoad) return false;
      if (options?.autoFit === false) return false;
      if (options?.loadedCount !== undefined && options.loadedCount <= 0) return false;
      return !autoFitAppliedKeys.has(autoFitKeyOf(dbno, config));
    },
    markAutoFitApplied(dbno: number, config: Pick<DtxScaleTransformConfig, 'scale' | 'recenter'>): void {
      autoFitAppliedKeys.add(autoFitKeyOf(dbno, config));
    },
    reset(): void {
      globalTransformKey = null;
      autoFitAppliedKeys.clear();
    },
  };
}

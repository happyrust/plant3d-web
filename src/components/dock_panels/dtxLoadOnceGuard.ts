/**
 * DTX 主图层首次全局变换与首次自动对焦（auto-fit）的去重守卫（happyrust/gen-model#324）。
 *
 * 原先 `ViewerPanel.vue` 用单个字符串 `dtxAutoFitAppliedKey` / `dtxGlobalTransformAppliedKey`
 * 仅记「上一次加载的库号」：当场景同时装着多个库（如 8000 与 7998），随后「取最新」重载较早装过的
 * 库（8000）时，单值键与上一次（7998）不等，导致 `fitToDtxLayerBBoxOnce` 把它误判为首次加载、
 * 无视 `flyTo: false` 将相机拉回全景，同时 `applyDtxGlobalTransformOnce` 也反复重算全局矩阵。
 *
 * 规矩：
 * 1. 全局变换（单位缩放 + 原点重心化）作用于整张共享 `DTXLayer`，按配置键 `scale:recenter`
 *    记单次——切换单位/重心化设置时重算，多库同屏叠加或重载旧库不再挪动场景原点；
 * 2. 自动对焦用集合记录已对焦过的 `dbno:scale:recenter`，且在 `suppressAutoFit` 期间
 *    （「取最新」重载/撤下、带 `flyTo: false` 的重载）或空批（`loadedCount <= 0` 撤下回调）一律跳过。
 */

export function makeDtxTransformConfigKey(scale: number, recenter: boolean): string {
  return `${scale}:${recenter ? 1 : 0}`;
}

export function makeDtxAutoFitKey(dbno: number, scale: number, recenter: boolean): string {
  return `${dbno}:${scale}:${recenter ? 1 : 0}`;
}

export interface DtxLoadOnceGuard {
  shouldApplyGlobalTransform(scale: number, recenter: boolean): boolean;
  markGlobalTransformApplied(scale: number, recenter: boolean): void;
  shouldAutoFit(dbno: number, scale: number, recenter: boolean, loadedCount: number): boolean;
  markAutoFitApplied(dbno: number, scale: number, recenter: boolean): void;
  beginSuppressAutoFit(): void;
  endSuppressAutoFit(): void;
  isAutoFitSuppressed(): boolean;
  reset(): void;
}

export function createDtxLoadOnceGuard(): DtxLoadOnceGuard {
  let globalTransformConfigKey: string | null = null;
  const autoFitKeys = new Set<string>();
  let suppressAutoFitDepth = 0;

  return {
    shouldApplyGlobalTransform(scale: number, recenter: boolean): boolean {
      return globalTransformConfigKey !== makeDtxTransformConfigKey(scale, recenter);
    },
    markGlobalTransformApplied(scale: number, recenter: boolean): void {
      globalTransformConfigKey = makeDtxTransformConfigKey(scale, recenter);
    },
    shouldAutoFit(dbno: number, scale: number, recenter: boolean, loadedCount: number): boolean {
      if (suppressAutoFitDepth > 0 || loadedCount <= 0) return false;
      return !autoFitKeys.has(makeDtxAutoFitKey(dbno, scale, recenter));
    },
    markAutoFitApplied(dbno: number, scale: number, recenter: boolean): void {
      autoFitKeys.add(makeDtxAutoFitKey(dbno, scale, recenter));
    },
    beginSuppressAutoFit(): void {
      suppressAutoFitDepth += 1;
    },
    endSuppressAutoFit(): void {
      suppressAutoFitDepth = Math.max(0, suppressAutoFitDepth - 1);
    },
    isAutoFitSuppressed(): boolean {
      return suppressAutoFitDepth > 0;
    },
    reset(): void {
      globalTransformConfigKey = null;
      autoFitKeys.clear();
      suppressAutoFitDepth = 0;
    },
  };
}

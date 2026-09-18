import { computed, ref, type Ref } from 'vue';

import type { ClearanceService } from '@/clearance/services/clearanceService';
import type { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import type { ToastPayload } from '@/ribbon/toastBus';

import { clearanceFaceLabel } from '@/clearance/adapters/clearanceExternalDimensions';
import { normalizeClearanceRefno, type ClearanceRecord } from '@/clearance/domain/clearanceRecord';

/**
 * 「构件 → 墙净距」拾取流（计划 §6.3，Q8 (c) 的主入口）：
 * 源 = 当前选中的构件（`useSelectionStore.selectedRefno`），进入 `pick_refno` 模式只放行墙族，
 * 用户点墙、Enter 确认 → `useClearanceStore.compute` → 记录进 store（外部尺寸源随之画出）。
 * 三维交互本身（点选、Enter / Esc）沿用 `useDtxTools` 对 `pick_refno` 的既有处理，这里只定义边界。
 */

/** 与 gen-model `surface_clearance::WALL_NOUNS` 逐字相同：CWALL 是 owner，其余四个是 `/nearest-clearance` 的 `wall` 预置组。 */
export const CLEARANCE_WALL_PICK_NOUNS: readonly string[] = Object.freeze(['CWALL', 'WALL', 'STWALL', 'GWALL', 'PANE']);

export type ComponentToWallToolStore = Readonly<{
  toolMode: Ref<string>;
  startPickRefno(nounFilter: string[], onConfirm?: (refnos: string[]) => void, onCancel?: () => void): void;
  cancelPickRefno(): void;
}>;

export type ComponentToWallSelectionStore = Readonly<{
  selectedRefno: Ref<string | null>;
}>;

export type ComponentToWallClearanceDeps = Readonly<{
  toolStore: ComponentToWallToolStore;
  selectionStore: ComponentToWallSelectionStore;
  clearanceStore: ReturnType<typeof useClearanceStore>;
  /** 测试注入；缺省走 store 的缺省 service（真 API） */
  service?: ClearanceService;
  toast?: (payload: ToastPayload) => void;
  /** 算成一条记录后的回调（ViewerPanel 用来飞到两点） */
  onRecord?: (record: ClearanceRecord) => void;
}>;

export function formatClearanceToast(record: ClearanceRecord): string {
  const snapshot = record.snapshot;
  if (!snapshot) return `${record.inputs.sourceRefno} → ${record.inputs.targetRefno}：给定范围内两侧网格没有靠近到一起`;
  if (snapshot.intersects) return `${record.inputs.sourceRefno} 与 ${record.inputs.targetRefno} 相交（净距 0）`;
  const mm = snapshot.distanceM * 1000;
  const distance = mm < 10 ? mm.toFixed(2) : mm.toFixed(1);
  const kind = snapshot.targetFace?.kind;
  const face = clearanceFaceLabel(kind);
  const perpendicular = snapshot.perpendicular ? (kind === 'opening' ? '，垂直于洞壁' : '，垂直于墙面') : '';
  return `外表面净距 ${distance} mm${face ? `（${face}）` : ''}${perpendicular}`;
}

export function useComponentToWallClearance(deps: ComponentToWallClearanceDeps) {
  const { toolStore, selectionStore, clearanceStore } = deps;
  const toast = deps.toast ?? ((payload: ToastPayload) => {
    if (payload.level === 'error') console.error('[clearance]', payload.message);
  });
  /** 本会话发起的拾取才算「在拾取」——别的功能也用 `pick_refno`。 */
  const sourceRefno = ref<string | null>(null);
  const picking = computed(() => sourceRefno.value !== null && toolStore.toolMode.value === 'pick_refno');

  async function computeForPair(source: string, target: string, targetKind: 'wall' | 'any' = 'wall'): Promise<ClearanceRecord | null> {
    const sourceKey = normalizeClearanceRefno(source);
    const targetKey = normalizeClearanceRefno(target);
    if (!sourceKey || !targetKey) {
      toast({ message: '构件 refno 为空，无法计算净距', level: 'warning' });
      return null;
    }
    if (sourceKey === targetKey) {
      toast({ message: '源与目标是同一个构件，换一堵墙再试', level: 'warning' });
      return null;
    }
    const record = await clearanceStore.compute(
      { sourceRefno: sourceKey, targetRefno: targetKey, targetKind },
      { service: deps.service },
    );
    if (!record) {
      toast({ message: `净距计算失败：${clearanceStore.lastError.value ?? '未知错误'}`, level: 'error' });
      return null;
    }
    toast({ message: formatClearanceToast(record), level: record.snapshot ? 'success' : 'warning' });
    deps.onRecord?.(record);
    return record;
  }

  function finishPick() {
    sourceRefno.value = null;
  }

  /**
   * 进入「点墙」模式。返回 false 表示没进去（没选中构件）。
   * 用户多选了几堵墙只算第一堵——一期一对（Q7）。
   */
  function start(): boolean {
    const selected = selectionStore.selectedRefno.value;
    const source = selected ? normalizeClearanceRefno(selected) : '';
    if (!source) {
      toast({ message: '先在三维里选中一个构件，再点「构件→墙净距」', level: 'warning' });
      return false;
    }
    sourceRefno.value = source;
    toolStore.startPickRefno(
      [...CLEARANCE_WALL_PICK_NOUNS],
      (refnos) => {
        const target = refnos.find(refno => normalizeClearanceRefno(refno) !== source) ?? null;
        finishPick();
        if (!target) {
          toast({ message: '没有点到墙（CWALL / WALL / STWALL / GWALL / PANE）', level: 'warning' });
          return;
        }
        if (refnos.length > 1) {
          toast({ message: `点了 ${refnos.length} 堵墙，只算第一堵 ${normalizeClearanceRefno(target)}`, level: 'info' });
        }
        void computeForPair(source, target, 'wall');
      },
      () => {
        finishPick();
      },
    );
    toast({ message: `源构件 ${source}：请点选一堵墙，Enter 确认、Esc 取消`, level: 'info' });
    return true;
  }

  function cancel() {
    if (!picking.value) return;
    toolStore.cancelPickRefno();
    finishPick();
  }

  return {
    sourceRefno,
    picking,
    start,
    cancel,
    computeForPair,
  };
}

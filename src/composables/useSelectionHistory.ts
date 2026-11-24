import { shallowRef } from 'vue';

import { Vector3 } from 'three';

import { useViewerContext } from './useViewerContext';

import {
  createSelectionHistory,
  type SelectionNavEntry,
  type SelectionNavStep,
} from '@/utils/selectionHistory';

type Vec3 = [number, number, number];
export type SelectionCameraPose = { position: Vec3; target: Vec3 };

export type SelectionHistorySnapshot = {
  entries: readonly SelectionNavEntry<SelectionCameraPose>[];
  cursor: number | null;
};

/** 回放相机的插值时长：短到不拖手，长到看得出是「回去」而不是跳屏。 */
const RESTORE_CAMERA_MS = 300;

const history = createSelectionHistory<SelectionCameraPose>();
const snapshot = shallowRef<SelectionHistorySnapshot>({ entries: [], cursor: null });
/** 回放进行中：这期间选中照常写，但不入栈——否则一次后退就把自己又推回栈顶。 */
let navigating = false;
let applySelection: ((refnos: string[], active: string) => void) | null = null;

function syncSnapshot() {
  snapshot.value = { entries: [...history.entries()], cursor: history.cursor() };
}

function captureCamera(): SelectionCameraPose | null {
  const dtx = useViewerContext().viewerRef.value?.__dtxViewer;
  if (!dtx) return null;
  const { x, y, z } = dtx.camera.position;
  const t = dtx.controls.target;
  return { position: [x, y, z], target: [t.x, t.y, t.z] };
}

function restoreCamera(pose: SelectionCameraPose) {
  const dtx = useViewerContext().viewerRef.value?.__dtxViewer;
  if (!dtx) return;
  dtx.flyTo(new Vector3(...pose.position), new Vector3(...pose.target), { duration: RESTORE_CAMERA_MS });
}

/** 选中 store 在模块加载时把写入口登记进来：回放走同一条路，树 / 三维 / 属性面板自然跟上。 */
export function registerSelectionHistoryApplier(apply: (refnos: string[], active: string) => void) {
  applySelection = apply;
}

/** 主选中换了 = 到了一个新地方。回放期间由这里挡掉，不在调用点判。 */
export function recordSelectionHistory(refnos: string[], active: string) {
  if (navigating) return;
  const camera = captureCamera();
  if (history.record({ refnos, active, camera }, camera)) syncSnapshot();
}

export function navigateSelectionHistory(step: SelectionNavStep): boolean {
  const entry = history.step(step, captureCamera());
  if (!entry) return false;
  navigating = true;
  try {
    applySelection?.(entry.refnos, entry.active);
  } finally {
    navigating = false;
  }
  if (entry.camera) restoreCamera(entry.camera);
  syncSnapshot();
  return true;
}

export function clearSelectionHistory() {
  history.clear();
  syncSnapshot();
}

export function useSelectionHistory() {
  return {
    snapshot,
    navigate: navigateSelectionHistory,
    clear: clearSelectionHistory,
  };
}

import { reactive } from 'vue';

import { Color } from 'three';

import {
  normalizeRuleRefnoToken,
  type UnifiedRuleViolation,
} from '@/api/ruleCheckApi';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { useViewerContext } from '@/composables/useViewerContext';

export type RuleCheckOverlayCategory =
  | 'firezone_red'
  | 'firezone_yellow'
  | 'violation'
  | 'semi_auto'
  | 'reminder';

export type RuleCheckOverlayMode = 'firezone' | 'all';

export interface RuleCheckOverlayPaletteItem {
  category: RuleCheckOverlayCategory;
  label: string;
  hex: string;
  priority: number;
}

export const RULE_CHECK_OVERLAY_PALETTE: Record<
  RuleCheckOverlayCategory,
  RuleCheckOverlayPaletteItem
> = {
  firezone_red: {
    category: 'firezone_red',
    label: '扩散性火灾',
    hex: '#ef4444',
    priority: 5,
  },
  firezone_yellow: {
    category: 'firezone_yellow',
    label: '局部性火灾',
    hex: '#eab308',
    priority: 4,
  },
  violation: {
    category: 'violation',
    label: '硬违规',
    hex: '#f97316',
    priority: 3,
  },
  semi_auto: {
    category: 'semi_auto',
    label: '半自动复核',
    hex: '#8b5cf6',
    priority: 2,
  },
  reminder: {
    category: 'reminder',
    label: '提醒',
    hex: '#0ea5e9',
    priority: 1,
  },
};

export interface RuleCheckOverlayPlan {
  refnoCategory: Map<string, RuleCheckOverlayCategory>;
  categoryRefnoCounts: Record<RuleCheckOverlayCategory, number>;
}

export function classifyViolationOverlayCategory(
  violation: UnifiedRuleViolation,
): RuleCheckOverlayCategory {
  if (violation.highlightColor === 'red') return 'firezone_red';
  if (violation.highlightColor === 'yellow') return 'firezone_yellow';
  if (violation.severity === 'semi_auto') return 'semi_auto';
  if (violation.severity === 'reminder') return 'reminder';
  return 'violation';
}

/**
 * 为违规集合规划 refno -> 颜色分类映射。
 * 同一构件命中多条规则时，按优先级取最高色（红火灾 > 黄火灾 > 硬违规 > 半自动 > 提醒）。
 */
export function planRuleCheckColorAssignments(
  violations: UnifiedRuleViolation[],
  mode: RuleCheckOverlayMode,
): RuleCheckOverlayPlan {
  const refnoCategory = new Map<string, RuleCheckOverlayCategory>();

  for (const v of violations) {
    if (mode === 'firezone' && !v.highlightColor) continue;
    const cat = classifyViolationOverlayCategory(v);
    const prio = RULE_CHECK_OVERLAY_PALETTE[cat].priority;

    for (const raw of v.highlightRefnos) {
      const refno = normalizeRuleRefnoToken(raw);
      if (!refno) continue;
      const existing = refnoCategory.get(refno);
      if (!existing || prio > RULE_CHECK_OVERLAY_PALETTE[existing].priority) {
        refnoCategory.set(refno, cat);
      }
    }
  }

  const categoryRefnoCounts: Record<RuleCheckOverlayCategory, number> = {
    firezone_red: 0,
    firezone_yellow: 0,
    violation: 0,
    semi_auto: 0,
    reminder: 0,
  };
  for (const cat of refnoCategory.values()) {
    categoryRefnoCounts[cat] += 1;
  }

  return { refnoCategory, categoryRefnoCounts };
}

/** 从 DTX objectId（`o:<refno>:<idx>` 或 `<refno>`）提取规整后的 refno。 */
export function extractRefnoFromDtxObjectId(objectId: string): string {
  if (!objectId) return '';
  if (objectId.startsWith('o:')) {
    const parts = objectId.split(':');
    return normalizeRuleRefnoToken(parts[1] ?? '');
  }
  return normalizeRuleRefnoToken(objectId);
}

interface OverlayDtxLayerLike {
  getAllObjectIds?: () => Iterable<string>;
  setObjectColor?: (objectId: string, color: Color) => void;
  resetObjectColor?: (objectId: string) => void;
}

interface OverlayViewerLike {
  __dtxLayer?: OverlayDtxLayerLike;
  requestRender?: (() => void) | null;
  scene?: {
    getLoadedRefnos?: () => string[];
    getSubtreeRefnos?: (refnos: string[]) => string[];
    ensureRefnos?: (refnos: string[]) => void;
    setObjectsVisible?: (refnos: string[], visible: boolean) => void;
    setObjectsXRayed?: (refnos: string[], xrayed: boolean) => void;
  };
}

function createInitialOverlayState() {
  return {
    activeMode: null as RuleCheckOverlayMode | null,
    xrayOthers: true,
    applying: false,
    paintedRefnoCount: 0,
    paintedObjectCount: 0,
    categoryCounts: {
      firezone_red: 0,
      firezone_yellow: 0,
      violation: 0,
      semi_auto: 0,
      reminder: 0,
    } as Record<RuleCheckOverlayCategory, number>,
    lastNotice: null as string | null,
  };
}

const overlayState = reactive(createInitialOverlayState());
let paintedObjectIds: string[] = [];
let dimmedRefnos: string[] = [];

export function resetRuleCheckOverlayStore() {
  paintedObjectIds = [];
  dimmedRefnos = [];
  Object.assign(overlayState, createInitialOverlayState());
}

export function useRuleCheckOverlay() {
  const viewerContext = useViewerContext();
  const spatialQuery = useSpatialQuery();

  function clearOverlay(): void {
    const viewer = viewerContext.viewerRef.value as OverlayViewerLike | null;
    const layer = viewer?.__dtxLayer;

    if (layer?.resetObjectColor && paintedObjectIds.length > 0) {
      for (const objectId of paintedObjectIds) {
        layer.resetObjectColor(objectId);
      }
    }
    if (viewer?.scene?.setObjectsXRayed && dimmedRefnos.length > 0) {
      viewer.scene.setObjectsXRayed(dimmedRefnos, false);
    }

    paintedObjectIds = [];
    dimmedRefnos = [];
    overlayState.activeMode = null;
    overlayState.paintedRefnoCount = 0;
    overlayState.paintedObjectCount = 0;
    overlayState.categoryCounts = {
      firezone_red: 0,
      firezone_yellow: 0,
      violation: 0,
      semi_auto: 0,
      reminder: 0,
    };
    overlayState.lastNotice = null;
    viewer?.requestRender?.();
  }

  async function applyOverlay(
    violations: UnifiedRuleViolation[],
    options: { mode: RuleCheckOverlayMode; xrayOthers?: boolean },
  ): Promise<{ paintedRefnos: number; paintedObjects: number }> {
    const xrayOthers = options.xrayOthers ?? overlayState.xrayOthers;
    overlayState.xrayOthers = xrayOthers;
    overlayState.applying = true;

    try {
      clearOverlay();

      const plan = planRuleCheckColorAssignments(violations, options.mode);
      const targetRefnos = Array.from(plan.refnoCategory.keys());
      if (targetRefnos.length === 0) {
        overlayState.lastNotice = options.mode === 'firezone'
          ? '当前结果中无带红/黄火灾分区标注的构件'
          : '当前结果中无涉事可着色构件';
        return { paintedRefnos: 0, paintedObjects: 0 };
      }

      const viewer = viewerContext.viewerRef.value as OverlayViewerLike | null;
      const layer = viewer?.__dtxLayer;
      if (!viewer || !layer?.setObjectColor || !layer.getAllObjectIds) {
        overlayState.lastNotice = '三维视口尚未就绪，暂无法应用着色覆盖层';
        return { paintedRefnos: 0, paintedObjects: 0 };
      }

      await spatialQuery.ensureRefnosLoaded(targetRefnos).catch(() => null);

      // 展开单元子树（如 BRAN / EQUI / ZONE），继承父级规划颜色但不覆盖更高级别叶子颜色
      const expandedCategory = new Map<string, RuleCheckOverlayCategory>(plan.refnoCategory);
      if (viewer.scene?.getSubtreeRefnos) {
        for (const [refno, cat] of plan.refnoCategory.entries()) {
          const prio = RULE_CHECK_OVERLAY_PALETTE[cat].priority;
          for (const childRaw of viewer.scene.getSubtreeRefnos([refno])) {
            const child = normalizeRuleRefnoToken(childRaw);
            if (!child) continue;
            const prev = expandedCategory.get(child);
            if (!prev || prio > RULE_CHECK_OVERLAY_PALETTE[prev].priority) {
              expandedCategory.set(child, cat);
            }
          }
        }
      }

      const colorCache: Record<RuleCheckOverlayCategory, Color> = {
        firezone_red: new Color(RULE_CHECK_OVERLAY_PALETTE.firezone_red.hex),
        firezone_yellow: new Color(RULE_CHECK_OVERLAY_PALETTE.firezone_yellow.hex),
        violation: new Color(RULE_CHECK_OVERLAY_PALETTE.violation.hex),
        semi_auto: new Color(RULE_CHECK_OVERLAY_PALETTE.semi_auto.hex),
        reminder: new Color(RULE_CHECK_OVERLAY_PALETTE.reminder.hex),
      };

      const matchedObjects: string[] = [];
      const matchedRefnos = new Set<string>();
      for (const objectId of layer.getAllObjectIds()) {
        const refno = extractRefnoFromDtxObjectId(objectId);
        if (!refno) continue;
        const cat = expandedCategory.get(refno);
        if (!cat) continue;
        layer.setObjectColor(objectId, colorCache[cat]);
        matchedObjects.push(objectId);
        matchedRefnos.add(refno);
      }

      paintedObjectIds = matchedObjects;
      const paintedRefnoList = Array.from(matchedRefnos);

      if (paintedRefnoList.length > 0) {
        viewer.scene?.ensureRefnos?.(paintedRefnoList);
        viewer.scene?.setObjectsVisible?.(paintedRefnoList, true);
      }

      if (xrayOthers && viewer.scene?.getLoadedRefnos && viewer.scene?.setObjectsXRayed) {
        const otherLoaded = viewer.scene
          .getLoadedRefnos()
          .map(normalizeRuleRefnoToken)
          .filter((r) => r && !matchedRefnos.has(r));
        if (otherLoaded.length > 0) {
          viewer.scene.setObjectsXRayed(otherLoaded, true);
          dimmedRefnos = otherLoaded;
        }
        if (paintedRefnoList.length > 0) {
          viewer.scene.setObjectsXRayed(paintedRefnoList, false);
        }
      }

      overlayState.activeMode = options.mode;
      overlayState.paintedRefnoCount = paintedRefnoList.length;
      overlayState.paintedObjectCount = matchedObjects.length;
      overlayState.categoryCounts = { ...plan.categoryRefnoCounts };
      overlayState.lastNotice = matchedObjects.length === 0
        ? `规划 ${targetRefnos.length} 个构件，当前场景尚未加载对应图元`
        : null;

      viewer.requestRender?.();
      return {
        paintedRefnos: paintedRefnoList.length,
        paintedObjects: matchedObjects.length,
      };
    } finally {
      overlayState.applying = false;
    }
  }

  return {
    overlayState,
    applyOverlay,
    clearOverlay,
  };
}

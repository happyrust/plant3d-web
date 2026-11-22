import { beforeEach, describe, expect, it, vi } from 'vitest';

const viewerContextStub = vi.hoisted(() => ({
  viewerRef: { value: null as unknown },
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => viewerContextStub,
}));

const spatialQueryStub = vi.hoisted(() => ({
  ensureRefnosLoaded: vi.fn(async () => ({ ok: [], fail: [] })),
}));

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => spatialQueryStub,
}));

import {
  extractRefnoFromDtxObjectId,
  planRuleCheckColorAssignments,
  resetRuleCheckOverlayStore,
  RULE_CHECK_OVERLAY_PALETTE,
  useRuleCheckOverlay,
} from './useRuleCheckOverlay';

import type { UnifiedRuleViolation } from '@/api/ruleCheckApi';

function makeViolation(partial: Partial<UnifiedRuleViolation>): UnifiedRuleViolation {
  return {
    key: partial.key ?? 'k1',
    engine: partial.engine ?? 'attrs',
    ruleId: partial.ruleId ?? 'ELEC-282',
    issue: partial.issue ?? 282,
    discipline: partial.discipline ?? '电气',
    title: partial.title ?? '火灾分区',
    requirement: partial.requirement ?? '红黄标注',
    sourceLabel: partial.sourceLabel ?? 'CTRAY 24381_10',
    targetLabel: partial.targetLabel ?? '-',
    severity: partial.severity ?? 'violation',
    highlightColor: partial.highlightColor,
    highlightRefnos: partial.highlightRefnos ?? ['24381_10'],
    detail: partial.detail ?? 'detail',
  };
}

describe('useRuleCheckOverlay', () => {
  beforeEach(() => {
    resetRuleCheckOverlayStore();
    viewerContextStub.viewerRef.value = null;
    spatialQueryStub.ensureRefnosLoaded.mockReset().mockResolvedValue({ ok: [], fail: [] });
  });

  it('extracts normalized refno from DTX objectId patterns', () => {
    expect(extractRefnoFromDtxObjectId('o:24381_10:0')).toBe('24381_10');
    expect(extractRefnoFromDtxObjectId('o:24381/10:2')).toBe('24381_10');
    expect(extractRefnoFromDtxObjectId('24381_99')).toBe('24381_99');
  });

  it('resolves priority red > yellow > violation > semi_auto > reminder and filters firezone mode', () => {
    const list: UnifiedRuleViolation[] = [
      makeViolation({ key: '1', severity: 'reminder', highlightRefnos: ['24381_1'] }),
      makeViolation({ key: '2', highlightColor: 'yellow', highlightRefnos: ['24381_1', '24381_2'] }),
      makeViolation({ key: '3', highlightColor: 'red', highlightRefnos: ['24381_1'] }),
      makeViolation({ key: '4', severity: 'semi_auto', highlightRefnos: ['24381_3'] }),
    ];

    const firezonePlan = planRuleCheckColorAssignments(list, 'firezone');
    expect(firezonePlan.refnoCategory.get('24381_1')).toBe('firezone_red');
    expect(firezonePlan.refnoCategory.get('24381_2')).toBe('firezone_yellow');
    expect(firezonePlan.refnoCategory.has('24381_3')).toBe(false);
    expect(firezonePlan.categoryRefnoCounts.firezone_red).toBe(1);
    expect(firezonePlan.categoryRefnoCounts.firezone_yellow).toBe(1);

    const allPlan = planRuleCheckColorAssignments(list, 'all');
    expect(allPlan.refnoCategory.get('24381_3')).toBe('semi_auto');
    expect(allPlan.categoryRefnoCounts.semi_auto).toBe(1);
  });

  it('applies non-destructive DTXLayer color overrides with subtree expansion, X-Ray dim, and exact restore', async () => {
    const painted = new Map<string, string>();
    const setObjectColor = vi.fn((objectId: string, color: { getHexString: () => string }) => {
      painted.set(objectId, `#${color.getHexString()}`);
    });
    const resetObjectColor = vi.fn((objectId: string) => {
      painted.delete(objectId);
    });
    const setObjectsVisible = vi.fn();
    const setObjectsXRayed = vi.fn();
    const ensureRefnos = vi.fn();
    const requestRender = vi.fn();

    viewerContextStub.viewerRef.value = {
      __dtxLayer: {
        getAllObjectIds: () => ['o:24381_10:0', 'o:24381_10:1', 'o:24381_11:0', 'o:24381_20:0', 'o:24381_99:0'],
        setObjectColor,
        resetObjectColor,
      },
      requestRender,
      scene: {
        getLoadedRefnos: () => ['24381_10', '24381_11', '24381_20', '24381_99'],
        getSubtreeRefnos: (refnos: string[]) => (refnos.includes('24381_10') ? ['24381_10', '24381_11'] : refnos),
        ensureRefnos,
        setObjectsVisible,
        setObjectsXRayed,
      },
    };

    const { overlayState, applyOverlay, clearOverlay } = useRuleCheckOverlay();
    const result = await applyOverlay(
      [
        makeViolation({ key: 'r1', highlightColor: 'red', highlightRefnos: ['24381_10'] }),
        makeViolation({ key: 'y1', highlightColor: 'yellow', highlightRefnos: ['24381_20'] }),
      ],
      { mode: 'firezone', xrayOthers: true },
    );

    expect(result).toEqual({ paintedRefnos: 3, paintedObjects: 4 });
    expect(overlayState.activeMode).toBe('firezone');
    expect(painted.get('o:24381_10:0')).toBe(RULE_CHECK_OVERLAY_PALETTE.firezone_red.hex);
    expect(painted.get('o:24381_11:0')).toBe(RULE_CHECK_OVERLAY_PALETTE.firezone_red.hex);
    expect(painted.get('o:24381_20:0')).toBe(RULE_CHECK_OVERLAY_PALETTE.firezone_yellow.hex);
    expect(painted.has('o:24381_99:0')).toBe(false);
    expect(setObjectsXRayed).toHaveBeenCalledWith(['24381_99'], true);
    expect(setObjectsXRayed).toHaveBeenCalledWith(['24381_10', '24381_11', '24381_20'], false);
    expect(requestRender).toHaveBeenCalled();

    clearOverlay();
    expect(resetObjectColor).toHaveBeenCalledTimes(4);
    expect(painted.size).toBe(0);
    expect(setObjectsXRayed).toHaveBeenLastCalledWith(['24381_99'], false);
    expect(overlayState.activeMode).toBeNull();
    expect(overlayState.paintedObjectCount).toBe(0);
  });
});

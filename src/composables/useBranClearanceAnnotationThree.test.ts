import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import {
  BRAN_CLEARANCE_ANNOTATION_PREFIX,
  formatBranClearanceDistanceLabel,
  makeBranClearanceAnnotationId,
  useBranClearanceAnnotationThree,
} from './useBranClearanceAnnotationThree';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { BranNearestClearanceAnnotationCandidate } from './useSpatialCompute';

function candidate(
  targetGroup: string,
  refno: string,
  index: number,
  annotation: BranNearestClearanceAnnotationCandidate['candidate']['annotation'],
): BranNearestClearanceAnnotationCandidate {
  return {
    targetGroup,
    index,
    candidate: {
      refno,
      noun: targetGroup === 'wall' ? 'WALL' : 'COLU',
      distance_mm: Number(annotation?.label_mm ?? 0),
      annotation,
    },
  };
}

function createAnnotationSystemMock() {
  const annotations = shallowRef<Map<string, unknown>>(new Map());
  const materials = {
    yellow: { name: 'yellow' },
  };
  const addAnnotation = vi.fn((id: string, annotation: unknown) => {
    annotations.value.set(id, annotation);
    annotations.value = new Map(annotations.value);
  });
  const removeAnnotation = vi.fn((id: string) => {
    annotations.value.delete(id);
    annotations.value = new Map(annotations.value);
  });

  return {
    system: {
      annotations,
      materials,
      addAnnotation,
      removeAnnotation,
    } as unknown as UseAnnotationThreeReturn,
    addAnnotation,
    removeAnnotation,
  };
}

describe('useBranClearanceAnnotationThree', () => {
  it('reports candidates as skipped while the dimension renderer is absent', () => {
    const { system, addAnnotation } = createAnnotationSystemMock();
    const requestRender = vi.fn();
    const adapter = useBranClearanceAnnotationThree(system, { requestRender });

    const result = adapter.renderAnnotations([
      candidate('wall', '24381/target-1', 0, {
        start_point: { x: 1, y: 2, z: 3 },
        end_point: { x: 4, y: 5, z: 6 },
        label_mm: 1200,
      }),
    ]);

    expect(result.drawnIds).toEqual([]);
    expect(result.skipped).toEqual([
      {
        id: 'bran_clearance_wall_24381_target_1_0',
        reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
      },
    ]);
    expect(addAnnotation).not.toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalled();
  });

  it('clears stale BRAN namespace annotations without touching unrelated annotations', () => {
    const { system, addAnnotation, removeAnnotation } = createAnnotationSystemMock();
    system.annotations.value.set('manual_dimension_1', {});
    system.annotations.value.set('bran_clearance_wall_old_0', {});
    const adapter = useBranClearanceAnnotationThree(system, { requestRender: vi.fn() });

    const result = adapter.renderAnnotations([
      candidate('column', '24381_2', 0, {
        start_point: { x: 0, y: 0, z: 0 },
        end_point: { x: 1, y: 0, z: 0 },
        label_mm: 1,
      }),
    ]);

    expect(result).toEqual({
      drawnIds: [],
      skipped: [{
        id: 'bran_clearance_column_24381_2_0',
        reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
      }],
    });
    expect(addAnnotation).not.toHaveBeenCalled();
    expect(removeAnnotation).toHaveBeenCalledWith('bran_clearance_wall_old_0');
    expect(removeAnnotation).not.toHaveBeenCalledWith('manual_dimension_1');
    expect(system.annotations.value.has('manual_dimension_1')).toBe(true);
    expect(system.annotations.value.has('bran_clearance_column_24381_2_0')).toBe(false);
  });

  it('reports every candidate as skipped regardless of geometry completeness', () => {
    const { system, addAnnotation } = createAnnotationSystemMock();
    const adapter = useBranClearanceAnnotationThree(system, { requestRender: vi.fn() });

    const result = adapter.renderAnnotations([
      candidate('wall', 'missing-start', 0, {
        start_point: undefined as any,
        end_point: { x: 1, y: 1, z: 1 },
        label_mm: 1,
      }),
      candidate('column', 'zero', 1, {
        start_point: { x: 7, y: 8, z: 9 },
        end_point: { x: 7, y: 8, z: 9 },
        label_mm: 0,
      }),
    ]);

    expect(result.drawnIds).toEqual([]);
    expect(result.skipped).toEqual([
      {
        id: 'bran_clearance_wall_missing_start_0',
        reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
      },
      {
        id: 'bran_clearance_column_zero_1',
        reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
      },
    ]);
    expect(addAnnotation).not.toHaveBeenCalled();
  });

  it('generates stable sanitized collision-free IDs and matching distance labels', () => {
    expect(makeBranClearanceAnnotationId('wall/pipe', '24381/145018', 2))
      .toBe('bran_clearance_wall_pipe_24381_145018_2');
    expect(makeBranClearanceAnnotationId('wall', 'same-refno', 0))
      .not.toBe(makeBranClearanceAnnotationId('column', 'same-refno', 0));
    expect(makeBranClearanceAnnotationId('wall', 'same-refno', 0))
      .not.toBe(makeBranClearanceAnnotationId('wall', 'same-refno', 1));
    expect(makeBranClearanceAnnotationId('wall', 'same-refno', 0))
      .toBe(makeBranClearanceAnnotationId('wall', 'same-refno', 0));
    expect(makeBranClearanceAnnotationId('wall', 'same-refno', 0).startsWith(BRAN_CLEARANCE_ANNOTATION_PREFIX))
      .toBe(true);
    expect(formatBranClearanceDistanceLabel(1234.5)).toBe('1235mm');
    expect(formatBranClearanceDistanceLabel(0)).toBe('0mm');
  });
});

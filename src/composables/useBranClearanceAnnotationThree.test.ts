import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import {
  BRAN_CLEARANCE_ANNOTATION_PREFIX,
  formatBranClearanceDistanceLabel,
  makeBranClearanceAnnotationId,
  useBranClearanceAnnotationThree,
} from './useBranClearanceAnnotationThree';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { BranNearestClearanceAnnotationCandidate } from './useSpatialCompute';

const { constructedDimensions } = vi.hoisted(() => ({
  constructedDimensions: [] as MockLinearDimension3D[],
}));

type MockLinearDimension3D = {
  materials: unknown;
  params: any;
  materialSet: unknown;
  backgroundColor: unknown;
  setMaterialSet: (materialSet: unknown) => void;
  setBackgroundColor: (color: unknown) => void;
};

vi.mock('@/utils/three/annotation', () => {
  class LinearDimension3D {
    readonly materials: unknown;
    readonly params: any;
    materialSet: unknown = null;
    backgroundColor: unknown = null;

    constructor(materials: unknown, params: any) {
      this.materials = materials;
      this.params = params;
      constructedDimensions.push(this);
    }

    setMaterialSet(materialSet: unknown): void {
      this.materialSet = materialSet;
    }

    setBackgroundColor(color: unknown): void {
      this.backgroundColor = color;
    }
  }

  return { LinearDimension3D };
});

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
  beforeEach(() => {
    constructedDimensions.length = 0;
  });

  it('renders LinearDimension3D annotations from backend points and labels', () => {
    const { system, addAnnotation } = createAnnotationSystemMock();
    const requestRender = vi.fn();
    const adapter = useBranClearanceAnnotationThree(system, { requestRender });

    const result = adapter.renderAnnotations([
      candidate('wall', '24381/target-1', 0, {
        start_point: { x: 1, y: 2, z: 3 },
        end_point: { x: 4, y: 5, z: 6 },
        label_mm: 1200.4,
      }),
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.drawnIds).toEqual(['bran_clearance_wall_24381_target_1_0']);
    expect(addAnnotation).toHaveBeenCalledWith(
      'bran_clearance_wall_24381_target_1_0',
      constructedDimensions[0],
    );
    expect(constructedDimensions[0]?.params.start.toArray()).toEqual([1, 2, 3]);
    expect(constructedDimensions[0]?.params.end.toArray()).toEqual([4, 5, 6]);
    expect(constructedDimensions[0]?.params.text).toBe('1200mm');
    expect(constructedDimensions[0]?.params.unit).toBe('mm');
    expect(requestRender).toHaveBeenCalled();
  });

  it('clears stale BRAN namespace annotations without touching unrelated annotations', () => {
    const { system, removeAnnotation } = createAnnotationSystemMock();
    system.annotations.value.set('manual_dimension_1', {});
    system.annotations.value.set('bran_clearance_wall_old_0', {});
    const adapter = useBranClearanceAnnotationThree(system, { requestRender: vi.fn() });

    adapter.renderAnnotations([
      candidate('column', '24381_2', 0, {
        start_point: { x: 0, y: 0, z: 0 },
        end_point: { x: 1, y: 0, z: 0 },
        label_mm: 1,
      }),
    ]);
    adapter.renderAnnotations([
      candidate('wall', '24381_3', 0, {
        start_point: { x: 0, y: 0, z: 0 },
        end_point: { x: 2, y: 0, z: 0 },
        label_mm: 2,
      }),
    ]);

    expect(removeAnnotation).toHaveBeenCalledWith('bran_clearance_wall_old_0');
    expect(removeAnnotation).toHaveBeenCalledWith('bran_clearance_column_24381_2_0');
    expect(removeAnnotation).not.toHaveBeenCalledWith('manual_dimension_1');
    expect(system.annotations.value.has('manual_dimension_1')).toBe(true);
    expect(system.annotations.value.has('bran_clearance_wall_24381_3_0')).toBe(true);
  });

  it('skips incomplete candidates safely and renders zero-distance candidates', () => {
    const { system } = createAnnotationSystemMock();
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

    expect(result.drawnIds).toEqual(['bran_clearance_column_zero_1']);
    expect(result.skipped).toEqual([
      {
        id: 'bran_clearance_wall_missing_start_0',
        reason: 'Missing annotation start_point or end_point',
      },
    ]);
    expect(constructedDimensions).toHaveLength(1);
    expect(constructedDimensions[0]?.params.text).toBe('0mm');
    expect(constructedDimensions[0]?.params.direction.toArray()).toEqual([0, 1, 0]);
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

import { describe, it, expect, beforeEach } from 'vitest';

import { useReviewStore } from './useReviewStore';
import { useToolStore } from './useToolStore';

describe('useReviewStore - confirm without OBB', () => {
  beforeEach(() => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();
    reviewStore.clearConfirmedRecords();
    toolStore.clearAll();
  });

  it('should not include obbAnnotations in confirmed records', () => {
    const reviewStore = useReviewStore();
    const toolStore = useToolStore();

    toolStore.addAnnotation({
      id: 'text-1',
      entityId: 'entity-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'Text annotation',
      createdAt: Date.now(),
    });

    toolStore.addCloudAnnotation({
      id: 'cloud-1',
      anchorWorldPos: [1, 1, 1],
      screenSpacePoints: [[100, 100], [200, 200]],
      visible: true,
      title: 'Cloud annotation',
      description: '',
      createdAt: Date.now(),
    });

    toolStore.addRectAnnotation({
      id: 'rect-1',
      obb: {
        center: [2, 2, 2],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [0.5, 0.5, 0.5],
        corners: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      },
      anchorWorldPos: [2, 2, 2],
      visible: true,
      title: 'Rect annotation',
      description: '',
      createdAt: Date.now(),
    });

    reviewStore.addConfirmedRecord({
      type: 'batch',
      annotations: [...toolStore.annotations.value],
      cloudAnnotations: [...toolStore.cloudAnnotations.value],
      rectAnnotations: [...toolStore.rectAnnotations.value],
      measurements: [],
      note: 'Test batch',
    });

    const confirmed = reviewStore.confirmedRecords.value;
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].annotations).toHaveLength(1);
    expect(confirmed[0].cloudAnnotations).toHaveLength(1);
    expect(confirmed[0].rectAnnotations).toHaveLength(1);
    expect('obbAnnotations' in confirmed[0]).toBe(false);
  });
});

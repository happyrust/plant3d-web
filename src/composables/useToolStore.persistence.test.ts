import { describe, it, expect, beforeEach } from 'vitest';

import { useToolStore } from './useToolStore';

describe('useToolStore - persistence', () => {
  beforeEach(() => {
    const store = useToolStore();
    store.clearAll();
  });

  it('should maintain text/cloud/rect annotations in memory', () => {
    const store = useToolStore();

    store.addAnnotation({
      id: 'text-1',
      entityId: 'entity-1',
      worldPos: [1, 2, 3],
      visible: true,
      glyph: '1',
      title: 'Text',
      createdAt: Date.now(),
    });

    store.addCloudAnnotation({
      id: 'cloud-1',
      anchorWorldPos: [4, 5, 6],
      screenSpacePoints: [[100, 100], [200, 200]],
      visible: true,
      title: 'Cloud',
      description: '',
      createdAt: Date.now(),
    });

    store.addRectAnnotation({
      id: 'rect-1',
      obb: {
        center: [7, 8, 9],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [1, 1, 1],
        corners: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      },
      anchorWorldPos: [7, 8, 9],
      visible: true,
      title: 'Rect',
      description: '',
      createdAt: Date.now(),
    });

    expect(store.annotations.value).toHaveLength(1);
    expect(store.cloudAnnotations.value).toHaveLength(1);
    expect(store.rectAnnotations.value).toHaveLength(1);
    expect(store.annotations.value[0].worldPos).toEqual([1, 2, 3]);
    expect(store.cloudAnnotations.value[0].screenSpacePoints).toEqual([[100, 100], [200, 200]]);
    expect(store.rectAnnotations.value[0].obb.center).toEqual([7, 8, 9]);
  });
});

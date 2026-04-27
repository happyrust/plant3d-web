import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: { value: null } }),
}));

import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

function createCloudAnnotation(overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id: 'cloud-1',
    objectIds: ['obj-1'],
    anchorWorldPos: [1, 2, 3],
    visible: true,
    title: '云线批注',
    description: '管线间距不足',
    createdAt: 1777041600000,
    ...overrides,
  };
}

describe('useToolStore annotation screenshots', () => {
  beforeEach(() => {
    const store = useToolStore();
    store.clearAllAnnotations();
  });

  it('normalizes legacy cloud thumbnailUrl into canonical screenshot', () => {
    const store = useToolStore();

    store.addCloudAnnotation(createCloudAnnotation({
      thumbnailUrl: 'https://example.com/legacy.png',
      attachmentId: 'att-legacy',
    }));

    expect(store.getAnnotationScreenshot('cloud', 'cloud-1')).toEqual({
      url: 'https://example.com/legacy.png',
      attachmentId: 'att-legacy',
    });
  });

  it('mirrors canonical cloud screenshot to legacy thumbnail fields while setting', () => {
    const store = useToolStore();
    store.addCloudAnnotation(createCloudAnnotation());

    const updated = store.setAnnotationScreenshot('cloud', 'cloud-1', {
      url: 'https://example.com/new.png',
      attachmentId: 'att-new',
      name: 'new.png',
      capturedAt: 1777041600100,
    });

    const cloud = store.cloudAnnotations.value.find((item) => item.id === 'cloud-1');
    expect(updated).toBe(true);
    expect(cloud?.screenshot).toEqual({
      url: 'https://example.com/new.png',
      attachmentId: 'att-new',
      name: 'new.png',
      capturedAt: 1777041600100,
    });
    expect(cloud?.thumbnailUrl).toBe('https://example.com/new.png');
    expect(cloud?.attachmentId).toBe('att-new');
  });

  it('clears both canonical and legacy cloud screenshot fields', () => {
    const store = useToolStore();
    store.addCloudAnnotation(createCloudAnnotation({
      thumbnailUrl: 'https://example.com/old.png',
      attachmentId: 'att-old',
      screenshot: {
        url: 'https://example.com/old.png',
        attachmentId: 'att-old',
      },
    }));

    const cleared = store.clearAnnotationScreenshot('cloud', 'cloud-1');

    const cloud = store.cloudAnnotations.value.find((item) => item.id === 'cloud-1');
    expect(cleared).toBe(true);
    expect(cloud?.screenshot).toBeUndefined();
    expect(cloud?.thumbnailUrl).toBeUndefined();
    expect(cloud?.attachmentId).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('annotationWorkspaceModel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels OBB annotations as auxiliary evidence because backend gate does not check them yet', async () => {
    const { getAnnotationWorkspaceTypeDisplay } = await import('./annotationWorkspaceModel');
    const display = getAnnotationWorkspaceTypeDisplay('obb');

    expect(display.label).toBe('包围盒（辅助证据）');
    expect(display.tone).toContain('fuchsia');
  });

  it('derives screenshot fields from legacy cloud thumbnailUrl', async () => {
    const { buildAnnotationWorkspaceItems } = await import('./annotationWorkspaceModel');

    const [item] = buildAnnotationWorkspaceItems({
      annotations: [],
      rectAnnotations: [],
      obbAnnotations: [],
      cloudAnnotations: [{
        id: 'cloud-1',
        objectIds: ['obj-1'],
        anchorWorldPos: [1, 2, 3],
        visible: true,
        title: '云线批注',
        description: '管线间距不足',
        createdAt: 1777041600000,
        thumbnailUrl: 'https://example.com/cloud.png',
        attachmentId: 'att-cloud',
      }],
    });

    expect(item.thumbnailUrl).toBe('https://example.com/cloud.png');
    expect(item.screenshot).toEqual({
      url: 'https://example.com/cloud.png',
      attachmentId: 'att-cloud',
    });
  });
});

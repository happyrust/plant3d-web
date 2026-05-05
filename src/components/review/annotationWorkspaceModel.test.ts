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

  it('formats linked measurement summaries with user-readable refnos', async () => {
    const { buildLinkedMeasurementItems } = await import('./annotationWorkspaceModel');

    const linked = buildLinkedMeasurementItems(
      {
        id: 'anno-1',
        type: 'text',
        title: '批注',
        description: '',
        createdAt: 1,
        activityAt: 1,
        visible: true,
        refnos: [],
        commentCount: 0,
        statusKey: 'pending',
        statusLabel: '待处理',
        statusTone: 'tone',
        priority: 'low',
        priorityLabel: '未设置',
        priorityTone: 'tone',
      },
      [{
        id: 'classic-distance',
        kind: 'distance',
        origin: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 0] },
        target: { entityId: '24381_145019', worldPos: [1, 0, 0] },
        visible: true,
        createdAt: 10,
        sourceAnnotationId: 'anno-1',
        sourceAnnotationType: 'text',
      }],
      [{
        id: 'xeokit-angle',
        kind: 'angle',
        origin: { entityId: 'pe:=24381/145020', worldPos: [0, 0, 0] },
        corner: { entityId: '<24381/145021>', worldPos: [1, 0, 0] },
        target: { entityId: '24381_145022', worldPos: [1, 1, 0] },
        visible: true,
        approximate: false,
        createdAt: 20,
        sourceAnnotationId: 'anno-1',
        sourceAnnotationType: 'text',
      }],
    );

    expect(linked.map((item) => item.summary)).toEqual([
      '角度 · 起点 24381/145020 -> 拐点 24381/145021 -> 终点 24381/145022',
      '距离 · 起点 24381/145018 -> 终点 24381/145019',
    ]);
  });

  describe('scopeAnnotationWorkspaceItemsByFormId', () => {
    type AnnotationWorkspaceItem = import('./annotationWorkspaceModel').AnnotationWorkspaceItem;

    function makeItem(partial: Partial<AnnotationWorkspaceItem> & { id: string }): AnnotationWorkspaceItem {
      return {
        id: partial.id,
        type: 'text',
        title: partial.title ?? '批注',
        description: partial.description ?? '',
        createdAt: partial.createdAt ?? 1,
        activityAt: partial.activityAt ?? 1,
        visible: partial.visible ?? true,
        refnos: partial.refnos ?? [],
        formId: partial.formId,
        commentCount: partial.commentCount ?? 0,
        statusKey: partial.statusKey ?? 'pending',
        statusLabel: partial.statusLabel ?? '待处理',
        statusTone: partial.statusTone ?? 'tone',
        priority: partial.priority ?? 'low',
        priorityLabel: partial.priorityLabel ?? '未设置',
        priorityTone: partial.priorityTone ?? 'tone',
      };
    }

    it('returns only items matching the given formId by default and excludes unbound items', async () => {
      const { scopeAnnotationWorkspaceItemsByFormId } = await import('./annotationWorkspaceModel');

      const items: AnnotationWorkspaceItem[] = [
        makeItem({ id: 'a-1', formId: 'FORM-1' }),
        makeItem({ id: 'a-2', formId: 'FORM-2' }),
        makeItem({ id: 'a-3' }),
      ];

      const scoped = scopeAnnotationWorkspaceItemsByFormId(items, 'FORM-1');
      expect(scoped.map((item) => item.id)).toEqual(['a-1']);
    });

    it('keeps unbound items only when includeUnbound=true is passed', async () => {
      const { scopeAnnotationWorkspaceItemsByFormId } = await import('./annotationWorkspaceModel');

      const items: AnnotationWorkspaceItem[] = [
        makeItem({ id: 'a-1', formId: 'FORM-1' }),
        makeItem({ id: 'a-2', formId: 'FORM-2' }),
        makeItem({ id: 'a-3' }),
      ];

      const scoped = scopeAnnotationWorkspaceItemsByFormId(items, 'FORM-1', { includeUnbound: true });
      expect(scoped.map((item) => item.id)).toEqual(['a-1', 'a-3']);
    });

    it('returns all items unchanged when no formId is provided', async () => {
      const { scopeAnnotationWorkspaceItemsByFormId } = await import('./annotationWorkspaceModel');

      const items: AnnotationWorkspaceItem[] = [
        makeItem({ id: 'a-1', formId: 'FORM-1' }),
        makeItem({ id: 'a-2' }),
      ];

      expect(scopeAnnotationWorkspaceItemsByFormId(items).map((item) => item.id)).toEqual(['a-1', 'a-2']);
      expect(scopeAnnotationWorkspaceItemsByFormId(items, '').map((item) => item.id)).toEqual(['a-1', 'a-2']);
      expect(scopeAnnotationWorkspaceItemsByFormId(items, null).map((item) => item.id)).toEqual(['a-1', 'a-2']);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

function makeCloud(id: string, overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id,
    objectIds: ['obj-1'],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `cloud-${id}`,
    description: 'desc',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function clearStorage() {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
}

describe('useToolStore · cloud annotation collapsed', () => {
  beforeEach(() => {
    clearStorage();
  });
  afterEach(() => {
    clearStorage();
  });

  it('addCloudAnnotation 不带 collapsed 时 normalize 默认填 false', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.addCloudAnnotation(makeCloud('c1'));
    const persisted = store.cloudAnnotations.value.find((c) => c.id === 'c1');
    expect(persisted).toBeDefined();
    expect(persisted!.collapsed).toBe(false);
  });

  it('addCloudAnnotation 带 collapsed=true 被保留', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.addCloudAnnotation(makeCloud('c2', { collapsed: true }));
    const persisted = store.cloudAnnotations.value.find((c) => c.id === 'c2');
    expect(persisted?.collapsed).toBe(true);
  });

  it('setCloudAnnotationsCollapsed 切换多条云线 collapsed 状态', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.addCloudAnnotation(makeCloud('c1'));
    store.addCloudAnnotation(makeCloud('c2'));
    store.addCloudAnnotation(makeCloud('c3'));

    store.setCloudAnnotationsCollapsed(['c1', 'c3'], true);
    const snapshot1 = store.cloudAnnotations.value.reduce<Record<string, boolean | undefined>>((acc, c) => {
      acc[c.id] = c.collapsed;
      return acc;
    }, {});
    expect(snapshot1).toMatchObject({ c1: true, c2: false, c3: true });

    store.setCloudAnnotationsCollapsed(['c1'], false);
    const snapshot2 = store.cloudAnnotations.value.reduce<Record<string, boolean | undefined>>((acc, c) => {
      acc[c.id] = c.collapsed;
      return acc;
    }, {});
    expect(snapshot2).toMatchObject({ c1: false, c2: false, c3: true });
  });

  it('setCloudAnnotationsCollapsed 传入空 / 空字符串 ids 不影响现有云线', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.addCloudAnnotation(makeCloud('c1', { collapsed: true }));

    store.setCloudAnnotationsCollapsed([], false);
    expect(store.cloudAnnotations.value.find((c) => c.id === 'c1')?.collapsed).toBe(true);

    store.setCloudAnnotationsCollapsed(['  ', ''], false);
    expect(store.cloudAnnotations.value.find((c) => c.id === 'c1')?.collapsed).toBe(true);
  });

  it('setCloudAnnotationsCollapsed 不影响文字批注的 collapsed 字段', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.annotations.value = [];
    store.addAnnotation({
      id: 't1',
      entityId: 'ent-1',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: 'text',
      description: 'desc',
      createdAt: 1_700_000_000_000,
      collapsed: false,
    });
    store.addCloudAnnotation(makeCloud('c1'));

    store.setCloudAnnotationsCollapsed(['c1', 't1'], true);

    expect(store.cloudAnnotations.value.find((c) => c.id === 'c1')?.collapsed).toBe(true);
    expect(store.annotations.value.find((a) => a.id === 't1')?.collapsed).toBe(false);
  });
});

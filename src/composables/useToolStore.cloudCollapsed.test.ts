import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  useToolStore,
  type CloudAnnotationRecord,
  type ObbAnnotationRecord,
  type Obb,
  type RectAnnotationRecord,
} from './useToolStore';

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

function makeObb(): Obb {
  return {
    center: [0, 0, 0],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    halfSize: [1, 1, 1],
    corners: [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ],
  };
}

function makeRect(id: string, overrides: Partial<RectAnnotationRecord> = {}): RectAnnotationRecord {
  return {
    id,
    objectIds: ['obj-1'],
    obb: makeObb(),
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `rect-${id}`,
    description: 'desc',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeObbAnnotation(id: string, overrides: Partial<ObbAnnotationRecord> = {}): ObbAnnotationRecord {
  return {
    id,
    objectIds: ['obj-1'],
    obb: makeObb(),
    labelWorldPos: [0, 0, 0],
    anchor: { kind: 'top_center' },
    visible: true,
    title: `obb-${id}`,
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

describe('useToolStore · rect annotation collapsed', () => {
  beforeEach(() => {
    clearStorage();
  });
  afterEach(() => {
    clearStorage();
  });

  it('addRectAnnotation 不带 collapsed 时 normalize 默认填 false', () => {
    const store = useToolStore();
    store.rectAnnotations.value = [];
    store.addRectAnnotation(makeRect('r1'));
    const persisted = store.rectAnnotations.value.find((r) => r.id === 'r1');
    expect(persisted?.collapsed).toBe(false);
  });

  it('addRectAnnotation 带 collapsed=true 被保留', () => {
    const store = useToolStore();
    store.rectAnnotations.value = [];
    store.addRectAnnotation(makeRect('r2', { collapsed: true }));
    expect(store.rectAnnotations.value.find((r) => r.id === 'r2')?.collapsed).toBe(true);
  });

  it('setRectAnnotationsCollapsed 切换多条矩形 collapsed 状态', () => {
    const store = useToolStore();
    store.rectAnnotations.value = [];
    store.addRectAnnotation(makeRect('r1'));
    store.addRectAnnotation(makeRect('r2'));

    store.setRectAnnotationsCollapsed(['r1'], true);
    expect(store.rectAnnotations.value.find((r) => r.id === 'r1')?.collapsed).toBe(true);
    expect(store.rectAnnotations.value.find((r) => r.id === 'r2')?.collapsed).toBe(false);

    store.setRectAnnotationsCollapsed(['r1', 'r2'], true);
    expect(store.rectAnnotations.value.every((r) => r.collapsed === true)).toBe(true);

    store.setRectAnnotationsCollapsed(['r1'], false);
    expect(store.rectAnnotations.value.find((r) => r.id === 'r1')?.collapsed).toBe(false);
    expect(store.rectAnnotations.value.find((r) => r.id === 'r2')?.collapsed).toBe(true);
  });

  it('setRectAnnotationsCollapsed 不影响云线 / 文字批注 collapsed', () => {
    const store = useToolStore();
    store.rectAnnotations.value = [];
    store.cloudAnnotations.value = [];
    store.addRectAnnotation(makeRect('r1'));
    store.addCloudAnnotation(makeCloud('c1', { collapsed: false }));

    store.setRectAnnotationsCollapsed(['r1', 'c1'], true);

    expect(store.rectAnnotations.value.find((r) => r.id === 'r1')?.collapsed).toBe(true);
    expect(store.cloudAnnotations.value.find((c) => c.id === 'c1')?.collapsed).toBe(false);
  });
});

describe('useToolStore · obb annotation collapsed', () => {
  beforeEach(() => {
    clearStorage();
  });
  afterEach(() => {
    clearStorage();
  });

  it('addObbAnnotation 不带 collapsed 时 normalize 默认填 false', () => {
    const store = useToolStore();
    store.obbAnnotations.value = [];
    store.addObbAnnotation(makeObbAnnotation('o1'));
    expect(store.obbAnnotations.value.find((o) => o.id === 'o1')?.collapsed).toBe(false);
  });

  it('addObbAnnotation 带 collapsed=true 被保留', () => {
    const store = useToolStore();
    store.obbAnnotations.value = [];
    store.addObbAnnotation(makeObbAnnotation('o2', { collapsed: true }));
    expect(store.obbAnnotations.value.find((o) => o.id === 'o2')?.collapsed).toBe(true);
  });

  it('setObbAnnotationsCollapsed 切换多条 OBB collapsed 状态', () => {
    const store = useToolStore();
    store.obbAnnotations.value = [];
    store.addObbAnnotation(makeObbAnnotation('o1'));
    store.addObbAnnotation(makeObbAnnotation('o2'));

    store.setObbAnnotationsCollapsed(['o1', 'o2'], true);
    expect(store.obbAnnotations.value.every((o) => o.collapsed === true)).toBe(true);

    store.setObbAnnotationsCollapsed(['o2'], false);
    expect(store.obbAnnotations.value.find((o) => o.id === 'o1')?.collapsed).toBe(true);
    expect(store.obbAnnotations.value.find((o) => o.id === 'o2')?.collapsed).toBe(false);
  });

  it('setObbAnnotationsCollapsed 不影响其它三类批注 collapsed', () => {
    const store = useToolStore();
    store.obbAnnotations.value = [];
    store.cloudAnnotations.value = [];
    store.rectAnnotations.value = [];
    store.addObbAnnotation(makeObbAnnotation('o1'));
    store.addRectAnnotation(makeRect('r1'));
    store.addCloudAnnotation(makeCloud('c1'));

    store.setObbAnnotationsCollapsed(['o1', 'r1', 'c1'], true);

    expect(store.obbAnnotations.value.find((o) => o.id === 'o1')?.collapsed).toBe(true);
    expect(store.rectAnnotations.value.find((r) => r.id === 'r1')?.collapsed).toBe(false);
    expect(store.cloudAnnotations.value.find((c) => c.id === 'c1')?.collapsed).toBe(false);
  });
});

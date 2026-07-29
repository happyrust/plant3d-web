import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveCloudBindings,
  findCloudAnnotationsByMemberRefnos,
  getCloudMemberRefnos,
  useToolStore,
  type CloudAnnotationRecord,
} from './useToolStore';

const CREATED_AT = 1_700_000_000_000;

function makeCloud(id: string, overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id,
    objectIds: ['obj-1'],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `cloud-${id}`,
    description: 'desc',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function clearStorage() {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
}

describe('deriveCloudBindings', () => {
  it('旧记录由 anchorRefno + refnos 推导出带角色的 bindings', () => {
    const bindings = deriveCloudBindings(makeCloud('c1', {
      anchorRefno: '=24381/145018',
      refnos: ['=24381/145019', '=24381/145020'],
    }));

    expect(bindings).toEqual([
      { refno: '=24381/145018', role: 'anchor', createdAt: CREATED_AT },
      { refno: '=24381/145019', role: 'member', createdAt: CREATED_AT },
      { refno: '=24381/145020', role: 'member', createdAt: CREATED_AT },
    ]);
  });

  it('锚点同时也是目标元素时产生两条记录，与旧字段无损互换', () => {
    const record = makeCloud('c2', {
      anchorRefno: '=24381/145018',
      refnos: ['=24381/145018', '=24381/145019'],
    });
    const bindings = deriveCloudBindings(record);

    expect(bindings.filter((b) => b.role === 'anchor').map((b) => b.refno)).toEqual(['=24381/145018']);
    expect(bindings.filter((b) => b.role === 'member').map((b) => b.refno)).toEqual(record.refnos);
  });

  it('已有 bindings 时不再回退到旧字段推导', () => {
    const bindings = deriveCloudBindings(makeCloud('c3', {
      anchorRefno: '=24381/999999',
      refnos: ['=24381/888888'],
      bindings: [{ refno: '=24381/145018', role: 'member', noun: 'VALV', createdAt: 1 }],
    }));

    expect(bindings).toEqual([
      { refno: '=24381/145018', role: 'member', noun: 'VALV', createdAt: 1 },
    ]);
  });

  it('bindings 为空数组时回退到旧字段推导', () => {
    const bindings = deriveCloudBindings(makeCloud('c4', {
      refnos: ['=24381/145019'],
      bindings: [],
    }));

    expect(bindings.map((b) => b.refno)).toEqual(['=24381/145019']);
  });

  it('旧记录缺少 refnos 时使用 objectIds 作为成员兜底', () => {
    const bindings = deriveCloudBindings(makeCloud('c5', {
      objectIds: ['=24381/145019', '=24381/145020'],
    }));

    expect(bindings.map((b) => `${b.role}:${b.refno}`)).toEqual([
      'member:=24381/145019',
      'member:=24381/145020',
    ]);
  });

  it('按 refno+role 去重，并剔除空白 refno', () => {
    const bindings = deriveCloudBindings(makeCloud('c6', {
      bindings: [
        { refno: '=24381/145018', role: 'member', createdAt: 1 },
        { refno: ' =24381/145018 ', role: 'member', createdAt: 2 },
        { refno: '=24381/145018', role: 'anchor', createdAt: 3 },
        { refno: '   ', role: 'member', createdAt: 4 },
      ],
    }));

    expect(bindings).toEqual([
      { refno: '=24381/145018', role: 'member', createdAt: 1 },
      { refno: '=24381/145018', role: 'anchor', createdAt: 3 },
    ]);
  });

  it('多个 anchor 只保留首个', () => {
    const bindings = deriveCloudBindings(makeCloud('c7', {
      bindings: [
        { refno: '=24381/145018', role: 'anchor', createdAt: 1 },
        { refno: '=24381/145019', role: 'anchor', createdAt: 2 },
        { refno: '=24381/145020', role: 'member', createdAt: 3 },
      ],
    }));

    expect(bindings.map((b) => `${b.role}:${b.refno}`)).toEqual([
      'anchor:=24381/145018',
      'member:=24381/145020',
    ]);
  });

  it('getCloudMemberRefnos 只返回目标元素，不含锚点', () => {
    const refnos = getCloudMemberRefnos(makeCloud('c8', {
      anchorRefno: '=24381/145018',
      refnos: ['=24381/145019'],
    }));

    expect(refnos).toEqual(['=24381/145019']);
  });

  it('反向查找只匹配 member，且一条云线最多返回一次', () => {
    const clouds = [
      makeCloud('c9', {
        bindings: [
          { refno: 'REF/ANCHOR', role: 'anchor', createdAt: 1 },
          { refno: 'REF/A', role: 'member', createdAt: 2 },
          { refno: 'REF/B', role: 'member', createdAt: 3 },
        ],
      }),
      makeCloud('c10', {
        bindings: [{ refno: 'REF/C', role: 'member', createdAt: 4 }],
      }),
    ];

    expect(findCloudAnnotationsByMemberRefnos(clouds, ['REF/ANCHOR'])).toEqual([]);
    expect(findCloudAnnotationsByMemberRefnos(clouds, [' REF/B ', 'REF/A', 'REF/A'])).toEqual([clouds[0]]);
    expect(findCloudAnnotationsByMemberRefnos(clouds, ['REF/C', 'REF/A'])).toEqual(clouds);
  });
});

describe('useToolStore · 云线 bindings 归一', () => {
  beforeEach(clearStorage);
  afterEach(clearStorage);

  it('addCloudAnnotation 写入时由 bindings 投影全部兼容字段', () => {
    const store = useToolStore();
    store.cloudAnnotations.value = [];
    store.addCloudAnnotation(makeCloud('c1', {
      objectIds: ['legacy-object'],
      anchorRefno: '=24381/999999',
      refnos: ['=24381/888888'],
      bindings: [
        { refno: '=24381/145018', role: 'anchor', createdAt: 1 },
        { refno: '=24381/145019', role: 'member', noun: 'VALV', createdAt: 2 },
      ],
    }));

    const persisted = store.cloudAnnotations.value.find((c) => c.id === 'c1');
    expect(persisted?.bindings).toEqual([
      { refno: '=24381/145018', role: 'anchor', createdAt: 1 },
      { refno: '=24381/145019', role: 'member', noun: 'VALV', createdAt: 2 },
    ]);
    expect(persisted?.anchorRefno).toBe('=24381/145018');
    expect(persisted?.refnos).toEqual(['=24381/145019']);
    expect(persisted?.objectIds).toEqual(['=24381/145019']);
  });

  it('校审恢复链路（importJSON）同样补齐 bindings', () => {
    const store = useToolStore();
    store.clearAll();
    store.importJSON(JSON.stringify({
      version: 6,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [makeCloud('c3', {
        anchorRefno: '=24381/145018',
        refnos: ['=24381/145019'],
      })],
      rectAnnotations: [],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    }));

    const restored = store.cloudAnnotations.value.find((c) => c.id === 'c3');
    expect(restored?.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual([
      'anchor:=24381/145018',
      'member:=24381/145019',
    ]);
  });

  it('bindings 经 export → import 往返不丢失', () => {
    const store = useToolStore();
    store.clearAll();
    store.addCloudAnnotation(makeCloud('c4', {
      bindings: [{ refno: '=24381/145018', role: 'member', noun: 'VALV', createdAt: 7 }],
    }));

    const exported = store.exportJSON();
    store.clearAll();
    store.importJSON(exported);

    const restored = store.cloudAnnotations.value.find((c) => c.id === 'c4');
    expect(restored?.bindings).toEqual([
      { refno: '=24381/145018', role: 'member', noun: 'VALV', createdAt: 7 },
    ]);
    expect(restored?.refnos).toEqual(['=24381/145018']);
    expect(restored?.objectIds).toEqual(['=24381/145018']);
  });
});

describe('useToolStore · 云线目标元素集合', () => {
  beforeEach(clearStorage);
  afterEach(clearStorage);

  it('addCloudTargetRefnos 追加、去重并裁掉空白', () => {
    const store = useToolStore();
    store.clearCloudTargetRefnos();
    store.addCloudTargetRefnos(['=24381/145018', ' =24381/145019 ', '', '   ']);
    store.addCloudTargetRefnos(['=24381/145018', '=24381/145020']);

    expect(store.cloudTargetRefnos.value).toEqual([
      '=24381/145018',
      '=24381/145019',
      '=24381/145020',
    ]);
  });

  it('removeCloudTargetRefno 只移除指定项，setCloudTargetRefnos 整体覆盖', () => {
    const store = useToolStore();
    store.setCloudTargetRefnos(['=24381/145018', '=24381/145019']);
    store.removeCloudTargetRefno('=24381/145018');
    expect(store.cloudTargetRefnos.value).toEqual(['=24381/145019']);

    store.setCloudTargetRefnos(['=24381/145020']);
    expect(store.cloudTargetRefnos.value).toEqual(['=24381/145020']);
  });

  it('clearCloudTargetRefnos 清空集合', () => {
    const store = useToolStore();
    store.setCloudTargetRefnos(['=24381/145018']);
    store.clearCloudTargetRefnos();
    expect(store.cloudTargetRefnos.value).toEqual([]);
  });
});

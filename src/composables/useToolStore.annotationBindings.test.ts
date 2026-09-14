import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveAnnotationBindings,
  deriveBoxAnnotationBindings,
  deriveTextAnnotationBindings,
  findAnnotationsByMemberRefnos,
  getAnnotationAnchorRefno,
  getAnnotationMemberRefnos,
  useToolStore,
  type AnnotationRecord,
  type ObbAnnotationRecord,
  type RectAnnotationRecord,
} from './useToolStore';

const CREATED_AT = 1_700_000_000_000;

function makeText(id: string, overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id,
    entityId: 'entity-1',
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'A1',
    title: `text-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

const OBB = {
  center: [0, 0, 0] as [number, number, number],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  halfSize: [1, 1, 1] as [number, number, number],
  corners: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ] as RectAnnotationRecord['obb']['corners'],
};

function makeRect(id: string, overrides: Partial<RectAnnotationRecord> = {}): RectAnnotationRecord {
  return {
    id,
    objectIds: ['=24381/145018'],
    obb: OBB,
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `rect-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeObb(id: string, overrides: Partial<ObbAnnotationRecord> = {}): ObbAnnotationRecord {
  return {
    id,
    objectIds: ['=24381/145018', '=24381/145019'],
    obb: OBB,
    labelWorldPos: [0, 0, 1],
    anchor: { kind: 'top_center' },
    visible: true,
    title: `obb-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function clearStorage() {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
}

describe('deriveTextAnnotationBindings（ADR-0049：文字批注双角色）', () => {
  it('旧记录只有 refno 时，命中构件同时是 anchor 与 member', () => {
    const bindings = deriveTextAnnotationBindings(makeText('t1', { refno: '=24381/145018' }));
    expect(bindings).toEqual([
      { refno: '=24381/145018', role: 'anchor', createdAt: CREATED_AT },
      { refno: '=24381/145018', role: 'member', createdAt: CREATED_AT },
    ]);
  });

  it('refnos 多个时首个作 anchor，全部作 member', () => {
    const bindings = deriveTextAnnotationBindings(makeText('t2', { refnos: ['=1/1', '=1/2'] }));
    expect(bindings.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/1', 'member:=1/2']);
  });

  it('既无 refno 也无 refnos 的历史批注没有任何绑定', () => {
    expect(deriveTextAnnotationBindings(makeText('t3'))).toEqual([]);
  });

  it('已有 bindings 时以它为准，空数组代表关联已删光、不被 refno 复活', () => {
    expect(deriveTextAnnotationBindings(makeText('t4', {
      refno: '=9/9',
      bindings: [{ refno: '=1/1', role: 'member', noun: 'VALV', createdAt: 1 }],
    }))).toEqual([{ refno: '=1/1', role: 'member', noun: 'VALV', createdAt: 1 }]);
    expect(deriveTextAnnotationBindings(makeText('t5', { refno: '=9/9', bindings: [] }))).toEqual([]);
  });
});

describe('deriveBoxAnnotationBindings（rect / obb：只推导 member）', () => {
  it('rect 由 refnos 推导 member，不推导 anchor', () => {
    const bindings = deriveBoxAnnotationBindings(makeRect('r1', { refnos: ['=1/1', '=1/2'] }));
    expect(bindings.map((b) => `${b.role}:${b.refno}`)).toEqual(['member:=1/1', 'member:=1/2']);
  });

  it('缺 refnos 时用 objectIds 兜底（创建时两者同为 refno）', () => {
    expect(deriveBoxAnnotationBindings(makeObb('o1')).map((b) => b.refno)).toEqual(['=24381/145018', '=24381/145019']);
  });

  it('显式写入的 anchor 绑定照常保留', () => {
    const bindings = deriveBoxAnnotationBindings(makeRect('r2', {
      bindings: [
        { refno: '=1/1', role: 'anchor', createdAt: 1 },
        { refno: '=1/2', role: 'member', createdAt: 1 },
      ],
    }));
    expect(bindings.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/2']);
  });
});

describe('deriveAnnotationBindings / getAnnotationMemberRefnos / getAnnotationAnchorRefno', () => {
  it('按类型分派，member 不含锚点', () => {
    const text = makeText('t', { refno: '=1/1', refnos: ['=1/1', '=1/2'] });
    expect(getAnnotationMemberRefnos('text', text)).toEqual(['=1/1', '=1/2']);
    expect(getAnnotationAnchorRefno('text', text)).toBe('=1/1');

    const rect = makeRect('r', { refnos: ['=2/1'] });
    expect(deriveAnnotationBindings('rect', rect).map((b) => b.role)).toEqual(['member']);
    expect(getAnnotationAnchorRefno('rect', rect)).toBeUndefined();
  });

  it('findAnnotationsByMemberRefnos 只按 member 命中；文字批注锚点即 member 所以能命中', () => {
    const rects = [makeRect('r1', { refnos: ['=1/1'] }), makeRect('r2', { refnos: ['=1/2'] })];
    expect(findAnnotationsByMemberRefnos('rect', rects, ['=1/2']).map((r) => r.id)).toEqual(['r2']);
    expect(findAnnotationsByMemberRefnos('rect', rects, [' ', '']).map((r) => r.id)).toEqual([]);

    const onlyAnchor = makeText('t1', { bindings: [{ refno: '=3/3', role: 'anchor', createdAt: 1 }] });
    expect(findAnnotationsByMemberRefnos('text', [onlyAnchor], ['=3/3'])).toEqual([]);
  });
});

describe('useToolStore：四类批注的 bindings 读写与旧字段双写', () => {
  beforeEach(() => {
    clearStorage();
    useToolStore().clearAll();
  });

  afterEach(() => {
    useToolStore().clearAll();
    clearStorage();
  });

  it('addAnnotation 归一化后 bindings 恒存在，refno 指锚点、refnos 是 member 集合', () => {
    const store = useToolStore();
    store.addAnnotation(makeText('t1', { refno: '=1/1' }));
    const saved = store.annotations.value.find((a) => a.id === 't1')!;
    expect(saved.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/1']);
    expect(saved.refno).toBe('=1/1');
    expect(saved.refnos).toEqual(['=1/1']);
  });

  it('addAnnotationMembers / removeAnnotationMember 对文字批注生效，锚点不受影响', () => {
    const store = useToolStore();
    store.addAnnotation(makeText('t2', { refno: '=1/1' }));

    expect(store.addAnnotationMembers('text', 't2', ['=1/2', ' =1/2 ', '=1/1', ''], (r) => (r === '=1/2' ? 'VALV' : undefined))).toBe(1);
    let saved = store.annotations.value.find((a) => a.id === 't2')!;
    expect(saved.refnos).toEqual(['=1/1', '=1/2']);
    expect(saved.bindings?.find((b) => b.refno === '=1/2')?.noun).toBe('VALV');

    expect(store.removeAnnotationMember('text', 't2', '=1/1')).toBe(true);
    saved = store.annotations.value.find((a) => a.id === 't2')!;
    expect(saved.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/2']);
    expect(saved.refno).toBe('=1/1');
    expect(saved.refnos).toEqual(['=1/2']);

    expect(store.removeAnnotationMember('text', 't2', '=1/2')).toBe(true);
    saved = store.annotations.value.find((a) => a.id === 't2')!;
    expect(saved.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1']);
    expect(saved.refnos).toBeUndefined();
    expect(store.removeAnnotationMember('text', 't2', '=1/2')).toBe(false);
  });

  it('rect / obb：member 变更同步投影回 refnos 与 objectIds', () => {
    const store = useToolStore();
    store.addRectAnnotation(makeRect('r1', { refnos: ['=1/1'] }));
    store.addObbAnnotation(makeObb('o1'));

    expect(store.addAnnotationMembers('rect', 'r1', ['=1/2'])).toBe(1);
    const rect = store.rectAnnotations.value.find((a) => a.id === 'r1')!;
    expect(rect.refnos).toEqual(['=1/1', '=1/2']);
    expect(rect.objectIds).toEqual(['=1/1', '=1/2']);

    expect(store.removeAnnotationMember('obb', 'o1', '=24381/145018')).toBe(true);
    const obb = store.obbAnnotations.value.find((a) => a.id === 'o1')!;
    expect(obb.refnos).toEqual(['=24381/145019']);
    expect(obb.objectIds).toEqual(['=24381/145019']);
    expect(obb.bindings).toEqual([{ refno: '=24381/145019', role: 'member', createdAt: CREATED_AT }]);
  });

  it('云线旧入口仍可用（委托给通用实现）', () => {
    const store = useToolStore();
    store.addCloudAnnotation({
      id: 'c1',
      objectIds: ['=1/1'],
      anchorWorldPos: [0, 0, 0],
      anchorRefno: '=0/0',
      visible: true,
      title: 'c',
      description: '',
      createdAt: CREATED_AT,
    });
    expect(store.addCloudAnnotationMembers('c1', ['=1/2'])).toBe(1);
    expect(store.removeCloudAnnotationMember('c1', '=1/1')).toBe(true);
    const cloud = store.cloudAnnotations.value.find((a) => a.id === 'c1')!;
    expect(cloud.anchorRefno).toBe('=0/0');
    expect(cloud.refnos).toEqual(['=1/2']);
  });

  it('findAnnotationsByMemberRefnosAcrossTypes 覆盖四类，顺序 text → cloud → rect → obb', () => {
    const store = useToolStore();
    store.addAnnotation(makeText('t', { refno: '=1/1' }));
    store.addCloudAnnotation({
      id: 'c', objectIds: ['=1/1'], anchorWorldPos: [0, 0, 0], visible: true, title: 'c', description: '', createdAt: CREATED_AT,
    });
    store.addRectAnnotation(makeRect('r', { refnos: ['=1/1'] }));
    store.addObbAnnotation(makeObb('o', { objectIds: ['=1/1'], refnos: ['=1/1'] }));
    store.addRectAnnotation(makeRect('r-other', { refnos: ['=9/9'] }));

    const hits = store.findAnnotationsByMemberRefnosAcrossTypes(['=1/1']);
    expect(hits.map((h) => `${h.type}:${h.record.id}`)).toEqual(['text:t', 'cloud:c', 'rect:r', 'obb:o']);
    expect(store.findAnnotationsByMemberRefnosAcrossTypes([])).toEqual([]);
  });

  it('export / import 往返：四类批注的 bindings 与旧字段都保留，且再导出逐字节相同', () => {
    const store = useToolStore();
    store.addAnnotation(makeText('t', { refno: '=1/1' }));
    store.addRectAnnotation(makeRect('r', { refnos: ['=2/1', '=2/2'] }));
    store.addObbAnnotation(makeObb('o'));
    store.addAnnotationMembers('text', 't', ['=1/2']);

    const firstExport = store.exportJSON();
    const parsed = JSON.parse(firstExport) as {
      annotations: AnnotationRecord[];
      rectAnnotations: RectAnnotationRecord[];
      obbAnnotations: ObbAnnotationRecord[];
    };
    const text = parsed.annotations.find((a) => a.id === 't')!;
    expect(text.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/1', 'member:=1/2']);
    expect(text.refno).toBe('=1/1');
    expect(text.refnos).toEqual(['=1/1', '=1/2']);
    const rect = parsed.rectAnnotations.find((a) => a.id === 'r')!;
    expect(rect.bindings?.map((b) => b.refno)).toEqual(['=2/1', '=2/2']);
    const obb = parsed.obbAnnotations.find((a) => a.id === 'o')!;
    expect(obb.bindings).toHaveLength(2);

    store.clearAll();
    store.importJSON(firstExport);
    expect(store.exportJSON()).toBe(firstExport);
    expect(getAnnotationMemberRefnos('text', store.annotations.value.find((a) => a.id === 't')!)).toEqual(['=1/1', '=1/2']);
  });

  it('旧格式（无 bindings 字段）导入后按 ADR-0049 推导，不改旧字段', () => {
    const store = useToolStore();
    store.importJSON(JSON.stringify({
      version: 6,
      measurements: [],
      annotations: [{ ...makeText('legacy-t'), refno: '=1/1' }],
      obbAnnotations: [makeObb('legacy-o')],
      cloudAnnotations: [],
      rectAnnotations: [makeRect('legacy-r', { refnos: ['=2/1'] })],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    }));
    const text = store.annotations.value.find((a) => a.id === 'legacy-t')!;
    expect(text.bindings?.map((b) => `${b.role}:${b.refno}`)).toEqual(['anchor:=1/1', 'member:=1/1']);
    expect(text.refno).toBe('=1/1');
    expect(store.rectAnnotations.value.find((a) => a.id === 'legacy-r')?.bindings)
      .toEqual([{ refno: '=2/1', role: 'member', createdAt: CREATED_AT }]);
    expect(store.obbAnnotations.value.find((a) => a.id === 'legacy-o')?.bindings?.map((b) => b.refno))
      .toEqual(['=24381/145018', '=24381/145019']);
  });
});
